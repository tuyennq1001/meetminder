<p align="center">
  <img src="banner.png?v=2" alt="My Translator — Real-time Speech Translation">
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/phuc-nt/my-translator?color=green&label=release" alt="Latest Release">
  <img src="https://img.shields.io/badge/built_with-Tauri-orange?logo=tauri" alt="Built with Tauri">
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-black?logo=apple" alt="macOS">
  <img src="https://img.shields.io/badge/Windows-10%2F11-blue?logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/github/stars/phuc-nt/my-translator?style=flat&color=yellow" alt="Stars">
</p>

**My Translator** is a real-time speech translation desktop app built with Tauri. It captures audio directly from your system or microphone, transcribes it, and displays translations in a minimal overlay — with no intermediary server involved.

> 📖 Installation guides: [macOS (EN)](docs/installation_guide.md) · [macOS (VI)](docs/installation_guide_vi.md) · [Windows (EN)](docs/installation_guide_win.md) · [Windows (VI)](docs/installation_guide_win_vi.md)

---

## How It Works

```
System Audio / Mic → 16kHz PCM → Soniox API (STT + Translation) → Overlay UI
                                                                    ↓ (optional)
                                                                Edge TTS → 🔊
```

| Feature | Detail |
|---------|--------|
| **Latency** | ~2–3s |
| **Languages** | 70+ (source) → any target |
| **Cost** | ~$0.12/hr (Soniox API) |
| **TTS** | Free (Edge TTS, default) |
| **Platform** | macOS (ARM + Intel) · Windows |

---

## Features

### 🎙️ TTS Narration (Free)

Read translations aloud — **no API key needed** for the default provider:

| | Edge TTS ⭐ | ElevenLabs |
|-|-------------|------------|
| **Cost** | Free | Paid |
| **Quality** | ★★★★★ Neural | ★★★★★ Premium |
| **Vietnamese** | ✅ HoaiMy, NamMinh | ✅ Yes |
| **Setup** | None | API key required |

Speed adjustable from −50% to +100% (default +50%).

> 📖 TTS guide: [English](docs/tts_guide.md) · [Tiếng Việt](docs/tts_guide_vi.md)

### 📖 Custom Translation Terms

Define how domain-specific words should be translated:

```
Original sin = Tội nguyên tổ
Christ = Kitô
Pneumonia = Viêm phổi
```

Add terms in Settings → Translation → Translation terms. Great for religious, medical, or technical content.

### 🖥️ Local Mode (Apple Silicon only)

Experimental offline mode using MLX + Whisper + Gemma — runs 100% on-device. JA/EN/ZH/KO → VI/EN.

---

## Privacy

**Your audio never touches our servers — because there are none.**

- App connects **directly** to APIs you configure — no relay, no middleman
- **You own your API keys** — stored locally, never transmitted elsewhere
- **No account, no telemetry, no analytics** — zero tracking
- Transcripts saved as `.md` files locally, per session

---

## Tech Stack

- **[Tauri 2](https://tauri.app/)** — Rust backend + WebView frontend
- **[ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)** — macOS system audio
- **[WASAPI](https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi)** — Windows system audio
- **[cpal](https://github.com/RustAudio/cpal)** — Cross-platform microphone
- **[Soniox](https://soniox.com)** — Real-time STT + translation
- **[Edge TTS](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/index-text-to-speech)** — Free neural TTS (default)
- **[ElevenLabs](https://elevenlabs.io)** — Premium TTS

---

## Build from Source

```bash
git clone https://github.com/phuc-nt/my-translator.git
cd my-translator
npm install
npm run tauri build
```

Requires: Rust (stable), Node.js 18+, macOS 13+ or Windows 10+.

---

## Star History

<a href="https://www.star-history.com/?repos=phuc-nt%2Fmy-translator&type=date&legend=top-left">
 <picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=phuc-nt/my-translator&type=date&theme=dark&legend=top-left" />
  <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=phuc-nt/my-translator&type=date&legend=top-left" />
  <img alt="Star History Chart" src="https://api.star-history.com/image?repos=phuc-nt/my-translator&type=date&legend=top-left" />
 </picture>
</a>

---

## License

MIT
