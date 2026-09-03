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
    sessions: Arc<Mutex<HashMap<u64, Session>>>,
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
    let sessions_map = state.sessions.clone();

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
        }
        // Always clean up session from active sessions map to prevent leaks
        sessions_map.lock().unwrap().remove(&session_id);
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
    let mut committed_prefix = String::new();
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
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
            let is_no_translate = target_lang == "none"
                || target_lang == "off"
                || target_lang.is_empty();

            let translation = if is_no_translate {
                String::new()
            } else {
                let translation_opt = translate_text_rest(
                    &translation_http,
                    &translation_api_key,
                    &job.original,
                    &target_lang,
                )
                .await;

                match translation_opt {
                    Some(t) if !t.trim().is_empty() => t,
                    _ => {
                        eprintln!(
                            "[gemini-live] Translation failed or timed out for job {}",
                            job.id
                        );
                        if target_lang == "vi" {
                            "[Bản dịch đang cập nhật...]".to_string()
                        } else if target_lang == "ja" {
                            "[翻訳を更新中...]".to_string()
                        } else {
                            "[Translation pending...]".to_string()
                        }
                    }
                }
            };

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
                            &mut committed_prefix,
                        ).await;
                    }
                    Some(Ok(Message::Binary(bin))) => {
                        if let Ok(text) = std::str::from_utf8(&bin) {
                            handle_server_message(
                                text,
                                &event_ch,
                                &translation_tx,
                                &mut next_translation_id,
                                &mut committed_prefix,
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
                        return Ok(());
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        eprintln!("[gemini-live] WebSocket stream error: {}", e);
                        finish_translation_worker(translation_tx, translation_worker).await;
                        return Err(format!("ws error: {}", e));
                    }
                    None => {
                        eprintln!("[gemini-live] WebSocket stream ended");
                        let _ = event_ch.send(GeminiEvent::Closed {
                            reason: "stream_ended".into(),
                        });
                        finish_translation_worker(translation_tx, translation_worker).await;
                        return Ok(());
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
        "th" => "Thai".to_string(),
        "id" => "Indonesian".to_string(),
        "ru" => "Russian".to_string(),
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

    let is_no_translate = cfg.target_language == "none"
        || cfg.target_language == "off"
        || cfg.target_language.is_empty();

    let src = cfg.source_language.trim().to_lowercase();
    let sys_instruction = if is_no_translate {
        if !src.is_empty() && src != "auto" {
            let src_name = map_lang_name(&src);
            format!("You are an automated live speech transcription engine. The speaker is speaking {}. Accurately transcribe all spoken audio verbatim in {} without translation.", src_name, src_name)
        } else {
            "You are an automated live speech transcription engine. Accurately transcribe all spoken audio verbatim in its spoken language without translation.".to_string()
        }
    } else {
        let target_name = map_lang_name(&cfg.target_language);
        if !src.is_empty() && src != "auto" {
            let src_name = map_lang_name(&src);
            format!("You are an automated live speech transcription engine. The speaker is speaking {}. Accurately transcribe all audio and translate directly to {}.", src_name, target_name)
        } else {
            format!("You are an automated live speech transcription engine. Accurately transcribe all audio and translate directly to {}.", target_name)
        }
    };

    serde_json::json!({
        "setup": {
            "model": model,
            "generationConfig": {
                "responseModalities": ["TEXT"],
                "temperature": 0.2
            },
            "inputAudioTranscription": {},
            "systemInstruction": {
                "parts": [
                    {
                        "text": sys_instruction
                    }
                ]
            }
        }
    })
    .to_string()
}

/// Find a stable sentence boundary in Japanese/multilingual streaming interim text.
/// Returns the byte index after the sentence terminator if a complete sentence is found
/// with sufficient trailing context (so the boundary is stable).
fn find_sentence_split(text: &str, min_chars: usize, min_trailing_chars: usize) -> Option<usize> {
    let char_count = text.chars().count();
    if char_count < min_chars + min_trailing_chars {
        return None;
    }

    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let total_len = chars.len();
    let mut current_chars = 0;

    for i in 0..total_len {
        current_chars += 1;
        let (byte_idx, ch) = chars[i];

        let is_cjk_term = ch == '。' || ch == '！' || ch == '？' || ch == '\n';
        let is_latin_term = (ch == '.' || ch == '!' || ch == '?')
            && i + 1 < total_len
            && (chars[i + 1].1 == ' ' || chars[i + 1].1 == '\n');

        if (is_cjk_term || is_latin_term) && current_chars >= min_chars {
            let next_byte = if is_latin_term {
                chars[i + 1].0 + chars[i + 1].1.len_utf8()
            } else {
                byte_idx + ch.len_utf8()
            };
            let remaining_chars = total_len.saturating_sub(i + 1);
            if remaining_chars >= min_trailing_chars {
                return Some(next_byte);
            }
        }
    }

    None
}

/// Split finalized speech into naturally sized sentences so long utterances
/// don't overwhelm the UI or the REST translation model.
fn split_text_into_sentences(text: &str, min_chars: usize) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let total_len = chars.len();

    let mut i = 0;
    while i < total_len {
        let (_byte_idx, ch) = chars[i];
        current.push(ch);

        let is_cjk_term = ch == '。' || ch == '！' || ch == '？' || ch == '\n';
        let is_latin_term = (ch == '.' || ch == '!' || ch == '?')
            && i + 1 < total_len
            && (chars[i + 1].1 == ' ' || chars[i + 1].1 == '\n');

        if is_latin_term {
            i += 1;
            current.push(chars[i].1);
        }

        if (is_cjk_term || is_latin_term) && current.chars().count() >= min_chars {
            let s = current.trim();
            if !s.is_empty() {
                result.push(s.to_string());
            }
            current.clear();
        }
        i += 1;
    }

    let s = current.trim();
    if !s.is_empty() {
        if let Some(last) = result.last_mut() {
            if s.chars().count() < 15 {
                last.push(' ');
                last.push_str(s);
            } else {
                result.push(s.to_string());
            }
        } else {
            result.push(s.to_string());
        }
    }

    if result.is_empty() && !text.trim().is_empty() {
        result.push(text.trim().to_string());
    }

    result
}

async fn handle_server_message(
    text: &str,
    event_ch: &Channel<GeminiEvent>,
    translation_tx: &mpsc::Sender<TranslationJob>,
    next_translation_id: &mut u64,
    committed_prefix: &mut String,
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

    // Handle goAway notification (Gemini Live sends ~60s before connection expires)
    if let Some(go_away) = value.get("goAway") {
        let time_remaining = go_away
            .get("timeRemaining")
            .and_then(|t| t.as_str())
            .unwrap_or("unknown");
        eprintln!(
            "[gemini-live] Server sent goAway (timeRemaining: {}). Connection will rollover soon.",
            time_remaining
        );
    }

    // 3. Process serverContent
    if let Some(server_content) = value.get("serverContent") {
        // A. Live interim transcription (real-time streaming speech delta)
        if let Some(interim) = server_content.get("interimInputTranscription") {
            if let Some(speech) = interim.get("text").and_then(|t| t.as_str()) {
                let speech_trimmed = speech.trim();
                if !speech_trimmed.is_empty() {
                    let mut uncommitted = if speech_trimmed.starts_with(committed_prefix.as_str()) {
                        &speech_trimmed[committed_prefix.len()..]
                    } else {
                        // A new turn has begun or speech diverged; reset committed_prefix
                        committed_prefix.clear();
                        speech_trimmed
                    };

                    // Auto-commit stable completed sentences from interim stream
                    // so users don't have to wait minutes during continuous speaking.
                    while let Some(split_idx) = find_sentence_split(uncommitted, 25, 10) {
                        let to_commit = uncommitted[..split_idx].trim().to_string();
                        let raw_segment = &uncommitted[..split_idx];
                        uncommitted = &uncommitted[split_idx..];

                        if !to_commit.is_empty() {
                            committed_prefix.push_str(raw_segment);

                            let translation_id = *next_translation_id;
                            *next_translation_id = (*next_translation_id).saturating_add(1);
                            eprintln!("[gemini-live] Auto-committed interim sentence #{}: {}", translation_id, to_commit);

                            let _ = event_ch.send(GeminiEvent::SourceTranscript {
                                id: translation_id,
                                text: to_commit.clone(),
                                is_final: true,
                                speaker: None,
                            });

                            let _ = translation_tx
                                .send(TranslationJob {
                                    id: translation_id,
                                    original: to_commit,
                                    speaker: None,
                                })
                                .await;
                        }
                    }

                    // Forward the remaining in-progress fragment to the UI as provisional
                    let _ = event_ch.send(GeminiEvent::Transcript {
                        text: uncommitted.trim().to_string(),
                        is_final: false,
                    });
                }
            }
        }

        // B. Final input transcription (when an utterance completes)
        if let Some(input_tx) = server_content.get("inputTranscription") {
            if let Some(speech) = input_tx.get("text").and_then(|t| t.as_str()) {
                let speech_clean = speech.trim();
                if !speech_clean.is_empty() {
                    let speaker = input_tx
                        .get("speaker")
                        .or_else(|| input_tx.get("speakerLabel"))
                        .and_then(|s| s.as_str())
                        .map(str::to_string);

                    let remaining_text = if speech_clean.starts_with(committed_prefix.as_str()) {
                        speech_clean[committed_prefix.len()..].trim()
                    } else {
                        speech_clean
                    };

                    committed_prefix.clear();

                    if !remaining_text.is_empty() {
                        let sentences = split_text_into_sentences(remaining_text, 25);
                        for sentence in sentences {
                            let translation_id = *next_translation_id;
                            *next_translation_id = (*next_translation_id).saturating_add(1);
                            eprintln!("[gemini-live] Final speech sentence #{}: {}", translation_id, sentence);

                            let _ = event_ch.send(GeminiEvent::SourceTranscript {
                                id: translation_id,
                                text: sentence.clone(),
                                is_final: true,
                                speaker: speaker.clone(),
                            });

                            let _ = translation_tx
                                .send(TranslationJob {
                                    id: translation_id,
                                    original: sentence,
                                    speaker: speaker.clone(),
                                })
                                .await;
                        }
                    }

                    // Clear provisional text in the UI
                    let _ = event_ch.send(GeminiEvent::Transcript {
                        text: "".into(),
                        is_final: false,
                    });
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
        "Translate the following speech accurately and naturally into {target_name}. Output ONLY the translated text in {target_name} without repeating the source language, and without notes or quotes:\n{}",
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
