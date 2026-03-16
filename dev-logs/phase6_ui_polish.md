# Phase 6: UI Polish & Transcript Management

**Branch:** `ui/shared-header`  
**Date:** 2026-03-15  
**Status:** ✅ Complete, merged to main

## Changes

### Settings Drag Fix
- **Problem:** `data-tauri-drag-region` on parent elements consumed click events, making buttons unclickable
- **Solution:** Used manual `appWindow.startDragging()` on mousedown for settings view, excluding interactive elements
- **Lesson:** Never put `data-tauri-drag-region` on parent containers that hold buttons. Use empty sibling divs or manual JS dragging instead
- **Ref:** https://v2.tauri.app/learn/window-customization/

### Transcript Display
- Each segment (original + translation) now renders as a block div instead of inline spans
- New entries always start on a new line
- Removed decorative blinking cursor (wasted space, no UX value)

### New Buttons (Control Bar)
- **📋 Copy** — copies current transcript as plain text to clipboard
- **📁 Open Folder** — opens transcript directory in Finder

### Transcript File Saving
- **Old:** Append each translation line to a daily `.txt` file
- **New:** Save complete session as `.md` file with timestamp filename
- **Triggers:** Stop, Clear, Close (never lose data)
- **File format:**
  ```markdown
  ---
  date: 2026-03-15T12:45:00.000Z
  model: Soniox Cloud API
  source_language: auto
  target_language: vi
  recording_duration: 5m 23s
  audio_source: system
  segments: 12
  ---
  
  > が攻めてきて、たくさんの人が殺されて、
  Họ tấn công, rất nhiều người bị giết,
  ```

### DevOps Documentation
- Added build/install sequence rules to CLAUDE.md and GEMINI.md
- Documented Tauri drag region gotchas
- Documented branch strategy

## Commits
```
06fbc07 feat: auto-save transcript on stop and close
00bf936 feat: save complete transcript file on clear
8f00169 docs: add DevOps rules to CLAUDE.md and GEMINI.md
71f0fab ui: remove blinking cursor from transcript
46fce88 feat: copy transcript + open saved transcripts folder
32de984 ui: block layout for transcript entries + settings drag fix
c46cbe4 ui: each transcript entry on new line (block layout)
6472caa fix: add manual drag for settings view
```
