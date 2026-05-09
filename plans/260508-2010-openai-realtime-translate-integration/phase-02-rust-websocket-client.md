# Phase 2 — Rust WebSocket Client to OpenAI Realtime

**Status:** ☑ Done
**Estimate:** 4h
**Owner:** Rust backend
**Depends on:** phase 1

## Overview

Implement the actual WebSocket connection from Rust to `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`. Send PCM audio (resampled to 24kHz), parse server events, forward translated text + audio chunks to the frontend via the Tauri Channel set up in phase 1.

## Key insights from research

- WebSocket auth via `Authorization: Bearer {key}` header — Rust `tokio-tungstenite` supports custom headers via `Request::builder()`.
- Audio chunks sent as Base64-encoded `input_audio_buffer.append` events. Send every ~100ms for low latency.
- Server events to handle:
  - `session.created` — confirm config, mark connected.
  - `input_audio_buffer.speech_started` / `speech_stopped` — VAD signals.
  - `response.audio_transcript.delta` — translated text deltas.
  - `response.audio.delta` — translated audio Base64 chunks (24kHz s16le).
  - `response.audio_transcript.done` — final transcript line.
  - `response.done` — turn complete.
  - `error` — surface to UI.
- Session config sent via `session.update` after `session.created`.
- 60-min hard limit; auto-reconnect with `previous_response_id` to preserve context.

## Related code files

- MODIFY: `src-tauri/src/commands/openai_realtime.rs` — fill in the 3 stub commands
- USE: `src-tauri/src/audio/resampler.rs` (from phase 1)
- REFERENCE: [src/js/soniox.js](../../src/js/soniox.js) — keep callback shape similar for easy frontend swap

## Architecture

```
JS frontend                 Rust backend                       OpenAI
────────────                ─────────────                      ──────
start({api_key, src,tgt})    → spawn task ──→
                              connect WSS w/ Bearer header  →
                              recv session.created          ←
                              send session.update          →
                              ready (emit Status::Ready)
sendAudio(pcm 16k bytes)     → resampler.process            
                              → ws.send(append base64 24k)  →
                                                            ← response.audio_transcript.delta
                              parse → emit Transcript      
                                                            ← response.audio.delta
                              parse → emit AudioChunk      
stop(session_id)             → ws.close()                   
                              → emit Closed
```

## Implementation steps

### 1. Session state

In `commands/openai_realtime.rs`, add a top-level state map:

```rust
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::mpsc;

static NEXT_ID: Mutex<u64> = Mutex::new(1);

pub struct SessionHandle {
    pub audio_tx: mpsc::UnboundedSender<Vec<u8>>,  // PCM 16kHz s16le
    pub stop_tx: mpsc::UnboundedSender<()>,
}

pub struct OpenAiState {
    pub sessions: Mutex<HashMap<u64, SessionHandle>>,
}

impl OpenAiState {
    pub fn new() -> Self { Self { sessions: Mutex::new(HashMap::new()) } }
}
```

Register state in `lib.rs`:

```rust
.manage(commands::openai_realtime::OpenAiState::new())
```

### 2. WebSocket connect helper

```rust
use http::Request;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

async fn connect_openai(api_key: &str) -> Result<WsStream, String> {
    let url = "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate";
    let req = Request::builder()
        .method("GET")
        .uri(url)
        .header("Host", "api.openai.com")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("OpenAI-Beta", "realtime=v1")  // verify still required at GA
        .header("Upgrade", "websocket")
        .header("Connection", "Upgrade")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_ws_key())
        .body(())
        .map_err(|e| format!("ws request build: {e}"))?;

    let (ws, _resp) = connect_async(req).await
        .map_err(|e| format!("ws connect: {e}"))?;
    Ok(ws)
}
```

Note: `tokio-tungstenite::connect_async` accepts a `Request<()>` directly; it adds the WS upgrade headers automatically — only `Authorization` and `OpenAI-Beta` are needed manually. Strip the manual upgrade headers if so.

### 3. Session.update payload

