# Lesson Learned #3: Audio Pipeline & Soniox Translation Optimization

> **Date**: 2026-03-11
> **Context**: Real-time audio capture → Soniox STT → Translation pipeline
> **Problem**: Translation progressively slowed down over time (from ~1s to 20s+ delay)

## Root Causes Identified

### 1. Audio Data Rate 2x Real-time (Critical)

**Symptom**: Batch size ~12,800 bytes per 200ms instead of expected ~6,400 bytes.

**Root cause**: ScreenCaptureKit on macOS outputs 48kHz stereo audio as **2 separate deinterleaved mono buffers** (Left and Right channels). Code was iterating over ALL buffers with `for buffer in audio_buffer_list`, processing both L and R channels → doubling the output data.

**Fix**: Only process the **first buffer** (one channel is sufficient for speech):
```rust
// BEFORE (processes both L+R = 2x data)
for audio_buffer in &audio_buffer_list { ... }

// AFTER (single channel = 1x data)
let mut iter = audio_buffer_list.into_iter();
if let Some(audio_buffer) = iter.next() { ... }
```

**Verification**: Batch size dropped from ~12,800 to ~6,400 bytes per 200ms → correct 1x real-time rate.

### 2. IPC Overhead: Per-Chunk Forwarding

**Symptom**: Thousands of tiny IPC messages per second (640-byte chunks × 50/sec).

**Root cause**: Each ScreenCaptureKit audio callback sent a small PCM chunk (~640 bytes = 20ms audio) through `mpsc::channel` → Tauri IPC → JavaScript → WebSocket. This created massive overhead at all 3 layers.

**Fix**: Added **200ms batching in Rust forwarder thread**:
```rust
// Buffer audio in the forwarder thread
let batch_interval = Duration::from_millis(200);
// ... accumulate chunks, flush every 200ms as single IPC message
```

**Result**: IPC messages reduced from ~50/sec to ~5/sec.

### 3. ScreenCaptureKit Does NOT Support Non-48kHz Output

**Symptom**: Setting `with_sample_rate(16000)` caused no audio data to be recognized.

**Root cause**: macOS ScreenCaptureKit natively outputs at 48kHz. Setting a different sample rate via `with_sample_rate()` results in corrupted/wrong-format audio data that Soniox cannot process.

**Fix**: Always capture at 48kHz and downsample in software:
```rust
let config = SCStreamConfiguration::new()
    .with_sample_rate(48000)      // MUST be 48kHz (native)
    .with_channel_count(2);       // Stereo (native)
// Downsample 48kHz → 16kHz in AudioHandler callback
```

### 4. Translation Backlog from Aggressive Endpoint Detection

**Symptom**: Transcription fast, but translation gap grew progressively.

**Root cause**: `max_endpoint_delay_ms: 500` (minimum) finalized text every 0.5s pause → created many small segments → each needed separate translation → Soniox translation pipeline backed up.

**Fix**: Increased to `max_endpoint_delay_ms: 1500`:
- Fewer, larger segments → translation batches more efficiently
- Provisional text (gray italic) shows in real-time during the 1.5s window
- Translation arrives shortly after finalization
- No progressive delay accumulation

### 5. Soniox API Error Detection

**Issue**: Code checked `data.error` but Soniox uses `data.error_code` + `data.error_message`.

**Fix**: Check `data.error_code` (numeric: 400, 401, 402, 408, 429) instead of `data.error`.
Also: 408 timeout → auto-reconnect instead of just showing error.

## Optimal Settings (Verified Working)

```javascript
// Soniox WebSocket config
{
    model: 'stt-rt-v4',              // Latest model (Feb 2026)
    audio_format: 'pcm_s16le',
    sample_rate: 16000,
    num_channels: 1,
    enable_endpoint_detection: true,
    max_endpoint_delay_ms: 1500,     // Sweet spot: fast enough + efficient translation
    translation: {
        type: 'one_way',
        target_language: 'vi',       // Target language code
    }
}
```

```rust
// ScreenCaptureKit config
SCStreamConfiguration::new()
    .with_sample_rate(48000)         // MUST be native 48kHz
    .with_channel_count(2)           // MUST be native stereo
    .with_captures_audio(true)
    .with_width(2).with_height(2);   // Minimal video (required by API)

// Audio processing pipeline:
// 1. Take FIRST buffer only (one channel)
// 2. f32 samples → downsample step_by(3) → 16kHz
// 3. f32 → i16 s16le conversion
// 4. Batch in forwarder thread (200ms intervals)
```

## Key Takeaways

1. **Always verify data rate**: Calculate expected bytes/sec and compare with actual batch sizes
2. **ScreenCaptureKit quirks**: Deinterleaved stereo (2 mono buffers), only supports 48kHz
3. **Batch at every layer**: Rust → IPC → JS → WebSocket — reduce frame count at each step
4. **Endpoint delay trade-off**: Too low → translation backlog; too high → user perceives lag. 1500ms is sweet spot
5. **Soniox model**: `stt-rt-v4` provides best real-time performance with millisecond finality
6. **TranslaBuddy reference**: Uses `rubato` crate for high-quality resampling (we use simple decimation, adequate for speech)
