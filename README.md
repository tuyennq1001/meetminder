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

- **Real-time transcription & translation** — powered by Soniox STT v4
- **System audio capture** — translate any audio playing on your Mac (YouTube, meetings, podcasts)
- **Microphone input** — translate live speech (requires external mic on Mac Mini)
- **Multi-speaker detection** — labels different speakers automatically
- **70+ languages** — translate between any languages supported by Soniox
- **Overlay UI** — minimal, always-on-top dark overlay window
- **No server, no tracking** — connects directly to Soniox. Your audio never touches a middleman
- **Transcript persistence** — translations are saved locally as daily text files
- **Seamless session management** — auto-resets every 3 minutes to maintain speed

## Quick Start

### 1. Download & Install

1. Download the latest `.dmg` from the [macOS Releases](https://github.com/phuc-nt/my-translator/releases/tag/v0.1.0) (or [Windows Releases](https://github.com/phuc-nt/my-translator/releases/tag/v0.1.0-windows))
2. Open the `.dmg` and drag **My Translator** to Applications
3. **Important** — the app is not yet signed with an Apple Developer certificate (pending enrollment approval). macOS will block it on first open. Run this command **once** in Terminal to allow it:

```bash
xattr -cr /Applications/My\ Translator.app
```

> This step will no longer be needed once code signing is in place.

4. Open **My Translator** from Applications

### 2. Get a Soniox API Key

1. Create an account at [soniox.com](https://soniox.com) (pay-per-use, ~$0.12/hour)
2. Go to your [Dashboard](https://soniox.com/dashboard) → copy your API key

### 3. Configure

1. Open **My Translator**
2. Click the ⚙️ gear icon (or press `⌘ ,`)
3. Paste your Soniox API key
4. Set your **source language** and **target language**
5. Click **Save**

### 4. Start Translating

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

```
System Audio (ScreenCaptureKit)
        │
        ▼
   48kHz → 16kHz PCM
        │
        ▼
   Soniox WebSocket ──► STT + Translation
        │
        ▼
   Overlay UI (real-time)
```

1. **Audio Capture**: ScreenCaptureKit captures system audio at 48kHz, downsampled to 16kHz PCM mono
2. **Batched Streaming**: Audio is batched every 200ms and streamed via WebSocket to Soniox
3. **Real-time Results**: Soniox returns transcription + translation tokens in real-time
4. **Display**: Translations appear instantly in the overlay window

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
- **[Soniox](https://soniox.com)** — Real-time speech-to-text + translation API
- **Vanilla HTML/CSS/JS** — Lightweight frontend, no framework

## Privacy

- **No backend server** — the app connects directly to Soniox
- **No telemetry or analytics** — zero tracking
- **No account required** — just your Soniox API key
- **API key stored locally** — never leaves your machine
- **Transcripts stored locally** — daily `.txt` files on your disk

## Roadmap

- [x] macOS Apple Silicon support
- [x] Windows support
- [ ] macOS Intel support
- [ ] Apple code signing & notarization
- [ ] Windows code signing

## License

MIT
