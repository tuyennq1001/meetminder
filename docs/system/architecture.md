# Backend Architecture — Personal Translator

## Overview

Two independent backend pipelines process audio into translated text:

| Mode | Pipeline | Path |
|------|----------|------|
| **Cloud (Soniox)** | Audio → WebSocket → Soniox API → tokens | JS direct |
| **Local (MLX)** | Audio → Rust stdin → Python sidecar → JSON | Rust + Python |

Both share the same **audio capture layer** (Rust) but diverge at the processing stage.

---

## Audio Capture Layer (Rust)

All audio goes through Rust regardless of translation mode.

### System Audio — ScreenCaptureKit
```
ScreenCaptureKit callback (48kHz, f32, stereo)
  → take first channel only (mono)
  → downsample 48kHz → 16kHz (factor 3, linear interpolation)
  → convert f32 → s16le (clamp to [-32768, 32767])
  → batch every 200ms
  → send via Tauri Channel → JS callback
```

- **Source**: `src-tauri/src/audio/system_audio.rs`
- **Permission**: macOS Screen Recording (TCC)
- **Output**: PCM s16le, 16kHz, mono
- **Batching**: 200ms chunks (~6,400 bytes each)

### Microphone — cpal
```
cpal input stream (native rate, f32/i16)
  → resample to 16kHz
  → convert to s16le mono
  → batch → Tauri Channel → JS
```

- **Source**: `src-tauri/src/audio/microphone.rs`
- **Permission**: macOS Microphone (TCC)

### Tauri Commands
| Command | Description |
|---------|-------------|
| `start_capture(source, channel)` | Start system/mic capture, stream to JS channel |
| `stop_capture()` | Stop capture, release ScreenCaptureKit/cpal |
| `check_audio_permissions()` | Check TCC permissions |

---

## Cloud Mode — Soniox WebSocket

### Connection
```
JS (soniox.js)
  → new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket')
  → send config JSON on open:
      {
        api_key, model: 'stt-rt-v4',
        audio_format: 'pcm_s16le', sample_rate: 16000,
        enable_endpoint_detection: true,
        enable_speaker_diarization: true,
        translation: { type: 'one_way', target_language: 'vi' },
        context: { domain: '...' }
      }
```

### Data Flow
```
Audio capture (Rust)
  → Tauri Channel → JS callback
  → ws.send(pcmData)   [binary frame, raw PCM]
  ↓
Soniox server processes in real-time
  ↓
ws.onmessage → JSON response:
  { tokens: [
    { text: "こんにちは", is_final: true, speaker: 1, translation_status: "original" },
    { text: "Xin chào", is_final: true, translation_status: "translation" },
    { text: "今日は", is_final: false, translation_status: "original" }  // provisional
  ]}
```

### Protocol Summary
| Direction | Format | Content |
|-----------|--------|---------|
| Client → Server | JSON (first msg) | Config: api_key, model, audio_format, translation |
| Client → Server | Binary | Raw PCM s16le 16kHz mono |
| Server → Client | JSON | Tokens array: text, is_final, speaker, translation_status |
| Client → Server | Empty binary | Graceful close signal |

### Session Management
- **Auto-reset**: Every 3 minutes — seamless make-before-break reconnect
- **Context carryover**: Last 500 chars of translations → `context.domain` in next session
- **Auto-reconnect**: Up to 3 attempts with exponential backoff on transient errors
- **Error codes**: 4001 (bad key), 4002 (subscription), 4029 (rate limit), 1006 (connection lost)

---

## Local Mode — MLX Pipeline

### Architecture
```
Audio capture (Rust)
  → Tauri Channel → JS callback
  → JS calls invoke('send_audio_to_pipeline', { data })
  → Rust writes PCM bytes to Python stdin
  ↓
Python sidecar (local_pipeline.py)
  ├── stdin reader thread → audio_buffer
  ├── main loop (every 500ms):
  │   └── when buffer ≥ 7s (224,000 bytes):
  │       ├── ASR: Whisper-large-v3-turbo (MLX)     ~2.0s
  │       ├── Dedup transcript (suffix-prefix match)
  │       ├── Translate: Gemma-3-4B-qat-4bit (MLX)  ~1.6s
  │       └── stdout → JSON result
  ↓
Rust stdout reader thread
  → parse JSON line
  → send via Tauri Channel → JS
```

### Rust Commands
| Command | Description |
|---------|-------------|
| `check_mlx_setup()` | Check if venv + models exist |
| `run_mlx_setup(channel)` | Create venv, install packages, download models (~5GB) |
| `start_local_pipeline(source_lang, target_lang, channel)` | Spawn Python sidecar |
| `send_audio_to_pipeline(data)` | Write PCM bytes to Python stdin |
| `stop_local_pipeline()` | Kill Python process |

