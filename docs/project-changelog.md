# Changelog

All notable changes to My Translator are documented here.
Each release section is extracted automatically by `.github/workflows/release.yml` and published as the GitHub Release body.

Format: `## v<version> - <YYYY-MM-DD>` followed by content until the next `## v` heading.

---

## v0.6.0 - 2026-05-13

### New Features

- **OpenAI Realtime translation provider**: added `gpt-realtime-translate` (May 2026 GA) as a third translation engine alongside Soniox and Local MLX. The model streams translated text **and** translated speech audio over a single WebSocket — no separate TTS step required, and lower end-to-end latency than text-only providers.
- **13 output languages supported**: en, es, pt, fr, de, it, ru, hi, id, vi, ja, ko, zh.
- **Signed + notarized macOS DMG**: builds are now signed with Developer ID and notarized through Apple's notary service — installs without the `xattr` workaround on first launch.

### Bug Fixes

- **Dual-panel routing**: in dual view, the OpenAI source transcript now reliably lands in the left (source) column and the translation in the right column. Previous heuristic-based routing dropped the translation into the source column when whisper transcription lagged behind translation output.
- **Source/target final pairing**: whisper transcription and translation streams finalize at different cadences. A queue now pairs each source final with its matching translation final so the saved transcript stays aligned.

### Caveats

- **Cost**: ~$0.07/min (~$4/hr) — about 34× Soniox at provider list rates (measured on a 5-min Japanese→Vietnamese test against the GA endpoint). Charged to your own OpenAI account; a cost warning is shown in Settings.
- **Two-way mode** and the **custom TTS provider toggle** are unavailable while OpenAI Realtime is selected (audio comes natively from the model).
- **Thai** is not in the supported output set; Thai users should stay on Soniox or Local MLX.
- **Source transcript may pause** during long speaker pauses (e.g. applause breaks) — translation keeps working but the source column can stall. Under investigation.

### Technical

- Added a `rubato`-based 16k → 24k polyphase upsampler in the Rust audio pipeline so the existing 16kHz capture path can feed the model's 24kHz s16le input requirement.
- New Tauri commands: `openai_realtime_start`, `openai_realtime_send_audio`, `openai_realtime_stop` — the WebSocket lives in Rust because browsers can't set the `Authorization` header on WebSocket handshakes.
- New JS modules `openai-realtime-client.js` (mirrors the Soniox client callback shape) and `openai-audio-output-queue.js` (Web Audio API streaming player for the 24kHz output stream).
- Explicit `provider` flag on transcript UI replaces the previous heuristic detection, fixing the dual-panel routing regression.
- Added `scripts/build-notarized.sh` for local notarized builds (reads `APPLE_*` env vars from a gitignored `.env`).

---

## v0.5.3 - 2026-04-10

### Bug Fixes

- **Windows**: Fix app crashing a few seconds after pressing Play. The Application Loopback (ALAC) path introduced in v0.5.2 had an incorrect stream setup that caused an access violation during capture. Reverted to the v0.5.1 legacy WASAPI loopback path, which is known to be stable.

### Known Limitation (reintroduced)

- Windows system audio capture will include the app's own TTS output. In one-way mode, use headphones to avoid feedback. Two-way mode already disables TTS, so no change there. Self-exclusion will be revisited once it can be properly tested on a real Windows machine.

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
