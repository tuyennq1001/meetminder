# Speech Translation Pipeline Architecture — Current State

## 1. Audio Capture Flow

### Microphone Capture (Rust backend)
- **File**: `src-tauri/src/audio/microphone.rs:1-279`
- **Input**: Default audio device via cpal, detects F32 or I16 format
- **Processing**: 
  - Line 106–152: Build input stream from device, auto-detect sample rate (prefers 48kHz, fallback to max available)
  - Line 182–213: `convert_f32_to_pcm_s16le()` — mono mixdown + linear resampling + s16le encoding
  - Line 215–250: `convert_i16_to_pcm_s16le()` — same for i16 input
  - Line 254–278: `simple_resample()` — linear interpolation (adequate for speech)
- **Output**: PCM s16le 16kHz mono via mpsc channel
- **Enum**: TARGET_SAMPLE_RATE=16000, TARGET_CHANNELS=1 (mod.rs:16–18)

### System Audio Capture (macOS)
- **File**: `src-tauri/src/audio/system_audio.rs:1–152`
- **Input**: ScreenCaptureKit (macOS 13+), captures system audio output
- **Processing**:
  - Line 15–62: `AudioHandler::did_output_sample_buffer()` — CMSampleBuffer → f32 samples
  - Line 39–46: Downsample 48kHz → 16kHz (step_by ratio=3)
  - Line 49–57: f32 → PCM s16le
- **Output**: PCM s16le 16kHz mono
- **Note**: Excludes app's own audio (line 114: `excludes_current_process_audio`)

### Audio Batching & Forwarding (Rust → JS)
- **File**: `src-tauri/src/commands/audio.rs:33–129`
- **Entry**: Tauri command `start_capture(source, channel)` (line 35)
- **Sources**: `"system"` | `"microphone"` | `"both"` (merged via channels, line 52–76)
- **Batch strategy**: Line 86–120 — buffer + 200ms flush interval
  - 32KB buffer capacity (line 86)
  - Recv timeout 10ms, flush at 200ms boundary or channel close
- **IPC**: Tauri IPC channel receives Vec<u8> batches

### Frontend Consumption (JS)
- **File**: `src/js/app.js:1033–1051` (_startSonioxMode)
- **Channel setup**: Line 1036 — `new window.__TAURI__.core.Channel()`
- **Message handler**: Line 1037 — `channel.onmessage = (pcmData) => { ... }`
- **Forward**: Line 1043–1044 — `sonioxClient.sendAudio(new Uint8Array(pcmData).buffer)`

---

## 2. Soniox Provider Implementation

### WebSocket Client
- **File**: `src/js/soniox.js:1–525`
- **Endpoint**: `wss://stt-rt.soniox.com/transcribe-websocket` (line 16)
- **Connection**: Line 55–70 — `connect(config)` accepts apiKey, sourceLanguage, targetLanguage, customContext, translationType, etc.

### Session & Reconnect
- **Reconnect**: Line 19–20 — MAX_RECONNECT=3, delay 2s (exponential via line 504)
- **Make-before-break**: Line 142–155 — open new WS, close old after switch
- **Session reset**: Line 348–352 — every 3min (SESSION_DURATION_MS=180000), resets via `_seamlessReset()`
- **Context carryover**: Line 451–466 — rolling 500-char history of translations

### Config Message
- **File**: `soniox.js:94–140`
- **Format**: JSON dict with api_key, model, audio_format (pcm_s16le), sample_rate (16000), num_channels (1)
- **Language**: Line 108–110 — language_hints array; line 112–131 — translation object (one_way or two_way)
- **Context**: Line 133–137 — calls `_buildContext()` (line 405–449)

### Response Handling
- **File**: `soniox.js:268–344` (_handleResponse)
- **Message**: Receives tokens with `translation_status` (original | translation | none)
- **Callbacks**:
  - Line 328–329: `onOriginal(text, speaker, language)` — finalized original
  - Line 333–335: `onTranslation(text)` — finalized translation + store for context
  - Line 338–343: `onProvisional(text, speaker, language)` — intermediate text
- **Confidence**: Line 296–298, 322–324 — average confidence per batch

### Error Handling
- **File**: `soniox.js:470–516`
- **Codes**:
  - 4001/4003: Invalid API key → error status
  - 4029: Rate limit → error status
  - 4002: Subscription issue → error status
  - 1006 (abnormal close): Retry up to 3 times with exponential backoff (line 504)

### Keepalive
- **File**: `soniox.js:380–394`
- **Interval**: 15s (KEEPALIVE_INTERVAL_MS=15000)
- **Message**: JSON `{type: "keepalive"}` to prevent timeout during silence

---

## 3. Provider Abstraction & Current Hardcoding