### Pipeline Startup Sequence
```
1. check_mlx_setup()
   → checks ~/Library/Application Support/Personal Translator/mlx-env/
   → if missing: run_mlx_setup() (one-time, ~5GB download)

2. start_local_pipeline()
   → pkill old pipeline processes
   → find scripts/local_pipeline.py (dev or production path)
   → select python (venv > homebrew > system)
   → spawn: python3 local_pipeline.py --asr-model whisper --source-lang ja --target-lang vi
   → pipe: stdin (audio in), stdout (JSON out), stderr (logs)
   → spawn 2 reader threads (stdout → Channel, stderr → Channel as status)

3. Python loads models:
   → Load Whisper-large-v3-turbo     (emit status)
   → Load Gemma-3-4B-qat-4bit       (emit status)
   → Warm up LLM with test sentence  (emit status)
   → emit { type: "ready" }
```

### Sliding Window Processing
```
Audio stream: ──────────────────────────────────────────→ time

              [======= 7s chunk ========]
                   [======= 7s chunk ========]
                        [======= 7s chunk ========]
              ←── 5s stride ──→← 2s overlap →

New result every ~5 seconds
Effective latency: 7s (buffer) + 3.5s (process) ≈ 10.5s
```

### Python Sidecar Protocol
| Direction | Format | Content |
|-----------|--------|---------|
| Rust → Python stdin | Binary | Raw PCM s16le 16kHz mono (4096 byte chunks) |
| Python stdout → Rust | JSON lines | `{ type, original, translated, timing }` |
| Python stderr → Rust | Text lines | Log/status messages → forwarded to frontend |

### Output Message Types
```json
{ "type": "status", "message": "Loading Whisper..." }
{ "type": "ready" }
{ "type": "result", "original": "こんにちは", "translated": "Xin chào",
  "language": "ja", "timing": { "asr": 2.01, "translate": 1.16, "total": 3.17 }}
{ "type": "done" }
```

### ASR Stage (Whisper)
- **Model**: `mlx-community/whisper-large-v3-turbo`
- **Framework**: `mlx-whisper`
- **Input**: Temp WAV file (saved from PCM buffer)
- **Output**: Transcribed text + detected language
- **Dedup**: Character-level suffix-prefix matching with previous chunk output
- **Silence skip**: RMS < 100 → skip chunk entirely

### Translation Stage (Gemma)
- **Model**: `mlx-community/gemma-3-4b-it-qat-4bit`
- **Framework**: `mlx-lm`
- **Prompt template**: Few-shot with examples + rolling context
- **Context**: Last 5 Japanese originals as topic hints
- **Post-processing**: Remove Gemma tokens, truncate at hallucination, dedup with previous translation
- **max_tokens**: 100

### Translation Prompt
```
<start_of_turn>user
Translate this ONE Japanese sentence to Vietnamese.
Output ONLY the Vietnamese translation of the LAST line.

Examples:
JA: こんにちは、マイです。→ Xin chào, tôi là Mai.
JA: おでんを作って食べました。→ Tôi đã làm oden ăn.

Rules: Vietnamese only. Keep names. Keep food terms. ONE sentence only.

[Topic context: <last 5 JA originals joined by " / ">]

Translate: <new_text>
<end_of_turn>
<start_of_turn>model
```

---

## File Structure (Backend Only)

```
src-tauri/src/
├── lib.rs                    # Tauri app setup, command registration, state management
├── settings.rs               # Settings JSON persistence
├── audio/
│   ├── mod.rs                # Constants: TARGET_SAMPLE_RATE=16000, batching logic
│   ├── system_audio.rs       # ScreenCaptureKit: capture → downsample → s16le → channel
│   └── microphone.rs         # cpal: capture → resample → s16le → channel
├── commands/
│   ├── mod.rs                # Module declarations
│   ├── audio.rs              # start_capture, stop_capture, check_permissions
│   ├── settings.rs           # get_settings, save_settings
│   ├── transcript.rs         # save_transcript, open_transcript_dir
│   └── local_pipeline.rs     # MLX pipeline: start/stop/send_audio, check/run setup

scripts/
├── local_pipeline.py         # Python sidecar: Whisper ASR + Gemma translation
├── setup_mlx.py              # One-time setup: venv + packages + model download
├── benchmark_translate.py    # Translation quality benchmark
└── benchmark_parallel.py     # Parallel vs sequential pipeline benchmark
```

### Key Paths
| Path | Purpose |
|------|---------|
| `~/Library/Application Support/Personal Translator/mlx-env/` | Python venv with MLX packages |
| `~/Library/Application Support/Personal Translator/mlx-env/.setup_complete` | Setup completion marker |
| `~/Library/Application Support/com.personal.translator/settings.json` | User settings |
| `~/Library/Application Support/com.personal.translator/transcripts/` | Saved transcript files |
| `/tmp/personal_translator_pipeline.log` | Pipeline debug log |

---

## Constraints & Limitations

1. **Sequential MLX only**: Metal GPU cannot run two MLX models concurrently → ASR then LLM, never parallel
2. **~10.5s latency** (Local): 7s buffer + 3.5s processing — inherent to chunked approach
3. **~6-7GB RAM** (Local): Both Whisper + Gemma loaded in unified memory
4. **macOS only** (Local): MLX is Apple Silicon exclusive
5. **No speaker ID** (Local): Whisper doesn't support diarization
