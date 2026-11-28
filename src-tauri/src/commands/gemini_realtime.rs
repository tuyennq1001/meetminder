// Gemini Live realtime translation provider — backend WebSocket bridge.
//
// Uses Google Gemini Multimodal Live API (gemini-3.5-transcribe-live + fast translation):
// wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={API_KEY}

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use crate::settings::GeminiLiveGlossarySettings;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const GEMINI_LIVE_WS_HOST: &str = "generativelanguage.googleapis.com";
const AUTO_GEMINI_MODEL: &str = "auto";
const LIVE_TRANSLATE_MODEL: &str = "models/gemini-3.5-live-translate-preview";
const FALLBACK_TRANSCRIBE_MODEL: &str = "models/gemini-3.5-transcribe-live";
const DEFAULT_GEMINI_MODEL: &str = LIVE_TRANSLATE_MODEL;
const TRANSLATION_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
const TRANSLATION_MAX_ATTEMPTS: usize = 5;
// Gemini's free-tier generateContent limit is 15 requests/minute. Batches can
// contain up to six utterances, so one request every four seconds keeps the
// worker below that limit without imposing a per-utterance delay.
const TRANSLATION_PACE_DELAY: std::time::Duration = std::time::Duration::from_secs(4);

type GeminiEventSink = Arc<dyn Fn(GeminiEvent) + Send + Sync>;

fn emit_event(event_sink: &GeminiEventSink, event: GeminiEvent) {
    event_sink(event);
}

#[derive(Clone, Copy)]
enum ModelCooldownKind {
    Quota,
    Server,
}

#[derive(Debug, Deserialize, Clone)]
pub struct GeminiRealtimeConfig {
    pub api_key: String,
    /// BCP-47-ish code (e.g. "en", "ja", "auto")
    pub source_language: String,
    /// BCP-47-ish code (e.g. "vi", "en", "ja")
    pub target_language: String,
    pub model: Option<String>,
    /// "direct" uses Live Translate audio output; "batch" transcribes first and translates text.
    #[serde(default = "default_live_translation_mode")]
    pub live_translation_mode: String,
    #[serde(default)]
    pub gemini_live_glossary: GeminiLiveGlossarySettings,
    /// Runtime circuit breaker set after Gemini explicitly rejects customVocabulary.
    #[serde(default = "default_glossary_transcription_hints_enabled")]
    pub glossary_transcription_hints_enabled: bool,
    #[serde(default)]
    pub diarization: bool,
}

fn default_live_translation_mode() -> String {
    "direct".to_string()
}

