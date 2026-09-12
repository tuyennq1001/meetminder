// Gemini Live realtime translation provider — backend WebSocket bridge.
//
// Uses Google Gemini Multimodal Live API (gemini-3.5-transcribe-live + fast translation):
// wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={API_KEY}

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::commands::session_store::TranslationTermPair;

const GEMINI_LIVE_WS_HOST: &str = "generativelanguage.googleapis.com";
const DEFAULT_GEMINI_MODEL: &str = "models/gemini-3.5-transcribe-live";
const TRANSLATION_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
const TRANSLATION_MAX_ATTEMPTS: usize = 5;
// Gemini's free-tier generateContent limit is 15 requests/minute. Batches can
// contain up to six utterances, so one request every four seconds keeps the
// worker below that limit without imposing a per-utterance delay.
const TRANSLATION_PACE_DELAY: std::time::Duration = std::time::Duration::from_secs(4);

#[derive(Debug, Deserialize, Clone)]
pub struct GeminiRealtimeConfig {
    pub api_key: String,
    /// BCP-47-ish code (e.g. "en", "ja", "auto")
    pub source_language: String,
    /// BCP-47-ish code (e.g. "vi", "en", "ja")
    pub target_language: String,
    pub model: Option<String>,
    #[serde(default)]
    pub diarization: bool,
    #[serde(default, alias = "contextPrompt")]
    pub context_prompt: Option<String>,
    #[serde(default)]
    pub terms: Vec<String>,
    #[serde(default, alias = "translationTerms")]
    pub translation_terms: Vec<TranslationTermPair>,
}

#[derive(Debug, Clone, Default)]
pub struct GeminiLiveContext {
    pub context_prompt: Option<String>,
    pub terms: Vec<String>,
    pub translation_terms: Vec<TranslationTermPair>,
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
    live_context: Arc<tokio::sync::RwLock<GeminiLiveContext>>,
    done_rx: Option<oneshot::Receiver<()>>,
}

