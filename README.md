# Personal Translator — Dev Repo

Private development repo for **My Translator**. Public release → [github.com/phuc-nt/my-translator](https://github.com/phuc-nt/my-translator)

## Repo Roles

| Repo | URL | Role |
|------|-----|------|
| **`realtime_pc_translator`** (Private) | `github.com/phuc-nt/realtime_pc_translator` | Development, experiments, internal docs, dev-logs |
| **`my-translator`** (Public) | `github.com/phuc-nt/my-translator` | Release builds, user-facing docs, GitHub Releases |

**Sync rule**: Code flows `private → public`. Never edit code in public repo directly.
**Private-only files**: CLAUDE.md, GEMINI.md, dev-logs/, lessons-learned/, docs/system/, docs/experiment_*

---

## Version History & Roadmap

| Version | Features | Date | Status |
|---------|----------|------|--------|
| v0.1.0 | Soniox Cloud — macOS Apple Silicon | 2026-03 | ✅ Released |
| v0.2.0 | Windows support + UI Polish | 2026-03 | ✅ Released |
| v0.3.0 | Local MLX offline translation (Apple Silicon) | 2026-03-16 | ✅ Released |
| v0.4.0 | TTS narration — ElevenLabs Flash v2.5 | 2026-03-16 | ✅ Released |
| v0.5.0+ | Code signing, UX improvements | TBD | 📋 Backlog |

### Version Strategy

- **Single version number** for all platforms (macOS, Windows)
- Platform-specific features (e.g. Local MLX) are **feature-gated in UI**, not by version
- Soniox Cloud features apply to all platforms
- Local MLX features are Apple Silicon only (auto-hidden on other platforms)

### v0.4.0 — TTS Narration (ElevenLabs Flash v2.5)

- **Read translations aloud** via ElevenLabs WebSocket TTS API
- Voice selector: 2 male + 2 female voices (all verified Vietnamese-capable)
- Toggle with ⌘T shortcut or UI button
- Audio feedback loop prevention via `excludesCurrentProcessAudio`
- Benchmark: TTFB avg 209ms (175–260ms range)
- Works with both Cloud (Soniox) and Local (MLX) translation modes

---

## Platform & Feature Status

| Platform | Audio | Soniox Cloud | Local MLX | Status |
|----------|-------|-------------|-----------|--------|
| macOS Apple Silicon | ScreenCaptureKit | ✅ | ✅ | Released v0.3.0 |
| macOS Intel | ScreenCaptureKit | ✅ | ❌ (no Metal) | Built, chưa test |
| Windows | WASAPI loopback | ✅ | ❌ | Code done, chưa build |

## Quick Dev Setup

```bash
# Prerequisites: Rust (rustup.rs), Node.js 18+
git clone git@github.com:phuc-nt/realtime_pc_translator.git
cd realtime_pc_translator
npm install

# Debug build (nhanh hơn)
npm run tauri build -- --debug

# Release build
npm run tauri build

# Intel cross-compile (từ Apple Silicon)
rustup target add x86_64-apple-darwin
npm run tauri build -- --target x86_64-apple-darwin
```

## Project Structure

```
src/                          # Frontend (WebView)
├── js/
│   ├── app.js                # App controller, mode dispatch, audio orchestration
│   ├── soniox.js             # Soniox WebSocket client (Cloud mode)
│   ├── elevenlabs-tts.js      # ElevenLabs TTS WebSocket client
│   ├── audio-player.js       # AudioContext playback queue for TTS
│   ├── ui.js                 # TranscriptUI — render transcriptions
│   └── settings.js           # Settings panel
├── styles/main.css
└── index.html

src-tauri/                    # Backend (Rust)
├── src/
│   ├── lib.rs                # Tauri app init, platform detection, state management
│   ├── audio/
│   │   ├── mod.rs            # #[cfg] platform routing, resampling
│   │   ├── system_audio.rs   # macOS: ScreenCaptureKit (48kHz → 16kHz)
│   │   ├── wasapi.rs         # Windows: WASAPI loopback
│   │   └── microphone.rs     # Cross-platform (cpal)
│   ├── commands/
│   │   ├── audio.rs          # start_capture / stop_capture
│   │   ├── settings.rs       # get_settings / save_settings
│   │   ├── transcript.rs     # save_transcript / open_transcript_dir
│   │   └── local_pipeline.rs # MLX pipeline: start/stop/send_audio, setup
│   └── settings.rs           # Settings struct + file persistence
└── Cargo.toml

scripts/                      # Python sidecar (Local MLX mode)
├── local_pipeline.py         # Whisper ASR + Gemma translation
└── setup_mlx.py              # One-time venv + model download

docs/
├── system/                   # Backend architecture & benchmarks
├── 01_internal_mechanisms.md  # TranslaBuddy reverse engineering
├── 03_implementation_plan.md  # Original 5-phase plan
└── windows_port_plan.md       # Windows port plan

dev-logs/                     # Progress tracking per phase
lessons-learned/              # Bài học kỹ thuật (permissions, audio, Tauri, MLX)
```

## Architecture

```
Frontend (JS)                    Backend (Rust)
─────────────                    ──────────────
soniox.js    ◄── Tauri IPC ──►  audio/system_audio.rs (macOS)
                                 audio/wasapi.rs (Windows)
app.js ──┐                      audio/microphone.rs
         ├── Tauri IPC ──────►  commands/local_pipeline.rs
settings.js  ◄── Tauri IPC ──►  settings.rs
ui.js                            commands/transcript.rs

elevenlabs-tts.js ─► wss://api.elevenlabs.io (TTS)
audio-player.js   ─► AudioContext → 🔊 Speaker
```

### Two Translation Modes

| Mode | Pipeline | Latency | Quality |
|------|----------|---------|---------|
| **Cloud (Soniox)** | Audio → WebSocket → Soniox API → tokens | ~2-3s real-time | 9/10 |
| **Local (MLX)** | Audio → Rust stdin → Python(Whisper+Gemma) → JSON | ~10.5s | 7/10 |

Details: [docs/system/architecture.md](docs/system/architecture.md)

## Release to Public Repo

### Sync Code

```bash
# 1. Copy source files (không copy internal docs)
cp -r src/ /Users/phucnt/workspace/my-translator/src/
cp -r src-tauri/src/ /Users/phucnt/workspace/my-translator/src-tauri/src/
cp -r scripts/ /Users/phucnt/workspace/my-translator/scripts/
cp src-tauri/tauri.conf.json /Users/phucnt/workspace/my-translator/src-tauri/
cp src-tauri/Cargo.toml /Users/phucnt/workspace/my-translator/src-tauri/
cp package.json /Users/phucnt/workspace/my-translator/

# ⚠️ public repo has different productName ("My Translator" vs "Personal Translator")
# ⚠️ DON'T overwrite tauri.conf.json blindly — check productName, title
```

### Build + Sign + Upload

```bash
cd /Users/phucnt/workspace/my-translator

# Build
npm run tauri build

# Sign (MANDATORY — without this, TCC permissions don't persist)
codesign --force --deep --sign - --entitlements entitlements.plist \
  "src-tauri/target/release/bundle/macos/My Translator.app"

# Create DMG
hdiutil create -volname "My Translator" \
  -srcfolder "src-tauri/target/release/bundle/macos/My Translator.app" \
  -ov -format UDZO /tmp/My.Translator_X.Y.Z_aarch64.dmg

# Upload
gh release create vX.Y.Z /tmp/My.Translator_X.Y.Z_aarch64.dmg \
  --title "vX.Y.Z — Title" --notes "..."
```

### ⚠️ Sync Gotchas

| Item | Private repo | Public repo |
|------|-------------|-------------|
| Product name | `Personal Translator` | `My Translator` |
| tauri.conf.json | Don't copy blindly | Has different productName/title |
| App Support path | `~/Library/Application Support/Personal Translator/` | Same (via bundle ID) |
| Bundle ID | `com.personal.translator` | Same |
| Internal docs | ✅ Included | ❌ Not synced |

**Không sync sang public:** CLAUDE.md, GEMINI.md, dev-logs/, lessons-learned/, docs/system/, docs/experiment_*

## Key References

- [CLAUDE.md](CLAUDE.md) / [GEMINI.md](GEMINI.md) — Agent instructions
- [docs/system/architecture.md](docs/system/architecture.md) — Backend architecture
- [docs/system/benchmark.md](docs/system/benchmark.md) — Performance data
- [lessons-learned/](lessons-learned/) — Deployment gotchas, best practices
- [dev-logs/](dev-logs/) — Phase-by-phase progress
- [Soniox API docs](https://soniox.com/docs)
- [Tauri 2 docs](https://tauri.app/start/)
