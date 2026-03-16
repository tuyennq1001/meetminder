# Windows Port — Handoff Guide

## Mục tiêu

Build và test app "Personal Translator" trên Windows. **Chỉ cần Soniox API mode** — không cần local/MLX pipeline.

> Local MLX translation chỉ dành cho macOS Apple Silicon. Windows dùng Soniox cloud API.

---

## Trạng thái hiện tại

| Component | Status | Notes |
|-----------|--------|-------|
| **Frontend** (HTML/CSS/JS) | ✅ Done | Cross-platform, không cần sửa |
| **Soniox WebSocket client** | ✅ Done | `src/js/soniox.js` — chạy trên mọi OS |
| **Settings** | ✅ Done | Tauri plugin-store, cross-platform |
| **Microphone** (`cpal`) | ✅ Done | `src-tauri/src/audio/microphone.rs` — cross-platform |
| **System Audio** (WASAPI) | ⚠️ Code written | `src-tauri/src/audio/wasapi.rs` — chưa build/test |
| **Build trên Windows** | ❌ Chưa | Cần Windows machine hoặc VM |

---

## Công việc cần làm

### 1. Setup Build Environment

Cài trên Windows:
```powershell
# Rust
winget install Rustlang.Rust.MSVC

# Node.js
winget install OpenJS.NodeJS.LTS

# Visual Studio Build Tools (C++ workload)
winget install Microsoft.VisualStudio.2022.BuildTools
# → Chọn "C++ build tools" workload trong installer

# WebView2 (thường đã có sẵn trên Windows 10/11)
```

### 2. Clone và Build

```powershell
git clone https://github.com/phuc-nt/realtime_pc_translator.git
cd realtime_pc_translator
npm install
npm run tauri build
```

Nếu build trên **ARM Windows** (VM trên Mac):
```powershell
npm run tauri build -- --target aarch64-pc-windows-msvc
```

### 3. Test WASAPI System Audio

File: `src-tauri/src/audio/wasapi.rs`

Code WASAPI loopback đã viết nhưng chưa test thực tế. Cần verify:
- [ ] Bắt được system audio (YouTube, music player, etc.)
- [ ] Output format: PCM s16le, 16kHz, mono
- [ ] Downsample từ 44.1/48kHz nếu cần
- [ ] Không crash khi không có audio device

### 4. Test Flow End-to-End

1. Mở app → Settings → dán Soniox API key
2. Chọn source: System Audio hoặc Microphone
3. Bấm Start → Nói/Play tiếng Nhật
4. Xem transcript + translation hiển thị

### 5. Windows-specific UI

- [ ] Font rendering (WebView2 dùng Chromium — nên OK)
- [ ] Always-on-top overlay window
- [ ] Drag to move, resize
- [ ] Settings path: `%APPDATA%\Personal Translator\`

---

## Platform-specific Code

```
src-tauri/src/audio/
├── mod.rs              # #[cfg(target_os)] chọn module
├── system_audio.rs     # macOS only (ScreenCaptureKit)
├── wasapi.rs           # Windows only (WASAPI loopback)
└── microphone.rs       # Cross-platform (cpal)
```

`mod.rs` pattern:
```rust
#[cfg(target_os = "macos")]
pub mod system_audio;

#[cfg(target_os = "windows")]
pub mod wasapi;

pub mod microphone;
```

---

## Không cần làm trên Windows

- ❌ Local/MLX pipeline (`scripts/local_pipeline.py`, `setup_mlx.py`)
- ❌ MLX setup commands (`check_mlx_setup`, `run_mlx_setup`)
- ❌ Python dependencies
- ❌ Apple-specific permissions (TCC)

Các command liên quan MLX đã có `#[cfg]` guard hoặc chỉ dùng khi `translationMode === 'local'`.

---

## Soniox API Key

User tự lấy key tại: https://soniox.com
- Free tier: 10 giờ/tháng
- Model: `stt-rt-preview` (real-time, multi-language)
- Hỗ trợ: transcription + translation đồng thời

---

## Lưu ý quan trọng

1. **WASAPI không cần permission** — khác macOS (cần Screen Recording permission)
2. **Unsigned EXE** — Windows SmartScreen sẽ cảnh báo → user cần "Run anyway"
3. **Code signing** — cần certificate để tránh SmartScreen (tính sau)
4. **PCM format** — Soniox yêu cầu s16le, 16kHz, mono. WASAPI output thường 48kHz stereo → phải convert.

---

## Reference Docs

- `docs/03_implementation_plan.md` — Full architecture
- `docs/windows_port_plan.md` — Detailed Windows port phases
- `docs/01_internal_mechanisms.md` — How TranslaBuddy works (reference)
- `CLAUDE.md` — Agent instructions
- `dev-logs/phase5_polish_build.md` — macOS build lessons

---

## Branch

Windows work nên làm trên branch `main` (hoặc tạo `feature/windows-port`).
Branch `experiment/mlx-whisper` là riêng cho local translation trên macOS.
