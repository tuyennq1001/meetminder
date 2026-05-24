// Qwen-Omni Realtime translate provider — backend WebSocket bridge.
//
// Mirrors `openai_realtime.rs` but for Alibaba DashScope's Qwen-Omni model.
// Key differences from OpenAI:
//   - WS URL: dashscope-intl + ?model=qwen3.5-omni-plus-realtime
//   - Audio is pcm16 @ 16kHz (NO resampling — Soniox pipeline native rate)
//   - Server-VAD is DISABLED. Benchmarks (variant K) showed Qwen's server-VAD
//     drops 33-80% of translated content. We run client-side RMS-based silence
//     detection in Rust and fire `input_audio_buffer.commit` + `response.create`
//     at natural pauses. See:
//     plans/reports/benchmark-260523-0701-qwen-coherence-improvement.md
//   - Event schema matches OpenAI legacy realtime (no `session.*` prefix on
//     transcript events): response.text.delta / response.audio_transcript.delta
//     / conversation.item.input_audio_transcription.completed.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use http::Request;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const QWEN_REALTIME_URL: &str =
    "wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-plus-realtime";

// Client-side RMS-VAD tunables (variant K, tuned on Hope-v2 benchmark).
const SILENCE_RMS: f32 = 500.0; // int16 amplitude
const SILENCE_MS: u32 = 400;
const MIN_WINDOW_MS: u32 = 2000;
const MAX_WINDOW_MS: u32 = 7000;
const SAMPLE_RATE_HZ: u32 = 16_000;
const BYTES_PER_SAMPLE: u32 = 2;