```rust
fn build_session_update(cfg: &OpenAiRealtimeConfig) -> serde_json::Value {
    serde_json::json!({
        "type": "session.update",
        "session": {
            "modalities": ["text", "audio"],
            "input_audio_format": "pcm16",
            "output_audio_format": "pcm16",
            "input_audio_transcription": null,
            "turn_detection": {
                "type": "server_vad",
                "threshold": 0.5,
                "prefix_padding_ms": 300,
                "silence_duration_ms": 500
            },
            "voice": cfg.voice.clone().unwrap_or_else(|| "alloy".into()),
            // Translation-specific: target language for output
            "translation": {
                "target_language": cfg.target_language,
                "source_language_hint": cfg.source_language
            }
        }
    })
}
```

⚠️ The exact translation config schema needs verification against OpenAI cookbook (research report linked it). If the API uses `output.language` instead of `translation.target_language`, adjust here.

### 4. Main task loop — `run_session`

```rust
async fn run_session(
    cfg: OpenAiRealtimeConfig,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    mut stop_rx: mpsc::UnboundedReceiver<()>,
    on_event: Channel<OpenAiEvent>,
) {
    use futures_util::{SinkExt, StreamExt};
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let _ = on_event.send(OpenAiEvent::Status { state: "connecting".into(), message: None });

    let ws = match connect_openai(&cfg.api_key).await {
        Ok(w) => w,
        Err(e) => { let _ = on_event.send(OpenAiEvent::Error { code: "connect_failed".into(), message: e }); return; }
    };
    let (mut write, mut read) = ws.split();

    // Send session.update
    let cfg_msg = build_session_update(&cfg);
    if let Err(e) = write.send(Message::Text(cfg_msg.to_string())).await {
        let _ = on_event.send(OpenAiEvent::Error { code: "send_failed".into(), message: e.to_string() });
        return;
    }

    let _ = on_event.send(OpenAiEvent::Status { state: "ready".into(), message: None });

    // Resampler 16k→24k
    let mut resampler = match crate::audio::resampler::UpsamplerTo24k::new(1024) {
        Ok(r) => r,
        Err(e) => { let _ = on_event.send(OpenAiEvent::Error { code: "resample_init".into(), message: e }); return; }
    };

    loop {
        tokio::select! {
            // Stop signal
            _ = stop_rx.recv() => {
                let _ = write.send(Message::Close(None)).await;
                let _ = on_event.send(OpenAiEvent::Closed { reason: "user_stop".into() });
                break;
            }
            // Outgoing audio
            Some(pcm16k) = audio_rx.recv() => {
                let pcm24k = match resampler.process(&pcm16k) {
                    Ok(b) => b,
                    Err(e) => { let _ = on_event.send(OpenAiEvent::Error { code: "resample".into(), message: e }); continue; }
                };
                if pcm24k.is_empty() { continue; }
                let b64 = STANDARD.encode(&pcm24k);
                let evt = serde_json::json!({
                    "type": "input_audio_buffer.append",
                    "audio": b64
                });
                if let Err(e) = write.send(Message::Text(evt.to_string())).await {
                    let _ = on_event.send(OpenAiEvent::Error { code: "send_audio".into(), message: e.to_string() });
                    break;
                }
            }
            // Incoming server events
            Some(msg) = read.next() => {
                match msg {
                    Ok(Message::Text(txt)) => handle_server_event(&txt, &on_event),
                    Ok(Message::Close(c)) => {
                        let reason = c.map(|f| f.reason.to_string()).unwrap_or_default();
                        let _ = on_event.send(OpenAiEvent::Closed { reason });
                        break;
                    }
                    Err(e) => {
                        let _ = on_event.send(OpenAiEvent::Error { code: "ws_error".into(), message: e.to_string() });
                        break;
                    }
                    _ => {}
                }
            }
        }
    }
}
```

### 5. Server event parser — `handle_server_event`

