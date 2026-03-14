# Installation Guide — Windows

Step-by-step guide to install and use **My Translator** on Windows 10/11.

---

## Requirements

- Windows 10 or later (x64 or ARM64)
- [Soniox](https://soniox.com) API key (pay-per-use, ~$0.12/hour)

---

## Step 1 — Download

Download the latest `.exe` installer from: [**Releases — Windows**](https://github.com/phuc-nt/my-translator/releases/tag/v0.1.0-windows)

Choose the right version:
- **x64** — Most Windows PCs (Intel/AMD)  
- **arm64** — Windows on ARM (Surface Pro X, Snapdragon laptops)

---

## Step 2 — Bypass SmartScreen

> ⚠️ The app is not yet signed with a certificate. Windows SmartScreen will block it on first run.

When you see the **"Windows protected your PC"** screen:

1. Click **"More info"**

![SmartScreen warning — click More info](user_manual_win/mytrans_win_01.png)

2. Click **"Run anyway"**

![Click Run anyway](user_manual_win/mytrans_win_02.png)

---

## Step 3 — Install

The setup wizard will guide you:

1. Click **Next** to start

![Welcome to My Translator Setup](user_manual_win/mytrans_win_03.png)

2. Choose install location (default is fine) → click **Next**

![Choose Install Location](user_manual_win/mytrans_win_04.png)

3. Wait for installation to complete → click **Next**

![Installation Complete](user_manual_win/mytrans_win_05.png)

4. Check **"Run My Translator"** → click **Finish**

![Completing Setup — Run My Translator](user_manual_win/mytrans_win_06.png)

---

## Step 4 — Configure API Key & Languages

The app opens. Click ⚙️ to open **Settings**:

![Main screen — Ready](user_manual_win/mytrans_win_07.png)

Configure:

1. **SONIOX API KEY** — Paste your API key from [console.soniox.com](https://console.soniox.com)
2. **Source** — Choose the source language (or leave as Auto-detect)
3. **Target** — Choose the target language (e.g., Vietnamese, English...)
4. **Audio Source** — Choose System Audio (computer sound) or Microphone

![Settings — API Key and Languages](user_manual_win/mytrans_win_08.png)

Scroll down for more options:

- **Font Size** — Adjust text size
- **Max Lines** — How many lines to show
- **Show original text** — Display source text alongside translation
- **Custom Context** — Add domain/terms for better accuracy

![Settings — Display and Context](user_manual_win/mytrans_win_09.png)

Click **Save & Close** when done.

> 💡 **Where to get an API key?**
> 1. Go to [soniox.com](https://soniox.com) → create an account
> 2. Go to Dashboard → copy your API key

---

## Step 5 — Start Translating!

Click ▶ to start. The app will show **Listening...**

![App is Listening](user_manual_win/mytrans_win_10.png)

Now play any audio on your PC (YouTube, Zoom, podcasts...) and translations appear in real-time!

![Real-time translation with speaker labels](user_manual_win/mytrans_win_11.png)

---

## Tips

- **System Audio** captures whatever is playing on your PC — no virtual cable needed
- **Microphone** captures live speech from your mic
- The app works as an **overlay** — drag it anywhere, resize as needed
- Translations are **saved automatically** — click 📋 to view the transcript file

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Start / Stop |
| `Ctrl+,` | Open Settings |
| `Esc` | Close Settings |

---

## Troubleshooting

### SmartScreen blocks the installer
→ Click **"More info"** → **"Run anyway"** (see Step 2).

### No translation text appears
→ Check that your Soniox API key is correct in Settings (⚙️).

### No system audio captured
→ Make sure audio is playing on your PC. Some apps use exclusive audio mode — try a different source.

### App doesn't start
→ Make sure WebView2 Runtime is installed. It comes with Windows 10/11, but on older versions you may need to install it from [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
