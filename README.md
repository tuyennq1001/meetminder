<p align="center">
  <img src="banner.png?v=2" alt="My Translator — Real-time Speech Translation">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple" alt="macOS">
  <img src="https://img.shields.io/badge/Windows-10%2F11-blue?logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/github/stars/phuc-nt/my-translator?style=social" alt="Stars">
</p>

Real-time speech translation app. Capture any audio on your computer — YouTube, Zoom, podcasts — and see translations instantly. Optional TTS narration reads translations aloud.

> 📥 **[Download Latest Release](https://github.com/phuc-nt/my-translator/releases/tag/v0.4.0)**

> 📖 **Installation Guides:**
> [macOS (English)](docs/installation_guide.md) · [macOS (Tiếng Việt)](docs/installation_guide_vi.md) · [Windows (English)](docs/installation_guide_win.md) · [Windows (Tiếng Việt)](docs/installation_guide_win_vi.md)

## Features

- 🎧 **Real-time transcription & translation** — Soniox STT (Cloud, 70+ languages) or Whisper + Gemma (Local, offline)
- 🔊 **TTS narration** — translations read aloud via ElevenLabs (optional)
- 🖥️ **System audio + Microphone** — translate any audio source
- 👥 **Multi-speaker detection** — labels different speakers automatically
- 🪟 **Overlay UI** — minimal, always-on-top, draggable & resizable
- 📌 **Pin / Minimize / Compact mode** — control visibility as needed
- 📋 **Auto-save transcripts** — `.md` files saved per session with metadata

### Cloud vs Local

| | ☁️ Cloud (Soniox) | 🖥️ Local (MLX) |
|-|-------------------|----------------|
| **Speed** | Real-time (~2s) | ~10s delay |
| **Languages** | 70+ | JA/EN/ZH/KO → VI/EN |
| **Cost** | ~$0.12/hr | Free |
| **Internet** | Required | Not needed |
| **Platform** | All | Apple Silicon only |

## Privacy

🔒 **Your data stays yours.**

- **No backend server** — connects directly to APIs with your own keys
- **No telemetry, no analytics** — zero tracking, zero data collection
- **API keys stored locally** — never leave your machine
- **Transcripts stored locally** — `.md` files on your disk, not uploaded anywhere
- **Fully open-source** — read every line of code

## How It Works

```
Audio Source → PCM 16kHz → Soniox STT → Translation → Overlay UI
                                                        ↓ (optional)
                                              ElevenLabs TTS → 🔊
```

## Build from Source

```bash
git clone https://github.com/phuc-nt/my-translator.git
cd my-translator
npm install
npm run tauri build
```

Requires: macOS 13+ (Apple Silicon) or Windows 10+, [Rust](https://rustup.rs/), [Node.js](https://nodejs.org/) 18+

## Tech Stack

[Tauri 2](https://tauri.app/) · [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit) · [WASAPI](https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi) · [Soniox](https://soniox.com) · [ElevenLabs](https://elevenlabs.io) · [MLX](https://github.com/ml-explore/mlx) · [Whisper](https://github.com/openai/whisper) · [Gemma](https://ai.google.dev/gemma) · Vanilla HTML/CSS/JS

## Roadmap

- [x] macOS Apple Silicon
- [x] Windows x64
- [x] Local offline translation (MLX)
- [x] TTS narration (ElevenLabs)
- [ ] Apple code signing & notarization
- [ ] Windows code signing

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=phuc-nt/my-translator&type=Date)](https://star-history.com/#phuc-nt/my-translator&Date)

## License

MIT
