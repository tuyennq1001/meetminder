# Phase 1 — Backend Foundation

**Status:** ☑ Done
**Estimate:** 2h
**Owner:** Rust backend

## Overview

Lay the Rust-side groundwork: persist a new API key field, add an audio resampler utility (16k → 24k), and register a stub Tauri command that phase 2 will fill in. Nothing networked yet.

## Related code files

- MODIFY: [src-tauri/src/settings.rs](../../src-tauri/src/settings.rs) — add `openai_api_key`, `translation_provider` fields
- MODIFY: [src-tauri/Cargo.toml](../../src-tauri/Cargo.toml) — add `rubato`, `tokio-tungstenite` (verify already present), `tokio` features
- MODIFY: [src-tauri/src/lib.rs](../../src-tauri/src/lib.rs) — register new module + commands
- CREATE: `src-tauri/src/commands/openai_realtime.rs` — module skeleton + stub command
- CREATE: `src-tauri/src/audio/resampler.rs` — 16kHz → 24kHz resampler helper
- MODIFY: [src-tauri/src/audio/mod.rs](../../src-tauri/src/audio/mod.rs) — `pub mod resampler;`
- MODIFY: [src-tauri/src/commands/mod.rs](../../src-tauri/src/commands/mod.rs) — `pub mod openai_realtime;`

## Implementation steps

### 1. Settings struct

In `src-tauri/src/settings.rs`:

```rust
pub struct AppSettings {
    // ... existing fields ...
    #[serde(default)]
    pub openai_api_key: String,

    /// "soniox" | "local" | "openai"
    #[serde(default = "default_translation_mode")]
    pub translation_mode: String,
}

fn default_translation_mode() -> String { "soniox".into() }
```

Note: `translation_mode` already exists. Just extend the doc comment & default. Add `openai_api_key` next to `soniox_api_key` for symmetry.

### 2. Cargo.toml deps

Add under `[dependencies]`:

```toml
rubato = "0.16"
tokio-tungstenite = { version = "0.24", features = ["rustls-tls-webpki-roots"] }
futures-util = "0.3"  # already present — verify
```

Run `cargo check` after editing.

### 3. Resampler utility — `src-tauri/src/audio/resampler.rs`

```rust
//! 16kHz → 24kHz PCM s16le resampler for OpenAI Realtime API.
//!
//! Uses rubato's SincFixedIn for high-quality polyphase resampling.
//! Input: PCM s16le bytes at 16000 Hz mono.
//! Output: PCM s16le bytes at 24000 Hz mono (1.5x size).

use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};

const RATIO: f64 = 24000.0 / 16000.0; // 1.5

pub struct UpsamplerTo24k {
    inner: SincFixedIn<f32>,
    in_buf: Vec<f32>,
    out_buf: Vec<f32>,
    chunk_size: usize,
}

impl UpsamplerTo24k {
    pub fn new(chunk_size: usize) -> Result<Self, String> {
        let params = SincInterpolationParameters {
            sinc_len: 128,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 128,
            window: WindowFunction::BlackmanHarris2,
        };
        let inner = SincFixedIn::<f32>::new(RATIO, 1.1, params, chunk_size, 1)
            .map_err(|e| format!("resampler init: {e}"))?;
        Ok(Self {
            inner,
            in_buf: Vec::with_capacity(chunk_size),
            out_buf: Vec::with_capacity((chunk_size as f64 * RATIO) as usize + 16),
            chunk_size,
        })
    }

    /// Push PCM s16le bytes; returns resampled PCM s16le bytes (may be empty
    /// if not yet enough samples to fill chunk_size). Caller should drain
    /// repeatedly with same input until empty result.
    pub fn process(&mut self, pcm_bytes: &[u8]) -> Result<Vec<u8>, String> {
        // Decode s16le -> f32
        for chunk in pcm_bytes.chunks_exact(2) {
            let s = i16::from_le_bytes([chunk[0], chunk[1]]);
            self.in_buf.push(s as f32 / 32768.0);
        }

        let mut out_bytes = Vec::new();
        while self.in_buf.len() >= self.chunk_size {
            let frame: Vec<f32> = self.in_buf.drain(..self.chunk_size).collect();
            let resampled = self.inner.process(&[frame], None)
                .map_err(|e| format!("resample: {e}"))?;
            for &s in &resampled[0] {
                let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
                out_bytes.extend_from_slice(&v.to_le_bytes());
            }
        }
        Ok(out_bytes)
    }
}
```