#[derive(Debug, Deserialize)]
pub struct QwenRealtimeConfig {
    pub api_key: String,
    /// BCP-47-ish code (e.g. "vi") — kept for symmetry with other engines /
    /// future use, but the actual language directive sent to Qwen uses the
    /// human-readable `target_language_name`.
    #[allow(dead_code)]
    pub target_language: String,
    pub target_language_name: String,
    #[serde(default = "default_true")]
    pub audio_output: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum QwenEvent {
    Status {
        state: String,
        message: Option<String>,
    },
    Transcript {
        text: String,
        is_final: bool,
    },
    SourceTranscript {
        text: String,
        is_final: bool,
    },
    AudioChunk {
        pcm_base64: String,
    },
    Error {
        code: String,
        message: String,
    },
    Closed {
        reason: String,
    },
}

struct Session {
    audio_tx: mpsc::UnboundedSender<Vec<u8>>,
    stop_tx: mpsc::UnboundedSender<()>,
}

#[derive(Default)]
pub struct QwenState {
    sessions: Mutex<HashMap<u64, Session>>,
    next_id: Mutex<u64>,
}

#[tauri::command]
pub async fn qwen_realtime_start(
    config: QwenRealtimeConfig,
    on_event: Channel<QwenEvent>,
    state: State<'_, QwenState>,
) -> Result<u64, String> {
    if config.api_key.trim().is_empty() {
        return Err("Qwen (DashScope) API key is empty".into());
    }

    let session_id = {
        let mut id = state.next_id.lock().unwrap();
        *id += 1;
        *id
    };

    let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (stop_tx, stop_rx) = mpsc::unbounded_channel::<()>();

    let session = Session { audio_tx, stop_tx };
    state.sessions.lock().unwrap().insert(session_id, session);

    let event_ch = on_event.clone();

    tokio::spawn(async move {
        let _ = event_ch.send(QwenEvent::Status {
            state: "connecting".into(),
            message: None,
        });

        if let Err(e) = run_session(config, audio_rx, stop_rx, event_ch.clone()).await {
            let _ = event_ch.send(QwenEvent::Error {
                code: "session_failed".into(),
                message: e,
            });
        }

        let _ = event_ch.send(QwenEvent::Closed {
            reason: "session_ended".into(),
        });
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn qwen_realtime_send_audio(
    session_id: u64,
    pcm: Vec<u8>,
    state: State<'_, QwenState>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session {} not found", session_id))?;

    session
        .audio_tx
        .send(pcm)
        .map_err(|e| format!("send audio failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn qwen_realtime_stop(
    session_id: u64,
    state: State<'_, QwenState>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.remove(&session_id) {
        let _ = session.stop_tx.send(());
    }
    Ok(())
}

async fn run_session(
    cfg: QwenRealtimeConfig,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    mut stop_rx: mpsc::UnboundedReceiver<()>,
    event_ch: Channel<QwenEvent>,
) -> Result<(), String> {
    let request = Request::builder()
        .uri(QWEN_REALTIME_URL)
        .header("Authorization", format!("Bearer {}", cfg.api_key))
        .header("Host", "dashscope-intl.aliyuncs.com")
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header(
            "Sec-WebSocket-Key",
            tokio_tungstenite::tungstenite::handshake::client::generate_key(),
        )
        .body(())
        .map_err(|e| format!("build request: {}", e))?;

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("websocket connect: {}", e))?;

    let (mut ws_sink, mut ws_stream) = ws_stream.split();

    let session_update = build_session_update(&cfg);
    ws_sink
        .send(Message::Text(session_update.into()))
        .await
        .map_err(|e| format!("send session.update: {}", e))?;

    let _ = event_ch.send(QwenEvent::Status {
        state: "ready".into(),
        message: None,
    });

    // RMS-VAD turn state (variant K).
    let mut window_ms: u32 = 0;
    let mut silence_ms: u32 = 0;
    let mut has_audio_in_window = false;
    // Single-flight guard: don't fire response.create while server still
    // streaming a previous turn — that causes Qwen InternalError mid-session.
    let mut response_in_flight = false;
    let mut last_done_response_id: Option<String> = None;

    loop {
        tokio::select! {
            biased;

            _ = stop_rx.recv() => {
                if has_audio_in_window && window_ms > 0 && !response_in_flight {
                    commit_turn(&mut ws_sink).await.ok();
                }
                let _ = ws_sink.send(Message::Close(None)).await;
                break;
            }

            Some(pcm) = audio_rx.recv() => {
                // 1. Forward audio to Qwen
                let b64 = B64.encode(&pcm);
                let evt = serde_json::json!({
                    "type": "input_audio_buffer.append",
                    "audio": b64,
                });
                if let Err(e) = ws_sink.send(Message::Text(evt.to_string().into())).await {
                    return Err(format!("send audio: {}", e));
                }

                // 2. RMS-VAD turn control
                let chunk_ms = (pcm.len() as u32 * 1000)
                    / (SAMPLE_RATE_HZ * BYTES_PER_SAMPLE);
                let energy = rms_int16(&pcm);
                window_ms += chunk_ms;
                if energy >= SILENCE_RMS {
                    silence_ms = 0;
                    has_audio_in_window = true;
                } else {
                    silence_ms += chunk_ms;
                }

                // Skip windows with no real speech (avoids pre-speech echoes).
                if !has_audio_in_window {
                    if window_ms >= MAX_WINDOW_MS {
                        window_ms = 0;
                        silence_ms = 0;
                    }
                    continue;
                }

                let hit_max = window_ms >= MAX_WINDOW_MS;
                let hit_pause = window_ms >= MIN_WINDOW_MS && silence_ms >= SILENCE_MS;
                if (hit_max || hit_pause) && !response_in_flight {
                    if commit_turn(&mut ws_sink).await.is_ok() {
                        response_in_flight = true;
                        window_ms = 0;
                        silence_ms = 0;
                        has_audio_in_window = false;
                    }
                }
            }

            msg = ws_stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_server_event(
                            &text,
                            &event_ch,
                            &mut response_in_flight,
                            &mut last_done_response_id,
                        );
                    }
                    Some(Ok(Message::Binary(_))) => {}
                    Some(Ok(Message::Close(frame))) => {
                        let reason = frame
                            .map(|f| format!("{}: {}", f.code, f.reason))
                            .unwrap_or_else(|| "remote_close".into());
                        let _ = event_ch.send(QwenEvent::Closed { reason });
                        break;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => return Err(format!("ws error: {}", e)),
                    None => break,
                }
            }
        }
    }

    Ok(())
}

async fn commit_turn<S>(ws_sink: &mut S) -> Result<(), String>
where
    S: SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    let commit = serde_json::json!({"type": "input_audio_buffer.commit"});
    ws_sink
        .send(Message::Text(commit.to_string().into()))
        .await
        .map_err(|e| format!("commit: {}", e))?;
    let create = serde_json::json!({"type": "response.create"});
    ws_sink
        .send(Message::Text(create.to_string().into()))
        .await
        .map_err(|e| format!("response.create: {}", e))?;
    Ok(())
}

fn build_session_update(cfg: &QwenRealtimeConfig) -> String {
    // Hardened instructions — same as mobile variant K. Enforce target
    // language, output-only, pronoun continuity, full-translate.
    let instructions = format!(
        "You are a professional simultaneous interpreter translating one \
         speaker's talk into {name}. RULES: \
         (1) Use consistent singular pronouns for the speaker across turns \
         — refer to them the same way every time. \
         (2) Preserve continuity from earlier turns in this session; if a \
         sentence was cut mid-thought in a prior turn, continue smoothly. \
         (3) Translate EVERY utterance fully — never stay silent. \
         (4) Output ONLY the {name} translation, no source, no commentary.",
        name = cfg.target_language_name
    );

    let modalities = if cfg.audio_output {
        serde_json::json!(["text", "audio"])
    } else {
        serde_json::json!(["text"])
    };

    let session = serde_json::json!({
        "modalities": modalities,
        "voice": "Tina",
        "input_audio_format": "pcm",
        "output_audio_format": "pcm",
        "instructions": instructions,
        // Disable server-VAD — we drive commits manually (variant K).
        "turn_detection": serde_json::Value::Null,
    });

    serde_json::json!({
        "type": "session.update",
        "session": session,
    })
    .to_string()
}

fn handle_server_event(
    text: &str,
    event_ch: &Channel<QwenEvent>,
    response_in_flight: &mut bool,
    last_done_response_id: &mut Option<String>,
) {
    let value: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };

