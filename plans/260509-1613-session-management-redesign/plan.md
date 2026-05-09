---
title: "Session Management Redesign"
description: "Replace per-recording file dump with launch-scoped sessions (MD + JSON sidecar), fix OpenAI data-loss bug, redesign sessions UI."
status: pending
priority: P1
effort: 14h
branch: main
tags: [tauri, sessions, persistence, openai, ui]
created: 2026-05-09
---

## Goal

Replace current "save new .md per Stop" behavior with a **launch-scoped session** model:
- One session per app launch (Start/Stop cycles append; explicit "New Session" button resets).
- Persist as `session-{YYMMDD-HHMM}.md` (human readable) + `.json` sidecar (structured reload).
- Stop = autosave (do not lose data on crash).
- Sessions list redesigned: title (auto), engine, lang pair, datetime, duration, chunks. Edit title, search, export .srt/.txt.
- Fix OpenAI mode "content disappears on stop, no file saved" bug.

## Critical Bugs to Fix

1. **OpenAI data loss**: investigate why content vanishes on stop. Suspect: `_cleanupStaleOriginals` dropping unmatched originals (>10s, >3 pending) during long OpenAI sentences; OR final translation arriving after `disconnect()` calls `clearSession()`. Phase 03 isolates and fixes.
2. **Premature `clearSession()`**: stop() wipes sessionLog after save (ui.js:1731). With launch-scoped sessions, this MUST move to "New Session" button only.

## Phase Index

| # | Phase | File | Effort | Blockers |
|---|-------|------|--------|----------|
| 01 | Rust persistence layer | phase-01-rust-persistence.md | 3h | none |
| 02 | JS SessionStore module | phase-02-js-session-store.md | 3h | 01 |
| 03 | App.js integration + OpenAI bug fix | phase-03-app-integration.md | 4h | 02 |
| 04 | Sessions list/viewer UI redesign | phase-04-ui-sessions-list.md | 2h | 02 |
| 05 | Resume-on-restart + .srt/.txt export | phase-05-extras.md | 1.5h | 03, 04 |
| 06 | Migration + cleanup | phase-06-migration-cleanup.md | 0.5h | 01-05 |

## File Ownership (no overlap)

- **Rust**: `src-tauri/src/commands/transcript.rs`, `src-tauri/src/lib.rs` (registry only)
- **JS new**: `src/js/session-store.js` (new, ~200 LOC)
- **JS modify**: `src/js/app.js`, `src/js/ui.js` (remove premature clear)
- **HTML/CSS**: `src/index.html` (sessions-view markup), `src/styles.css` (item layout)

## Cross-Phase Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Atomic write fails mid-session loses both files | Low | High | Write to `*.tmp` then rename; flush JSON before MD |
| OpenAI bug root cause is elsewhere (deeper than UI) | Med | High | Phase-03 step 1 = add logs, reproduce, RCA before code changes |
| Old `.md` files in transcripts/ break new list parser | High | Med | Phase-06: graceful fallback, mark legacy items read-only |
| Session JSON grows unbounded (long meeting) | Low | Med | Truncate `segments[]` past 10k entries; warn user |
| `_cleanupStaleOriginals` keeps eating OpenAI segments | Med | High | Phase-03: bypass cleanup for SessionStore writes (write directly, not via UI side-effect) |

## Backwards Compat

- Keep `save_transcript` / `read_transcript` / `list_transcripts` Tauri commands callable (legacy file fallback in sessions list).
- New commands: `save_session`, `list_sessions`, `read_session`, `delete_session`, `update_session_title`, `export_session`.
- Legacy `.md`-only files remain readable; new files are `.md` + `.json` pair.

## Success Criteria

- [ ] Start → speak → Stop → speak again → Stop: ONE file pair, two chunks with divider.
- [ ] App close mid-session → JSON has `ended_at: null` → relaunch prompts to resume.
- [ ] OpenAI mode: stop preserves all visible content; file written; reload shows same.
- [ ] Sessions list shows title/engine/langs/datetime/duration/chunks; search filters live.
- [ ] Edit title persists across reloads.
- [ ] Export .srt valid timestamps; .txt is plain transcript.

## Rollback Plan

Per phase, atomic via git revert. Phase 03 is highest risk — keep old `_saveTranscriptFile()` reachable behind a feature flag `settings.use_session_store` (default true) so we can disable JS-side without rebuilding Rust.

## Open Questions

- Title auto-generation language: take from first translated segment or first source? (Plan assumes **translated**.)
- Session ID collision if user relaunches within same minute: append `-N` suffix? (Plan: yes.)
- Local MLX mode: passes language strings ("Japanese") not codes — normalize to ISO before storing.
