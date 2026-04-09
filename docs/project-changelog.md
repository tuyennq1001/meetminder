# Changelog

All notable changes to My Translator are documented here.
Each release section is extracted automatically by `.github/workflows/release.yml` and published as the GitHub Release body.

Format: `## v<version> - <YYYY-MM-DD>` followed by content until the next `## v` heading.

---

## v0.5.2 - 2026-04-09

### New Features

#### Session History Viewer
- New **Sessions** view to browse all saved translation sessions
- Click any session to view full transcript, copy to clipboard
- Access via the clock icon in the overlay toolbar

#### Improved Auto-save
- Sessions now **auto-save on stop** — no manual action needed
- Full session log is preserved (never trimmed like the display buffer)
- Transcripts include metadata: date, time, source/target languages, mode

### Bug Fixes

- **Google TTS**: Clearer error message when API is blocked — tells users to enable "Cloud Text-to-Speech API" in Google Cloud Console
- **Windows**: Fixed WASAPI compile errors for new audio capture implementation

### Technical

- Refactored Windows WASAPI audio capture (ALAC + legacy loopback support)
- Added `list_transcripts` and `read_transcript` Rust commands

---

## v0.5.1 - 2026-03-26

### New Features

- **Two-way translation**: translate conversations between two languages simultaneously — ideal for bilingual meetings (Zoom, Google Meet, MS Teams)
- **Audio source "Both"** (System + Mic): capture both your voice and remote participants for two-way mode
- **Endpoint delay slider**: tune STT latency for faster or more accurate transcription
- **Soniox enhancements**: keepalive, rich context, language ID, confidence scores
- **Strict language restriction** for more reliable target language output

### Notes

- TTS narration is automatically disabled in two-way mode to prevent audio feedback loops

---

## v0.5.0 - 2026-03-21

### New Features

- **All Soniox languages** supported (70+ source languages)
- **Auto-update**: built-in updater, check & install from Settings → About
- **TTS narration**: 3 providers — Edge TTS (free), Google Chirp 3 HD, ElevenLabs
- **About tab**: version info, update controls, links
- **Update UX redesign**: clearer progress, error handling

### Bug Fixes

- Multiple stability fixes across auto-updater, relaunch, and TTS pipeline

---

## v0.4.5 - 2026-03-18

### New Features

- **Google TTS Chirp 3 HD**: near-human quality neural voices
- **Dual Panel view**: source and translation side-by-side, independent scroll
