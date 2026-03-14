# Installation Guide

Step-by-step guide to install and use **My Translator** on macOS.

---

## Requirements

- macOS 13 or later (Apple Silicon — M1/M2/M3/M4)
- [Soniox](https://soniox.com) API key (pay-per-use, ~$0.12/hour)

---

## Step 1 — Download

Download the latest `.dmg` from: [**Releases — macOS**](https://github.com/phuc-nt/my-translator/releases/tag/v0.1.0)

---

## Step 2 — Install

Open the `.dmg` file → drag **My Translator** into the **Applications** folder.

![Drag My Translator to Applications](user_manual/mytrans_01.png)

---

## Step 3 — Bypass Gatekeeper

> ⚠️ The app is not yet signed with an Apple Developer certificate (pending approval). macOS will block it on first open.

Open **Terminal** and run this command **once**:

```bash
xattr -cr /Applications/My\ Translator.app
```

![Run xattr command in Terminal](user_manual/mytrans_02.png)

Then open My Translator from Applications as usual.

---

## Step 4 — Grant Screen Recording Permission

On first launch, macOS will ask for **Screen & System Audio Recording** permission. This is required for the app to capture system audio.

Click **Open System Settings** to go to the permission page.

![Screen Recording permission request](user_manual/mytrans_03.png)

---

## Step 5 — Enable Permission in System Settings

Find **My Translator** in the list and **toggle the switch** to ON.

![Enable Screen & System Audio Recording](user_manual/mytrans_04.png)

macOS will ask you to **Quit & Reopen** the app — click that button to restart with the new permissions.

![Quit & Reopen to apply permission](user_manual/mytrans_05.png)

---

## Step 6 — Configure API Key & Languages

After the app reopens, click ⚙️ (or press `⌘ ,`) to open **Settings**:

1. **SONIOX API KEY** — Paste your API key from [console.soniox.com](https://console.soniox.com)
2. **Source** — Choose the source language (or leave as Auto-detect)
3. **Target** — Choose the target language (e.g., Vietnamese, English...)
4. **Audio Source** — Choose System Audio (computer sound) or Microphone
5. Click **Save**

![Configure API key and languages](user_manual/mytrans_07.png)

> 💡 **Where to get an API key?**
> 1. Go to [soniox.com](https://soniox.com) → create an account
> 2. Go to Dashboard → copy your API key

---

## Step 7 — Start Translating!

Go back to the main screen → click ▶ (or press `⌘ Enter`) to start.

The app will show **Listening...** — now play any audio on your Mac (YouTube, Zoom, podcasts...) and translations will appear in real-time!

![App is Listening](user_manual/mytrans_06.png)

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘ Enter` | Start / Stop |
| `⌘ ,` | Open Settings |
| `Esc` | Close Settings |
| `⌘ 1` | Switch to System Audio |
| `⌘ 2` | Switch to Microphone |

---

## Troubleshooting

### App says "damaged and can't be opened"
→ Run `xattr -cr /Applications/My\ Translator.app` in Terminal (see Step 3).

### No translation text appears
→ Check that **Screen & System Audio Recording** is enabled in System Settings (see Step 5).

### "No API key" error
→ Open Settings (⚙️) and paste your API key (see Step 6).

### "No microphone found" error
→ Mac Mini has no built-in microphone. Connect an external mic (USB, headset, or AirPods).