fn default_glossary_transcription_hints_enabled() -> bool {
    true
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
    /// Incremental source/target fragments from Gemini Live Translate. These
    /// are UI-only previews and are replaced by the next finalized Segment.
    LivePreview {
        original: String,
        translation: String,
    },
    /// The server is going to close this Live session. The frontend should
    /// reconnect before the deadline so the audio capture has no long gap.
    Reconnecting {
        delay_ms: u64,
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
#[derive(Debug, Clone)]
struct TranslationJob {
    id: u64,
    original: String,
    speaker: Option<String>,
    target_language: String,
}

/// Gemini Live Translate streams source and target transcript fragments on
/// separate fields. This assembler converts both streams into stable pairs
/// without issuing a second REST request for every sentence.
#[derive(Default)]
struct LiveTranslateAssembler {
    source_buffer: String,
    target_buffer: String,
    source_sentences: VecDeque<(u64, String)>,
    target_sentences: VecDeque<String>,
    next_id: u64,
}

impl LiveTranslateAssembler {
    fn new() -> Self {
        Self {
            next_id: 1,
            ..Self::default()
        }
    }

    fn ingest_source(&mut self, fragment: &str) -> Vec<GeminiEvent> {
        self.source_buffer.push_str(fragment);
        let (sentences, trailing) = split_sentences(&self.source_buffer);
        self.source_buffer = trailing;

        let mut events = Vec::new();
        for sentence in sentences {
            self.queue_source(sentence, &mut events);
        }
        self.drain_pairs(&mut events, false);
        self.push_preview(&mut events);
        events
    }

    fn ingest_target(&mut self, fragment: &str) -> Vec<GeminiEvent> {
        self.target_buffer.push_str(fragment);
        let (sentences, trailing) = split_sentences(&self.target_buffer);
        self.target_buffer = trailing;
        self.target_sentences.extend(sentences);

        let mut events = Vec::new();
        self.drain_pairs(&mut events, true);
        self.push_preview(&mut events);
        events
    }

    fn flush(&mut self) -> Vec<GeminiEvent> {
        let mut events = Vec::new();
        let source = std::mem::take(&mut self.source_buffer);
        if !source.trim().is_empty() {
            self.queue_source(source, &mut events);
        }
        let target = std::mem::take(&mut self.target_buffer);
        if !target.trim().is_empty() {
            self.target_sentences.push_back(target.trim().to_string());
        }
        self.drain_pairs(&mut events, false);
        events
    }

    fn queue_source(&mut self, sentence: String, events: &mut Vec<GeminiEvent>) {
        let original = sentence.trim().to_string();
        if original.is_empty() {
            return;
        }
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        self.source_sentences.push_back((id, original.clone()));
        events.push(GeminiEvent::SourceTranscript {
            id,
            text: original,
            is_final: true,
            speaker: None,
        });
    }

    fn push_preview(&self, events: &mut Vec<GeminiEvent>) {
        // Completed source sentences already have a durable SourceTranscript
        // event; only expose the still-unfinalized tail as a provisional line.
        let original = self.source_buffer.clone();

        let mut translation = self
            .target_sentences
            .iter()
            .cloned()
            .collect::<Vec<_>>()
            .join(" ");
        translation.push_str(&self.target_buffer);
        if !original.trim().is_empty() || !translation.trim().is_empty() {
            events.push(GeminiEvent::LivePreview {
                original,
                translation,
            });
        }
    }

    fn drain_pairs(
        &mut self,
        events: &mut Vec<GeminiEvent>,
        allow_completed_target_to_close_source: bool,
    ) {
        while !self.target_sentences.is_empty() {
            if self.source_sentences.is_empty()
                && allow_completed_target_to_close_source
                && self.target_buffer.is_empty()
                && !self.source_buffer.trim().is_empty()
            {
                let source = std::mem::take(&mut self.source_buffer);
                self.queue_source(source, events);
            }

            let Some((id, original)) = self.source_sentences.pop_front() else {
                break;
            };
            let Some(translation) = self.target_sentences.pop_front() else {
                self.source_sentences.push_front((id, original));
                break;
            };
            events.push(GeminiEvent::Segment {
                id,
                original,
                translation,
                speaker: None,
            });
        }
    }
}

#[derive(Default)]
pub struct GeminiState {
    sessions: Arc<Mutex<HashMap<u64, Session>>>,
    next_id: Mutex<u64>,
    models_cache: Arc<tokio::sync::RwLock<Option<(std::time::Instant, Vec<String>)>>>,
    cooldowns: Arc<tokio::sync::Mutex<HashMap<String, (std::time::Instant, ModelCooldownKind)>>>,
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
    let event_sink: GeminiEventSink = Arc::new(move |event| {
        let _ = event_ch.send(event);
    });
    let sessions_map = state.sessions.clone();
    let models_cache = state.models_cache.clone();
    let cooldowns = state.cooldowns.clone();
    let translation_cache = state.translation_cache.clone();

    tokio::spawn(async move {
        emit_event(
            &event_sink,
            GeminiEvent::Status {
                state: "connecting".into(),
                message: None,
            },
        );

        if let Err(e) = run_session(
            config,
            session_id.saturating_mul(1_000_000),
            target_lang,
            audio_rx,
            stop_rx,
            event_sink.clone(),
            models_cache,
            cooldowns,
            translation_cache,
        )
        .await
        {
            eprintln!("[gemini-live] Session failed: {}", e);
            emit_event(
                &event_sink,
                GeminiEvent::Error {
                    code: "session_failed".into(),
                    message: e.clone(),
                },
            );
            emit_event(
                &event_sink,
                GeminiEvent::Closed {
                    reason: format!("error: {}", e),
                },
            );
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
    mut cfg: GeminiRealtimeConfig,
    translation_id_base: u64,
    target_lang_ref: Arc<tokio::sync::RwLock<String>>,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    mut stop_rx: mpsc::UnboundedReceiver<()>,
    event_sink: GeminiEventSink,
    models_cache: Arc<tokio::sync::RwLock<Option<(std::time::Instant, Vec<String>)>>>,
    cooldowns: Arc<tokio::sync::Mutex<HashMap<String, (std::time::Instant, ModelCooldownKind)>>>,
    translation_cache: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
) -> Result<(), String> {
    let mut setup_fallback_attempted = false;
    let (mut ws_sink, mut ws_stream) = loop {
        let ws_url = format!(
            "wss://{}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={}",
            GEMINI_LIVE_WS_HOST,
            cfg.api_key.trim()
        );

        eprintln!("[gemini-live] Connecting to WebSocket endpoint...");
        let (ws_stream, response) = connect_async(ws_url.as_str()).await.map_err(|e| match e {
            tokio_tungstenite::tungstenite::Error::Http(response) => {
                let status = response.status();
                let body = response
                    .body()
                    .as_ref()
                    .map(|bytes| String::from_utf8_lossy(bytes).to_string())
                    .unwrap_or_default();
                if body.trim().is_empty() {
                    format!("WebSocket handshake failed: HTTP {}", status)
                } else {
                    format!(
                        "WebSocket handshake failed: HTTP {}: {}",
                        status,
                        body.trim()
                    )
                }
            }
            other => format!("WebSocket handshake failed: {}", other),
        })?;

        eprintln!(
            "[gemini-live] WebSocket connected! HTTP status: {}",
            response.status()
        );
        let (mut sink, mut stream) = ws_stream.split();
        let setup_msg = build_setup_message(&cfg);
        eprintln!(
            "[gemini-live] Sending setup for model {} ({} custom vocabulary terms)",
            normalized_model(&cfg),
            gemini_glossary_vocabulary(&cfg).len()
        );
        sink.send(Message::Text(setup_msg.into()))
            .await
            .map_err(|e| format!("send setup message: {}", e))?;

        // Gemini requires the client to wait for setupComplete before sending
        // audio. Waiting here also lets us safely retry an explicitly rejected
        // vocabulary field before the microphone stream enters this session.
        let setup_result = tokio::time::timeout(std::time::Duration::from_secs(20), async {
            loop {
                match stream.next().await {
                    Some(Ok(Message::Text(text))) => {
                        if let Some(result) = parse_gemini_setup_response(text.as_ref()) {
                            break result;
                        }
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        if let Ok(text) = std::str::from_utf8(&bytes) {
                            if let Some(result) = parse_gemini_setup_response(text) {
                                break result;
                            }
                        }
                    }
                    Some(Ok(Message::Close(frame))) => {
                        let detail = frame
                            .map(|frame| format!("{}: {}", frame.code, frame.reason))
                            .unwrap_or_else(|| "closed during setup".into());
                        break Err(format!("Gemini closed the connection during setup: {}", detail));
                    }
                    Some(Ok(_)) => {}
                    Some(Err(error)) => break Err(format!("Gemini setup response failed: {}", error)),
                    None => break Err("Gemini connection ended before setup completed".into()),
                }
            }
        })
        .await
        .map_err(|_| "Timed out waiting for Gemini setup to complete".to_string())?;

        match setup_result {
            Ok(()) => {
                emit_event(
                    &event_sink,
                    GeminiEvent::Status {
                        state: "ready".into(),
                        message: Some("Gemini Live connected".into()),
                    },
                );
                break (sink, stream);
            }
            Err(error)
                if !setup_fallback_attempted
                    && !gemini_glossary_vocabulary(&cfg).is_empty()
                    && is_custom_vocabulary_rejection(&error) =>
            {
                setup_fallback_attempted = true;
                cfg.glossary_transcription_hints_enabled = false;
                emit_event(
                    &event_sink,
                    GeminiEvent::Status {
                        state: "glossary_hints_unavailable".into(),
                        message: None,
                    },
                );
                let _ = sink.send(Message::Close(None)).await;
                eprintln!("[gemini-live] Gemini rejected customVocabulary; retrying setup without glossary hints");
            }
            Err(error) => return Err(error),
        }
    };

    let live_translate = uses_live_translate(&cfg);
    let mut live_assembler = LiveTranslateAssembler::new();
    let mut next_translation_id = translation_id_base.saturating_add(1);
    let mut recent_committed: VecDeque<(String, std::time::Instant)> = VecDeque::with_capacity(64);
    let mut turn_committed: HashSet<String> = HashSet::new();
    let (translation_tx, translation_worker) = if live_translate {
        eprintln!("[gemini-live] Live Translate pipeline active; REST translation disabled");
        (None, None)
    } else {
        let (tx, worker) = start_translation_worker(
            &cfg,
            event_sink.clone(),
            models_cache,
            cooldowns,
            translation_cache,
        )
        .await;
        (Some(tx), Some(worker))
    };

    loop {
        tokio::select! {
            biased;

            _ = stop_rx.recv() => {
                eprintln!("[gemini-live] Stop signal received, closing WS");
                if live_translate {
                    let end_msg = serde_json::json!({
                        "realtimeInput": { "audioStreamEnd": true }
                    });
                    let _ = ws_sink.send(Message::Text(end_msg.to_string().into())).await;

                    // Give the streaming model a short grace window to emit
                    // the last source/target fragments before closing.
                    let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(1500);
                    while tokio::time::Instant::now() < deadline {
                        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                        match tokio::time::timeout(remaining, ws_stream.next()).await {
                            Ok(Some(Ok(Message::Text(text)))) => {
                                handle_server_message(
                                    &text,
                                    &event_sink,
                                    None,
                                    &target_lang_ref,
                                    Some(&mut live_assembler),
                                    &mut next_translation_id,
                                    &mut turn_committed,
                                    &mut recent_committed,
                                ).await;
                            }
                            Ok(Some(Ok(Message::Binary(bin)))) => {
                                if let Ok(text) = std::str::from_utf8(&bin) {
                                    handle_server_message(
                                        text,
                                        &event_sink,
                                        None,
                                        &target_lang_ref,
                                        Some(&mut live_assembler),
                                        &mut next_translation_id,
                                        &mut turn_committed,
                                        &mut recent_committed,
                                    ).await;
                                }
                            }
                            _ => break,
                        }
                    }
                    send_events(&event_sink, live_assembler.flush());
                }
                let _ = ws_sink.send(Message::Close(None)).await;
                break;
            }

            Some(pcm) = audio_rx.recv() => {
                let b64 = B64.encode(&pcm);
                let media_msg = if live_translate {
                    serde_json::json!({
                        "realtimeInput": {
                            "audio": {
                                "mimeType": "audio/pcm;rate=16000",
                                "data": b64
                            }
                        }
                    })
                } else {
                    serde_json::json!({
                        "realtimeInput": {
                            "mediaChunks": [
                                {
                                    "mimeType": "audio/pcm;rate=16000",
                                    "data": b64
                                }
                            ]
                        }
                    })
                };
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
                            &event_sink,
                            translation_tx.as_ref(),
                            &target_lang_ref,
                            live_translate.then_some(&mut live_assembler),
                            &mut next_translation_id,
                            &mut turn_committed,
                            &mut recent_committed,
                        ).await;
                    }
                    Some(Ok(Message::Binary(bin))) => {
                        if let Ok(text) = std::str::from_utf8(&bin) {
                            handle_server_message(
                                text,
                                &event_sink,
                                translation_tx.as_ref(),
                                &target_lang_ref,
                                live_translate.then_some(&mut live_assembler),
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
                        emit_event(&event_sink, GeminiEvent::Closed { reason: reason.clone() });
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
                        emit_event(&event_sink, GeminiEvent::Closed {
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

#[derive(Debug, Clone)]
pub(crate) struct RecordedLiveSegment {
    pub start_sec: f64,
    pub original: String,
    pub translation: String,
    pub speaker: Option<String>,
}

#[derive(Default)]
struct RecordedLiveCollector {
    segments: Vec<(u64, RecordedLiveSegment)>,
    indexes: HashMap<u64, usize>,
    next_start_ms: u64,
}

impl RecordedLiveCollector {
    fn add_source(
        &mut self,
        id: u64,
        text: String,
        speaker: Option<String>,
        audio_position_ms: u64,
    ) {
        if text.trim().is_empty() || self.indexes.contains_key(&id) {
            return;
        }
        let start_ms = self.next_start_ms.min(audio_position_ms);
        self.next_start_ms = audio_position_ms.max(start_ms.saturating_add(250));
        let index = self.segments.len();
        self.segments.push((
            id,
            RecordedLiveSegment {
                start_sec: start_ms as f64 / 1_000.0,
                original: text.trim().to_string(),
                translation: String::new(),
                speaker,
            },
        ));
        self.indexes.insert(id, index);
    }

    fn add_pair(
        &mut self,
        id: u64,
        original: String,
        translation: String,
        speaker: Option<String>,
        audio_position_ms: u64,
        include_translation: bool,
    ) {
        if !self.indexes.contains_key(&id) {
            self.add_source(id, original.clone(), speaker.clone(), audio_position_ms);
        }
        if let Some(index) = self.indexes.get(&id).copied() {
            let segment = &mut self.segments[index].1;
            if segment.original.trim().is_empty() {
                segment.original = original.trim().to_string();
            }
            if include_translation {
                segment.translation = translation.trim().to_string();
            }
            if segment.speaker.is_none() {
                segment.speaker = speaker;
            }
        }
    }

    fn finish(mut self) -> Vec<RecordedLiveSegment> {
        self.segments.sort_by_key(|(id, _)| *id);
        self.segments
            .into_iter()
            .map(|(_, segment)| segment)
            .collect()
    }
}

/// Feed a recorded 16 kHz mono PCM buffer through the same Live Translate
/// WebSocket pipeline used by an active meeting. Google recommends 100 ms
/// frames, so playback is intentionally paced at wall-clock speed.
pub(crate) async fn translate_recorded_pcm<F>(
    api_key: &str,
    source_language: &str,
    target_language: &str,
    pcm: Vec<u8>,
    cancel_flag: Arc<AtomicBool>,
    on_progress: F,
) -> Result<Vec<RecordedLiveSegment>, String>
where
    F: Fn(u64, u64),
{
    if api_key.trim().is_empty() {
        return Err("Gemini API key is empty".into());
    }
    if pcm.is_empty() {
        return Err("The decoded audio is empty".into());
    }

    let requested_target = target_language.trim().to_lowercase();
    let include_translation = !requested_target.is_empty()
        && requested_target != "none"
        && requested_target != "off"
        && requested_target != source_language.trim().to_lowercase();
    let live_target =
        if requested_target.is_empty() || requested_target == "none" || requested_target == "off" {
            let source = source_language.trim().to_lowercase();
            if source.is_empty() || source == "auto" {
                "vi".to_string()
            } else {
                source
            }
        } else {
            requested_target
        };

    let cfg = GeminiRealtimeConfig {
        api_key: api_key.trim().to_string(),
        source_language: source_language.to_string(),
        target_language: live_target,
        model: Some(LIVE_TRANSLATE_MODEL.to_string()),
        live_translation_mode: default_live_translation_mode(),
        gemini_live_glossary: GeminiLiveGlossarySettings::default(),
        glossary_transcription_hints_enabled: default_glossary_transcription_hints_enabled(),
        diarization: false,
    };
    let target_lang_ref = Arc::new(tokio::sync::RwLock::new(cfg.target_language.clone()));
    let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (stop_tx, stop_rx) = mpsc::unbounded_channel::<()>();
    let ready = Arc::new(tokio::sync::Notify::new());
    let setup_complete = Arc::new(AtomicBool::new(false));
    let audio_position_ms = Arc::new(AtomicU64::new(0));
    let feeding_done = Arc::new(AtomicBool::new(false));
    let collector = Arc::new(Mutex::new(RecordedLiveCollector::default()));
    let error = Arc::new(Mutex::new(None::<String>));

    let sink_ready = ready.clone();
    let sink_setup_complete = setup_complete.clone();
    let sink_position = audio_position_ms.clone();
    let sink_done = feeding_done.clone();
    let sink_collector = collector.clone();
    let sink_error = error.clone();
    let event_sink: GeminiEventSink = Arc::new(move |event| match event {
        GeminiEvent::Status { state, .. } if state == "ready" => {
            sink_setup_complete.store(true, Ordering::SeqCst);
            sink_ready.notify_one();
        }
        GeminiEvent::SourceTranscript {
            id,
            text,
            is_final: true,
            speaker,
        } => {
            if let Ok(mut collector) = sink_collector.lock() {
                collector.add_source(id, text, speaker, sink_position.load(Ordering::Relaxed));
            }
        }
        GeminiEvent::Segment {
            id,
            original,
            translation,
            speaker,
        } => {
            if let Ok(mut collector) = sink_collector.lock() {
                collector.add_pair(
                    id,
                    original,
                    translation,
                    speaker,
                    sink_position.load(Ordering::Relaxed),
                    include_translation,
                );
            }
        }
        GeminiEvent::Error { message, .. } | GeminiEvent::TranslationFailed { message, .. } => {
            if let Ok(mut stored) = sink_error.lock() {
                *stored = Some(message);
            }
            sink_ready.notify_one();
        }
        GeminiEvent::Reconnecting { .. } => {
            if let Ok(mut stored) = sink_error.lock() {
                *stored = Some(
                    "Gemini Live requested a reconnect before this audio part finished".into(),
                );
            }
        }
        GeminiEvent::Closed { reason } if !sink_done.load(Ordering::SeqCst) => {
            if let Ok(mut stored) = sink_error.lock() {
                *stored = Some(format!("Gemini Live closed early: {}", reason));
            }
        }
        _ => {}
    });

    let runner = tokio::spawn(run_session(
        cfg,
        0,
        target_lang_ref,
        audio_rx,
        stop_rx,
        event_sink,
        Arc::new(tokio::sync::RwLock::new(None)),
        Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        Arc::new(tokio::sync::Mutex::new(HashMap::new())),
    ));

    if tokio::time::timeout(std::time::Duration::from_secs(20), ready.notified())
        .await
        .is_err()
    {
        let _ = stop_tx.send(());
        let _ = runner.await;
        return Err(error
            .lock()
            .ok()
            .and_then(|value| value.clone())
            .unwrap_or_else(|| "Timed out connecting to Gemini Live Translate".into()));
    }
    if !setup_complete.load(Ordering::SeqCst) {
        let _ = stop_tx.send(());
        let _ = runner.await;
        return Err(error
            .lock()
            .ok()
            .and_then(|value| value.clone())
            .unwrap_or_else(|| "Gemini Live Translate did not finish connecting".into()));
    }

    const PCM_BYTES_PER_100_MS: usize = 16_000 * 2 / 10;
    let total_bytes = pcm.len() as u64;
    let mut sent_bytes = 0_u64;
    for frame in pcm.chunks(PCM_BYTES_PER_100_MS) {
        if cancel_flag.load(Ordering::SeqCst) {
            let _ = stop_tx.send(());
            let _ = runner.await;
            return Err("Quá trình Re-transcript đã bị hủy".into());
        }
        if let Some(message) = error.lock().ok().and_then(|value| value.clone()) {
            let _ = stop_tx.send(());
            let _ = runner.await;
            return Err(message);
        }
        if audio_tx.send(frame.to_vec()).is_err() {
            let _ = stop_tx.send(());
            let recorded_error = error.lock().ok().and_then(|value| value.clone());
            if let Some(message) = recorded_error {
                let _ = runner.await;
                return Err(message);
            }
            return match runner.await {
                Ok(Err(message)) => Err(message),
                Err(join_error) => Err(format!("Gemini Live task failed: {}", join_error)),
                Ok(Ok(())) => Err("Gemini Live audio session ended unexpectedly".into()),
            };
        }
        sent_bytes = sent_bytes.saturating_add(frame.len() as u64);
        audio_position_ms.store(sent_bytes.saturating_mul(1_000) / 32_000, Ordering::Relaxed);
        if sent_bytes == total_bytes || sent_bytes % 32_000 < PCM_BYTES_PER_100_MS as u64 {
            on_progress(sent_bytes, total_bytes);
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    feeding_done.store(true, Ordering::SeqCst);
    drop(audio_tx);
    let _ = stop_tx.send(());
    match runner.await {
        Ok(Ok(())) => {}
        Ok(Err(message)) => return Err(message),
        Err(error) => return Err(format!("Gemini Live task failed: {}", error)),
    }
    if let Some(message) = error.lock().ok().and_then(|value| value.clone()) {
        return Err(message);
    }
    let collected = Arc::try_unwrap(collector)
        .map_err(|_| "Could not finalize Gemini Live transcript".to_string())?
        .into_inner()
        .map_err(|error| error.to_string())?
        .finish();
    if collected.is_empty() {
        return Err("Gemini Live Translate returned an empty transcript".into());
    }
    Ok(collected)
}

#[derive(Debug, Clone)]
struct GlossaryTerm {
    source: String,
    target: String,
}

#[derive(Debug, Clone)]
struct GlossaryMarker {
    token: String,
    target: String,
}

#[derive(Debug, Clone)]
struct PreparedGlossaryJob {
    job: TranslationJob,
    prompt_text: String,
    markers: Vec<GlossaryMarker>,
}

fn glossary_terms(
    glossary: &GeminiLiveGlossarySettings,
    source_language: &str,
    target_language: &str,
) -> Vec<GlossaryTerm> {
    let target = target_language
        .trim()
        .to_lowercase()
        .split('-')
        .next()
        .unwrap_or_default()
        .to_string();
    let source = source_language
        .trim()
        .to_lowercase()
        .split('-')
        .next()
        .unwrap_or_default()
        .to_string();
    let source_column = match (source.as_str(), target.as_str()) {
        ("vi", "ja") | ("auto", "ja") => "vi",
        ("ja", "vi") | ("auto", "vi") => "ja",
        _ => return Vec::new(),
    };

    let mut mapped: HashMap<String, String> = HashMap::new();
    let mut ambiguous = HashSet::new();
    for entry in &glossary.entries {
        let (term, replacement) = if source_column == "vi" {
            (entry.vi.trim(), entry.ja.trim())
        } else {
            (entry.ja.trim(), entry.vi.trim())
        };
        if term.is_empty() || replacement.is_empty() {
            continue;
        }
        let key = term.to_lowercase();
        match mapped.get(&key) {
            Some(existing) if existing != replacement => {
                ambiguous.insert(key);
            }
            Some(_) => {}
            None => {
                mapped.insert(key, replacement.to_string());
            }
        }
    }

    let mut terms = mapped
        .into_iter()
        .filter(|(key, _)| !ambiguous.contains(key))
        .map(|(source, target)| GlossaryTerm { source, target })
        .collect::<Vec<_>>();
    terms.sort_by_key(|term| std::cmp::Reverse(term.source.chars().count()));
    terms
}

fn is_japanese_word_char(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3040..=0x30ff | 0x31f0..=0x31ff | 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff
    )
}

fn is_japanese_particle(ch: char) -> bool {
    matches!(ch, 'は' | 'が' | 'を' | 'に' | 'へ' | 'と' | 'で' | 'の' | 'も' | 'や' | 'ね' | 'よ' | 'か')
}

fn has_japanese_suffix_boundary(after: &str) -> bool {
    ["さん", "ちゃん", "くん", "様", "氏", "社", "株式会社", "合同会社", "有限会社"]
        .iter()
        .any(|suffix| after.starts_with(suffix))
}

fn has_glossary_boundaries(text: &str, start: usize, end: usize, term: &str) -> bool {
    let before = text[..start].chars().next_back();
    let after = text[end..].chars().next();
    let has_japanese = term.chars().any(is_japanese_word_char);

    if term.chars().next().is_some_and(|ch| ch.is_ascii_alphanumeric())
        && before.is_some_and(|ch| ch.is_ascii_alphanumeric())
    {
        return false;
    }
    if term.chars().next_back().is_some_and(|ch| ch.is_ascii_alphanumeric())
        && after.is_some_and(|ch| ch.is_ascii_alphanumeric())
    {
        return false;
    }

    if has_japanese {
        if before.is_some_and(is_japanese_word_char)
            && !before.is_some_and(is_japanese_particle)
        {
            return false;
        }
        if after.is_some_and(is_japanese_word_char)
            && !after.is_some_and(is_japanese_particle)
            && !has_japanese_suffix_boundary(&text[end..])
        {
            return false;
        }
    }
    true
}

fn next_glossary_match<'a>(
    text: &str,
    from: usize,
    terms: &'a [GlossaryTerm],
) -> Option<(usize, usize, &'a GlossaryTerm)> {
    for (start, _) in text.char_indices().filter(|(start, _)| *start >= from) {
        for term in terms {
            let end = start.checked_add(term.source.len())?;
            let Some(candidate) = text.get(start..end) else {
                continue;
            };
            if candidate.eq_ignore_ascii_case(&term.source)
                && has_glossary_boundaries(text, start, end, &term.source)
            {
                return Some((start, end, term));
            }
        }
    }
    None
}

fn job_has_glossary_match(
    job: &TranslationJob,
    glossary: &GeminiLiveGlossarySettings,
    source_language: &str,
    target_language: &str,
) -> bool {
    glossary.enabled
        && next_glossary_match(
            &job.original,
            0,
            &glossary_terms(glossary, source_language, target_language),
        )
        .is_some()
}

fn prepare_glossary_job(
    job: TranslationJob,
    terms: &[GlossaryTerm],
    nonce: &str,
    raw_texts: &[String],
) -> PreparedGlossaryJob {
    let source_text = job.original.replace('\n', " ").replace('\r', " ");
    let mut prompt_text = String::with_capacity(source_text.len());
    let mut markers = Vec::new();
    let mut cursor = 0;
    let mut marker_index = 0usize;
    while let Some((start, end, term)) = next_glossary_match(&source_text, cursor, terms) {
        prompt_text.push_str(&source_text[cursor..start]);
        let token = format!("[[MMG_{nonce}_{}_{}]]", job.id, marker_index);
        marker_index += 1;
        // The nonce is random, but retain the collision check as a hard guard
        // so user speech can never be mistaken for a generated placeholder.
        if raw_texts.iter().any(|text| text.contains(&token)) {
            prompt_text.push_str(&source_text[start..end]);
        } else {
            prompt_text.push_str(&token);
            markers.push(GlossaryMarker {
                token,
                target: term.target.clone(),
            });
        }
        cursor = end;
    }
    prompt_text.push_str(&source_text[cursor..]);
    PreparedGlossaryJob {
        job,
        prompt_text,
        markers,
    }
}

fn parse_glossary_id_header(line: &str) -> Option<(u64, String)> {
    let rest = line.trim().strip_prefix("[ID:")?;
    let close = rest.find(']')?;
    let id = rest[..close].trim().parse::<u64>().ok()?;
    Some((id, rest[close + 1..].trim().to_string()))
}

fn parse_glossary_translations(
    text: &str,
) -> (HashMap<u64, String>, HashSet<u64>, HashSet<u64>) {
    let mut translations = HashMap::new();
    let mut duplicate_ids = HashSet::new();
    let mut malformed_ids = HashSet::new();
    let mut current_id = None;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("```") {
            continue;
        }
        if let Some((id, content)) = parse_glossary_id_header(line) {
            current_id = Some(id);
            if translations.contains_key(&id) {
                duplicate_ids.insert(id);
            } else {
                translations.insert(id, content);
            }
        } else if line.starts_with("[ID:") {
            if let Some(id) = current_id {
                malformed_ids.insert(id);
            }
        } else if let Some(id) = current_id {
            if let Some(content) = translations.get_mut(&id) {
                if !content.is_empty() {
                    content.push(' ');
                }
                content.push_str(line);
            }
        }
    }
    (translations, duplicate_ids, malformed_ids)
}

fn glossary_cache_key(target_language: &str, text: &str, cache_namespace: &str) -> String {
    if cache_namespace.is_empty() {
        format!("{}:{}", target_language, text)
    } else {
        format!("{}:{}:{}", target_language, cache_namespace, text)
    }
}

async fn translate_job(
    http_client: reqwest::Client,
    api_key: String,
    target_lang: String,
    job: TranslationJob,
    models_ref: std::sync::Arc<tokio::sync::RwLock<Vec<String>>>,
    cooldowns_ref: std::sync::Arc<
        tokio::sync::Mutex<HashMap<String, (std::time::Instant, ModelCooldownKind)>>,
    >,
    cache_ref: std::sync::Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    cache_namespace: String,
) -> GeminiEvent {
    let is_no_translate = target_lang == "none" || target_lang == "off" || target_lang.is_empty();

    let translation = if is_no_translate {
        String::new()
    } else {
        let trimmed_text = job.original.trim().to_string();

        // 1. Check in-memory phrase cache
        let cache_key = glossary_cache_key(&target_lang, &trimmed_text, &cache_namespace);
        let cached = {
            let cache = cache_ref.lock().await;
            cache.get(&cache_key).cloned()
        };

        if let Some(t) = cached {
            t
        } else {
            let mut result = None;
            let mut last_error = None;
            let models = models_ref.read().await.clone();
            for attempt in 0..TRANSLATION_MAX_ATTEMPTS {
                if attempt > 0 {
                    let delay_ms = 1500u64 * attempt as u64;
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                }
                match translate_text_rest(
                    &http_client,
                    &api_key,
                    &trimmed_text,
                    &target_lang,
                    &models,
                    &cooldowns_ref,
                )
                .await
                {
                    Ok(value) => result = value,
                    Err(error) => {
                        let stop_retrying = is_non_retryable_translation_error(&error);
                        last_error = Some(error);
                        result = None;
                        if stop_retrying {
                            break;
                        }
                    }
                }
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
                        message: last_error.unwrap_or_else(|| {
                            format!(
                                "Translation failed after {} attempts",
                                TRANSLATION_MAX_ATTEMPTS
                            )
                        }),
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

fn glossary_marker_tokens(text: &str) -> (Vec<String>, bool) {
    let mut tokens = Vec::new();
    let mut remaining = text;
    let mut malformed = false;
    while let Some(start) = remaining.find("[[MMG_") {
        let after_start = &remaining[start..];
        let Some(end) = after_start.find("]]") else {
            malformed = true;
            break;
        };
        tokens.push(after_start[..end + 2].to_string());
        remaining = &after_start[end + 2..];
    }
    (tokens, malformed)
}

async fn translate_glossary_jobs(
    http_client: reqwest::Client,
    api_key: String,
    target_language: String,
    jobs: Vec<TranslationJob>,
    glossary: GeminiLiveGlossarySettings,
    source_language: String,
    models_ref: std::sync::Arc<tokio::sync::RwLock<Vec<String>>>,
    cooldowns_ref: std::sync::Arc<
        tokio::sync::Mutex<HashMap<String, (std::time::Instant, ModelCooldownKind)>>,
    >,
    cache_ref: std::sync::Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    cache_namespace: String,
) -> Vec<GeminiEvent> {
    let is_no_translate = target_language == "none"
        || target_language == "off"
        || target_language.is_empty();
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

    let mut results = HashMap::new();
    let mut uncached_jobs = Vec::new();
    let all_jobs = jobs.clone();
    {
        let cache = cache_ref.lock().await;
        for job in jobs.iter().cloned() {
            let cache_key = glossary_cache_key(
                &target_language,
                job.original.trim(),
                &cache_namespace,
            );
            if let Some(cached) = cache.get(&cache_key) {
                results.insert(job.id, cached.clone());
            } else {
                uncached_jobs.push(job);
            }
        }
    }

    if uncached_jobs.is_empty() {
        return jobs_from_results_with_jobs(all_jobs, results, HashMap::new());
    }

    let terms = glossary_terms(&glossary, &source_language, &target_language);
    let raw_texts = uncached_jobs
        .iter()
        .map(|job| job.original.clone())
        .collect::<Vec<_>>();
    let mut nonce = uuid::Uuid::new_v4().simple().to_string();
    while raw_texts.iter().any(|text| text.contains(&format!("MMG_{nonce}_"))) {
        nonce = uuid::Uuid::new_v4().simple().to_string();
    }
    let prepared = uncached_jobs
        .into_iter()
        .map(|job| prepare_glossary_job(job, &terms, &nonce, &raw_texts))
        .collect::<Vec<_>>();

    let mut prompt_items = String::new();
    for item in &prepared {
        prompt_items.push_str(&format!("[ID:{}] {}\n", item.job.id, item.prompt_text));
    }
    let target_name = map_lang_name(&target_language);
    let prompt = format!(
        "Translate the following speech items naturally into {target_name}. Each item has a stable ID. Return exactly one line per item in the form [ID:<same ID>] <translation>. IDs may be returned in any order. Keep every token beginning [[MMG_ and ending ]] exactly unchanged, once, in the translation for its own item. Do not translate, remove, move, duplicate, or invent these tokens. Do not apply glossary names unless the corresponding token is present. Output no explanations.\n{}",
        prompt_items.trim()
    );
    let models = models_ref.read().await.clone();
    let mut response_text = None;
    let mut batch_error: Option<String> = None;
    for attempt in 0..TRANSLATION_MAX_ATTEMPTS {
        if attempt > 0 {
            let delay_ms = 2000u64 * attempt as u64;
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
        }
        match translate_raw_prompt(&http_client, &api_key, &prompt, &models, &cooldowns_ref).await {
            Ok(Some(value)) if !value.trim().is_empty() => {
                response_text = Some(value);
                break;
            }
            Ok(_) => {}
            Err(error) => {
                let stop_retrying = is_non_retryable_translation_error(&error);
                batch_error = Some(error);
                if stop_retrying {
                    break;
                }
            }
        }
    }

    let mut failures = HashMap::new();
    if let Some(error) = batch_error
        .as_deref()
        .filter(|message| is_non_retryable_translation_error(message))
    {
        for item in &prepared {
            failures.insert(item.job.id, error.to_string());
        }
    } else if let Some(response_text) = response_text {
        let (mut parsed, duplicate_ids, malformed_ids) =
            parse_glossary_translations(&response_text);
        let mut expected_tokens = HashMap::<String, u64>::new();
        for item in &prepared {
            for marker in &item.markers {
                expected_tokens.insert(marker.token.clone(), item.job.id);
            }
        }
        let (response_tokens, _) = glossary_marker_tokens(&response_text);
        let destination_terms = terms
            .iter()
            .map(|term| GlossaryTerm {
                source: term.target.clone(),
                target: String::new(),
            })
            .collect::<Vec<_>>();

        for item in &prepared {
            let id = item.job.id;
            let Some(mut translation) = parsed.remove(&id) else {
                failures.insert(id, "Gemini returned no translation for this segment.".into());
                continue;
            };
            let mut valid = !duplicate_ids.contains(&id) && !malformed_ids.contains(&id);
            if duplicate_ids.contains(&id) || malformed_ids.contains(&id) {
                failures.insert(id, "Gemini returned a malformed or duplicate segment ID.".into());
                continue;
            }

            let (segment_tokens, segment_malformed) = glossary_marker_tokens(&translation);
            valid &= !segment_malformed
                && segment_tokens
                    .iter()
                    .all(|token| expected_tokens.contains_key(token));
            if segment_tokens.iter().any(|token| {
                expected_tokens
                    .get(token)
                    .is_some_and(|owner_id| *owner_id != id)
            }) {
                valid = false;
            }
            // A target spelling emitted without a protected source match is
            // evidence that the model applied the glossary on its own.
            if next_glossary_match(&translation, 0, &destination_terms).is_some() {
                valid = false;
            }
            for marker in &item.markers {
                if response_tokens.iter().filter(|token| *token == &marker.token).count() != 1
                    || response_text.matches(&marker.token).count() != 1
                    || translation.matches(&marker.token).count() != 1
                {
                    valid = false;
                }
            }
            if !valid {
                failures.insert(id, "Gemini returned an invalid glossary translation format.".into());
                continue;
            }

            for marker in &item.markers {
                translation = translation.replace(&marker.token, &marker.target);
            }
            if translation.trim().is_empty() {
                failures.insert(id, "Gemini returned an empty translation.".into());
                continue;
            }
            if item.job.original.trim().len() < 120 {
                let cache_key = glossary_cache_key(
                    &target_language,
                    item.job.original.trim(),
                    &cache_namespace,
                );
                cache_ref.lock().await.insert(cache_key, translation.clone());
            }
            results.insert(id, translation);
        }

    } else {
        let message = batch_error.unwrap_or_else(|| "Gemini returned an empty translation.".into());
        for item in &prepared {
            failures.insert(item.job.id, message.clone());
        }
    }

    jobs_from_results_with_jobs(all_jobs, results, failures)
}

fn jobs_from_results_with_jobs(
    jobs: Vec<TranslationJob>,
    mut results: HashMap<u64, String>,
    mut failures: HashMap<u64, String>,
) -> Vec<GeminiEvent> {
    jobs.into_iter()
        .map(|job| match failures.remove(&job.id) {
            Some(message) => GeminiEvent::TranslationFailed { id: job.id, message },
            None => GeminiEvent::Segment {
                id: job.id,
                original: job.original,
                translation: results.remove(&job.id).unwrap_or_default(),
                speaker: job.speaker,
            },
        })
        .collect()
}

async fn finish_translation_worker(
    translation_tx: Option<mpsc::Sender<TranslationJob>>,
    translation_worker: Option<tokio::task::JoinHandle<()>>,
) {
    let (Some(translation_tx), Some(mut translation_worker)) = (translation_tx, translation_worker)
    else {
        return;
    };
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

async fn start_translation_worker(
    cfg: &GeminiRealtimeConfig,
    event_sink: GeminiEventSink,
    models_cache: Arc<tokio::sync::RwLock<Option<(std::time::Instant, Vec<String>)>>>,
    cooldowns: Arc<tokio::sync::Mutex<HashMap<String, (std::time::Instant, ModelCooldownKind)>>>,
    translation_cache: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
) -> (mpsc::Sender<TranslationJob>, tokio::task::JoinHandle<()>) {
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default();
    let available_models = Arc::new(tokio::sync::RwLock::new(
        get_or_fetch_models(&http_client, &cfg.api_key, &models_cache).await,
    ));
    let (translation_tx, mut translation_rx) = mpsc::channel::<TranslationJob>(64);
    let translation_api_key = cfg.api_key.clone();
    let translation_glossary = cfg.gemini_live_glossary.clone();
    let translation_source_language = cfg.source_language.clone();
    let cache_namespace = if cfg.live_translation_mode.eq_ignore_ascii_case("batch")
        && translation_glossary.enabled
    {
        serde_json::to_string(&translation_glossary).unwrap_or_default()
    } else {
        String::new()
    };

    let worker = tokio::spawn(async move {
        let mut paused_error: Option<String> = None;
        let mut queued_jobs = VecDeque::new();
        loop {
            let first_job = if let Some(job) = queued_jobs.pop_front() {
                job
            } else {
                match translation_rx.recv().await {
                    Some(job) => job,
                    None => break,
                }
            };
            if let Some(message) = paused_error.as_ref() {
                send_events(
                    &event_sink,
                    vec![GeminiEvent::TranslationFailed {
                        id: first_job.id,
                        message: message.clone(),
                    }],
                );
                continue;
            }

            let mut batch = vec![first_job];
            let target_language = batch[0].target_language.clone();
            let collect_until = tokio::time::Instant::now() + std::time::Duration::from_millis(800);
            while batch.len() < 6 {
                match tokio::time::timeout_at(collect_until, translation_rx.recv()).await {
                    Ok(Some(next_job)) if next_job.target_language == target_language => {
                        batch.push(next_job)
                    }
                    Ok(Some(next_job)) => {
                        queued_jobs.push_back(next_job);
                        break;
                    }
                    Ok(None) | Err(_) => break,
                }
            }

            let events = if batch.len() == 1 {
                let job = batch.remove(0);
                if job_has_glossary_match(
                    &job,
                    &translation_glossary,
                    &translation_source_language,
                    &target_language,
                ) {
                    translate_glossary_jobs(
                        http_client.clone(),
                        translation_api_key.clone(),
                        target_language,
                        vec![job],
                        translation_glossary.clone(),
                        translation_source_language.clone(),
                        available_models.clone(),
                        cooldowns.clone(),
                        translation_cache.clone(),
                        cache_namespace.clone(),
                    )
                    .await
                } else {
                    vec![translate_job(
                        http_client.clone(),
                        translation_api_key.clone(),
                        target_language,
                        job,
                        available_models.clone(),
                        cooldowns.clone(),
                        translation_cache.clone(),
                        cache_namespace.clone(),
                    )
                    .await]
                }
            } else {
                translate_batch_jobs(
                    http_client.clone(),
                    translation_api_key.clone(),
                    target_language,
                    batch,
                    translation_glossary.clone(),
                    translation_source_language.clone(),
                    available_models.clone(),
                    cooldowns.clone(),
                    translation_cache.clone(),
                    cache_namespace.clone(),
                )
                .await
            };

            paused_error = events.iter().find_map(|event| match event {
                GeminiEvent::TranslationFailed { message, .. }
                    if is_non_retryable_translation_error(message) =>
                {
                    Some(message.clone())
                }
                _ => None,
            });
            send_events(&event_sink, events);
            if paused_error.is_none() {
                tokio::time::sleep(TRANSLATION_PACE_DELAY).await;
            }
        }
    });

    (translation_tx, worker)
}

fn send_events(event_sink: &GeminiEventSink, events: Vec<GeminiEvent>) {
    for event in events {
        emit_event(event_sink, event);
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

fn gemini_glossary_vocabulary(cfg: &GeminiRealtimeConfig) -> Vec<String> {
    if !cfg.live_translation_mode.eq_ignore_ascii_case("batch")
        || !cfg.gemini_live_glossary.enabled
        || !cfg.glossary_transcription_hints_enabled
    {
        return Vec::new();
    }

    let source = cfg
        .source_language
        .trim()
        .to_lowercase()
        .split('-')
        .next()
        .unwrap_or_default()
        .to_string();
    let use_vietnamese = source == "vi" || source == "auto";
    let use_japanese = source == "ja" || source == "auto";
    let mut seen = HashSet::new();
    let mut vocabulary = Vec::new();
    for entry in &cfg.gemini_live_glossary.entries {
        for phrase in [
            use_vietnamese.then_some(entry.vi.trim()),
            use_japanese.then_some(entry.ja.trim()),
        ]
        .into_iter()
        .flatten()
        {
            if phrase.is_empty() || !seen.insert(phrase.to_lowercase()) {
                continue;
            }
            vocabulary.push(phrase.to_string());
            if vocabulary.len() >= 100 {
                return vocabulary;
            }
        }
    }
    vocabulary
}

fn parse_gemini_setup_response(text: &str) -> Option<Result<(), String>> {
    let value = serde_json::from_str::<serde_json::Value>(text).ok()?;
    if value.get("setupComplete").is_some() {
        return Some(Ok(()));
    }
    let error = value
        .get("error")
        .or_else(|| value.get("setupError"))?;
    if let Some(message) = error.as_str() {
        return Some(Err(format!("Gemini setup error: {}", message)));
    }
    let code = error
        .get("code")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_default();
    let message = error
        .get("message")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("Gemini rejected the Live setup");
    Some(Err(format!("Gemini setup error {}: {}", code, message)))
}

fn is_custom_vocabulary_rejection(error: &str) -> bool {
    let normalized = error.to_lowercase().replace('_', "");
    normalized.contains("customvocabulary") || normalized.contains("custom vocabulary")
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

fn normalized_model(cfg: &GeminiRealtimeConfig) -> String {
    let raw_model = cfg
        .model
        .as_deref()
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .unwrap_or(AUTO_GEMINI_MODEL);
    if raw_model.eq_ignore_ascii_case(AUTO_GEMINI_MODEL) {
        return DEFAULT_GEMINI_MODEL.to_string();
    }
    if raw_model.starts_with("models/") {
        raw_model.to_string()
    } else {
        format!("models/{}", raw_model)
    }
}

fn uses_live_translate(cfg: &GeminiRealtimeConfig) -> bool {
    let target = cfg.target_language.trim().to_lowercase();
    !cfg.live_translation_mode.eq_ignore_ascii_case("batch")
        && normalized_model(cfg) == LIVE_TRANSLATE_MODEL
        && !target.is_empty()
        && target != "none"
        && target != "off"
}

fn build_setup_message(cfg: &GeminiRealtimeConfig) -> String {
    let requested_model = normalized_model(cfg);

    if uses_live_translate(cfg) {
        return serde_json::json!({
            "setup": {
                "model": requested_model,
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "translationConfig": {
                        "targetLanguageCode": cfg.target_language.trim().to_lowercase(),
                        "echoTargetLanguage": true
                    }
                },
                "inputAudioTranscription": {},
                "outputAudioTranscription": {}
            }
        })
        .to_string();
    }

    // Live Translate requires a target language. Batch mode and "No
    // translation" use the dedicated transcription model instead.
    let model = if requested_model == LIVE_TRANSLATE_MODEL {
        FALLBACK_TRANSCRIBE_MODEL.to_string()
    } else {
        requested_model
    };
    let is_transcribe_live = model == FALLBACK_TRANSCRIBE_MODEL;

    let is_no_translate = cfg.target_language == "none"
        || cfg.target_language == "off"
        || cfg.target_language.is_empty();

    let src = cfg.source_language.trim().to_lowercase();
    let sys_instruction = if is_no_translate || is_transcribe_live {
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

    let sys_instruction = sys_instruction;
    let mut input_audio_transcription = serde_json::json!({});
    if let Some(bcp47) = map_bcp47(&src) {
        input_audio_transcription["languageCodes"] = serde_json::json!([bcp47]);
    }
    if is_transcribe_live {
        let vocabulary = gemini_glossary_vocabulary(cfg);
        if !vocabulary.is_empty() {
            input_audio_transcription["customVocabulary"] = serde_json::json!(vocabulary);
        }
    }

    let mut setup = serde_json::json!({
        "setup": {
            "model": model,
            "generationConfig": {
                "responseModalities": ["TEXT"]
            },
            "inputAudioTranscription": input_audio_transcription,
            "realtimeInputConfig": {
                "automaticActivityDetection": {
                    "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH",
                    "silenceDurationMs": 600
                }
            }
        }
    });

    // Live Transcribe is a dedicated ASR model and documents its text
    // transcription config without a conversational system instruction.
    if !is_transcribe_live {
        setup["setup"]["generationConfig"]["temperature"] = serde_json::json!(0.2);
        setup["setup"]["systemInstruction"] = serde_json::json!({
            "parts": [{ "text": sys_instruction }]
        });
    }

    setup.to_string()
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
        .filter(|c| {
            !c.is_whitespace() && !c.is_ascii_punctuation() && !"。！？、，.!?, \t\r\n".contains(*c)
        })
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
        "ます。",
        "ました。",
        "ません。",
        "ましょう。",
        "です。",
        "でした。",
        "ですね。",
        "ですよね。",
        "ですよ。",
        "でしょうか。",
        "ましたね。",
        "ましたよ。",
        "と思います。",
        "と考えています。",
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

fn parse_live_duration_ms(value: &str) -> Option<u64> {
    let value = value.trim();
    if let Some(number) = value.strip_suffix("ms") {
        return number.trim().parse::<u64>().ok();
    }
    if let Some(number) = value.strip_suffix('s') {
        let seconds = number.trim().parse::<f64>().ok()?;
        if seconds.is_finite() && seconds >= 0.0 {
            return Some((seconds * 1000.0).round() as u64);
        }
    }
    None
}

async fn handle_server_message(
    text: &str,
    event_sink: &GeminiEventSink,
    translation_tx: Option<&mpsc::Sender<TranslationJob>>,
    target_lang_ref: &Arc<tokio::sync::RwLock<String>>,
    live_assembler: Option<&mut LiveTranslateAssembler>,
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
        emit_event(
            event_sink,
            GeminiEvent::Status {
                state: "ready".into(),
                message: Some("Gemini Live connected".into()),
            },
        );
        return;
    }

    // 2. Check for server errors or warnings
    if let Some(error) = value.get("error") {
        let code = error.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
        let message = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown server error");
        eprintln!(
            "[gemini-live] Server error response: {} - {}",
            code, message
        );
        emit_event(
            event_sink,
            GeminiEvent::Error {
                code: format!("server_error_{}", code),
                message: message.to_string(),
            },
        );
        return;
    }

    if let Some(go_away) = value.get("goAway") {
        let time_remaining = go_away
            .get("timeLeft")
            .or_else(|| go_away.get("timeRemaining"))
            .and_then(|t| t.as_str())
            .unwrap_or("unknown");
        let reconnect_delay_ms = parse_live_duration_ms(time_remaining)
            .map(|millis| millis.saturating_sub(1500))
            .unwrap_or(2500);
        eprintln!(
            "[gemini-live] Server sent goAway (timeLeft: {}, reconnecting in {}ms)",
            time_remaining, reconnect_delay_ms
        );
        emit_event(
            event_sink,
            GeminiEvent::Reconnecting {
                delay_ms: reconnect_delay_ms,
            },
        );
    }

    // 3. Process serverContent
    if let Some(server_content) = value.get("serverContent") {
        if let Some(assembler) = live_assembler {
            if let Some(source) = server_content
                .get("inputTranscription")
                .and_then(|tx| tx.get("text"))
                .and_then(|text| text.as_str())
            {
                send_events(event_sink, assembler.ingest_source(source));
            }
            if let Some(target) = server_content
                .get("outputTranscription")
                .and_then(|tx| tx.get("text"))
                .and_then(|text| text.as_str())
            {
                send_events(event_sink, assembler.ingest_target(target));
            }
            if server_content
                .get("turnComplete")
                .and_then(|complete| complete.as_bool())
                .unwrap_or(false)
            {
                send_events(event_sink, assembler.flush());
            }
            return;
        }

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
                        let has_subsequent =
                            (i < sentences.len() - 1) || (provisional.chars().count() >= 8);
                        let sent_trimmed = sent.trim();
                        if has_subsequent && is_strong_sentence_end(sent_trimmed) {
                            if is_recent_duplicate(sent_trimmed, turn_committed, recent_committed) {
                                continue;
                            }

                            let translation_id = *next_translation_id;
                            *next_translation_id = (*next_translation_id).saturating_add(1);
                            eprintln!(
                                "[gemini-live] Stream commit sentence id={}",
                                translation_id
                            );

                            emit_event(
                                event_sink,
                                GeminiEvent::SourceTranscript {
                                    id: translation_id,
                                    text: sent_trimmed.to_string(),
                                    is_final: true,
                                    speaker: speaker.clone(),
                                },
                            );

                            if let Some(translation_tx) = translation_tx {
                                let _ = translation_tx
                                    .send(TranslationJob {
                                        id: translation_id,
                                        original: sent_trimmed.to_string(),
                                        speaker: speaker.clone(),
                                        target_language: target_lang_ref.read().await.clone(),
                                    })
                                    .await;
                            }

                            turn_committed.insert(clean_all(sent_trimmed));
                            recent_committed
                                .push_back((sent_trimmed.to_string(), std::time::Instant::now()));
                            if recent_committed.len() > 64 {
                                recent_committed.pop_front();
                            }
                        }
                    }

                    // Send live provisional preview for remaining unfinalized words
                    emit_event(
                        event_sink,
                        GeminiEvent::Transcript {
                            text: provisional,
                            is_final: false,
                        },
                    );
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
                    emit_event(
                        event_sink,
                        GeminiEvent::Transcript {
                            text: String::new(),
                            is_final: false,
                        },
                    );

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
                            eprintln!("[gemini-live] Skipped a duplicate final sentence");
                            continue;
                        }

                        let translation_id = *next_translation_id;
                        *next_translation_id = (*next_translation_id).saturating_add(1);
                        eprintln!(
                            "[gemini-live] Final speech sentence id={}",
                            translation_id
                        );

                        emit_event(
                            event_sink,
                            GeminiEvent::SourceTranscript {
                                id: translation_id,
                                text: sent_trimmed.to_string(),
                                is_final: true,
                                speaker: speaker.clone(),
                            },
                        );

                        if let Some(translation_tx) = translation_tx {
                            let _ = translation_tx
                                .send(TranslationJob {
                                    id: translation_id,
                                    original: sent_trimmed.to_string(),
                                    speaker: speaker.clone(),
                                    target_language: target_lang_ref.read().await.clone(),
                                })
                                .await;
                        }

                        turn_committed.insert(clean_all(sent_trimmed));
                        recent_committed
                            .push_back((sent_trimmed.to_string(), std::time::Instant::now()));
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
    cooldowns_ref: &Arc<
        tokio::sync::Mutex<HashMap<String, (std::time::Instant, ModelCooldownKind)>>,
    >,
) -> Result<Option<String>, String> {
    let now = std::time::Instant::now();
    let mut soonest_wait: Option<std::time::Duration> = None;
    let mut soonest_cooldown_kind: Option<ModelCooldownKind> = None;
    let mut last_error: Option<String> = None;

    for model in models {
        // Check if model is cooling down
        {
            let cooldowns = cooldowns_ref.lock().await;
            if let Some((until, cooldown_kind)) = cooldowns.get(model) {
                if now < *until {
                    let wait = *until - now;
                    let is_soonest = soonest_wait.map(|prev| wait < prev).unwrap_or(true);
                    soonest_wait = match soonest_wait {
                        Some(prev) => Some(prev.min(wait)),
                        None => Some(wait),
                    };
                    if is_soonest {
                        soonest_cooldown_kind = Some(*cooldown_kind);
                    }
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
                    match resp.text().await {
                        Ok(text_resp) => {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text_resp)
                            {
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
                                        return Ok(Some(translated));
                                    }
                                }
                                last_error = Some(format!(
                                    "Gemini API HTTP {} returned empty translation",
                                    status
                                ));
                            } else {
                                last_error = Some(format!(
                                    "Gemini API HTTP {} returned invalid JSON",
                                    status
                                ));
                            }
                        }
                        Err(e) => {
                            last_error = Some(format!(
                                "Gemini API HTTP {} response read failed: {}",
                                status, e
                            ));
                        }
                    }
                } else {
                    let err_body = resp.text().await.unwrap_or_default();
                    let err_json = serde_json::from_str::<serde_json::Value>(&err_body).ok();
                    let api_message = err_json
                        .as_ref()
                        .and_then(|json| json.get("error"))
                        .and_then(|error| error.get("message"))
                        .and_then(|message| message.as_str())
                        .unwrap_or("")
                        .trim();
                    let detail = if api_message.is_empty() {
                        format!("HTTP {}", status)
                    } else {
                        format!("HTTP {}: {}", status, api_message)
                    };
                    let is_quota_error = status.as_u16() == 429 || is_quota_error_text(api_message);
                    let is_auth_error =
                        matches!(status.as_u16(), 401 | 403) || is_auth_error_text(api_message);
                    last_error = Some(format!("Gemini API {}", detail));

                    // Extract retryDelay or default to 20s for transient errors.
                    let delay_secs = err_json
                        .as_ref()
                        .and_then(|json| json.get("error"))
                        .and_then(|error| error.get("details"))
                        .and_then(|details| details.as_array())
                        .and_then(|items| {
                            items.iter().find_map(|item| {
                                if item.get("@type").and_then(|t| t.as_str())
                                    == Some("type.googleapis.com/google.rpc.RetryInfo")
                                {
                                    item.get("retryDelay")
                                        .and_then(|retry| retry.as_str())
                                        .and_then(|value| {
                                            value.trim_end_matches('s').parse::<u64>().ok()
                                        })
                                } else {
                                    None
                                }
                            })
                        })
                        .unwrap_or(20);

                    if status.as_u16() == 429 || status.as_u16() == 503 {
                        eprintln!(
                            "[gemini-live] Model {} hit HTTP {}, placing in cooldown for {}s",
                            model, status, delay_secs
                        );
                        let mut cooldowns = cooldowns_ref.lock().await;
                        cooldowns.insert(
                            model.clone(),
                            (
                                std::time::Instant::now()
                                    + std::time::Duration::from_secs(delay_secs),
                                if is_quota_error {
                                    ModelCooldownKind::Quota
                                } else {
                                    ModelCooldownKind::Server
                                },
                            ),
                        );
                    } else {
                        eprintln!("[gemini-live] Model {} returned HTTP {}", model, status);
                    }

                    // Quota and credential failures are provider-wide. Trying
                    // every model or retrying the same request only creates a
                    // long silent gap and can make the rate-limit worse.
                    if is_quota_error || is_auth_error {
                        return Err(last_error.unwrap_or_else(|| format!("Gemini API {}", detail)));
                    }
                }
            }
            Err(e) => {
                eprintln!(
                    "[gemini-live] HTTP request error for model {}: {}",
                    model, e
                );
                last_error = Some(format!("Gemini HTTP request failed: {}", e));
            }
        }
    }

    // If all models were in cooldown, return immediately. Sleeping here blocks
    // the translation worker and causes every queued utterance to inherit the
    // provider outage. The caller can surface the category and let the user
    // retry explicitly.
    if let Some(wait) = soonest_wait {
        let seconds = wait
            .as_secs()
            .saturating_add(if wait.subsec_nanos() > 0 { 1 } else { 0 });
        let label = match soonest_cooldown_kind {
            Some(ModelCooldownKind::Quota) => "rate limit",
            Some(ModelCooldownKind::Server) => "server",
            None => "provider",
        };
        return Err(format!(
            "Gemini API {} cooldown active; retry after {}s",
            label, seconds
        ));
    }

    if let Some(error) = last_error {
        Err(error)
    } else {
        Ok(None)
    }
}

fn is_quota_error_text(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("429")
        || lower.contains("quota")
        || lower.contains("resource exhausted")
        || lower.contains("rate limit")
        || lower.contains("too many requests")
        || lower.contains("daily limit")
        || lower.contains("per-minute limit")
}

fn is_auth_error_text(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("api key")
        || lower.contains("api_key")
        || lower.contains("invalid key")
        || lower.contains("key not valid")
        || lower.contains("permission denied")
        || lower.contains("unauthenticated")
        || lower.contains("forbidden")
}

fn is_non_retryable_translation_error(message: &str) -> bool {
    is_quota_error_text(message)
        || is_auth_error_text(message)
        || message.to_lowercase().contains("cooldown active")
}

async fn translate_text_rest(
    client: &reqwest::Client,
    api_key: &str,
    text: &str,
    target_lang: &str,
    models: &[String],
    cooldowns_ref: &Arc<
        tokio::sync::Mutex<HashMap<String, (std::time::Instant, ModelCooldownKind)>>,
    >,
) -> Result<Option<String>, String> {
    let target_name = map_lang_name(target_lang);
    let prompt = format!(
        "Translate the following speech accurately and naturally into {target_name}. Output ONLY the translated text in {target_name} without repeating the source language, and without notes or quotes:\n{}",
        text.trim()
    );
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
        return items
            .into_iter()
            .map(|(_, t)| t.trim().to_string())
            .collect();
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
    target_lang: String,
    jobs: Vec<TranslationJob>,
    glossary: GeminiLiveGlossarySettings,
    source_language: String,
    models_ref: std::sync::Arc<tokio::sync::RwLock<Vec<String>>>,
    cooldowns_ref: std::sync::Arc<
        tokio::sync::Mutex<HashMap<String, (std::time::Instant, ModelCooldownKind)>>,
    >,
    cache_ref: std::sync::Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    cache_namespace: String,
) -> Vec<GeminiEvent> {
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

    if jobs.iter().any(|job| {
        job_has_glossary_match(job, &glossary, &source_language, &target_lang)
    }) {
        return translate_glossary_jobs(
            http_client,
            api_key,
            target_lang,
            jobs,
            glossary,
            source_language,
            models_ref,
            cooldowns_ref,
            cache_ref,
            cache_namespace,
        )
        .await;
    }

    let mut results: HashMap<u64, String> = HashMap::new();
    let mut failures: HashMap<u64, String> = HashMap::new();
    let mut uncached_indices: Vec<usize> = Vec::new();

    // Check cache for each job
    {
        let cache = cache_ref.lock().await;
        for (idx, job) in jobs.iter().enumerate() {
            let cache_key = glossary_cache_key(
                &target_lang,
                job.original.trim(),
                &cache_namespace,
            );
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
            target_lang.clone(),
            job,
            models_ref,
            cooldowns_ref,
            cache_ref,
            cache_namespace.clone(),
        )
        .await;
        match event {
            GeminiEvent::Segment {
                id, translation, ..
            } => {
                results.insert(id, translation);
            }
            GeminiEvent::TranslationFailed { id, message } => {
                failures.insert(id, message);
            }
            _ => {}
        }
        return jobs
            .into_iter()
            .map(|j| match failures.remove(&j.id) {
                Some(message) => GeminiEvent::TranslationFailed { id: j.id, message },
                None => {
                    let trans = results.remove(&j.id).unwrap_or_default();
                    GeminiEvent::Segment {
                        id: j.id,
                        original: j.original,
                        translation: trans,
                        speaker: j.speaker,
                    }
                }
            })
            .collect();
    }

    let mut prompt_items = String::new();
    for (seq, &idx) in uncached_indices.iter().enumerate() {
        prompt_items.push_str(&format!("[{}] {}\n", seq + 1, jobs[idx].original.trim()));
    }

    let target_name = map_lang_name(&target_lang);
    let prompt = format!(
        "Translate the following numbered speech items accurately and naturally into {target_name}. Output ONLY the numbered translations in order, without notes, quotes, or repeating source text:\n{}",
        prompt_items.trim()
    );
    let models = models_ref.read().await.clone();
    let mut batch_text_opt = None;
    let mut batch_error: Option<String> = None;

    for attempt in 0..TRANSLATION_MAX_ATTEMPTS {
        if attempt > 0 {
            let delay_ms = 2000u64 * (attempt as u64);
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
        }
        batch_text_opt =
            match translate_raw_prompt(&http_client, &api_key, &prompt, &models, &cooldowns_ref)
                .await
            {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("[gemini-live] Batch translation attempt failed: {}", error);
                    let stop_retrying = is_non_retryable_translation_error(&error);
                    batch_error = Some(error);
                    if stop_retrying {
                        break;
                    }
                    None
                }
            };
        if batch_text_opt
            .as_ref()
            .is_some_and(|t| !t.trim().is_empty())
        {
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
                    let cache_key = glossary_cache_key(&target_lang, trimmed, &cache_namespace);
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
            if let Some(error) = batch_error
                .as_deref()
                .filter(|message| is_non_retryable_translation_error(message))
            {
                failures.insert(job.id, error.to_string());
                continue;
            }
            let event = translate_job(
                http_client.clone(),
                api_key.clone(),
                target_lang.clone(),
                job,
                models_ref.clone(),
                cooldowns_ref.clone(),
                cache_ref.clone(),
                cache_namespace.clone(),
            )
            .await;
            match event {
                GeminiEvent::Segment {
                    id, translation, ..
                } => {
                    results.insert(id, translation);
                }
                GeminiEvent::TranslationFailed { id, message } => {
                    failures.insert(id, message);
                }
                _ => {}
            }
        }
    }

    jobs.into_iter()
        .map(|job| match failures.remove(&job.id) {
            Some(message) => GeminiEvent::TranslationFailed {
                id: job.id,
                message,
            },
            None => {
                let trans = results.remove(&job.id).unwrap_or_default();
                GeminiEvent::Segment {
                    id: job.id,
                    original: job.original,
                    translation: trans,
                    speaker: job.speaker,
                }
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
    fn test_parse_live_duration_ms() {
        assert_eq!(parse_live_duration_ms("30s"), Some(30_000));
        assert_eq!(parse_live_duration_ms("1.5s"), Some(1_500));
        assert_eq!(parse_live_duration_ms("250ms"), Some(250));
        assert_eq!(parse_live_duration_ms("unknown"), None);
    }

    #[test]
    fn test_build_setup_message_language_codes() {
        let cfg = GeminiRealtimeConfig {
            api_key: "test_key".into(),
            source_language: "vi".into(),
            target_language: "none".into(),
            model: None,
            live_translation_mode: default_live_translation_mode(),
            gemini_live_glossary: GeminiLiveGlossarySettings::default(),
            glossary_transcription_hints_enabled: default_glossary_transcription_hints_enabled(),
            diarization: false,
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
    fn test_build_live_translate_setup_uses_single_stream_translation() {
        let cfg = GeminiRealtimeConfig {
            api_key: "test_key".into(),
            source_language: "ja".into(),
            target_language: "vi".into(),
            model: Some(LIVE_TRANSLATE_MODEL.into()),
            live_translation_mode: default_live_translation_mode(),
            gemini_live_glossary: GeminiLiveGlossarySettings::default(),
            glossary_transcription_hints_enabled: default_glossary_transcription_hints_enabled(),
            diarization: false,
        };
        let parsed: serde_json::Value = serde_json::from_str(&build_setup_message(&cfg)).unwrap();

        assert_eq!(parsed["setup"]["model"], LIVE_TRANSLATE_MODEL);
        assert_eq!(
            parsed["setup"]["generationConfig"]["responseModalities"][0],
            "AUDIO"
        );
        assert_eq!(
            parsed["setup"]["generationConfig"]["translationConfig"]["targetLanguageCode"],
            "vi"
        );
        assert_eq!(
            parsed["setup"]["generationConfig"]["translationConfig"]["echoTargetLanguage"],
            true
        );
        assert!(parsed["setup"].get("inputAudioTranscription").is_some());
        assert!(parsed["setup"].get("outputAudioTranscription").is_some());
        assert!(parsed["setup"].get("systemInstruction").is_none());
    }

    #[test]
    fn test_auto_model_resolves_to_live_translate() {
        let cfg = GeminiRealtimeConfig {
            api_key: "test_key".into(),
            source_language: "ja".into(),
            target_language: "vi".into(),
            model: Some(AUTO_GEMINI_MODEL.into()),
            live_translation_mode: default_live_translation_mode(),
            gemini_live_glossary: GeminiLiveGlossarySettings::default(),
            glossary_transcription_hints_enabled: default_glossary_transcription_hints_enabled(),
            diarization: false,
        };

        assert_eq!(normalized_model(&cfg), LIVE_TRANSLATE_MODEL);
        assert!(uses_live_translate(&cfg));
        let parsed: serde_json::Value = serde_json::from_str(&build_setup_message(&cfg)).unwrap();
        assert_eq!(parsed["setup"]["model"], LIVE_TRANSLATE_MODEL);
    }

    #[test]
    fn test_live_translate_assembler_pairs_streamed_fragments() {
        let mut assembler = LiveTranslateAssembler::new();
        let source_fragments = [
            "こんにちは。今日は",
            "新しい",
            "翻訳機能を",
            "テストしています。",
            "会議の",
            "内容をベトナム",
            "語に翻訳",
        ];
        let target_fragments = [
            "Xin chào. Hôm",
            " nay chúng ta sẽ",
            " thử nghiệm tính năng",
            " dịch mới.",
            " Nội dung cuộc",
            " họp sẽ được dịch",
            " sang tiếng Việt.",
        ];

        let mut events = Vec::new();
        for index in 0..source_fragments.len() {
            events.extend(assembler.ingest_source(source_fragments[index]));
            events.extend(assembler.ingest_target(target_fragments[index]));
        }
        events.extend(assembler.flush());

        let pairs: Vec<(String, String)> = events
            .into_iter()
            .filter_map(|event| match event {
                GeminiEvent::Segment {
                    original,
                    translation,
                    ..
                } => Some((original, translation)),
                _ => None,
            })
            .collect();

        assert_eq!(pairs.len(), 3);
        assert_eq!(pairs[0], ("こんにちは。".into(), "Xin chào.".into()));
        assert_eq!(
            pairs[1],
            (
                "今日は新しい翻訳機能をテストしています。".into(),
                "Hôm nay chúng ta sẽ thử nghiệm tính năng dịch mới.".into()
            )
        );
        assert_eq!(
            pairs[2],
            (
                "会議の内容をベトナム語に翻訳".into(),
                "Nội dung cuộc họp sẽ được dịch sang tiếng Việt.".into()
            )
        );
    }

    #[test]
    fn test_recorded_live_collector_merges_source_and_translation_events() {
        let mut collector = RecordedLiveCollector::default();
        collector.add_source(2, "こんにちは。".into(), None, 2_000);
        collector.add_pair(
            2,
            "こんにちは。".into(),
            "Xin chào.".into(),
            None,
            2_000,
            true,
        );
        collector.add_source(1, "おはようございます。".into(), None, 1_000);

        let segments = collector.finish();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].original, "おはようございます。");
        assert_eq!(segments[1].original, "こんにちは。");
        assert_eq!(segments[1].translation, "Xin chào.");
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
        assert!(is_strong_sentence_end(
            "昔のRNNとかよくやってたことなんですが、時間方向にぐるぐる回すんですね。"
        ));
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
        assert!(is_recent_duplicate(
            "まさかの緊急収録ですね。",
            &turn_committed,
            &recent
        ));

        // Turn committed match
        turn_committed.insert(clean_all("はい。"));
        assert!(is_recent_duplicate("はい。", &turn_committed, &recent));

        // Different sentence
        assert!(!is_recent_duplicate(
            "いや、本当にこれ緊急です。",
            &turn_committed,
            &recent
        ));
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
