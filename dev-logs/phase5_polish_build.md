# Phase 5: Polish & Build — Dev Log

> **Chi tiết**: xem [docs/03_implementation_plan.md](../docs/03_implementation_plan.md)  
> **Trạng thái**: ✅ Hoàn thành  
> **Phụ thuộc**: Phase 4

## Checklist

- [x] 5.1 Keyboard shortcuts (⌘Enter, ⌘,, Esc, ⌘1/⌘2)
- [x] 5.2 Auto-reconnect Soniox (3 attempts, exponential backoff)
- [x] 5.3 Structured API error handling (auth, rate limit, payment)
- [x] 5.4 Permission-aware error messages (Screen Recording, Microphone)
- [x] 5.5 macOS entitlements & Info.plist for TCC permissions
- [x] 5.6 Production build (.app bundle) — `npm run tauri build -- --debug`
- [x] 5.7 Swift concurrency rpath fix in build.rs
- [ ] 5.8 Window position save/restore (implemented, disabled pending transparent window fix)
- [ ] 5.9 DMG packaging (bundle_dmg.sh fails — needs icons)

## Progress

### 2026-03-11 (Session 3): Speaker Diarization & UI Fixes
- Đã làm:
  - **Speaker diarization**: Soniox `enable_speaker_diarization: true`
    - Token có field `speaker` (số: 1, 2, 3...)
    - UI hiện "Speaker N:" label (màu vàng cam) khi speaker thay đổi
    - Mỗi speaker xuống dòng mới (`display: block`)
  - **CSP fix** (`tauri.conf.json`):
    - Thêm `ipc://localhost` vào `connect-src` (Tauri IPC bị block)
    - Thêm `https://fonts.googleapis.com` vào `style-src` (Google Fonts)
    - Thêm `https://fonts.gstatic.com` vào `font-src`
  - **Auto-scroll fix** (`ui.js`):
    - Bug: `scrollTop` set trên `#transcript-content` (inner div) thay vì `#transcript-container` (scrollable parent)
    - Fix: scroll `parentElement` có `overflow-y: auto`
    - Bỏ `scroll-behavior: smooth` (gây lag real-time), thêm `min-height: 0` (flex scroll fix)
- Kết quả:
  - ✅ Multi-speaker detection hoạt động
  - ✅ Auto-scroll khi text đầy window
  - ✅ CSP không còn block IPC/fonts

### 2026-03-11 (Session 2): Audio Pipeline & Translation Optimization
- Đã làm:
  - **UI rewrite — Continuous paragraph flow** (`ui.js`):
    - Text dịch (trắng) + text gốc chưa dịch (cyan) + provisional (xám italic) chạy liền nhau
    - Translation tự replace oldest untranslated segment (queue-based, không dùng ID matching)
    - Blinking cursor indicator ở cuối text
  - **Soniox model upgrade**: `stt-rt-preview` → `stt-rt-v4` (latest Feb 2026, millisecond finality)
  - **Audio data rate fix** (critical):
    - ScreenCaptureKit outputs 2 deinterleaved mono buffers (L+R) → code cũ xử lý cả 2 → 2x data rate
    - Fix: chỉ lấy buffer đầu tiên → đúng 1x real-time (~6400 bytes/200ms)
  - **Audio batching** (Rust forwarder):
    - Gộp audio chunks trong Rust thread → gửi 1 IPC message mỗi 200ms
    - Giảm IPC overhead từ ~50 msg/sec → ~5 msg/sec
  - **Endpoint delay tuning**: `max_endpoint_delay_ms: 500 → 1500` (sweet spot)
    - 500ms: transcription nhanh nhưng translation bị backlog
    - 1500ms: cả transcription lẫn translation đều bám sát audio
  - **Soniox error handling fix**: check `error_code` (numeric) thay vì `error` (string)
    - 408 timeout → auto-reconnect
  - **ScreenCaptureKit 16kHz test**: FAILED — chỉ hoạt động ở 48kHz native
- Kết quả:
  - ✅ Transcription real-time (bám sát audio gốc)
  - ✅ Translation real-time (không chậm dần)
  - ✅ Batch size ~6400 bytes/200ms (đúng 1x rate)
  - ✅ UI paragraph flow mượt mà
- Lessons learned:
  - [03_audio_pipeline_optimization.md](../lessons-learned/03_audio_pipeline_optimization.md)

### 2026-03-10 ~ 2026-03-11 (Session 1)
- Đã làm:
  - **Soniox client rewrite** (`soniox.js`):
    - Auto-reconnect: tối đa 3 lần, delay tăng dần (2s, 4s, 6s)
    - Xử lý close codes: 1006 (abnormal → reconnect), 4001/4003 (auth → stop), 4029 (rate limit)
    - API error handling: map error codes → user-friendly messages
    - Intentional disconnect flag để phân biệt user stop vs network error
  - **Keyboard shortcuts** (`app.js`):
    - `⌘ Enter` — Start/Stop capture
    - `⌘ ,` — Open Settings
    - `Escape` — Close Settings
    - `⌘ 1` / `⌘ 2` — Switch System Audio / Microphone
    - Input fields excluded from shortcuts
  - **Hot-swap audio source**: Tự restart capture khi chuyển source giữa chừng
  - **Permission error guidance**: Toast hiện hướng dẫn cụ thể (System Settings → Privacy...)
  - **macOS permissions fix** (critical):
    - Tạo `Info.plist` với `NSScreenCaptureUsageDescription` + `NSMicrophoneUsageDescription`
    - Tạo `Entitlements.plist` với `screen-capture` + `audio-input`
    - Config `tauri.conf.json` bundle → `entitlements: "Entitlements.plist"`
    - **Lesson**: Dev binary (`cargo run`) KHÔNG hoạt động với TCC — phải build `.app` bundle
  - **Swift concurrency fix**:
    - `build.rs` thêm rpath `/usr/lib/swift` cho `libswift_Concurrency.dylib`
    - `screencapturekit` crate cần Swift runtime mà trên macOS 15+ nằm trong dyld cache
  - **Production build**: `npm run tauri build -- --debug` → `.app` bundle OK
  - **End-to-end test thành công** (2026-03-11):
    - ScreenCaptureKit audio capture → 2000+ chunks PCM data flowing
    - Soniox WebSocket connected, config accepted
    - STT: Nhận diện tiếng Anh chính xác ("These two things, they're not simply co-occurring")
    - Translation: Dịch sang tiếng Việt thành công ("Góp phần vào suy giảm nhận thức hoặc trí nhớ")
    - UI hiển thị cả original (xám) + final (trắng) + translation
  - **Soniox API config fixes**:
    - `translation.type: 'one_way'` (required parameter)
    - `translation.target_language` (singular, not `target_languages` array)
- Vấn đề còn lại:
  - DMG bundling: thường fail do bundle_dmg.sh script issue
  - `transparent: true` tạm tắt do window invisible issue
  - Window position restore tạm disable
- Lessons learned:
  - [01_macos_permissions_tcc.md](../lessons-learned/01_macos_permissions_tcc.md)
  - [02_dev_build_permissions_workflow.md](../lessons-learned/02_dev_build_permissions_workflow.md)

