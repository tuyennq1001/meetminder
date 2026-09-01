// Gemini Live realtime translation provider — backend WebSocket bridge.
//
// Uses Google Gemini Multimodal Live API (gemini-3.5-transcribe-live + fast translation):
// wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={API_KEY}

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const GEMINI_LIVE_WS_HOST: &str = "generativelanguage.googleapis.com";
const DEFAULT_GEMINI_MODEL: &str = "models/gemini-3.5-transcribe-live";
const TRANSLATION_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

#[derive(Debug, Deserialize)]
pub struct GeminiRealtimeConfig {
    pub api_key: String,
    /// BCP-47-ish code (e.g. "en", "ja", "auto")
    pub source_language: String,
    /// BCP-47-ish code (e.g. "vi", "en", "ja")
    pub target_language: String,
    pub model: Option<String>,
    #[serde(default)]
    pub diarization: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GeminiEvent {
    Status {
        state: String,
        message: Option<String>,
    },
    Transcript {
        text: String,
        is_final: bool,
    },
    /// Final source-language ASR. This is emitted before the REST translation
    /// finishes so stopping a session can never hide the source transcript.
    SourceTranscript {
        id: u64,
        text: String,
        is_final: bool,
        speaker: Option<String>,
    },
    Segment {
        id: u64,
        original: String,
        translation: String,
        speaker: Option<String>,
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
    target_lang: Arc<tokio::sync::RwLock<String>>,
    done_rx: Option<oneshot::Receiver<()>>,
}

/// A finalized transcript awaiting REST translation. Keeping these in one
/// bounded FIFO avoids unbounded task growth and preserves segment order.
struct TranslationJob {
    id: u64,
    original: String,
    speaker: Option<String>,
}

#[derive(Default)]
pub struct GeminiState {
    sessions: Mutex<HashMap<u64, Session>>,
    next_id: Mutex<u64>,
}

#[tauri::command]
pub async fn gemini_realtime_start(
    config: GeminiRealtimeConfig,
    on_event: Channel<GeminiEvent>,
    state: State<'_, GeminiState>,
) -> Result<u64, String> {
    if config.api_key.trim().is_empty() {
        return Err("Gemini API key is empty. Please enter your API key in Settings.".into());
    }

    let session_id = {
        let mut id = state.next_id.lock().unwrap();
        *id += 1;
        *id
    };

    let target_lang = Arc::new(tokio::sync::RwLock::new(config.target_language.clone()));
    let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (stop_tx, stop_rx) = mpsc::unbounded_channel::<()>();
    let (done_tx, done_rx) = oneshot::channel::<()>();

    let session = Session {
        audio_tx,
        stop_tx,
        target_lang: target_lang.clone(),
        done_rx: Some(done_rx),
    };
    state.sessions.lock().unwrap().insert(session_id, session);

    let event_ch = on_event.clone();

    tokio::spawn(async move {
        let _ = event_ch.send(GeminiEvent::Status {
            state: "connecting".into(),
            message: None,
        });

        if let Err(e) = run_session(config, target_lang, audio_rx, stop_rx, event_ch.clone()).await {
            eprintln!("[gemini-live] Session failed: {}", e);
            let _ = event_ch.send(GeminiEvent::Error {
                code: "session_failed".into(),
                message: e.clone(),
            });
            let _ = event_ch.send(GeminiEvent::Closed {
                reason: format!("error: {}", e),
            });
        } else {
            let _ = event_ch.send(GeminiEvent::Closed {
                reason: "session_ended".into(),
            });
        }
        let _ = done_tx.send(());
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn gemini_realtime_set_target_lang(
    session_id: u64,
    target_lang: String,
    state: State<'_, GeminiState>,
) -> Result<(), String> {
    let target_lock = {
        let guard = state.sessions.lock().unwrap();
        guard.get(&session_id).map(|s| s.target_lang.clone())
    };
    if let Some(tl) = target_lock {
        let mut w = tl.write().await;
        *w = target_lang;
        Ok(())
    } else {
        Err("Session not found".into())
    }
}

#[tauri::command]
pub async fn gemini_realtime_send_audio(
    session_id: u64,
    pcm: Vec<u8>,
    state: State<'_, GeminiState>,
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
pub async fn gemini_realtime_stop(
    session_id: u64,
    state: State<'_, GeminiState>,
) -> Result<(), String> {
    let session = {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.remove(&session_id)
    };
    if let Some(mut session) = session {
        let _ = session.stop_tx.send(());
        if let Some(done_rx) = session.done_rx.take() {
            if tokio::time::timeout(TRANSLATION_DRAIN_TIMEOUT + std::time::Duration::from_secs(2), done_rx)
                .await
                .is_err()
            {
                eprintln!("[gemini-live] Timed out waiting for session {} to drain", session_id);
            }
        }
    }
    Ok(())
}

async fn run_session(
    cfg: GeminiRealtimeConfig,
    target_lang_ref: Arc<tokio::sync::RwLock<String>>,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    mut stop_rx: mpsc::UnboundedReceiver<()>,
    event_ch: Channel<GeminiEvent>,
) -> Result<(), String> {
    let ws_url = format!(
        "wss://{}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={}",
        GEMINI_LIVE_WS_HOST,
        cfg.api_key.trim()
    );

    eprintln!("[gemini-live] Connecting to WebSocket endpoint...");
    let (ws_stream, response) = connect_async(ws_url.as_str())
        .await
        .map_err(|e| format!("WebSocket handshake failed: {}", e))?;

    eprintln!(
        "[gemini-live] WebSocket connected! HTTP status: {}",
        response.status()
    );

    let (mut ws_sink, mut ws_stream) = ws_stream.split();

    // 1. Send initial setup message
    let setup_msg = build_setup_message(&cfg);
    eprintln!("[gemini-live] Sending setup: {}", setup_msg);
    ws_sink
        .send(Message::Text(setup_msg.into()))
        .await
        .map_err(|e| format!("send setup message: {}", e))?;

    let mut next_translation_id = 1u64;
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    // Gemini Live final-transcript events can arrive faster than the REST
    // translator responds. One worker provides deterministic ordering while
    // the bounded channel applies backpressure instead of accumulating an
    // unbounded set of spawned tasks.
    let (translation_tx, mut translation_rx) = mpsc::channel::<TranslationJob>(32);
    let translation_event_ch = event_ch.clone();
    let translation_api_key = cfg.api_key.clone();
    let translation_target_lang = target_lang_ref.clone();
    let translation_http = http_client.clone();
    let translation_worker = tokio::spawn(async move {
        while let Some(job) = translation_rx.recv().await {
            let target_lang = translation_target_lang.read().await.clone();
            let translation = translate_text_rest(
                &translation_http,
                &translation_api_key,
                &job.original,
                &target_lang,
            )
            .await
            .unwrap_or_else(|| job.original.clone());
            let _ = translation_event_ch.send(GeminiEvent::Segment {
                id: job.id,
                original: job.original,
                translation,
                speaker: job.speaker,
            });
        }
    });

    loop {
        tokio::select! {
            biased;

            _ = stop_rx.recv() => {
                eprintln!("[gemini-live] Stop signal received, closing WS");
                let _ = ws_sink.send(Message::Close(None)).await;
                break;
            }

            Some(pcm) = audio_rx.recv() => {
                let b64 = B64.encode(&pcm);
                let media_msg = serde_json::json!({
                    "realtimeInput": {
                        "mediaChunks": [
                            {
                                "mimeType": "audio/pcm;rate=16000",
                                "data": b64
                            }
                        ]
                    }
                });
                if let Err(e) = ws_sink.send(Message::Text(media_msg.to_string().into())).await {
                    eprintln!("[gemini-live] send audio failed: {}", e);
                    finish_translation_worker(translation_tx, translation_worker).await;
                    return Err(format!("send audio: {}", e));
                }
            }

            msg = ws_stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_server_message(
                            &text,
                            &event_ch,
                            &translation_tx,
                            &mut next_translation_id,
                        ).await;
                    }
                    Some(Ok(Message::Binary(bin))) => {
                        if let Ok(text) = std::str::from_utf8(&bin) {
                            handle_server_message(
                                text,
                                &event_ch,
                                &translation_tx,
                                &mut next_translation_id,
                            ).await;
                        }
                    }
                    Some(Ok(Message::Close(frame))) => {
                        let reason = frame
                            .map(|f| format!("{}: {}", f.code, f.reason))
                            .unwrap_or_else(|| "remote_close".into());
                        eprintln!("[gemini-live] WebSocket closed by server: {}", reason);
                        let _ = event_ch.send(GeminiEvent::Closed { reason: reason.clone() });
                        finish_translation_worker(translation_tx, translation_worker).await;
                        return Err(format!("Server closed connection: {}", reason));
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        eprintln!("[gemini-live] WebSocket stream error: {}", e);
                        finish_translation_worker(translation_tx, translation_worker).await;
                        return Err(format!("ws error: {}", e));
                    }
                    None => {
                        eprintln!("[gemini-live] WebSocket stream ended");
                        break;
                    }
                }
            }
        }
    }

    // Stop is a graceful boundary: close the producer, then wait for every
    // already-accepted translation job. SourceTranscript events were emitted
    // before enqueueing, so even a timeout here cannot lose source text.
    finish_translation_worker(translation_tx, translation_worker).await;
    Ok(())
}

async fn finish_translation_worker(
    translation_tx: mpsc::Sender<TranslationJob>,
    mut translation_worker: tokio::task::JoinHandle<()>,
) {
    drop(translation_tx);
    if tokio::time::timeout(TRANSLATION_DRAIN_TIMEOUT, &mut translation_worker)
        .await
        .is_err()
    {
        eprintln!("[gemini-live] Translation drain timed out; cancelling remaining REST work");
        translation_worker.abort();
        let _ = translation_worker.await;
    }
}

fn map_lang_name(code: &str) -> String {
    match code.to_lowercase().as_str() {
        "vi" => "Vietnamese (Tiếng Việt)".to_string(),
        "en" => "English".to_string(),
        "ja" => "Japanese (日本語)".to_string(),
        "ko" => "Korean (한국어)".to_string(),
        "zh" => "Chinese (中文)".to_string(),
        "fr" => "French (Français)".to_string(),
        "de" => "German (Deutsch)".to_string(),
        "es" => "Spanish (Español)".to_string(),
        "auto" | "" => "any spoken language".to_string(),
        other => format!("language '{}'", other),
    }
}

fn build_setup_message(cfg: &GeminiRealtimeConfig) -> String {
    let raw_model = cfg
        .model
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_GEMINI_MODEL);

    let model = if raw_model.starts_with("models/") {
        raw_model.to_string()
    } else {
        format!("models/{}", raw_model)
    };

    let target_name = map_lang_name(&cfg.target_language);

    serde_json::json!({
        "setup": {
            "model": model,
            "generationConfig": {
                "responseModalities": ["TEXT"],
                "temperature": 0.2
            },
            "inputAudioTranscription": if cfg.diarization {
                serde_json::json!({ "diarization": true })
            } else {
                serde_json::json!({})
            },
            "systemInstruction": {
                "parts": [
                    {
                        "text": format!("You are an automated live speech transcription engine. Accurately transcribe all audio and translate directly to {}.", target_name)
                    }
                ]
            }
        }
    })
    .to_string()
}

async fn handle_server_message(
    text: &str,
    event_ch: &Channel<GeminiEvent>,
    translation_tx: &mpsc::Sender<TranslationJob>,
    next_translation_id: &mut u64,
) {
    let value: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };

    // 1. Setup complete
    if value.get("setupComplete").is_some() {
        eprintln!("[gemini-live] Setup complete received from Google!");
        let _ = event_ch.send(GeminiEvent::Status {
            state: "ready".into(),
            message: Some("Gemini Live connected".into()),
        });
        return;
    }

    // 2. Error response
    if let Some(err) = value.get("error") {
        let code = err
            .get("code")
            .and_then(|c| c.as_i64())
            .map(|c| c.to_string())
            .unwrap_or_else(|| "error".into());
        let message = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown Gemini error")
            .to_string();
        eprintln!("[gemini-live] Server error response: {} - {}", code, message);
        let _ = event_ch.send(GeminiEvent::Error { code, message });
        return;
    }

    // 3. Process serverContent
    if let Some(server_content) = value.get("serverContent") {
        // A. Live interim transcription (real-time streaming speech delta)
        if let Some(interim) = server_content.get("interimInputTranscription") {
            if let Some(speech) = interim.get("text").and_then(|t| t.as_str()) {
                if !speech.is_empty() {
                    let _ = event_ch.send(GeminiEvent::Transcript {
                        text: speech.to_string(),
                        is_final: false,
                    });
                }
            }
        }

        // B. Final input transcription (when an utterance completes)
        if let Some(input_tx) = server_content.get("inputTranscription") {
            if let Some(speech) = input_tx.get("text").and_then(|t| t.as_str()) {
                let speech_clean = speech.trim().to_string();
                if !speech_clean.is_empty() {
                    eprintln!("[gemini-live] Final speech: {}", speech_clean);
                    let speaker = input_tx
                        .get("speaker")
                        .or_else(|| input_tx.get("speakerLabel"))
                        .and_then(|s| s.as_str())
                        .map(str::to_string);
                    let translation_id = *next_translation_id;
                    *next_translation_id = (*next_translation_id).saturating_add(1);
                    // Publish source text first. The UI/session store can now
                    // retain it even while REST translation is still pending.
                    let _ = event_ch.send(GeminiEvent::SourceTranscript {
                        id: translation_id,
                        text: speech_clean.clone(),
                        is_final: true,
                        speaker: speaker.clone(),
                    });
                    // Awaiting here is intentional: when the queue is full,
                    // pause WebSocket consumption until translation catches up
                    // rather than dropping or reordering finalized speech.
                    let _ = translation_tx
                        .send(TranslationJob {
                            id: translation_id,
                            original: speech_clean,
                            speaker,
                        })
                        .await;
                }
            }
        }

        // Ignore modelTurn text here. The setup asks Gemini to generate a
        // direct translation, but that stream can contain speculative text or
        // language hallucinations while ASR is still settling. The input
        // transcript above is the source of truth; REST translation emits the
        // only target text shown for this provider.
    }
}

async fn translate_text_rest(
    client: &reqwest::Client,
    api_key: &str,
    text: &str,
    target_lang: &str,
) -> Option<String> {
    let target_name = map_lang_name(target_lang);
    let prompt = format!(
        "Translate the following speech accurately and naturally into {target_name}. Output ONLY the translated text without notes or quotes:\n{}",
        text.trim()
    );

    let models = ["gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-3.5-flash"];

    for model in &models {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model,
            api_key.trim()
        );

        let body = serde_json::json!({
            "contents": [
                {
                    "parts": [
                        {
                            "text": &prompt
                        }
                    ]
                }
            ]
        });

        if let Ok(resp) = client
            .post(&url)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(text_resp) = resp.text().await {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text_resp) {
                        if let Some(translated) = json
                            .get("candidates")
                            .and_then(|c| c.get(0))
                            .and_then(|c| c.get("content"))
                            .and_then(|c| c.get("parts"))
                            .and_then(|p| p.get(0))
                            .and_then(|p| p.get("text"))
                            .and_then(|t| t.as_str())
                            .map(|s| s.trim().to_string())
                        {
                            if !translated.is_empty() {
                                return Some(translated);
                            }
                        }
                    }
                }
            }
        }
    }

    None
}
