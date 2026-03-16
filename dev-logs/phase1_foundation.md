# Phase 1: Foundation — Dev Log

> **Chi tiết**: xem [docs/03_implementation_plan.md](../docs/03_implementation_plan.md#phase-1-foundation-2-3-ngày)  
> **Trạng thái**: ✅ Hoàn thành

## Checklist

- [x] 1.1 Init Tauri 2 project (vanilla template)
- [x] 1.2 Configure `tauri.conf.json` (window, permissions, CSP)
- [x] 1.3 Implement `settings.rs` (struct, load/save, Tauri commands)
- [x] 1.4 Build Settings UI (API key, languages, audio source, display)

## Progress

### 2026-03-10
- Đã làm:
  - Cài đặt Rust toolchain (1.94.0) + Node.js (25.6.1) 
  - Init Tauri 2 project với vanilla template
  - Khôi phục docs/ và dev-logs/ bị scaffold ghi đè
  - Cấu hình tauri.conf.json:
    - Transparent window, decorations off, always-on-top
    - macOSPrivateApi: true cho transparent support
    - CSP chỉ cho phép wss://stt-rt.soniox.com + Google Fonts
    - Window capabilities (drag, close, resize, etc.)
  - Implement settings.rs:
    - Settings struct đầy đủ (API key, language, audio source, display options, custom context)
    - JSON persistence tại ~/Library/Application Support/com.personal.translator/
    - SettingsState wrapper với Mutex cho thread-safety
  - Implement commands/settings.rs:
    - get_settings và save_settings Tauri commands
  - Build đầy đủ frontend UI:
    - Overlay view: control bar (settings, status, source toggle, start/stop, close), transcript container, resize handle
    - Settings view: API key, languages, audio source, display sliders, custom context, save button
    - Dark glassmorphism CSS với custom properties design system
    - SVG icons inline (zero dependencies)
    - Toast notifications
  - JavaScript modules:
    - settings.js — Settings manager singleton với reactive onChange pattern
    - ui.js — TranscriptUI component (rolling text, provisional/final states, auto-scroll)
    - soniox.js — Soniox WebSocket client (đầy đủ protocol, sẵn sàng cho Phase 3)
    - app.js — Main controller wiring everything together
  - Build thành công (release + dev mode), app launches OK
- Vấn đề: Phải add `macOSPrivateApi: true` cho transparent windows
- Tiếp theo: Phase 2 — Audio Capture
