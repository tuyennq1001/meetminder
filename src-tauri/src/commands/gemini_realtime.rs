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
const TRANSLATION_MAX_ATTEMPTS: usize = 5;
const TRANSLATION_PACE_DELAY: std::time::Duration = std::time::Duration::from_millis(800);

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
    TranslationFailed {
        id: u64,
        message: String,
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
    models_cache: Arc<tokio::sync::RwLock<Option<(std::time::Instant, Vec<String>)>>>,
    cooldowns: Arc<tokio::sync::Mutex<HashMap<String, std::time::Instant>>>,
    translation_cache: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
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
    let models_cache = state.models_cache.clone();
    let cooldowns = state.cooldowns.clone();
    let translation_cache = state.translation_cache.clone();

    tokio::spawn(async move {
        let _ = event_ch.send(GeminiEvent::Status {
            state: "connecting".into(),
            message: None,
        });

        if let Err(e) = run_session(
            config,
            target_lang,
            audio_rx,
            stop_rx,
            event_ch.clone(),
            models_cache,
            cooldowns,
            translation_cache,
        )
        .await
        {
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
            if tokio::time::timeout(
                TRANSLATION_DRAIN_TIMEOUT + std::time::Duration::from_secs(2),
                done_rx,
            )
            .await
            .is_err()
            {
                eprintln!(
                    "[gemini-live] Timed out waiting for session {} to drain",
                    session_id
                );
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
    models_cache: Arc<tokio::sync::RwLock<Option<(std::time::Instant, Vec<String>)>>>,
    cooldowns: Arc<tokio::sync::Mutex<HashMap<String, std::time::Instant>>>,
    translation_cache: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
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
    let mut committed_count: usize = 0;
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default();

    let available_models = Arc::new(tokio::sync::RwLock::new(
        get_or_fetch_models(&http_client, &cfg.api_key, &models_cache).await,
    ));

    // Bounded channel for translation jobs.
    // Processed sequentially (concurrency 1) with gentle pacing to guarantee 15 RPM Free Tier compliance.
    let (translation_tx, mut translation_rx) = mpsc::channel::<TranslationJob>(64);
    let translation_event_ch = event_ch.clone();
    let translation_api_key = cfg.api_key.clone();
    let translation_target_lang = target_lang_ref.clone();
    let translation_http = http_client.clone();
    let translation_models = available_models.clone();
    let translation_cooldowns = cooldowns.clone();
    let translation_cache_ref = translation_cache.clone();

    let translation_worker = tokio::spawn(async move {
        while let Some(job) = translation_rx.recv().await {
            let http = translation_http.clone();
            let api_key = translation_api_key.clone();
            let target_lang = translation_target_lang.clone();
            let models = translation_models.clone();
            let cd = translation_cooldowns.clone();
            let cache = translation_cache_ref.clone();

            let event = translate_job(http, api_key, target_lang, job, models, cd, cache).await;
            let _ = translation_event_ch.send(event);

            // Maintain gentle pacing between consecutive translation requests to stay safely below 15 RPM
            tokio::time::sleep(TRANSLATION_PACE_DELAY).await;
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
                            &mut committed_count,
                        ).await;
                    }
                    Some(Ok(Message::Binary(bin))) => {
                        if let Ok(text) = std::str::from_utf8(&bin) {
                            handle_server_message(
                                text,
                                &event_ch,
                                &translation_tx,
                                &mut next_translation_id,
                                &mut committed_count,
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

async fn translate_job(
    http_client: reqwest::Client,
    api_key: String,
    target_lang_ref: std::sync::Arc<tokio::sync::RwLock<String>>,
    job: TranslationJob,
    models_ref: std::sync::Arc<tokio::sync::RwLock<Vec<String>>>,
    cooldowns_ref: std::sync::Arc<tokio::sync::Mutex<HashMap<String, std::time::Instant>>>,
    cache_ref: std::sync::Arc<tokio::sync::Mutex<HashMap<String, String>>>,
) -> GeminiEvent {
    let target_lang = target_lang_ref.read().await.clone();
    let is_no_translate = target_lang == "none" || target_lang == "off" || target_lang.is_empty();

    let translation = if is_no_translate {
        String::new()
    } else {
        let trimmed_text = job.original.trim().to_string();

        // 1. Check in-memory phrase cache
        let cache_key = format!("{}:{}", target_lang, trimmed_text);
        let cached = {
            let cache = cache_ref.lock().await;
            cache.get(&cache_key).cloned()
        };

        if let Some(t) = cached {
            t
        } else {
            let mut result = None;
            let models = models_ref.read().await.clone();
            for attempt in 0..TRANSLATION_MAX_ATTEMPTS {
                if attempt > 0 {
                    let delay_ms = 1500u64 * attempt as u64;
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                }
                result = translate_text_rest(
                    &http_client,
                    &api_key,
                    &trimmed_text,
                    &target_lang,
                    &models,
                    &cooldowns_ref,
                )
                .await;
                if result.as_ref().is_some_and(|text| !text.trim().is_empty()) {
                    break;
                }
            }

            match result {
                Some(t) if !t.trim().is_empty() => {
                    if trimmed_text.len() < 120 {
                        let mut cache = cache_ref.lock().await;
                        cache.insert(cache_key, t.clone());
                    }
                    t
                }
                _ => {
                    eprintln!(
                        "[gemini-live] Translation failed after {} attempts for job {}",
                        TRANSLATION_MAX_ATTEMPTS, job.id
                    );
                    return GeminiEvent::TranslationFailed {
                        id: job.id,
                        message: format!(
                            "Translation failed after {} attempts",
                            TRANSLATION_MAX_ATTEMPTS
                        ),
                    };
                }
            }
        }
    };

    GeminiEvent::Segment {
        id: job.id,
        original: job.original,
        translation,
        speaker: job.speaker,
    }
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

/// Extracts complete sentences (ending in punctuation or clause boundary >= min_clause_chars)
/// and the remaining unfinalized provisional text.
fn extract_sentences_and_provisional(text: &str, min_clause_chars: usize) -> (Vec<String>, String) {
    let mut sentences = Vec::new();
    let text_trimmed = text.trim();
    if text_trimmed.is_empty() {
        return (sentences, String::new());
    }

    let chars: Vec<(usize, char)> = text_trimmed.char_indices().collect();
    let total_len = chars.len();
    let mut start = 0;
    let mut i = 0;
    let mut current_clause_len = 0;

    while i < total_len {
        let (byte_idx, ch) = chars[i];
        current_clause_len += 1;

        let is_period = ch == '。'
            || ch == '！'
            || ch == '？'
            || ch == '\n'
            || ((ch == '.' || ch == '!' || ch == '?')
                && (i + 1 == total_len || chars[i + 1].1 == ' '));

        let is_comma_split = (ch == '、'
            || (ch == ',' && i + 1 < total_len && chars[i + 1].1 == ' '))
            && current_clause_len >= min_clause_chars;

        if is_period || is_comma_split {
            let end_byte = byte_idx + ch.len_utf8();
            let slice = text_trimmed[start..end_byte].trim();
            if !slice.is_empty() {
                sentences.push(slice.to_string());
            }
            start = end_byte;
            current_clause_len = 0;
        }
        i += 1;
    }

    let provisional = if start < text_trimmed.len() {
        text_trimmed[start..].trim().to_string()
    } else {
        String::new()
    };

    (sentences, provisional)
}

async fn handle_server_message(
    text: &str,
    event_ch: &Channel<GeminiEvent>,
    translation_tx: &mpsc::Sender<TranslationJob>,
    next_translation_id: &mut u64,
    committed_count: &mut usize,
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
        eprintln!(
            "[gemini-live] Server error response: {} - {}",
            code, message
        );
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
        // Auto-commit completed sentences as they arrive so continuous speech (e.g. news, long meetings)
        // does not build up into an unfinalized wall of text, while keeping the uncommitted fragment in provisional.
        if let Some(interim) = server_content.get("interimInputTranscription") {
            if let Some(speech) = interim.get("text").and_then(|t| t.as_str()) {
                let speech_trimmed = speech.trim();
                if !speech_trimmed.is_empty() {
                    let (sentences, provisional) =
                        extract_sentences_and_provisional(speech_trimmed, 45);

                    // If speech contracted significantly or sentences count dropped, a new turn began
                    if sentences.len() < *committed_count {
                        *committed_count = 0;
                    }

                    if sentences.len() > *committed_count {
                        for sentence in &sentences[*committed_count..] {
                            let translation_id = *next_translation_id;
                            *next_translation_id = (*next_translation_id).saturating_add(1);
                            eprintln!(
                                "[gemini-live] Auto-committed interim sentence #{}: {}",
                                translation_id, sentence
                            );

                            let _ = event_ch.send(GeminiEvent::SourceTranscript {
                                id: translation_id,
                                text: sentence.clone(),
                                is_final: true,
                                speaker: None,
                            });

                            let _ = translation_tx
                                .send(TranslationJob {
                                    id: translation_id,
                                    original: sentence.clone(),
                                    speaker: None,
                                })
                                .await;
                        }
                        *committed_count = sentences.len();
                    }

                    // Forward only the remaining in-progress fragment to the UI as provisional
                    let _ = event_ch.send(GeminiEvent::Transcript {
                        text: provisional,
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

                    let (sentences, provisional) =
                        extract_sentences_and_provisional(speech_clean, 45);
                    let start_idx = (*committed_count).min(sentences.len());

                    for sentence in &sentences[start_idx..] {
                        let translation_id = *next_translation_id;
                        *next_translation_id = (*next_translation_id).saturating_add(1);
                        eprintln!(
                            "[gemini-live] Final speech sentence #{}: {}",
                            translation_id, sentence
                        );

                        let _ = event_ch.send(GeminiEvent::SourceTranscript {
                            id: translation_id,
                            text: sentence.clone(),
                            is_final: true,
                            speaker: speaker.clone(),
                        });

                        let _ = translation_tx
                            .send(TranslationJob {
                                id: translation_id,
                                original: sentence.clone(),
                                speaker: speaker.clone(),
                            })
                            .await;
                    }

                    // If there is any trailing text that wasn't finalized by punctuation, commit it now!
                    if !provisional.is_empty() {
                        let translation_id = *next_translation_id;
                        *next_translation_id = (*next_translation_id).saturating_add(1);
                        eprintln!(
                            "[gemini-live] Final speech trailing clause #{}: {}",
                            translation_id, provisional
                        );

                        let _ = event_ch.send(GeminiEvent::SourceTranscript {
                            id: translation_id,
                            text: provisional.clone(),
                            is_final: true,
                            speaker: speaker.clone(),
                        });

                        let _ = translation_tx
                            .send(TranslationJob {
                                id: translation_id,
                                original: provisional,
                                speaker: speaker.clone(),
                            })
                            .await;
                    }

                    *committed_count = 0;

                    // Clear provisional text in the UI
                    let _ = event_ch.send(GeminiEvent::Transcript {
                        text: "".into(),
                        is_final: false,
                    });
                }
            }
        }
    }
}

fn extract_gemini_version(name: &str) -> f32 {
    if let Some(pos) = name.find("gemini-") {
        let rest = &name[pos + "gemini-".len()..];
        let num_str: String = rest
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        if let Ok(v) = num_str.parse::<f32>() {
            return v;
        }
    }
    0.0
}

fn score_gemini_model(name: &str) -> f32 {
    let mut score = 0.0;
    let lower = name.to_lowercase();
    // For real-time speech translation on Free Tier:
    // Flash-Lite has 1,500 RPD and low latency (< 500ms).
    // Regular Flash has only 20 RPD on Free Tier, kept as fallback.
    if lower.contains("flash-lite") || lower.contains("flash_lite") {
        score += 200.0;
    } else if lower.contains("flash") {
        score += 80.0;
    } else if lower.contains("pro") {
        score += 30.0;
    }

    if lower.contains("latest") {
        score += 15.0;
    }
    if lower.contains("preview") || lower.contains("exp") {
        score -= 5.0;
    }
    let ver = extract_gemini_version(&lower);
    score += ver * 20.0;
    score
}

async fn fetch_dynamic_models(client: &reqwest::Client, api_key: &str) -> Vec<String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models?key={}",
        api_key.trim()
    );
    let mut models = Vec::new();

    if let Ok(resp) = client.get(&url).send().await {
        if resp.status().is_success() {
            if let Ok(text_resp) = resp.text().await {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text_resp) {
                    if let Some(arr) = json.get("models").and_then(|m| m.as_array()) {
                        for item in arr {
                            let is_gen_content = item
                                .get("supportedGenerationMethods")
                                .and_then(|m| m.as_array())
                                .map(|methods| {
                                    methods
                                        .iter()
                                        .any(|m| m.as_str() == Some("generateContent"))
                                })
                                .unwrap_or(false);

                            if !is_gen_content {
                                continue;
                            }

                            if let Some(raw_name) = item.get("name").and_then(|n| n.as_str()) {
                                let name = raw_name.strip_prefix("models/").unwrap_or(raw_name);
                                if !name.starts_with("gemini-") {
                                    continue;
                                }
                                let lower = name.to_lowercase();
                                if lower.contains("tts")
                                    || lower.contains("image")
                                    || lower.contains("robotics")
                                    || lower.contains("clip")
                                    || lower.contains("banana")
                                    || lower.contains("embedding")
                                    || lower.contains("computer-use")
                                    || lower.contains("2.5")
                                // 2.5 returns 404
                                {
                                    continue;
                                }
                                models.push(name.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    if models.is_empty() {
        models = vec![
            "gemini-3.1-flash-lite".to_string(),
            "gemini-3.1-flash-lite-preview".to_string(),
            "gemini-flash-lite-latest".to_string(),
            "gemini-3.5-flash-lite".to_string(),
            "gemini-3.8-flash".to_string(),
            "gemini-3.7-flash".to_string(),
            "gemini-3.6-flash".to_string(),
            "gemini-3.5-flash".to_string(),
            "gemini-flash-latest".to_string(),
        ];
    } else {
        if !models.iter().any(|m| m == "gemini-3.1-flash-lite") {
            models.push("gemini-3.1-flash-lite".to_string());
        }
        if !models.iter().any(|m| m == "gemini-3.1-flash-lite-preview") {
            models.push("gemini-3.1-flash-lite-preview".to_string());
        }
        if !models.iter().any(|m| m == "gemini-flash-lite-latest") {
            models.push("gemini-flash-lite-latest".to_string());
        }
    }

    models.sort_by(|a, b| {
        score_gemini_model(b)
            .partial_cmp(&score_gemini_model(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    eprintln!(
        "[gemini-live] Discovered {} candidate models (ranked): {:?}",
        models.len(),
        models
    );
    models
}

async fn get_or_fetch_models(
    client: &reqwest::Client,
    api_key: &str,
    cache: &Arc<tokio::sync::RwLock<Option<(std::time::Instant, Vec<String>)>>>,
) -> Vec<String> {
    {
        let r = cache.read().await;
        if let Some((fetched_at, models)) = r.as_ref() {
            if fetched_at.elapsed() < std::time::Duration::from_secs(1800) && !models.is_empty() {
                return models.clone();
            }
        }
    }

    let fresh = fetch_dynamic_models(client, api_key).await;
    {
        let mut w = cache.write().await;
        *w = Some((std::time::Instant::now(), fresh.clone()));
    }
    fresh
}

async fn translate_text_rest(
    client: &reqwest::Client,
    api_key: &str,
    text: &str,
    target_lang: &str,
    models: &[String],
    cooldowns_ref: &Arc<tokio::sync::Mutex<HashMap<String, std::time::Instant>>>,
) -> Option<String> {
    let target_name = map_lang_name(target_lang);
    let prompt = format!(
        "Translate the following speech accurately and naturally into {target_name}. Output ONLY the translated text in {target_name} without repeating the source language, and without notes or quotes:\n{}",
        text.trim()
    );

    let now = std::time::Instant::now();
    let mut soonest_wait: Option<std::time::Duration> = None;

    for model in models {
        // Check if model is cooling down
        {
            let cooldowns = cooldowns_ref.lock().await;
            if let Some(until) = cooldowns.get(model) {
                if now < *until {
                    let wait = *until - now;
                    soonest_wait = match soonest_wait {
                        Some(prev) => Some(prev.min(wait)),
                        None => Some(wait),
                    };
                    continue;
                }
            }
        }

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

        match client
            .post(&url)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
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
                } else if status.as_u16() == 429 || status.as_u16() == 503 {
                    // Extract retryDelay or default to 20s
                    let delay_secs = if let Ok(err_body) = resp.text().await {
                        if let Ok(err_json) = serde_json::from_str::<serde_json::Value>(&err_body) {
                            err_json
                                .get("error")
                                .and_then(|e| e.get("details"))
                                .and_then(|d| d.as_array())
                                .and_then(|arr| {
                                    arr.iter().find_map(|item| {
                                        if item.get("@type").and_then(|t| t.as_str())
                                            == Some("type.googleapis.com/google.rpc.RetryInfo")
                                        {
                                            item.get("retryDelay")
                                                .and_then(|r| r.as_str())
                                                .and_then(|s| {
                                                    s.trim_end_matches('s').parse::<u64>().ok()
                                                })
                                        } else {
                                            None
                                        }
                                    })
                                })
                                .unwrap_or(20)
                        } else {
                            20
                        }
                    } else {
                        20
                    };
                    eprintln!(
                        "[gemini-live] Model {} hit HTTP {}, placing in cooldown for {}s",
                        model, status, delay_secs
                    );
                    let mut cooldowns = cooldowns_ref.lock().await;
                    cooldowns.insert(
                        model.clone(),
                        std::time::Instant::now() + std::time::Duration::from_secs(delay_secs),
                    );
                } else {
                    eprintln!("[gemini-live] Model {} returned HTTP {}", model, status);
                }
            }
            Err(e) => {
                eprintln!(
                    "[gemini-live] HTTP request error for model {}: {}",
                    model, e
                );
            }
        }
    }

    // If all models were in cooldown and the soonest cooldown is short (<= 5s), wait for it!
    if let Some(wait) = soonest_wait {
        if wait <= std::time::Duration::from_secs(5) {
            tokio::time::sleep(wait).await;
        }
    }

    None
}
