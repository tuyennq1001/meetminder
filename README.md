# Meet Minder

<p align="center">
  <img src="banner.png?v=3" alt="Meet Minder — Real-time Speech Translation">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/built_with-Tauri-orange?logo=tauri" alt="Built with Tauri">
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-black?logo=apple" alt="macOS">
  <img src="https://img.shields.io/badge/Windows-10%2F11-blue?logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
</p>

Meet Minder is a privacy-first desktop companion for multilingual meetings, calls, videos, and presentations. It captures system audio and/or microphone input, transcribes speech, translates it in real time, and shows the result in a focused overlay.

Audio goes directly from Meet Minder to the provider you configure. There is no intermediary Meet Minder server, account, telemetry, or analytics.

## Download

Download the latest release from [GitHub Releases](https://github.com/phuc-nt/my-translator/releases/latest).

| Platform | Installer |
| --- | --- |
| macOS Apple Silicon | `MeetMinder_<version>_aarch64.dmg` |
| macOS Intel | `MeetMinder_<version>_x64.dmg` |
| Windows 10/11 | `MeetMinder_<version>_x64-setup.exe` |

On macOS, choose `aarch64` for an Apple M-series chip and `x64` for an Intel chip. The updater files (`.sig`, `.app.tar.gz`, and `latest.json`) are used internally by the app.

Installation guides: [macOS English](docs/installation_guide.md) · [macOS Tiếng Việt](docs/installation_guide_vi.md) · [Windows English](docs/installation_guide_win.md) · [Windows Tiếng Việt](docs/installation_guide_win_vi.md)

## What Meet Minder does

```text
System audio / microphone
          │
          ├── Soniox real-time speech translation
          ├── OpenAI Realtime Translate (text + voice)
          ├── Qwen LiveTranslate Flash (text)
          └── Local MLX pipeline (offline, Apple Silicon)
                         │
                         ▼
                 Meet Minder overlay
                         │
                         └── Optional TTS narration
```

### Translation engines

- Soniox: fast cloud transcription and translation with broad language coverage.
- OpenAI Realtime Translate: streaming translated text and speech from one connection.
- Qwen LiveTranslate Flash: text-only real-time translation on the free preview tier.
- Local MLX: experimental offline transcription and translation on Apple Silicon.

### Meeting-focused features

- Single or dual-panel view for translation-only or source-plus-translation display.
- Smart scrolling that preserves your place while you review earlier lines.
- Adjustable text size up to 140px for rooms and presentations.
- One-way and two-way translation for bilingual conversations.
- Optional narration through Edge TTS, Google Cloud TTS, or ElevenLabs.
- Custom translation terms for names, technical vocabulary, medical content, and more.
- Session transcripts saved locally as Markdown files.
- Built-in update checking from Settings.

For TTS configuration, see the [English guide](docs/tts_guide.md) or [Vietnamese guide](docs/tts_guide_vi.md).

## Privacy and data

- Meet Minder does not provide a relay server; API calls go directly to your selected provider.
- API keys are stored locally on your computer.
- Transcripts and session data remain local unless a configured provider receives audio for processing.
- Microphone and system-audio access are requested only for the features that need them.

Review each provider's terms and retention policy before enabling a cloud engine.

## Build from source

Requirements: Rust stable, Node.js 18+, and macOS 13+ or Windows 10+.

```bash
git clone https://github.com/phuc-nt/my-translator.git
cd my-translator
npm install
npm run tauri build
```

For development:

```bash
npm run dev
```

Useful checks:

```bash
npm run lint
npm run format
```

## Technology

Meet Minder uses Tauri 2, Rust, a WebView frontend, ScreenCaptureKit on macOS, WASAPI on Windows, `cpal` for microphone capture, and provider-specific WebSocket/HTTP clients. Local speech features use MLX, Whisper, Gemma, Piper, and sherpa-onnx.

## License

MIT. See [LICENSE](LICENSE).
