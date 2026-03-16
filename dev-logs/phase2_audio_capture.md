# Phase 2: Audio Capture — Dev Log

> **Chi tiết**: xem [docs/03_implementation_plan.md](../docs/03_implementation_plan.md#phase-2-audio-capture-2-3-ngày)  
> **Trạng thái**: ✅ Hoàn thành  
> **Phụ thuộc**: Phase 1

## Checklist

- [x] 2.1 Add Rust deps (`screencapturekit`, `cpal`)
- [x] 2.2 Implement `system_audio.rs` (ScreenCaptureKit, PCM 16kHz mono)
- [x] 2.3 Implement `microphone.rs` (cpal, PCM 16kHz mono)
- [x] 2.4 Tauri commands (`start_capture`, `stop_capture`, `check_permissions`)
- [ ] 2.5 Test audio capture (system audio + mic + permissions flow)

## Progress

### 2026-03-10
- Đã làm:
  - Thêm dependencies: `screencapturekit = "1.5"`, `cpal = "0.15"`
  - Implement `audio/system_audio.rs`:
    - ScreenCaptureKit capture (audio only, minimal 2x2 video)
    - SCStreamOutputTrait handler nhận CMSampleBuffer audio
    - Phân tích AudioBufferList → f32 raw data
    - Pipeline chuyển đổi: stereo → mono → downsample 48kHz→16kHz → f32→s16le
    - mpsc channel để forward audio data
    - Background thread giữ stream alive
  - Implement `audio/microphone.rs`:
    - cpal default input device 
    - Hỗ trợ cả F32 và I16 sample formats
    - Linear interpolation resampler cho downsampling
    - Sửa lỗi `cpal::Stream` là `!Send` — lưu stream trong struct + `unsafe impl Send`
  - Implement `commands/audio.rs`:
    - `start_capture(source, channel)` → nhận IPC Channel, forward PCM data từ Rust → JS
    - `stop_capture()` → dừng capture + forwarder
    - `check_permissions()` → placeholder
    - AudioForwarder pattern (thread + atomic stop flag)
  - Cập nhật `app.js`:
    - Tạo Tauri IPC Channel trong `start()`
    - Forward PCM data dạng Uint8Array → Soniox WebSocket binary frames
    - Gọi `stop_capture` khi dừng
  - Build thành công, mọi module compile OK
- Vấn đề:
  - `cpal::Stream` là `!Send`, không thể move qua thread → giải quyết bằng cách lưu trong struct + unsafe impl Send
  - ScreenCaptureKit API yêu cầu tối thiểu width/height cho video, dùng 2x2 pixel minimal
- Cần test:
  - Test thực tế trên macOS với actual audio (play YouTube, speak into mic)
  - Verify permissions flow (Screen Recording, Microphone)
- Tiếp theo: Phase 3 — Soniox Integration (đã implement phần lớn cùng Phase 2)