Choose `chunk_size = 1024` samples (64ms @ 16kHz) — balances latency and quality. Output per chunk: 1536 samples (64ms @ 24kHz).

### 4. Stub Tauri command — `src-tauri/src/commands/openai_realtime.rs`

```rust
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

#[derive(Deserialize)]
pub struct OpenAiRealtimeConfig {
    pub api_key: String,
    pub source_language: String,    // ISO 639-1, e.g. "ja"; "auto" for detect
    pub target_language: String,    // ISO 639-1, e.g. "vi"
    pub voice: Option<String>,      // e.g. "alloy"; None → server default
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OpenAiEvent {
    Status { state: String, message: Option<String> },
    Transcript { text: String, is_final: bool },
    AudioChunk { pcm_base64: String },     // 24kHz s16le mono
    Error { code: String, message: String },
    Closed { reason: String },
}

#[tauri::command]
pub async fn openai_realtime_start(
    _config: OpenAiRealtimeConfig,
    on_event: Channel<OpenAiEvent>,
) -> Result<u64, String> {
    // Phase 2 fills this in. For phase 1, just emit a not-implemented status.
    let _ = on_event.send(OpenAiEvent::Error {
        code: "not_implemented".into(),
        message: "WebSocket client coming in phase 2".into(),
    });
    Err("not implemented".into())
}

#[tauri::command]
pub async fn openai_realtime_send_audio(
    _session_id: u64,
    _pcm_s16le_16khz: Vec<u8>,
) -> Result<(), String> {
    Err("not implemented".into())
}

#[tauri::command]
pub async fn openai_realtime_stop(_session_id: u64) -> Result<(), String> {
    Err("not implemented".into())
}
```

### 5. Wire commands in `lib.rs`

Add to the `invoke_handler!` block:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing ...
    commands::openai_realtime::openai_realtime_start,
    commands::openai_realtime::openai_realtime_send_audio,
    commands::openai_realtime::openai_realtime_stop,
])
```

## Todo list

- [ ] Add `openai_api_key` field to `AppSettings`
- [ ] Add `rubato` to Cargo.toml; run `cargo check`
- [ ] Create `audio/resampler.rs` with `UpsamplerTo24k`
- [ ] Add `pub mod resampler;` to `audio/mod.rs`
- [ ] Create `commands/openai_realtime.rs` with stub commands + event enum
- [ ] Add `pub mod openai_realtime;` to `commands/mod.rs`
- [ ] Register all 3 commands in `lib.rs` invoke_handler
- [ ] `cargo check` passes on macOS

## Success criteria

- App compiles with `cargo check` (and on Windows via CI tag if needed).
- Settings JSON loads/saves the new `openai_api_key` field with empty default.
- `openai_realtime_start` is callable from JS via `invoke()` and returns the stub error.

## Risks

- `rubato 0.16` API may differ from snippet — read [docs.rs/rubato](https://docs.rs/rubato/latest/rubato/) and adjust constructor call. Versions ≥ 0.15 changed signatures.
- `tokio-tungstenite` already used? Check — Soniox was previously WS-via-frontend. If not present, adding it pulls a few deps but small footprint.

## Security

- API key stored in plaintext in settings.json (same as Soniox/Google/ElevenLabs keys today). Acceptable for personal app.
- Key never sent to frontend after first save — only used inside Rust WS client.

## Next steps

→ Phase 2 fills in `openai_realtime_start` with actual WebSocket logic.
