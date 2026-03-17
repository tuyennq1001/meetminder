<p align="center">
  <img src="banner.png?v=2" alt="My Translator — Real-time Speech Translation">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple" alt="macOS">
  <img src="https://img.shields.io/badge/Windows-10%2F11-blue?logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/github/stars/phuc-nt/my-translator?style=flat&color=yellow" alt="Stars">
</p>

**My Translator** is a real-time speech translation desktop app built with Tauri. It captures audio directly from your system or microphone, transcribes it, and displays translations in a minimal overlay — with no intermediary server involved.

> 📖 Installation & usage guides: [macOS (EN)](docs/installation_guide.md) · [macOS (VI)](docs/installation_guide_vi.md) · [Windows (EN)](docs/installation_guide_win.md) · [Windows (VI)](docs/installation_guide_win_vi.md)

---

## How It Works

The app operates in two modes, both following the same pipeline:

**☁️ Cloud Mode (Soniox)**
```
System Audio / Mic → 48kHz → 16kHz PCM → Soniox WebSocket (STT + Translation) → Overlay UI
                                                                                  ↓ (optional)
                                                                       ElevenLabs TTS → 🔊
```

**🖥️ Local Mode (MLX — Apple Silicon only)**
```
System Audio / Mic → 48kHz → 16kHz PCM → Whisper ASR → Gemma LLM → Overlay UI
                                           (on-device)   (on-device)  ↓ (optional)
                                                              ElevenLabs TTS → 🔊
```

| | ☁️ Cloud (Soniox) | 🖥️ Local (MLX) |
|-|-------------------|----------------|
| **Latency** | ~2–3s | ~10s |
| **Languages** | 70+ | JA/EN/ZH/KO → VI/EN |
| **Cost** | ~$0.12/hr | Free |
| **Internet** | Required | Not needed |
| **Platform** | All | Apple Silicon only |

---

## Privacy

**Your audio never touches our servers — because there are none.**

- The app connects **directly** to the APIs you configure (Soniox, ElevenLabs) — no relay, no middleman
- **You own your API keys** — stored locally on your machine, never transmitted elsewhere
- **No account, no telemetry, no analytics** — zero tracking of any kind
- In Local mode: everything runs **100% on-device**, nothing leaves your machine
- Transcripts are saved as `.md` files locally, per session

---

## Tech Stack

- **[Tauri 2](https://tauri.app/)** — Rust backend + WebView frontend
- **[ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)** — macOS system audio capture
- **[cpal](https://github.com/RustAudio/cpal)** — Cross-platform microphone input
- **[Soniox](https://soniox.com)** — Real-time STT + translation (Cloud mode)
- **[MLX](https://github.com/ml-explore/mlx) + [Whisper](https://github.com/openai/whisper) + [Gemma](https://ai.google.dev/gemma)** — On-device inference (Local mode)
- **[ElevenLabs](https://elevenlabs.io)** — TTS narration (optional)

---

## Build from Source

```bash
git clone https://github.com/phuc-nt/my-translator.git
cd my-translator
npm install
npm run tauri build
```

Requires: Rust (stable), Node.js 18+, macOS 13+ (Apple Silicon).

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=phuc-nt/my-translator&type=Date)](https://star-history.com/#phuc-nt/my-translator&Date)

---

## License

MIT