/// A finalized transcript awaiting REST translation. Keeping these in one
/// bounded FIFO avoids unbounded task growth and preserves segment order.
#[derive(Debug, Clone)]
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
    let initial_context = GeminiLiveContext {
        context_prompt: config.context_prompt.clone(),
        terms: config.terms.clone(),
        translation_terms: config.translation_terms.clone(),
    };
    let live_context = Arc::new(tokio::sync::RwLock::new(initial_context));
    let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (stop_tx, stop_rx) = mpsc::unbounded_channel::<()>();
    let (done_tx, done_rx) = oneshot::channel::<()>();

    let session = Session {
        audio_tx,
        stop_tx,
        target_lang: target_lang.clone(),
        live_context: live_context.clone(),
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
            live_context,
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
pub async fn gemini_realtime_set_context(
    session_id: u64,
    context_prompt: Option<String>,
    terms: Vec<String>,
    translation_terms: Vec<TranslationTermPair>,
    state: State<'_, GeminiState>,
) -> Result<(), String> {
    let context_lock = {
        let guard = state.sessions.lock().unwrap();
        guard.get(&session_id).map(|s| s.live_context.clone())
    };
    if let Some(lock) = context_lock {
        let mut w = lock.write().await;
        *w = GeminiLiveContext {
            context_prompt,
            terms,
            translation_terms,
        };
        // Invalidate phrase cache so subsequent identical lines re-translate using the updated glossary
        state.translation_cache.lock().await.clear();
        Ok(())
    } else {
        Err(format!("Session {} not found", session_id))
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
    live_context_ref: Arc<tokio::sync::RwLock<GeminiLiveContext>>,
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
    let mut recent_committed: VecDeque<(String, std::time::Instant)> = VecDeque::with_capacity(64);
    let mut turn_committed: HashSet<String> = HashSet::new();
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
    let translation_live_context = live_context_ref.clone();
    let translation_http = http_client.clone();
    let translation_models = available_models.clone();
    let translation_cooldowns = cooldowns.clone();
    let translation_cache_ref = translation_cache.clone();

    let translation_worker = tokio::spawn(async move {
        while let Some(first_job) = translation_rx.recv().await {
            let mut batch = vec![first_job];
            while let Ok(next_job) = translation_rx.try_recv() {
                batch.push(next_job);
                if batch.len() >= 6 {
                    break;
                }
            }

            let http = translation_http.clone();
            let api_key = translation_api_key.clone();
            let target_lang = translation_target_lang.clone();
            let models = translation_models.clone();
            let cd = translation_cooldowns.clone();
            let cache = translation_cache_ref.clone();
            let live_ctx = translation_live_context.read().await.clone();

            if batch.len() == 1 {
                let job = batch.remove(0);
                let event = translate_job(http, api_key, target_lang, job, models, cd, cache, &live_ctx).await;
                let _ = translation_event_ch.send(event);
            } else {
                let events = translate_batch_jobs(http, api_key, target_lang, batch, models, cd, cache, &live_ctx).await;
                for event in events {
                    let _ = translation_event_ch.send(event);
                }
            }

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
                            &mut turn_committed,
                            &mut recent_committed,
                        ).await;
                    }
                    Some(Ok(Message::Binary(bin))) => {
                        if let Ok(text) = std::str::from_utf8(&bin) {
                            handle_server_message(
                                text,
                                &event_ch,
                                &translation_tx,
                                &mut next_translation_id,
                                &mut turn_committed,
                                &mut recent_committed,
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
    live_context: &GeminiLiveContext,
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
                    live_context,
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

fn map_bcp47(code: &str) -> Option<String> {
    match code.to_lowercase().as_str() {
        "vi" => Some("vi-VN".to_string()),
        "ja" => Some("ja-JP".to_string()),
        "en" => Some("en-US".to_string()),
        "ko" => Some("ko-KR".to_string()),
        "zh" => Some("zh-CN".to_string()),
        "fr" => Some("fr-FR".to_string()),
        "de" => Some("de-DE".to_string()),
        "es" => Some("es-ES".to_string()),
        "th" => Some("th-TH".to_string()),
        "id" => Some("id-ID".to_string()),
        "ru" => Some("ru-RU".to_string()),
        "auto" | "" => None,
        other => {
            if other.contains('-') {
                Some(other.to_string())
            } else {
                Some(format!("{}-{}", other, other.to_uppercase()))
            }
        }
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

    let mut sys_instruction = sys_instruction;
    if let Some(ctx) = &cfg.context_prompt {
        if !ctx.trim().is_empty() {
            sys_instruction.push_str("\n\nContext & Background:\n");
            sys_instruction.push_str(ctx.trim());
        }
    }
    if !cfg.terms.is_empty() {
        sys_instruction.push_str("\n\nDomain terminology & keywords to recognize accurately:\n");
        sys_instruction.push_str(&cfg.terms.join(", "));
    }

    let mut input_audio_transcription = serde_json::json!({});
    if let Some(bcp47) = map_bcp47(&src) {
        input_audio_transcription["languageCodes"] = serde_json::json!([bcp47]);
    }

    serde_json::json!({
        "setup": {
            "model": model,
            "generationConfig": {
                "responseModalities": ["TEXT"],
                "temperature": 0.2
            },
            "inputAudioTranscription": input_audio_transcription,
            "realtimeInputConfig": {
                "automaticActivityDetection": {
                    "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH",
                    "silenceDurationMs": 600
                }
            },
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
/// Extracts complete sentences (ending in punctuation . ! ? 。 ！？ \n)
/// and the remaining unfinalized provisional text.
fn split_sentences(text: &str) -> (Vec<String>, String) {
    let mut sentences = Vec::new();
    let text_trimmed = text.trim();
    if text_trimmed.is_empty() {
        return (sentences, String::new());
    }

    let chars: Vec<(usize, char)> = text_trimmed.char_indices().collect();
    let total_len = chars.len();
    let mut start = 0;
    let mut i = 0;

    while i < total_len {
        let (byte_idx, ch) = chars[i];
        let is_period = ch == '。'
            || ch == '！'
            || ch == '？'
            || ch == '!'
            || ch == '?'
            || ch == '\n'
            || (ch == '.'
                && !(i > 0
                    && chars[i - 1].1.is_ascii_digit()
                    && i + 1 < total_len
                    && chars[i + 1].1.is_ascii_digit()));

        if is_period {
            let end_byte = byte_idx + ch.len_utf8();
            let slice = text_trimmed[start..end_byte].trim();
            if !slice.is_empty() {
                sentences.push(slice.to_string());
            }
            start = end_byte;
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

fn clean_all(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation() && !"。！？、，.!?, \t\r\n".contains(*c))
        .collect::<String>()
        .to_lowercase()
}

fn dice_similarity(s1: &str, s2: &str) -> f64 {
    let a = clean_all(s1);
    let b = clean_all(s2);
    if a == b {
        return 1.0;
    }
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }

    // Substring containment check
    if a.contains(&b) || b.contains(&a) {
        let min_len = a.len().min(b.len()) as f64;
        let max_len = a.len().max(b.len()) as f64;
        let ratio = min_len / max_len;
        if ratio >= 0.50 {
            return ratio;
        }
    }

    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    if a_chars.len() < 2 || b_chars.len() < 2 {
        return if a_chars == b_chars { 1.0 } else { 0.0 };
    }

    let mut a_map: HashMap<(char, char), usize> = HashMap::new();
    for w in a_chars.windows(2) {
        *a_map.entry((w[0], w[1])).or_default() += 1;
    }

    let mut matches = 0;
    for w in b_chars.windows(2) {
        if let Some(count) = a_map.get_mut(&(w[0], w[1])) {
            if *count > 0 {
                *count -= 1;
                matches += 1;
            }
        }
    }

    (2.0 * matches as f64) / ((a_chars.len() - 1 + b_chars.len() - 1) as f64)
}

fn is_strong_sentence_end(text: &str) -> bool {
    let t = text.trim();
    if t.ends_with('.') || t.ends_with('!') || t.ends_with('?') {
        return t.split_whitespace().count() >= 4;
    }
    let strong_endings = [
        "ます。", "ました。", "ません。", "ましょう。",
        "です。", "でした。", "ですね。", "ですよね。", "ですよ。",
        "でしょうか。", "ましたね。", "ましたよ。", "と思います。", "と考えています。"
    ];
    if strong_endings.iter().any(|&e| t.ends_with(e)) {
        return true;
    }
    if (t.ends_with('。') || t.ends_with('！') || t.ends_with('？')) && t.chars().count() >= 25 {
        return true;
    }
    false
}

fn is_recent_duplicate(
    candidate: &str,
    turn_committed: &HashSet<String>,
    recent_committed: &VecDeque<(String, std::time::Instant)>,
) -> bool {
    let clean = clean_all(candidate);
    if clean.is_empty() {
        return true;
    }

    // 1. Check within active turn
    if turn_committed.contains(&clean) {
        return true;
    }

    // 2. Check recent history across turns (last 60 seconds)
    let now = std::time::Instant::now();
    for (prev_text, prev_time) in recent_committed.iter().rev() {
        if now.duration_since(*prev_time) > std::time::Duration::from_secs(60) {
            break;
        }
        let sim = dice_similarity(candidate, prev_text);
        if sim >= 0.65 {
            return true;
        }
    }

    false
}

async fn handle_server_message(
    text: &str,
    event_ch: &Channel<GeminiEvent>,
    translation_tx: &mpsc::Sender<TranslationJob>,
    next_translation_id: &mut u64,
    turn_committed: &mut HashSet<String>,
    recent_committed: &mut VecDeque<(String, std::time::Instant)>,
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

    // 2. Check for server errors or warnings
    if let Some(error) = value.get("error") {
        let code = error
            .get("code")
            .and_then(|c| c.as_i64())
            .unwrap_or(0);
        let message = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown server error");
        eprintln!(
            "[gemini-live] Server error response: {} - {}",
            code, message
        );
        let _ = event_ch.send(GeminiEvent::Error {
            code: format!("server_error_{}", code),
            message: message.to_string(),
        });
        return;
    }

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
        // A. Live interim transcription (with real-time incremental sentence commit)
        if let Some(interim) = server_content.get("interimInputTranscription") {
            if let Some(speech) = interim.get("text").and_then(|t| t.as_str()) {
                let speech_trimmed = speech.trim();
                if !speech_trimmed.is_empty() {
                    let speaker = interim
                        .get("speaker")
                        .or_else(|| interim.get("speakerLabel"))
                        .and_then(|s| s.as_str())
                        .map(str::to_string);

                    let (sentences, provisional) = split_sentences(speech_trimmed);

                    for (i, sent) in sentences.iter().enumerate() {
                        let has_subsequent = (i < sentences.len() - 1) || (provisional.chars().count() >= 8);
                        let sent_trimmed = sent.trim();
                        if has_subsequent && is_strong_sentence_end(sent_trimmed) {
                            if is_recent_duplicate(sent_trimmed, turn_committed, recent_committed) {
                                continue;
                            }

                            let translation_id = *next_translation_id;
                            *next_translation_id = (*next_translation_id).saturating_add(1);
                            eprintln!(
                                "[gemini-live] Stream commit sentence #{}: {}",
                                translation_id, sent_trimmed
                            );

                            let _ = event_ch.send(GeminiEvent::SourceTranscript {
                                id: translation_id,
                                text: sent_trimmed.to_string(),
                                is_final: true,
                                speaker: speaker.clone(),
                            });

                            let _ = translation_tx
                                .send(TranslationJob {
                                    id: translation_id,
                                    original: sent_trimmed.to_string(),
                                    speaker: speaker.clone(),
                                })
                                .await;

                            turn_committed.insert(clean_all(sent_trimmed));
                            recent_committed.push_back((
                                sent_trimmed.to_string(),
                                std::time::Instant::now(),
                            ));
                            if recent_committed.len() > 64 {
                                recent_committed.pop_front();
                            }
                        }
                    }

                    // Send live provisional preview for remaining unfinalized words
                    let _ = event_ch.send(GeminiEvent::Transcript {
                        text: provisional,
                        is_final: false,
                    });
                }
            }
        }

        // B. Final input transcription (when an utterance/turn completes)
        if let Some(input_tx) = server_content.get("inputTranscription") {
            if let Some(speech) = input_tx.get("text").and_then(|t| t.as_str()) {
                let speech_clean = speech.trim();
                if !speech_clean.is_empty() {
                    let speaker = input_tx
                        .get("speaker")
                        .or_else(|| input_tx.get("speakerLabel"))
                        .and_then(|s| s.as_str())
                        .map(str::to_string);

                    // Clear provisional text in the UI immediately
                    let _ = event_ch.send(GeminiEvent::Transcript {
                        text: String::new(),
                        is_final: false,
                    });

                    let (sentences, trailing) = split_sentences(speech_clean);
                    let mut all_sentences = sentences;
                    let trailing_trimmed = trailing.trim();
                    if !trailing_trimmed.is_empty() {
                        all_sentences.push(trailing_trimmed.to_string());
                    }

                    for sentence in all_sentences {
                        let sent_trimmed = sentence.trim();
                        if sent_trimmed.is_empty() {
                            continue;
                        }

                        if is_recent_duplicate(sent_trimmed, turn_committed, recent_committed) {
                            eprintln!(
                                "[gemini-live] Skipped duplicate final sentence: {}",
                                sent_trimmed
                            );
                            continue;
                        }

                        let translation_id = *next_translation_id;
                        *next_translation_id = (*next_translation_id).saturating_add(1);
                        eprintln!(
                            "[gemini-live] Final speech sentence #{}: {}",
                            translation_id, sent_trimmed
                        );

                        let _ = event_ch.send(GeminiEvent::SourceTranscript {
                            id: translation_id,
                            text: sent_trimmed.to_string(),
                            is_final: true,
                            speaker: speaker.clone(),
                        });

                        let _ = translation_tx
                            .send(TranslationJob {
                                id: translation_id,
                                original: sent_trimmed.to_string(),
                                speaker: speaker.clone(),
                            })
                            .await;

                        turn_committed.insert(clean_all(sent_trimmed));
                        recent_committed.push_back((
                            sent_trimmed.to_string(),
                            std::time::Instant::now(),
                        ));
                        if recent_committed.len() > 64 {
                            recent_committed.pop_front();
                        }
                    }

                    // Reset current turn committed set for the next turn
                    turn_committed.clear();
                }
            }
        }

        // Reset current turn committed set if turnComplete signal received
        if server_content.get("turnComplete").is_some() {
            turn_committed.clear();
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

async fn translate_raw_prompt(
    client: &reqwest::Client,
    api_key: &str,
    prompt: &str,
    models: &[String],
    cooldowns_ref: &Arc<tokio::sync::Mutex<HashMap<String, std::time::Instant>>>,
) -> Option<String> {
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
                            "text": prompt
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 1024
            }
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

    // If all models were in cooldown, wait up to 20s for the soonest cooldown to expire
    if let Some(wait) = soonest_wait {
        if wait <= std::time::Duration::from_secs(20) {
            eprintln!(
                "[gemini-live] All candidate models in cooldown, waiting {:?} before retrying",
                wait
            );
            tokio::time::sleep(wait).await;
        }
    }

    None
}

fn format_glossary_instructions(live_context: &GeminiLiveContext) -> String {
    let mut instructions = String::new();
    if !live_context.translation_terms.is_empty() {
        instructions.push_str("\n\nGlossary & Terminology translation rules (strictly respect these mappings):\n");
        for pair in &live_context.translation_terms {
            if !pair.source.trim().is_empty() && !pair.target.trim().is_empty() {
                instructions.push_str(&format!("- \"{}\" => \"{}\"\n", pair.source.trim(), pair.target.trim()));
            }
        }
    }
    if !live_context.terms.is_empty() {
        instructions.push_str("\nDomain terms & keywords to keep in mind:\n");
        instructions.push_str(&live_context.terms.join(", "));
        instructions.push('\n');
    }
    if let Some(ctx) = &live_context.context_prompt {
        if !ctx.trim().is_empty() {
            instructions.push_str(&format!("\nProject & conversation context:\n{}\n", ctx.trim()));
        }
    }
    instructions
}

async fn translate_text_rest(
    client: &reqwest::Client,
    api_key: &str,
    text: &str,
    target_lang: &str,
    models: &[String],
    cooldowns_ref: &Arc<tokio::sync::Mutex<HashMap<String, std::time::Instant>>>,
    live_context: &GeminiLiveContext,
) -> Option<String> {
    let target_name = map_lang_name(target_lang);
    let mut prompt = format!(
        "Translate the following speech accurately and naturally into {target_name}. Output ONLY the translated text in {target_name} without repeating the source language, and without notes or quotes:\n{}",
        text.trim()
    );
    let glossary_hints = format_glossary_instructions(live_context);
    if !glossary_hints.is_empty() {
        prompt.push_str(&glossary_hints);
    }
    translate_raw_prompt(client, api_key, &prompt, models, cooldowns_ref).await
}

fn parse_line_index_and_text(line: &str) -> Option<(usize, String)> {
    let line = line.trim();
    if line.starts_with('[') {
        if let Some(close_bracket) = line.find(']') {
            let num_str = line[1..close_bracket].trim();
            if let Ok(idx) = num_str.parse::<usize>() {
                let rest = line[close_bracket + 1..].trim().to_string();
                return Some((idx, rest));
            }
        }
    }
    let chars: Vec<char> = line.chars().collect();
    let mut digit_end = 0;
    while digit_end < chars.len() && chars[digit_end].is_ascii_digit() {
        digit_end += 1;
    }
    if digit_end > 0
        && digit_end < chars.len()
        && (chars[digit_end] == '.' || chars[digit_end] == ')' || chars[digit_end] == ']')
    {
        let num_str: String = chars[..digit_end].iter().collect();
        if let Ok(idx) = num_str.parse::<usize>() {
            let rest: String = chars[digit_end + 1..].iter().collect();
            return Some((idx, rest.trim().to_string()));
        }
    }
    None
}

fn parse_numbered_translations(text: &str, expected_count: usize) -> Vec<String> {
    let mut items: Vec<(usize, String)> = Vec::new();
    for line in text.lines() {
        let line_trimmed = line.trim();
        if line_trimmed.is_empty() {
            continue;
        }
        if let Some(captures) = parse_line_index_and_text(line_trimmed) {
            items.push(captures);
        } else if let Some(last) = items.last_mut() {
            last.1.push(' ');
            last.1.push_str(line_trimmed);
        }
    }

    if items.len() == expected_count {
        return items.into_iter().map(|(_, t)| t.trim().to_string()).collect();
    }

    let non_empty_lines: Vec<&str> = text
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();
    if non_empty_lines.len() == expected_count {
        return non_empty_lines
            .into_iter()
            .map(|l| {
                if let Some((_, t)) = parse_line_index_and_text(l) {
                    t
                } else {
                    l.to_string()
                }
            })
            .collect();
    }

    Vec::new()
}

async fn translate_batch_jobs(
    http_client: reqwest::Client,
    api_key: String,
    target_lang_ref: std::sync::Arc<tokio::sync::RwLock<String>>,
    jobs: Vec<TranslationJob>,
    models_ref: std::sync::Arc<tokio::sync::RwLock<Vec<String>>>,
    cooldowns_ref: std::sync::Arc<tokio::sync::Mutex<HashMap<String, std::time::Instant>>>,
    cache_ref: std::sync::Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    live_context: &GeminiLiveContext,
) -> Vec<GeminiEvent> {
    let target_lang = target_lang_ref.read().await.clone();
    let is_no_translate = target_lang == "none" || target_lang == "off" || target_lang.is_empty();

    if is_no_translate {
        return jobs
            .into_iter()
            .map(|job| GeminiEvent::Segment {
                id: job.id,
                original: job.original,
                translation: String::new(),
                speaker: job.speaker,
            })
            .collect();
    }

    let mut results: HashMap<u64, String> = HashMap::new();
    let mut uncached_indices: Vec<usize> = Vec::new();

    // Check cache for each job
    {
        let cache = cache_ref.lock().await;
        for (idx, job) in jobs.iter().enumerate() {
            let cache_key = format!("{}:{}", target_lang, job.original.trim());
            if let Some(cached) = cache.get(&cache_key) {
                results.insert(job.id, cached.clone());
            } else {
                uncached_indices.push(idx);
            }
        }
    }

    if uncached_indices.is_empty() {
        return jobs
            .into_iter()
            .map(|job| {
                let trans = results.remove(&job.id).unwrap_or_default();
                GeminiEvent::Segment {
                    id: job.id,
                    original: job.original,
                    translation: trans,
                    speaker: job.speaker,
                }
            })
            .collect();
    }

    if uncached_indices.len() == 1 {
        let idx = uncached_indices[0];
        let job = jobs[idx].clone();
        let event = translate_job(
            http_client,
            api_key,
            target_lang_ref,
            job,
            models_ref,
            cooldowns_ref,
            cache_ref,
            live_context,
        )
        .await;
        if let GeminiEvent::Segment { id, translation, .. } = &event {
            results.insert(*id, translation.clone());
        }
        return jobs
            .into_iter()
            .map(|j| {
                let trans = results.remove(&j.id).unwrap_or_default();
                GeminiEvent::Segment {
                    id: j.id,
                    original: j.original,
                    translation: trans,
                    speaker: j.speaker,
                }
            })
            .collect();
    }

    let mut prompt_items = String::new();
    for (seq, &idx) in uncached_indices.iter().enumerate() {
        prompt_items.push_str(&format!("[{}] {}\n", seq + 1, jobs[idx].original.trim()));
    }

    let target_name = map_lang_name(&target_lang);
    let mut prompt = format!(
        "Translate the following numbered speech items accurately and naturally into {target_name}. Output ONLY the numbered translations in order, without notes, quotes, or repeating source text:\n{}",
        prompt_items.trim()
    );
    let glossary_hints = format_glossary_instructions(live_context);
    if !glossary_hints.is_empty() {
        prompt.push_str(&glossary_hints);
    }

    let models = models_ref.read().await.clone();
    let mut batch_text_opt = None;

    for attempt in 0..TRANSLATION_MAX_ATTEMPTS {
        if attempt > 0 {
            let delay_ms = 2000u64 * (attempt as u64);
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
        }
        batch_text_opt = translate_raw_prompt(
            &http_client,
            &api_key,
            &prompt,
            &models,
            &cooldowns_ref,
        )
        .await;
        if batch_text_opt.as_ref().is_some_and(|t| !t.trim().is_empty()) {
            break;
        }
    }

    let mut parsed_success = false;
    if let Some(resp_text) = batch_text_opt {
        let parsed_items = parse_numbered_translations(&resp_text, uncached_indices.len());
        if parsed_items.len() == uncached_indices.len() {
            let mut cache = cache_ref.lock().await;
            for (seq, &idx) in uncached_indices.iter().enumerate() {
                let trans = parsed_items[seq].clone();
                let job = &jobs[idx];
                let trimmed = job.original.trim();
                if trimmed.len() < 120 {
                    let cache_key = format!("{}:{}", target_lang, trimmed);
                    cache.insert(cache_key, trans.clone());
                }
                results.insert(job.id, trans);
            }
            parsed_success = true;
        }
    }

    if !parsed_success {
        // Fallback: translate uncached items individually
        for &idx in &uncached_indices {
            let job = jobs[idx].clone();
            let event = translate_job(
                http_client.clone(),
                api_key.clone(),
                target_lang_ref.clone(),
                job,
                models_ref.clone(),
                cooldowns_ref.clone(),
                cache_ref.clone(),
                live_context,
            )
            .await;
            if let GeminiEvent::Segment { id, translation, .. } = event {
                results.insert(id, translation);
            }
        }
    }

    jobs.into_iter()
        .map(|job| {
            let trans = results.remove(&job.id).unwrap_or_default();
            GeminiEvent::Segment {
                id: job.id,
                original: job.original,
                translation: trans,
                speaker: job.speaker,
            }
        })
        .collect()
}



#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_bcp47() {
        assert_eq!(map_bcp47("vi"), Some("vi-VN".to_string()));
        assert_eq!(map_bcp47("ja"), Some("ja-JP".to_string()));
        assert_eq!(map_bcp47("en"), Some("en-US".to_string()));
        assert_eq!(map_bcp47("auto"), None);
        assert_eq!(map_bcp47(""), None);
    }

    #[test]
    fn test_build_setup_message_language_codes() {
        let cfg = GeminiRealtimeConfig {
            api_key: "test_key".into(),
            source_language: "vi".into(),
            target_language: "none".into(),
            model: None,
            diarization: false,
            context_prompt: None,
            terms: vec![],
            translation_terms: vec![],
        };
        let msg = build_setup_message(&cfg);
        let parsed: serde_json::Value = serde_json::from_str(&msg).unwrap();
        let lang_codes = parsed["setup"]["inputAudioTranscription"]["languageCodes"]
            .as_array()
            .unwrap();
        assert_eq!(lang_codes.len(), 1);
        assert_eq!(lang_codes[0].as_str(), Some("vi-VN"));
    }

    #[test]
    fn test_build_setup_message_with_glossary_and_context() {
        let cfg = GeminiRealtimeConfig {
            api_key: "test_key".into(),
            source_language: "ja".into(),
            target_language: "vi".into(),
            model: None,
            diarization: false,
            context_prompt: Some("Dự án AI Translator của công ty Acme".into()),
            terms: vec!["Kubernetes".into(), "Microservices".into()],
            translation_terms: vec![],
        };
        let msg = build_setup_message(&cfg);
        let parsed: serde_json::Value = serde_json::from_str(&msg).unwrap();
        let instruction = parsed["setup"]["systemInstruction"]["parts"][0]["text"]
            .as_str()
            .unwrap();
        assert!(instruction.contains("Dự án AI Translator của công ty Acme"));
        assert!(instruction.contains("Kubernetes, Microservices"));
    }

    #[test]
    fn test_format_glossary_instructions() {
        let ctx = GeminiLiveContext {
            context_prompt: Some("Core Banking System".into()),
            terms: vec!["gRPC".into(), "Kafka".into()],
            translation_terms: vec![TranslationTermPair {
                source: "要件定義".into(),
                target: "Định nghĩa yêu cầu".into(),
            }],
        };
        let formatted = format_glossary_instructions(&ctx);
        assert!(formatted.contains("要件定義"));
        assert!(formatted.contains("Định nghĩa yêu cầu"));
        assert!(formatted.contains("gRPC, Kafka"));
        assert!(formatted.contains("Core Banking System"));
    }

    #[test]
    fn test_extract_sentences_with_no_space_period() {
        let text = "Anh cơ bản là có hai ai mà là rồi thì nó dễ.Tôi thì học xong.";
        let (sentences, provisional) = split_sentences(text);
        assert_eq!(sentences.len(), 2);
        assert_eq!(sentences[0], "Anh cơ bản là có hai ai mà là rồi thì nó dễ.");
        assert_eq!(sentences[1], "Tôi thì học xong.");
        assert!(provisional.is_empty());
    }

    #[test]
    fn test_extract_sentences_preserves_decimal_numbers() {
        let text = "Phiên bản 2.5 đã ra mắt.Tuyệt vời!";
        let (sentences, provisional) = split_sentences(text);
        assert_eq!(sentences.len(), 2);
        assert_eq!(sentences[0], "Phiên bản 2.5 đã ra mắt.");
        assert_eq!(sentences[1], "Tuyệt vời!");
        assert!(provisional.is_empty());
    }

    #[test]
    fn test_clean_all_and_dice_similarity() {
        let s1 = "その と 1 トランスフォーマーレイヤーに対してですね、 まず、まあ最初は普通の インプットが入ってきます。";
        let s2 = "そのと1トランスフォーマーレイヤーに対してですね、まずまあ最初は普通のインプットが入ってきます。";
        assert_eq!(clean_all(s1), clean_all(s2));
        assert!(dice_similarity(s1, s2) >= 0.95);

        // Substring revision
        let s3 = "別のパラメーター持った。";
        let s4 = "別のパラメータ持ったがはい。";
        assert!(dice_similarity(s3, s4) >= 0.70);

        // Speech recognition token revision
        let s5 = "で、普通に考えたら これ、本人 が来るはず。";
        let s6 = "で、普通に考えたら これ、トニンが来るはず。";
        assert!(dice_similarity(s5, s6) >= 0.75);

        // Completely different
        let s7 = "全く同じパラメーターです。";
        assert!(dice_similarity(s1, s7) < 0.20);
    }

    #[test]
    fn test_is_strong_sentence_end() {
        assert!(is_strong_sentence_end("インプットが入ってきます。"));
        assert!(is_strong_sentence_end("全く同じパラメーターです。"));
        assert!(is_strong_sentence_end("昔のRNNとかよくやってたことなんですが、時間方向にぐるぐる回すんですね。"));
        assert!(is_strong_sentence_end("This is a complete sentence."));
        
        // Incomplete / weak
        assert!(!is_strong_sentence_end("で、出力する。"));
        assert!(!is_strong_sentence_end("なんと。"));
        assert!(!is_strong_sentence_end("Hi."));
    }

    #[test]
    fn test_is_recent_duplicate() {
        let mut turn_committed = HashSet::new();
        let mut recent = VecDeque::new();
        recent.push_back((
            "まさかの緊急収録 ですね。".to_string(),
            std::time::Instant::now(),
        ));

        // Exact match with different CJK spacing
        assert!(is_recent_duplicate("まさかの緊急収録ですね。", &turn_committed, &recent));

        // Turn committed match
        turn_committed.insert(clean_all("はい。"));
        assert!(is_recent_duplicate("はい。", &turn_committed, &recent));

        // Different sentence
        assert!(!is_recent_duplicate("いや、本当にこれ緊急です。", &turn_committed, &recent));
    }

    #[test]
    fn test_parse_numbered_translations() {
        let text = "[1] Tôi xin phép được chia sẻ 3 điểm chính.\n[2] Được gọi là bang\n[3] Tham gia vào chương trình đào tạo";
        let parsed = parse_numbered_translations(text, 3);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0], "Tôi xin phép được chia sẻ 3 điểm chính.");
        assert_eq!(parsed[1], "Được gọi là bang");
        assert_eq!(parsed[2], "Tham gia vào chương trình đào tạo");

        // Format with dot "1. "
        let text_dot = "1. Câu thứ nhất\n2. Câu thứ hai";
        let parsed_dot = parse_numbered_translations(text_dot, 2);
        assert_eq!(parsed_dot.len(), 2);
        assert_eq!(parsed_dot[0], "Câu thứ nhất");
        assert_eq!(parsed_dot[1], "Câu thứ hai");
    }

    #[test]
    fn test_continuous_speech_incremental_finalization() {
        let text = "え、今日はプーチン、ゼレンスキー両氏の思惑を読み解いていこうという風に思っております。今夜のゲストをご紹介します。元駐ウクライナ大使で";
        let (sentences, provisional) = split_sentences(text);
        assert_eq!(sentences.len(), 2);
        assert_eq!(
            sentences[0],
            "え、今日はプーチン、ゼレンスキー両氏の思惑を読み解いていこうという風に思っております。"
        );
        assert_eq!(sentences[1], "今夜のゲストをご紹介します。");
        assert_eq!(provisional, "元駐ウクライナ大使で");
    }
}
