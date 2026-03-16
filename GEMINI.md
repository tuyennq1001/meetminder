# GEMINI.md — Coding Agent Instructions

## Project Overview

Building a **personal real-time speech translator** for macOS and Windows. Direct connection to Soniox API with the user's own key — no proxy, no tracking.

## Key Documents (READ FIRST)

1. **[docs/03_implementation_plan.md](docs/03_implementation_plan.md)** — Full implementation plan
2. **[docs/windows_handoff.md](docs/windows_handoff.md)** — Windows port guide (START HERE if on Windows)
3. **[docs/windows_port_plan.md](docs/windows_port_plan.md)** — Detailed Windows port phases
4. **[docs/01_internal_mechanisms.md](docs/01_internal_mechanisms.md)** — Reference architecture
5. **[dev-logs/](dev-logs/)** — Progress tracking per phase

## Platform Support

| Platform | Audio | Translation | Status |
|----------|-------|-------------|--------|
| **macOS Apple Silicon** | ScreenCaptureKit | Soniox API + Local MLX | ✅ Released |
| **Windows** | WASAPI loopback | **Soniox API only** | 🔧 Code written, needs build & test |

> **Windows chỉ cần Soniox API** — không cần local/MLX pipeline.

## Tech Stack

- **Tauri 2** (Rust backend + WebView frontend)
- **Rust**: `screencapturekit` (macOS), `wasapi` (Windows), `cpal` (microphone)
- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **API**: Soniox WebSocket (`wss://stt-rt.soniox.com/transcribe-websocket`)

## Architecture

```
Frontend (JS)                    Backend (Rust)
─────────────                    ──────────────
soniox.js    ◄── Tauri IPC ──►  audio/system_audio.rs (macOS)
ui.js                            audio/wasapi.rs (Windows)
settings.js  ◄── Tauri IPC ──►  audio/microphone.rs (cross-platform)
app.js                           commands/
```

**NO server backend. NO auth. NO tracking. Direct Soniox connection only.**

## Design Principles

1. **Minimal** — capture audio → transcribe → translate → display
2. **Direct** — Client talks to Soniox directly, no proxy
3. **Transparent** — User provides their own API key
4. **Clean** — No telemetry, no analytics, no hidden controls

## 🚨 Security: NEVER Hardcode API Keys

- **NEVER** put real API keys, tokens, or secrets in any source file, script, or config
- This includes test scripts, benchmark scripts, and one-off utilities
- Use environment variables instead: `os.environ.get("KEY_NAME", "YOUR_KEY_HERE")`
- Always scan files before syncing to public repo: `grep -r "sk_\|sk-\|api_key.*=" --include="*.py" --include="*.rs" --include="*.js"`
- **Lesson learned**: An ElevenLabs API key was accidentally committed to the public repo via `scripts/test_tts_latency.py`. Even after removal, keys persist in git history forever.

## Audio Capture (Platform-specific)

### macOS
- System audio: ScreenCaptureKit (requires Screen Recording permission)
- Microphone: cpal (requires Microphone permission)
- Output: PCM s16le, 16kHz, mono (downsampled from 48kHz)

### Windows
- System audio: WASAPI loopback (no special permission needed)
- Microphone: cpal (WASAPI backend)
- Output: PCM s16le, 16kHz, mono (downsample from 44.1/48kHz)
- Code: `src-tauri/src/audio/wasapi.rs` — written but untested

## Soniox WebSocket Protocol

- Endpoint: `wss://stt-rt.soniox.com/transcribe-websocket`
- First message: JSON config (api_key, model, audio_format, translation, etc.)
- Audio: Binary frames (PCM s16le, 16kHz, mono)
- Response: JSON with tokens array ({text, is_final, confidence, speaker})
- Close: Send empty frame for graceful disconnect

## Branches

- `main` — Production code (Soniox API, cross-platform)
- `experiment/mlx-whisper` — Local MLX translation (macOS only, experimental)

## Windows Agent TODO

If you are working on Windows, read `docs/windows_handoff.md` first. Summary:

1. Setup build env (Rust + Node.js + VS Build Tools)
2. `npm install && npm run tauri build`
3. Test WASAPI system audio capture
4. Test Soniox end-to-end flow
5. Fix any Windows-specific UI issues

## DevOps Rules (MUST FOLLOW)

### Build & Install App (macOS)

**ALWAYS follow this exact sequence** — partial steps cause stale builds:

```bash
# 1. Kill running app
pkill -f "Personal Translator" 2>/dev/null
pkill -f "personal-translator" 2>/dev/null
sleep 1

# 2. Remove old app COMPLETELY (caching issues otherwise)
rm -rf "/Applications/Personal Translator.app"

# 3. Build
npm run tauri build

# 4. Copy new app to /Applications
cp -R src-tauri/target/release/bundle/macos/Personal\ Translator.app /Applications/

# 5. Copy Python scripts (for local MLX pipeline)
mkdir -p "/Applications/Personal Translator.app/Contents/Resources/scripts"
cp scripts/*.py "/Applications/Personal Translator.app/Contents/Resources/scripts/"

# 6. Open
open "/Applications/Personal Translator.app"
```

> **IMPORTANT**: Step 2 (rm -rf old app) is critical. Without it, macOS may cache old frontend assets (JS/CSS/HTML) and changes won't take effect.

### One-liner for quick rebuild:
```bash
pkill -f "Personal Translator" 2>/dev/null; pkill -f "personal-translator" 2>/dev/null; sleep 1 && rm -rf "/Applications/Personal Translator.app" && npm run tauri build 2>&1 | tail -3 && cp -R src-tauri/target/release/bundle/macos/Personal\ Translator.app /Applications/ && mkdir -p "/Applications/Personal Translator.app/Contents/Resources/scripts" && cp scripts/*.py "/Applications/Personal Translator.app/Contents/Resources/scripts/" && open "/Applications/Personal Translator.app"
```

### Tauri UI Drag Region Rules

- **DO NOT** put `data-tauri-drag-region` on parent elements that contain buttons — it consumes click events
- For drag in overlay: use `data-tauri-drag-region` on empty areas only (transcript container, status area)
- For drag in settings: use manual `appWindow.startDragging()` on mousedown, excluding interactive elements
- See Tauri docs: https://v2.tauri.app/learn/window-customization/

### Branch Strategy

- `main` — Stable, published version. **DO NOT** experiment on main.
- `ui/shared-header` — Current UI development branch
- `experiment/mlx-whisper` — Local MLX experiments
- Always create a new branch for risky changes