```rust
fn handle_server_event(raw: &str, ch: &Channel<OpenAiEvent>) {
    let v: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return,
    };
    let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match kind {
        "session.created" | "session.updated" => {
            // ack only; status already emitted
        }
        "response.audio_transcript.delta" => {
            if let Some(d) = v.get("delta").and_then(|x| x.as_str()) {
                let _ = ch.send(OpenAiEvent::Transcript { text: d.into(), is_final: false });
            }
        }
        "response.audio_transcript.done" => {
            if let Some(t) = v.get("transcript").and_then(|x| x.as_str()) {
                let _ = ch.send(OpenAiEvent::Transcript { text: t.into(), is_final: true });
            }
        }
        "response.audio.delta" => {
            if let Some(d) = v.get("delta").and_then(|x| x.as_str()) {
                let _ = ch.send(OpenAiEvent::AudioChunk { pcm_base64: d.into() });
            }
        }
        "input_audio_buffer.speech_started" => {
            let _ = ch.send(OpenAiEvent::Status { state: "speech_started".into(), message: None });
        }
        "input_audio_buffer.speech_stopped" => {
            let _ = ch.send(OpenAiEvent::Status { state: "speech_stopped".into(), message: None });
        }
        "error" => {
            let code = v.pointer("/error/code").and_then(|x| x.as_str()).unwrap_or("error").into();
            let message = v.pointer("/error/message").and_then(|x| x.as_str()).unwrap_or("").into();
            let _ = ch.send(OpenAiEvent::Error { code, message });
        }
        _ => {}
    }
}
```

### 6. Wire start/send/stop commands

```rust
#[tauri::command]
pub async fn openai_realtime_start(
    config: OpenAiRealtimeConfig,
    on_event: Channel<OpenAiEvent>,
    state: tauri::State<'_, OpenAiState>,
) -> Result<u64, String> {
    let id = { let mut n = NEXT_ID.lock().unwrap(); let v = *n; *n += 1; v };
    let (audio_tx, audio_rx) = mpsc::unbounded_channel();
    let (stop_tx, stop_rx) = mpsc::unbounded_channel();
    state.sessions.lock().unwrap().insert(id, SessionHandle { audio_tx, stop_tx });

    tokio::spawn(run_session(config, audio_rx, stop_rx, on_event));
    Ok(id)
}

#[tauri::command]
pub async fn openai_realtime_send_audio(
    session_id: u64,
    pcm: Vec<u8>,
    state: tauri::State<'_, OpenAiState>,
) -> Result<(), String> {
    let g = state.sessions.lock().unwrap();
    let h = g.get(&session_id).ok_or("no such session")?;
    h.audio_tx.send(pcm).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn openai_realtime_stop(
    session_id: u64,
    state: tauri::State<'_, OpenAiState>,
) -> Result<(), String> {
    let mut g = state.sessions.lock().unwrap();
    if let Some(h) = g.remove(&session_id) {
        let _ = h.stop_tx.send(());
    }
    Ok(())
}
```

### 7. Auto-reconnect on session limit

When `Closed` arrives with reason matching 60-min limit or `1006`, the frontend handles reconnect by calling `start` again (simpler than backend-side restart). Defer auto-context-resume (`previous_response_id`) to v2 — accept brief gap.

## Todo list

- [ ] Add `OpenAiState` and register via `.manage()`
- [ ] Implement `connect_openai` with auth headers
- [ ] Implement `build_session_update` (verify schema against OpenAI cookbook)
- [ ] Implement `run_session` task loop
- [ ] Implement `handle_server_event` parser
- [ ] Wire `start`, `send_audio`, `stop` commands
- [ ] Test connection succeeds with real API key (manual step — needs phase 4 UI)
- [ ] `cargo check` + `cargo build` pass

## Success criteria

- Session connects to OpenAI, receives `session.created`, sends `session.update`, gets `session.updated` ack.
- Sending PCM 16kHz audio results in `response.audio_transcript.delta` events arriving.
- `response.audio.delta` events arrive in parallel and are forwarded to frontend as Base64.
- Stop command cleanly closes WebSocket; no zombie tasks.

## Risks

- **`tokio-tungstenite` version conflict** — pick same version as already in deps if any. Rustls features must align with `reqwest`/other deps.
- **Schema drift** — `session.update` translation config not 100% pinned by research. First test may need iteration; surface raw `error` events to UI to diagnose.
- **Backpressure** — `mpsc::unbounded_channel` for audio is fine for short bursts but a pathological user could OOM. v1 acceptable; revisit with `bounded(64)` if observed.

## Security

- API key passed via Tauri command argument (in-process); never crosses an external boundary.
- TLS via `rustls-tls-webpki-roots` to match existing `reqwest` config.

## Next steps

→ Phase 3 wires the frontend JS to call these 3 commands and play the audio chunks.