### Current State: NO ABSTRACTION
- Soniox is **hardcoded** directly in the pipeline.
- Two modes exist but are **separate implementations**:
  - **Soniox mode**: Lines 1016–1058 (`_startSonioxMode`) → direct WebSocket to Soniox
  - **Local mode**: Lines 1060–1164 (`_startLocalMode`) → Python sidecar process

### Settings Distinction
- **File**: `src-tauri/src/settings.rs:40–42`
  - `translation_mode: String` — "soniox" or "local"
- **File**: `src/js/app.js:959–1004` (start)
  - Branches on `this.translationMode` (line 1001–1004)

### What Would Need Abstraction for New Provider

**Provider interface needed:**
1. **Initialization**: `connect(config)` with language, target, context
2. **Audio I/O**: `sendAudio(pcmBytes)` and receive callbacks
3. **Callbacks**: `onOriginal`, `onTranslation`, `onProvisional`, `onStatusChange`, `onError`, `onConfidence`
4. **Lifecycle**: `disconnect()`, error recovery, session management
5. **Settings**: API key storage, language hints, custom context format

**Current insertion points:**
- **Rust side**: New Tauri command `start_stt_provider(provider, config, channel)` with provider enum
- **JS side**: 
  - Import new provider module (e.g., `openai-realtime.js`)
  - Add case in `start()` method (line 1001)
  - Settings UI: select provider dropdown + provider-specific key input
  - Callbacks: wire new provider's callbacks to UI (line 388–416)

---

## 4. Settings & API Key Storage

### Rust Structure
- **File**: `src-tauri/src/settings.rs:21–95`
- **Fields**:
  - `soniox_api_key: String` (line 26)
  - `source_language: String` (line 28)
  - `target_language: String` (line 29)
  - `translation_mode: String` (line 42) — "soniox" | "local"
  - `custom_context: Option<CustomContext>` (line 44)
  - TTS keys: `elevenlabs_api_key`, `google_tts_api_key` (lines 46, 62)
- **Persistence**: Line 99–136 — JSON to `~/Library/Application Support/com.personal.translator/settings.json`

### JS Wrapper
- **File**: `src/js/settings.js` (small manager for localStorage caching)

### UI Form
- **File**: `src/js/app.js:533–687` (_populateSettingsForm, _saveSettingsFromForm)
- **API key input**: Line 536–540 (Soniox), line 607–627 (TTS)
- **Toggle visibility**: Line 271–274 (password/text toggle)

### New Provider Addition
- Add field to Settings struct (e.g., `openai_api_key: String`)
- Add settings form input in HTML
- Add provider selector dropdown (see TTS provider at line 630–633)

---

## 5. UI/State for Language Selection

### Language Dropdowns
- **File**: `src/js/app.js:537–549` (_populateSettingsForm)
- **Source language**: `select-source-lang` — "auto" | language codes
- **Target language**: `select-target-lang` — ISO 639-1 codes (vi, ja, en, etc.)

### Two-Way Mode
- **File**: `src/js/app.js:542–549`
- **Fields**: `select-translation-type` (one_way | two_way)
- **Two-way languages**: `select-lang-a` and `select-lang-b`
- **Soniox config**: Line 1021–1029 — passes `translationType`, `languageA`, `languageB`

### Soniox Integration
- **File**: `src/js/soniox.js:108–131`
- **One-way**: Translation object `{type: "one_way", target_language: "vi"}`
- **Two-way**: Translation object `{type: "two_way", language_a: "ja", language_b: "vi"}`
- **Language hints**: Array at line 109, strict mode at line 113–115

---

## 6. TTS Integration

### TTS Providers
- **Edge TTS (Rust proxy)**: `src/js/edge-tts.js:1–87` — calls Tauri command `edge_tts_speak`
- **ElevenLabs (WebSocket)**: `src/js/elevenlabs-tts.js` — direct wss:// to ElevenLabs
- **Google TTS (REST)**: `src/js/google-tts.js` — direct REST API

### Provider Selection
- **File**: `src/js/app.js:780–810` (_getActiveTTS, _configureTTS)
- **Settings field**: `tts_provider` (edge | elevenlabs | google)
- **Enable/disable**: `tts_enabled` flag (line 731, initially false)

### Audio Playback
- **File**: `src/js/audio-player.js`
- **TTS → player**: Line 65–68 (app.js) — all TTS providers call `audioPlayer.enqueue(base64Audio)`

### Trigger on Translation
- **File**: `src/js/app.js:393–395` (Soniox callback)
  - `sonioxClient.onTranslation = (text) => { this._speakIfEnabled(text); }`
- **File**: `src/js/app.js:902–906` (_speakIfEnabled)
  - Calls `this._getActiveTTS().speak(text)`

### Two-Way Mode Override
- **File**: `src/js/app.js:741–745` (_toggleTTS)
- **Blocks TTS in two-way mode** — prevents audio feedback loop

