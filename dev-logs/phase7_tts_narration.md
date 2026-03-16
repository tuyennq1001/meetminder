# Phase 7: TTS Narration — ElevenLabs Flash v2.5

> **Version**: v0.4.0  
> **Branch**: `feat/tts-narration`  
> **Trạng thái**: 🔧 In Progress  
> **Phụ thuộc**: Phase 6 (main branch)

---

## Tổng Quan

Thêm tính năng đọc to bản dịch (Text-to-Speech) sử dụng **ElevenLabs Flash v2.5** qua WebSocket.  
TTS chạy hoàn toàn ở Frontend JS — giống Soniox client, không cần Rust backend cho TTS logic.

### Thông số ElevenLabs Flash v2.5

| Attribute | Value |
|-----------|-------|
| Model ID | `eleven_flash_v2_5` |
| Latency | < 75ms (ultra-low) |
| Languages | 32 (bao gồm Vietnamese) |
| Max chars | 40,000/request |
| Output | MP3 base64 (default `mp3_44100_128`) |
| Pricing | ~$0.05/1000 chars (~$0.25/h continuous) |

### WebSocket Protocol

- **Endpoint**: `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?model_id=eleven_flash_v2_5`
- **BOS**: `{ "text": " ", "voice_settings": {...}, "xi_api_key": "..." }`
- **Text chunk**: `{ "text": "Bản dịch...", "flush": true }`
- **Response**: `{ "audio": "base64_mp3...", "isFinal": false }`
- **EOS**: `{ "text": "" }` → close socket

### Audio Feedback Loop Prevention

**Giải pháp**: ScreenCaptureKit `excludesCurrentProcessAudio` (1 dòng code Rust)

```rust
// system_audio.rs — thêm dòng này vào SCStreamConfiguration
.with_excludes_current_process_audio(true)
```

macOS kernel-level loại trừ audio output của chính process Personal Translator → TTS audio không bị capture lại → không feedback loop.

---

## Checklist

### Phase 7.1: Core TTS Client & Audio Playback
- [x] Tạo branch `feat/tts-narration`
- [x] Apply feedback loop fix (`system_audio.rs` — `excludesCurrentProcessAudio`)
- [x] Tạo `src/js/elevenlabs-tts.js` — WebSocket TTS client
  - [x] Connect/disconnect WS
  - [x] BOS message (api_key, voice_settings)
  - [x] speak(text) — send text chunk with flush
  - [x] EOS — graceful close
  - [x] Text queue while WS connecting
  - [x] Auto-reconnect on timeout
- [x] Tạo `src/js/audio-player.js` — AudioContext playback queue
  - [x] base64 → ArrayBuffer → AudioBuffer decode
  - [x] Queue-based seamless playback (schedule with AudioContext.currentTime)
  - [x] stop() — clear queue, reset context
  - [x] Backlog management (skip stale audio khi queue quá dài)
- [x] Test E2E: YouTube Japanese audio → Soniox → ElevenLabs TTS → speaker

### Phase 7.2: Settings & UI
- [x] Update `src-tauri/src/settings.rs` — thêm TTS fields
  - [x] `elevenlabs_api_key: String`
  - [x] `tts_enabled: bool`
  - [x] `tts_voice_id: String` (default: Rachel multilingual)
  - [x] `tts_auto_read: bool`
- [x] Update `src/index.html`
  - [x] TTS toggle button trong control bar (🔇/🔊)
  - [x] TTS settings section (API key, voice select, auto-read checkbox)
  - [x] Voice selector: 2 nữ (Rachel, Sarah) + 2 nam (Daniel, Adam)
- [x] Update `src/js/settings.js` — save/load TTS settings
- [x] Update `src/styles/main.css` — style TTS controls
- [x] Keyboard shortcut ⌘T — toggle TTS

