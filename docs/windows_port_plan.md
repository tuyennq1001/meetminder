# Windows Port Plan

## Overview

Port **My Translator** to Windows 10/11 (x64). Core logic (Soniox WebSocket, UI, settings) is shared. Only audio capture differs.

---

## Architecture Comparison

| Layer | macOS (current) | Windows (target) |
|---|---|---|
| **System audio** | ScreenCaptureKit | WASAPI loopback |
| **Microphone** | cpal (CoreAudio) | cpal (WASAPI) — already cross-platform |
| **Frontend** | WebView2 (Tauri) | WebView2 (Tauri) — same |
| **API** | Soniox WebSocket | Same |
| **Settings/Storage** | Tauri plugin-store | Same |
| **Transcript files** | ~/Library/… | %APPDATA%\… (Tauri handles) |

## End User (Windows)

User Windows chỉ cần:
1. Tải `.exe` từ GitHub Releases
2. Cài đặt (Next → Next → Done)
3. Mở app → dán Soniox API key → bấm Play

Không cần cài thêm gì.

---

## Dev Build Environment (VM)

> Phần này chỉ dành cho developer build app, không liên quan đến user.

Trên VM Windows cần cài:
- **Rust** + target `x86_64-pc-windows-msvc`
- **Node.js** 18+
- **Visual Studio Build Tools** (C++ workload)
- Clone repo → `npm install` → `npm run tauri build`

> ⚠️ VM ARM Windows trên Mac → dùng target `aarch64-pc-windows-msvc`.

---

## Phases

### Phase W1 — WASAPI Loopback Capture
**Effort:** ~2–3 days

macOS dùng ScreenCaptureKit để bắt system audio. Windows không có tương đương — phải dùng **WASAPI loopback**.

**Tasks:**
- [ ] Thêm `wasapi` feature flag trong `Cargo.toml`
- [ ] Tạo `src-tauri/src/audio/wasapi.rs`
- [ ] Implement WASAPI loopback capture — record what's playing (render endpoint, loopback mode)
- [ ] Downsample 44.1/48kHz → 16kHz (same as macOS)
- [ ] Wire vào `audio/mod.rs` với `#[cfg(target_os = "windows")]`
- [ ] Test: audio stream chạy đúng format PCM s16le mono 16kHz

**Crates cần dùng:**
```toml
[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.58", features = [
  "Win32_Media_Audio",
  "Win32_System_Com",
  "Win32_Foundation",
] }
```

---

### Phase W2 — Build & Permissions
**Effort:** ~1 day

macOS cần Screen Recording permission. Windows không cần permission đặc biệt cho loopback.

**Tasks:**
- [ ] Setup cross-compile hoặc build trực tiếp trên Windows VM
- [ ] Tauri bundler Windows: tạo `.msi` và `.exe` installer
- [ ] Test build ra `My Translator_x.x.x_x64-setup.exe`
- [ ] Kiểm tra Windows Defender không chặn (unsigned EXE)

**Build command:**
```bash
npm run tauri build -- --target x86_64-pc-windows-msvc
```

---

### Phase W3 — Windows-specific UI/UX
**Effort:** ~1 day

- [ ] Kiểm tra overlay window behavior trên Windows (always-on-top, drag, resize)
- [ ] Font rendering khác macOS — adjust CSS nếu cần
- [ ] Settings path: đảm bảo Tauri tự resolve `%APPDATA%`
- [ ] Transcript file path: Windows dùng `\` thay `/` — check Rust code

---

### Phase W4 — CI/CD & Release
**Effort:** ~1 day

- [ ] GitHub Actions: thêm Windows runner (`windows-latest`)
- [ ] Auto-build DMG (macOS) + EXE (Windows) khi push tag
- [ ] Upload cả 2 lên GitHub Release cùng một tag

**Workflow skeleton:**
```yaml
jobs:
  build-macos:
    runs-on: macos-latest
    steps: ...build DMG...

  build-windows:
    runs-on: windows-latest
    steps: ...build EXE/MSI...
```

---

## Platform-specific Code Structure

```
src-tauri/src/audio/
├── mod.rs              # #[cfg] chọn module
├── system_audio.rs     # macOS (ScreenCaptureKit) — hiện tại
├── wasapi.rs           # Windows (WASAPI loopback) — cần làm
└── microphone.rs       # cpal — dùng chung cả 2
```

`mod.rs` pattern:
```rust
#[cfg(target_os = "macos")]
pub mod system_audio;

#[cfg(target_os = "windows")]
pub mod wasapi;

pub mod microphone; // cross-platform
```

---

## Risks & Notes

| Risk | Mitigation |
|------|-----------|
| WASAPI API phức tạp hơn ScreenCaptureKit | Tham khảo `cpal` source hoặc dùng `windows-rs` WASAPI example |
| Code signing trên Windows (SmartScreen) | Giống macOS — workaround bằng hướng dẫn user |
| Frontend/CSS render khác | Cả 2 đều dùng WebView2 (Chromium engine) — ít khác biệt |
| Cross-compile macOS → Windows | Khó, nên build native trên Windows VM hoặc GitHub Actions |

---

## Priority

**W1 → W2 → W3 → W4**

Minimal viable: chỉ cần W1 + W2 là có app Windows chạy được.
W3 + W4 là polish và automation.

---

## Estimated Total Effort

~5–6 ngày làm việc (nếu có Windows machine để test).