### **Key Note for gpt-realtime-translate**
- gpt-realtime-translate is **bidirectional** — TTS is part of the same stream
- Must **bypass** downstream TTS integration (audioPlayer, ElevenLabs, etc.)
- Instead: extract audio chunks directly from gpt-realtime stream and play natively

---

## 7. MLX Local Mode Pipeline

### Sidecar Process
- **File**: `src-tauri/src/commands/local_pipeline.rs:32–180`
- **Launch**: Line 98–117 — spawn Python subprocess with args
- **Script**: `scripts/local_pipeline.py` (Whisper + Gemma-3 translator)
- **Models**:
  - ASR: `mlx-community/whisper-large-v3-turbo` (line 102 in script)
  - LLM: `mlx-community/gemma-3-4b-it-qat-4bit` (line 122 in script)

### Audio I/O (Rust ↔ Python)
- **Stdin**: PCM s16le from Rust → Python (line 109)
- **Stdout**: JSON lines `{type, original, translated, language}` (line 138)
- **Stderr**: Log messages (line 150–167)

### Protocol (Python script)
- **File**: `scripts/local_pipeline.py:1–14` (docstring)
- **Stdin**: raw PCM s16le 16kHz mono (continuous)
- **Stdout**: JSON `{type: "result", original: "...", translated: "...", lang: "..."}`

### Chunk Processing
- **File**: `scripts/local_pipeline.py:298–353` (_process_chunk)
- **Chunk size**: Line 54 — 7s chunks, 5s stride (sliding window)
- **Silence detection**: Line 304–306 — RMS < 100 threshold
- **Transcription**: Whisper → `_transcribe()` (line 143–170)
- **Translation**: Gemma-3 → `_translate()` (line 184–238)
- **Dedup**: Line 320–324 — strip overlap with previous chunk (line 276–296)

### Context Carryover (Local)
- **File**: `scripts/local_pipeline.py:78–79, 191–196`
- **Buffer**: `context_history` (max 5 items, line 79)
- **Usage**: Line 194 — included in LLM prompt for topic continuity

### MLX Setup
- **File**: `src-tauri/src/commands/local_pipeline.rs:200+` (run_mlx_setup)
- **Venv path**: `~/Library/Application Support/My Translator/mlx-env/` (line 84)
- **Steps**: Check Python → create venv → pip install packages → download models
- **UI feedback**: Progress modal with step indicators (app.js:1207–1317)

---

## 8. Two-Way / One-Way Mode Logic

### Mode Selection
- **File**: `src/js/app.js:542–549` (_populateSettingsForm)
- **Setting**: `translation_type` (one_way | two_way)

### One-Way (Default)
- Single direction: source language → target language
- Soniox config: `{type: "one_way", target_language: "vi"}` (soniox.js:126–131)
- Language hints: User's selected source language only

### Two-Way
- Bidirectional: language A ↔ language B
- Soniox config: `{type: "two_way", language_a: "ja", language_b: "vi"}` (soniox.js:118–123)
- Language hints: Both languages (line 125)
- **Token filter**: `translation_status` field distinguishes original vs translation vs untranslated (third language)
  - "original" — from language A (or untranslated in two-way)
  - "translation" — translated to language B
  - "none" — third language in two-way mode (treated as original, line 312–318)

### TTS Restriction
- **File**: `src/js/app.js:741–745`
- Two-way blocks TTS toggle to prevent audio feedback loop

---

## 9. Session & Transcript Persistence

### Transcript Saving
- **File**: `src-tauri/src/commands/transcript.rs:22–32` (save_transcript)
- **Path**: `~/Library/Application Support/com.personal.translator/transcripts/`
- **Format**: Markdown `.md` file, timestamp-named: `YYYY-MM-DD_HH-MM-SS.md`
- **Trigger**: Line 1356 (app.js) — on stop() if content exists
- **Content**: Full session log with metadata (line 1394–1401)

### Session Metadata Capture
- **File**: `src/js/app.js:980–992` (start)
- **Fields**:
  - `sessionStartTime` — timestamp
  - `sessionSourceLang` — user's selected source lang
  - `sessionTargetLang` — selected target lang
  - `sessionMode` — "one_way" | "two_way"
- **Used in save**: Line 1390–1401 — metadata header in output file

### Transcript Listing
- **File**: `src-tauri/src/commands/transcript.rs:64–100` (list_transcripts)
- **UI view**: app.js — Sessions tab, shows list + viewer

### In-Memory Transcript (UI)
- **File**: `src/js/ui.js` (TranscriptUI class)
- **Dual buffer**:
  - `sessionLog` — full session content (persisted)
  - Display buffer — max N lines (configurable)
- **Auto-scroll** — shows latest entries

---

