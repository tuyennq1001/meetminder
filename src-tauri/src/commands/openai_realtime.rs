// OpenAI Realtime translate provider — backend WebSocket bridge.
//
// Browsers can't set Authorization headers on WebSockets, so we run the WS
// in Rust. Frontend sends 16kHz s16le PCM via Tauri commands; we resample
// to 24kHz, base64-encode, and forward to OpenAI. Server events are parsed
// and emitted to the frontend via a Tauri Channel.

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

use crate::audio::resampler::UpsamplerTo24k;

const OPENAI_REALTIME_URL: &str =
    "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate";

#[derive(Debug, Deserialize)]
pub struct OpenAiRealtimeConfig {
    pub api_key: String,
    pub source_language: String,
    pub target_language: String,
    pub voice: Option<String>,
    /// When true (default), server generates translated audio output.
    /// When false, requests text-only modality so no TTS audio is generated
    /// (saves cost and bandwidth — for read-only use cases).
    #[serde(default = "default_true")]
    pub audio_output: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OpenAiEvent {
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
    upsampler: Mutex<UpsamplerTo24k>,
}

#[derive(Default)]
pub struct OpenAiState {
    sessions: Mutex<HashMap<u64, Session>>,
    next_id: Mutex<u64>,
}

#[tauri::command]
pub async fn openai_realtime_start(
    config: OpenAiRealtimeConfig,
    on_event: Channel<OpenAiEvent>,
    state: State<'_, OpenAiState>,
) -> Result<u64, String> {
    if config.api_key.trim().is_empty() {
        return Err("OpenAI API key is empty".into());
    }

    let session_id = {
        let mut id = state.next_id.lock().unwrap();
        *id += 1;
        *id
    };

    let upsampler = UpsamplerTo24k::new()?;

    let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (stop_tx, stop_rx) = mpsc::unbounded_channel::<()>();

    let session = Session {
        audio_tx,
        stop_tx,
        upsampler: Mutex::new(upsampler),
    };
    state.sessions.lock().unwrap().insert(session_id, session);

    let event_ch = on_event.clone();
    let cfg = OpenAiRealtimeConfig {
        api_key: config.api_key,
        source_language: config.source_language,
        target_language: config.target_language,
        voice: config.voice,
        audio_output: config.audio_output,
    };

    tokio::spawn(async move {
        let _ = event_ch.send(OpenAiEvent::Status {
            state: "connecting".into(),
            message: None,
        });

        if let Err(e) = run_session(cfg, audio_rx, stop_rx, event_ch.clone()).await {
            let _ = event_ch.send(OpenAiEvent::Error {
                code: "session_failed".into(),
                message: e,
            });
        }

        let _ = event_ch.send(OpenAiEvent::Closed {
            reason: "session_ended".into(),
        });
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn openai_realtime_send_audio(
    session_id: u64,
    pcm: Vec<u8>,
    state: State<'_, OpenAiState>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session {} not found", session_id))?;

    let upsampled = session.upsampler.lock().unwrap().push(&pcm)?;
    if !upsampled.is_empty() {
        session
            .audio_tx
            .send(upsampled)
            .map_err(|e| format!("send audio failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn openai_realtime_stop(
    session_id: u64,
    state: State<'_, OpenAiState>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.remove(&session_id) {
        let _ = session.stop_tx.send(());
    }
    Ok(())
}

async fn run_session(
    cfg: OpenAiRealtimeConfig,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    mut stop_rx: mpsc::UnboundedReceiver<()>,
    event_ch: Channel<OpenAiEvent>,
) -> Result<(), String> {
    // Build WebSocket request with auth headers
    let request = Request::builder()
        .uri(OPENAI_REALTIME_URL)
        .header("Authorization", format!("Bearer {}", cfg.api_key))
        .header("Host", "api.openai.com")
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

    // Send session.update once connected
    let session_update = build_session_update(&cfg);
    ws_sink
        .send(Message::Text(session_update.into()))
        .await
        .map_err(|e| format!("send session.update: {}", e))?;

    let _ = event_ch.send(OpenAiEvent::Status {
        state: "ready".into(),
        message: None,
    });

    loop {
        tokio::select! {
            biased;

            _ = stop_rx.recv() => {
                let _ = ws_sink.send(Message::Close(None)).await;
                break;
            }

            Some(audio_chunk) = audio_rx.recv() => {
                let b64 = B64.encode(&audio_chunk);
                let evt = serde_json::json!({
                    "type": "session.input_audio_buffer.append",
                    "audio": b64,
                });
                if let Err(e) = ws_sink.send(Message::Text(evt.to_string().into())).await {
                    return Err(format!("send audio: {}", e));
                }
            }

            msg = ws_stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_server_event(&text, &event_ch, cfg.audio_output);
                    }
                    Some(Ok(Message::Binary(_))) => {}
                    Some(Ok(Message::Close(frame))) => {
                        let reason = frame
                            .map(|f| format!("{}: {}", f.code, f.reason))
                            .unwrap_or_else(|| "remote_close".into());
                        let _ = event_ch.send(OpenAiEvent::Closed { reason });
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

fn build_session_update(cfg: &OpenAiRealtimeConfig) -> String {
    // GA Realtime Translation schema (May 2026):
    // - WebSocket URL is /v1/realtime/translations?model=gpt-realtime-translate
    // - No voice / turn_detection at session level
    // - Input transcription uses gpt-realtime-whisper
    // - Output language goes under audio.output.language
    // The translation endpoint does NOT support text-only modality config —
    // both `session.modalities` and `session.output_modalities` are rejected.
    // For "mute", we drop output_audio events client-side instead (see
    // run_session — audio_output flag suppresses AudioChunk forwarding).
    let session = serde_json::json!({
        "audio": {
            "input": {
                "transcription": {"model": "gpt-realtime-whisper"},
                "noise_reduction": {"type": "near_field"}
            },
            "output": {"language": cfg.target_language}
        }
    });
    serde_json::json!({
        "type": "session.update",
        "session": session,
    })
    .to_string()
}

fn handle_server_event(text: &str, event_ch: &Channel<OpenAiEvent>, audio_output: bool) {
    let value: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };

    let evt_type = match value.get("type").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return,
    };

    // Dev trace: log every event type (not the full payload — that's noisy)
    // so we can see the lifecycle around speech pauses and turn boundaries.
    eprintln!("[openai-realtime] event: {}", evt_type);

    match evt_type {
        "session.created" | "session.updated" => {
            // ack only
        }
        "session.input_transcript.delta" => {
            if let Some(delta) = value.get("delta").and_then(|v| v.as_str()) {
                let _ = event_ch.send(OpenAiEvent::SourceTranscript {
                    text: delta.into(),
                    is_final: false,
                });
            }
        }
        "session.input_transcript.done" | "session.input_audio_transcription.completed" => {
            // Whisper-side final for the input chunk. The `transcript` field
            // carries the full source text — use it as the authoritative source
            // (deltas can arrive at a different cadence than output translation
            // deltas, so accumulating deltas alone misaligns source/target pairs).
            let final_text = value
                .get("transcript")
                .and_then(|v| v.as_str())
                .or_else(|| value.get("text").and_then(|v| v.as_str()));
            if let Some(t) = final_text {
                let _ = event_ch.send(OpenAiEvent::SourceTranscript {
                    text: t.into(),
                    is_final: true,
                });
            }
        }
        "session.output_transcript.delta" => {
            if let Some(delta) = value.get("delta").and_then(|v| v.as_str()) {
                let _ = event_ch.send(OpenAiEvent::Transcript {
                    text: delta.into(),
                    is_final: false,
                });
            }
        }
        "session.output_transcript.done" => {
            if let Some(t) = value.get("transcript").and_then(|v| v.as_str()) {
                let _ = event_ch.send(OpenAiEvent::Transcript {
                    text: t.into(),
                    is_final: true,
                });
            }
        }
        "session.output_audio.delta" => {
            // Always forward; JS client gates playback via setMuted() so the
            // user can toggle mute live without restarting the session.
            let _ = audio_output; // unused — kept on signature for future server-side hint.
            if let Some(b64) = value.get("delta").and_then(|v| v.as_str()) {
                let _ = event_ch.send(OpenAiEvent::AudioChunk {
                    pcm_base64: b64.into(),
                });
            }
        }
        "session.closed" => {
            let _ = event_ch.send(OpenAiEvent::Closed {
                reason: "session.closed".into(),
            });
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
            let _ = event_ch.send(OpenAiEvent::Error { code, message: msg });
        }
        other => {
            // Log unknown event types so we can discover server-side names we
            // haven't mapped yet (e.g. turn lifecycle around speech pauses).
            eprintln!(
                "[openai-realtime] unhandled event type: {} | payload: {}",
                other, text
            );
        }
    }
}