### Phase 7.3: Integration & Polish
- [x] Wire TTS to Soniox mode `onTranslation` callback
- [x] Wire TTS to Local MLX mode `_handleLocalPipelineResult`
- [x] TTS connect/disconnect lifecycle (start/stop app)
- [x] AudioContext autoplay policy handling (resume on user gesture)
- [x] Error handling (bad API key, quota exceeded, WS timeout)
- [x] CSP verification (wss://api.elevenlabs.io already covered by `wss:` wildcard)
- [x] Build & test production bundle
- [ ] Update `docs/system/architecture.md` — add TTS section

---

## Kiến Trúc

```
Translation output (text)
  ↓
app.js — onTranslation(text)
  ├── TranscriptUI (display text)
  └── ElevenLabsTTS (elevenlabs-tts.js)
        → wss://api.elevenlabs.io/v1/text-to-speech/{voice}/stream-input
        → send { text, flush: true }
        ← receive { audio: base64_mp3 }
        ↓
      AudioPlayer (audio-player.js)
        → AudioContext.decodeAudioData()
        → AudioBufferSourceNode → speakers
        ↓
      🔊 Output (excluded from ScreenCaptureKit capture)
```

### File Changes

| File | Action | Mô tả |
|------|--------|-------|
| `src/js/elevenlabs-tts.js` | **NEW** | ElevenLabs WebSocket TTS client |
| `src/js/audio-player.js` | **NEW** | AudioContext playback queue |
| `src-tauri/src/audio/system_audio.rs` | EDIT | Add `excludesCurrentProcessAudio` |
| `src-tauri/src/settings.rs` | EDIT | Add TTS settings fields |
| `src/js/app.js` | EDIT | Wire TTS, toggle button, shortcut |
| `src/js/settings.js` | EDIT | TTS settings form |
| `src/index.html` | EDIT | TTS UI elements |
| `src/styles/main.css` | EDIT | TTS button styles |

---

## Chi Phí Ước Tính (kết hợp)

| Service | Cost/hour | Use case |
|---------|-----------|----------|
| Soniox STT | ~$0.12 | Transcription + Translation |
| ElevenLabs TTS | ~$0.25 | Read translations aloud |
| **Tổng** | **~$0.37** | Full pipeline |

4h/ngày × 20 ngày ≈ **$30/tháng** cho heavy use.

---

## Progress

### 2026-03-16 — Session 1: Research & Planning
- Đã làm:
  - [x] Research ElevenLabs Flash v2.5 WebSocket API
  - [x] Xác định protocol: BOS/text/EOS, base64 MP3 output
  - [x] Tìm giải pháp audio feedback loop: `excludesCurrentProcessAudio`
  - [x] Verify `screencapturekit` crate 1.5.4 hỗ trợ API này
  - [x] Xác nhận CSP đã cho phép `wss:` wildcard
  - [x] Lên implementation plan 3 phases

### 2026-03-16 — Session 2: Implementation & Testing
- Đã làm:
  - [x] Tạo branch `feat/tts-narration`
  - [x] Implement `elevenlabs-tts.js` (WS client, auto-reconnect, text queue)
  - [x] Implement `audio-player.js` (AudioContext queue, backlog mgmt)
  - [x] Apply `excludesCurrentProcessAudio` fix (1 line Rust)
  - [x] Add TTS settings (Rust + JS): API key, voice, auto-read
  - [x] Add TTS UI: toggle button, settings section, ⌘T shortcut
  - [x] Wire TTS to both Soniox and Local MLX translation callbacks
  - [x] Build & install production app
  - [x] E2E test: YouTube Japanese → Soniox → Vietnamese TTS → speaker ✅
  - [x] Feedback loop fix confirmed working ✅
  - [x] Benchmark: TTFB avg=209ms, min=175ms, max=260ms
  - [x] Verified 8 voices work with Vietnamese, selected 4 (2M/2F)
  - [x] Fix voice_id bug (old invalid ID → verified premade IDs)
- Kết quả:
  - Pipeline hoạt động end-to-end
  - 3 test sessions: 58 segments, ~3 phút audio
  - Memory: 44MB, CPU: <3%
  - TTFB: 175-260ms (rất nhanh cho real-time)

### Available Voices (verified working with Vietnamese)

| Voice ID | Name | Gender | TTFB |
|----------|------|--------|------|
| `21m00Tcm4TlvDq8ikWAM` | Rachel | Female | 417ms |
| `EXAVITQu4vr4xnSDxMaL` | Sarah | Female | 259ms |
| `onwK4e9ZLuTAKqWW03F9` | Daniel | Male | 202ms |
| `pNInz6obpgDQGcFmaJgB` | Adam | Male | 175ms |