## 10. Summary: Key Insertion Points for New Provider

### Architecture Decisions
1. **Soniox is currently hardcoded** — no provider pattern yet
2. **Two separate pipelines** (cloud vs local) branched on `translation_mode` setting
3. **For gpt-realtime-translate:**
   - Hybrid provider (like Soniox + TTS bundled)
   - Bidirectional capability (like two-way mode)
   - Requires custom audio stream handling (WebSocket or EventSource)

### Required Additions (Minimal)

#### 1. Rust Backend (Tauri)
- **New command**: `start_openai_provider(config, channel)` 
  - Takes: API key, model, input audio channel, output callback channel
  - Or: wrap in generic `start_stt_provider(provider: String, config: serde_json::Value, channel)`
- **gpt-realtime stream handler**: Listen to WebSocket/EventSource, parse JSON events, forward audio chunks

#### 2. Frontend (JS)
- **New module**: `openai-realtime.js` or `gpt-realtime-translate.js`
  - Implement same callback interface: `onOriginal`, `onTranslation`, `onProvisional`, `onStatusChange`, `onError`
  - Handle bidirectional stream, parse audio/text events
  - **Important**: Decode audio directly (don't call audioPlayer if TTS built-in)

#### 3. Settings (Rust + JS)
- **Add field**: `openai_api_key: String` (settings.rs)
- **Add to form**: API key input, provider dropdown value "openai"
- **Wire in app.js start()**: Case for "openai" → new provider connect

#### 4. UI Changes (Minimal)
- **Provider dropdown**: Add "OpenAI gpt-realtime-translate" option
- **Language selectors**: Support GPT's language list (if different from Soniox)
- **Two-way mode**: Leverage existing logic (gpt-realtime supports bidirectional natively)
- **TTS toggle**: Disable for gpt-realtime (built-in TTS, or route to separate handler)

### Files to Modify/Create
| File | Purpose |
|------|---------|
| `src-tauri/src/settings.rs` | Add `openai_api_key` field |
| `src-tauri/src/commands/mod.rs` | Export new OpenAI command(s) |
| **NEW**: `src-tauri/src/commands/openai.rs` | OpenAI gpt-realtime handler |
| `src/js/app.js` | Add case in `start()` for "openai" mode |
| `src/js/settings.js` | Add openai_api_key to settings object |
| **NEW**: `src/js/openai-realtime.js` | WebSocket client + callbacks |
| `src/index.html` | Add OpenAI key input + provider selector |

### Expected Behavior Differences
- **gpt-realtime-translate** streams **both text and audio** in single connection
  - No separate TTS service needed
  - `onTranslation` callback receives live audio (not text-only like Soniox)
- **Bidirectional native** — don't need Soniox's two-way mode wrapper
- **Session reset** — may differ from Soniox's 3-min cutoff
- **Context carryover** — gpt-realtime may handle internally (verify docs)

---

## Appendix: File Reference Map

### Rust (Backend)
| File | Purpose | Key Lines |
|------|---------|-----------|
| `src-tauri/src/lib.rs` | Tauri app setup, state injection | 22–65 |
| `src-tauri/src/settings.rs` | Settings struct, persistence | 21–140 |
| `src-tauri/src/audio/mod.rs` | Audio module exports, constants | 1–19 |
| `src-tauri/src/audio/microphone.rs` | Mic capture via cpal | 1–279 |
| `src-tauri/src/audio/system_audio.rs` | macOS ScreenCaptureKit | 1–152 |
| `src-tauri/src/commands/audio.rs` | Tauri audio capture command | 33–166 |
| `src-tauri/src/commands/local_pipeline.rs` | Local mode sidecar spawn | 32–180+ |
| `src-tauri/src/commands/transcript.rs` | Transcript save/list commands | 22–100+ |

### JavaScript (Frontend)
| File | Purpose | Key Lines |
|------|---------|-----------|
| `src/js/app.js` | Main app controller | 18–1550+ |
| `src/js/soniox.js` | Soniox WebSocket client | 31–525 |
| `src/js/settings.js` | Settings manager | |
| `src/js/edge-tts.js` | Edge TTS via Rust | 1–87 |
| `src/js/elevenlabs-tts.js` | ElevenLabs WebSocket | 1–200+ |
| `src/js/google-tts.js` | Google TTS REST | 1–150+ |
| `src/js/audio-player.js` | Audio playback queue | |
| `src/js/ui.js` | TranscriptUI component | |

### Python (Local Pipeline)
| File | Purpose | Key Lines |
|------|---------|-----------|
| `scripts/local_pipeline.py` | Whisper + Gemma translator | 47–399 |

---

**Version**: Architecture as of 2026-05-08 (v0.5.2)  
**Status**: Two modes (Soniox cloud + Local MLX), no provider abstraction yet
