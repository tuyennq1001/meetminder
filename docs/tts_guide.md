# Text-to-Speech (TTS) Guide

My Translator supports **3 TTS providers** to read translations aloud. This guide explains how each one works and helps you choose the best option.

---

## Quick Comparison

| | Edge TTS ⭐ | Web Speech | ElevenLabs |
|---|---|---|---|
| **Cost** | Free | Free | Paid (API key) |
| **Quality** | ★★★★★ Natural, neural | ★★★ Robotic | ★★★★★ Premium |
| **Vietnamese** | ✅ Built-in (HoaiMy, NamMinh) | ⚠️ Depends on OS | ✅ Yes |
| **Internet** | Required | Not required | Required |
| **API Key** | Not needed | Not needed | Required |
| **Setup** | None — works out of the box | May need setup on Windows | Sign up at elevenlabs.io |

> **Recommendation**: Use **Edge TTS** (default). It's free, sounds natural, and works on all platforms without any setup.

---

## Edge TTS (Default — Recommended)

### How it works

Edge TTS uses the same text-to-speech engine that powers the **"Read Aloud"** feature in Microsoft Edge browser. The app connects directly to Microsoft's speech service and receives high-quality neural audio.

```
Your text → Microsoft Speech Service (cloud) → Natural audio playback
```

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

### Speed control

Adjust speed from **-50%** (slower) to **+100%** (2x faster) in Settings → TTS tab.  
Default: **+30%** — slightly faster than normal speaking speed.

### Notes
- Requires internet connection
- No API key or account needed
- Works identically on **macOS and Windows**
- Free with no usage limits for personal use

---

## Web Speech API

### How it works

Web Speech uses the **voices installed on your operating system**. The browser's built-in speech synthesis reads the text using local TTS engines.

```
Your text → OS speech engine (local) → Audio playback
```

### ⚠️ Important: Windows Users

**Windows does not include Vietnamese voices by default.** If you select Web Speech and your system doesn't have a Vietnamese voice installed, it will fall back to an English voice (like David or Zira). This means:

- Vietnamese text will be read with an **English accent** — sounds unnatural
- The English pronunciation may be re-captured by the app, causing a **feedback loop**

#### How to install Vietnamese voice on Windows

1. Open **Settings** → **Time & Language** → **Language & region**
2. Click **Add a language**
3. Search for **Tiếng Việt** (Vietnamese) and install it
4. Go to **Settings** → **Time & Language** → **Speech**
5. Under **Manage voices**, click **Add voices**
6. Find **Vietnamese** and click **Add**
7. Wait for the download to complete
8. **Restart My Translator**

> After installation, the Vietnamese voice should appear automatically in the app.

### macOS Users

macOS includes Vietnamese voices by default. No additional setup is needed.

### When to use Web Speech
- ✅ You need **offline** TTS (no internet)
- ✅ You're on macOS (voices built-in)
- ❌ Not recommended on Windows without Vietnamese voice installed

---

## ElevenLabs (Premium)

### How it works

ElevenLabs is a premium AI voice service that produces extremely natural-sounding speech. It requires a paid API key.

```
Your text → ElevenLabs API (cloud) → Premium audio playback
```

### Setup

1. Sign up at [elevenlabs.io](https://elevenlabs.io)
2. Get your API key from the dashboard
3. In My Translator: Settings → TTS tab → select **ElevenLabs**
4. Paste your API key
5. Choose a voice

### When to use ElevenLabs
- ✅ You want the **highest quality** voices
- ✅ You need **custom voices** or voice cloning
- ❌ Not free — charges per character

---

## Troubleshooting

### No sound when TTS is enabled
1. Check that TTS is turned on (🔊 button in the overlay should be active)
2. Check your system volume
3. Try switching to a different TTS provider in Settings

### Vietnamese text is read in English accent
- **Most likely cause**: You're using Web Speech on Windows without Vietnamese voice installed
- **Fix**: Switch to **Edge TTS** (recommended) or install Vietnamese voice (see instructions above)

### Edge TTS not working
- Check your internet connection — Edge TTS requires internet
- Try restarting the app
- If the issue persists, switch to Web Speech as a fallback

### Audio feedback loop (TTS voice is re-transcribed)
- This can happen on **Windows** when system audio capture picks up the TTS audio
- **Workaround**: Lower the TTS volume, or pause transcription while TTS is reading

---

## Summary

For most users, **Edge TTS is the best choice** — it's free, sounds natural, supports Vietnamese out of the box, and requires zero setup. Just enable TTS and start listening! 🎙️
