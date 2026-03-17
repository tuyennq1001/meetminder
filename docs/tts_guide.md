# TTS (Text-to-Speech) Guide

My Translator can **read translations aloud** as they appear — like having a personal interpreter. Two providers available:

| | Edge TTS ⭐ | ElevenLabs |
|-|-------------|------------|
| **Cost** | Free | Paid (~$5/mo+) |
| **Quality** | Natural, clear | Very natural, expressive |
| **Vietnamese** | ✅ HoaiMy (F), NamMinh (M) | ✅ Yes |
| **Setup** | None — works out of the box | Sign up + API key |
| **Internet** | Required | Required |

---

## Edge TTS (Default — Free)

### What is Edge TTS?

Edge TTS uses the same neural speech engine behind Microsoft Edge's **"Read Aloud"** feature. When you click "Read Aloud" on a webpage in Edge, the browser sends text to Microsoft's servers and gets back high-quality neural audio.

My Translator connects to **the same service** to read translations.

### Why is it free?

Microsoft provides Edge TTS for free because it's **part of the Edge/Windows ecosystem**, not a standalone paid product:

- **Primary purpose**: Enhance Edge user experience — read articles, books, accessibility
- **No API key**: No account or registration — anyone can use it
- **No explicit limits**: Microsoft doesn't publish rate limits for this endpoint
- **Business strategy**: Microsoft profits indirectly through ecosystem retention (Edge, Windows, Bing)

> ⚠️ This is a free service for personal use. Microsoft may change policies anytime, but it has been stable to date.

### Available voices

| Voice | Language | Gender |
|-------|----------|--------|
| HoaiMy | Vietnamese 🇻🇳 | Female |
| NamMinh | Vietnamese 🇻🇳 | Male |
| Jenny | English 🇺🇸 | Female |
| Guy | English 🇺🇸 | Male |
| Nanami | Japanese 🇯🇵 | Female |
| SunHi | Korean 🇰🇷 | Female |
| Xiaoxiao | Chinese 🇨🇳 | Female |

### Speed

Adjust in Settings → TTS → Speed. Default **+50%** (faster than normal speech).

---

## ElevenLabs (Paid)

### What is ElevenLabs?

ElevenLabs specializes in **AI voice technology**, known for extremely natural voices with rich emotion and intonation. It's a paid service requiring an API key.

### Edge TTS vs ElevenLabs

| | Edge TTS | ElevenLabs |
|-|----------|-----------|
| **Intonation** | Good, consistent | Expressive, nuanced |
| **Vietnamese** | Clear, natural | Very natural, less robotic |
| **Customization** | Voice + speed | Voice + voice cloning |
| **Price** | $0 | ~$5–$22/month |
| **Best for** | Most users | Highest quality needs |

**In short**: Edge TTS is great for 90% of use cases. ElevenLabs is for when you need the most lifelike voices or voice cloning.

### Setup

1. Sign up at [elevenlabs.io](https://elevenlabs.io)
2. Get your API key from the Dashboard
3. In app: Settings → TTS → select **ElevenLabs** → paste API key

---

## Troubleshooting

- **No sound?** Check 🔊 button is active and system volume.
- **Edge TTS not working?** Check internet connection.
- **TTS voice getting re-transcribed?** Lower TTS volume or pause transcription while reading.
