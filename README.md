<p align="center">
  <img src="banner.png?v=2" alt="My Translator — Real-time Speech Translation">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple" alt="macOS">
  <img src="https://img.shields.io/badge/Windows-10%2F11-blue?logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
</p>

> 📖 **[Installation Guide — macOS (English)](docs/installation_guide.md)**<br>
> 📖 **[Hướng dẫn cài đặt — macOS (Tiếng Việt)](docs/installation_guide_vi.md)**<br>
> 📖 **[Installation Guide — Windows](docs/installation_guide_win.md)**<br>
> 📖 **[Hướng dẫn cài đặt — Windows (Tiếng Việt)](docs/installation_guide_win_vi.md)**

## Features

- **Real-time transcription & translation** — powered by Soniox STT v4 (Cloud) or Whisper + Gemma (Local)
- **Two modes**: ☁️ Cloud (real-time, 70+ languages) or 🖥️ Local (offline, free, Apple Silicon)
- **System audio capture** — translate any audio playing on your computer (YouTube, meetings, podcasts)
- **Microphone input** — translate live speech
- **Multi-speaker detection** — labels different speakers automatically (Cloud mode)
- **Overlay UI** — minimal, always-on-top dark overlay window
- **No server, no tracking** — connects directly to Soniox or runs 100% on-device
- **Smart transcript save** — auto-saves `.md` files with metadata on Stop/Clear/Close
- **Copy & export** — copy transcript to clipboard, open saved files folder
- **Cross-platform** — macOS (Apple Silicon) and Windows (x64 + ARM64)

### Cloud vs Local Mode

| | ☁️ Cloud (Soniox) | 🖥️ Local (MLX) |
|-|-------------------|----------------|
| **Latency** | Real-time (~2-3s) | ~10s delay |
| **Quality** | 9/10 | 7/10 |
| **Cost** | ~$0.12/hr | Free |
| **Internet** | Required | Not needed |
| **Languages** | 70+ | JA/EN/ZH/KO → VI/EN |
| **Privacy** | Cloud API | 100% on-device |
| **Platform** | All | Apple Silicon only |

## Quick Start

### 1. Download & Install

1. Download the latest `.dmg` from the [macOS Releases](https://github.com/phuc-nt/my-translator/releases/tag/v0.3.0) (or [Windows Releases](https://github.com/phuc-nt/my-translator/releases/tag/v0.2.0-windows))
2. Open the `.dmg` and drag **My Translator** to Applications
3. **Important** — the app is not yet signed with an Apple Developer certificate (pending enrollment approval). macOS will block it on first open. Run this command **once** in Terminal to allow it:

```bash
xattr -cr /Applications/My\ Translator.app
```

> This step will no longer be needed once code signing is in place.

4. Open **My Translator** from Applications

### 2. Configure

1. Open **My Translator**
2. Click the ⚙️ gear icon (or press `⌘ ,`)
3. Choose **Translation Engine**:
   - **☁️ Soniox API (Cloud)** — paste your API key from [soniox.com](https://soniox.com) (~$0.12/hr)
   - **🖥️ Local MLX (Offline)** — free, no API key needed (Apple Silicon only, ~5GB one-time download)
4. Set your **source language** and **target language**
5. Click **Save**

### 3. Start Translating

1. Click ▶ (or press `⌘ Enter`) to start
2. Play any audio on your Mac — translations appear in real-time
3. Click ■ to stop

## Permissions

On first launch, macOS will ask for:

| Permission | Why | Where to enable |
|-----------|-----|-----------------|
| **Screen & System Audio Recording** | Capture system audio | System Settings → Privacy → Screen & System Audio Recording |
| **Microphone** *(optional)* | Capture mic input | System Settings → Privacy → Microphone |

> **Note:** After granting permissions, you may need to quit (⌘Q) and reopen the app.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘ Enter` | Start / Stop |
| `⌘ ,` | Open Settings |
| `Esc` | Close Settings |
| `⌘ 1` | System Audio mode |
| `⌘ 2` | Microphone mode |

## How It Works

### Cloud Mode (Soniox)
```
System Audio → 48kHz→16kHz PCM → Soniox WebSocket → STT + Translation → Overlay UI
```

### Local Mode (MLX — Apple Silicon)
```
System Audio → 48kHz→16kHz PCM → Whisper ASR → Gemma Translation → Overlay UI
                                   (on-device)    (on-device)
```

## Build from Source

### Prerequisites

- macOS 13+ (Apple Silicon)
- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) 18+

### Build

```bash
git clone https://github.com/phuc-nt/my-translator.git
cd my-translator
npm install
npm run tauri build
```

The app bundle is at `src-tauri/target/release/bundle/macos/My Translator.app`.

## Tech Stack

- **[Tauri 2](https://tauri.app/)** — Rust backend + WebView frontend
- **[ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)** — macOS system audio capture
- **[cpal](https://github.com/RustAudio/cpal)** — Cross-platform microphone input
- **[Soniox](https://soniox.com)** — Real-time speech-to-text + translation API (Cloud mode)
- **[MLX](https://github.com/ml-explore/mlx)** — Apple's ML framework for on-device inference (Local mode)
- **[Whisper](https://github.com/openai/whisper)** — Speech recognition model (Local mode)
- **[Gemma](https://ai.google.dev/gemma)** — Translation LLM (Local mode)
- **Vanilla HTML/CSS/JS** — Lightweight frontend, no framework

## Privacy

- **No backend server** — the app connects directly to Soniox
- **No telemetry or analytics** — zero tracking
- **No account required** — just your Soniox API key
- **API key stored locally** — never leaves your machine
- **Transcripts stored locally** — `.md` files saved per session on your disk

## Roadmap

- [x] macOS Apple Silicon support
- [x] Windows support
- [x] Local offline translation (MLX — Apple Silicon)
- [ ] macOS Intel support
- [ ] Apple code signing & notarization
- [ ] Windows code signing

## License

MIT