    let evt_type = match value.get("type").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return,
    };

    eprintln!("[qwen-realtime] event: {}", evt_type);

    match evt_type {
        "session.created" | "session.updated" => {
            if let Some(sess) = value.get("session") {
                eprintln!("[qwen-realtime] {} session: {}", evt_type, sess);
            }
        }
        "response.created" => {
            *response_in_flight = true;
        }
        "response.done" => {
            *response_in_flight = false;
        }
        "conversation.item.input_audio_transcription.completed" => {
            let t = value
                .get("transcript")
                .and_then(|v| v.as_str())
                .or_else(|| value.get("text").and_then(|v| v.as_str()));
            if let Some(t) = t {
                eprintln!("[qwen-realtime] SRC: {}", &t.chars().take(120).collect::<String>());
                let _ = event_ch.send(QwenEvent::SourceTranscript {
                    text: t.into(),
                    is_final: true,
                });
            }
        }
        "conversation.item.input_audio_transcription.failed" => {
            let code = value
                .get("error")
                .and_then(|e| e.get("code"))
                .and_then(|v| v.as_str())
                .unwrap_or("transcription_failed")
                .to_string();
            let msg = value
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("Transcription failed")
                .to_string();
            let _ = event_ch.send(QwenEvent::Error { code, message: msg });
        }
        "response.text.delta" | "response.audio_transcript.delta" => {
            if let Some(delta) = value.get("delta").and_then(|v| v.as_str()) {
                let _ = event_ch.send(QwenEvent::Transcript {
                    text: delta.into(),
                    is_final: false,
                });
            }
        }
        "response.text.done" | "response.audio_transcript.done" => {
            // text + audio_transcript both finalize one response — emit once.
            let response_id = value
                .get("response_id")
                .and_then(|v| v.as_str())
                .or_else(|| value.get("item_id").and_then(|v| v.as_str()))
                .map(|s| s.to_string());

            if let (Some(rid), Some(last)) = (response_id.as_ref(), last_done_response_id.as_ref())
            {
                if rid == last {
                    return;
                }
            }
            *last_done_response_id = response_id;

            let t = value
                .get("text")
                .and_then(|v| v.as_str())
                .or_else(|| value.get("transcript").and_then(|v| v.as_str()));
            if let Some(t) = t {
                eprintln!("[qwen-realtime] DONE: {}", &t.chars().take(120).collect::<String>());
                let _ = event_ch.send(QwenEvent::Transcript {
                    text: t.into(),
                    is_final: true,
                });
            }
        }
        "response.audio.delta" => {
            if let Some(b64) = value.get("delta").and_then(|v| v.as_str()) {
                let _ = event_ch.send(QwenEvent::AudioChunk {
                    pcm_base64: b64.into(),
                });
            }
        }
        "error" => {
            let code = value
                .get("error")
                .and_then(|e| e.get("code"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let msg = value
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let _ = event_ch.send(QwenEvent::Error { code, message: msg });
        }
        _ => {}
    }
}

/// RMS amplitude of int16 little-endian PCM in a byte slice.
fn rms_int16(buf: &[u8]) -> f32 {
    let n = buf.len() / 2;
    if n == 0 {
        return 0.0;
    }
    let mut sum: f64 = 0.0;
    for i in 0..n {
        let s = i16::from_le_bytes([buf[i * 2], buf[i * 2 + 1]]) as f64;
        sum += s * s;
    }
    (sum / n as f64).sqrt() as f32
}
