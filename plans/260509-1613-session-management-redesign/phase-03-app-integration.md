# Phase 03 — App.js Integration + OpenAI Bug Fix

## Context Links
- SessionStore API: `./phase-02-js-session-store.md`
- App lifecycle: `src/js/app.js:38` (init), `:1239` (start), `:1682` (stop)
- OpenAI segment hookup: `src/js/app.js:1328-1333`
- Soniox segment hookup: `src/js/app.js:430-440` (around addOriginal/addTranslation calls)
- Local pipeline segment hookup: `src/js/app.js:1540-1545`
- UI side-effects to neutralize: `src/js/ui.js:_cleanupStaleOriginals` (line 536)

## Overview
- **Priority**: P1 (touches main controller)
- **Status**: pending
- **Effort**: 4h
- Wire `sessionStore` into all three engines. Remove premature `clearSession()`. Diagnose + fix OpenAI data-loss bug.

## Critical Bug Investigation: OpenAI "content disappears, no file"

**Hypothesis A** — `_cleanupStaleOriginals` (ui.js:536) drops original segments older than 10s, max 3 pending. OpenAI Realtime can have long buffering; if `addOriginal` runs but `addTranslation` is delayed, the original is dropped from `segments[]` AND its `sessionLog` mirror keeps `status:'original'`, but display only shows translated (single-view skips originals). Net effect: visible content seems empty.

**Hypothesis B** — On `disconnect()`, OpenAI client may emit one last `transcript.is_final=true` AFTER `clearSession()` ran. Race wipes data.

**Hypothesis C** — `addOriginal(text, null, null)` receives `null` speaker — works fine in `sessionLog` (already verified, lines 75-83 of ui.js). NOT the cause.

**Fix strategy**: bypass UI side-effects entirely for persistence. SessionStore receives data DIRECTLY from each client's `onSegment`/equivalent — does NOT depend on `transcriptUI.sessionLog`. UI display stays unchanged; persistence diverges.

## Requirements
**Functional**
- App init: create new session (or prompt resume if last `ended_at == null`).
- Start (any engine): `sessionStore.beginChunk({engine, srcLang, tgtLang})`.
- Each engine's segment finalization: `sessionStore.addSegment(src, tgt)` AT THE SAME PLACE that calls `transcriptUI.addOriginal/addTranslation`.
- Stop: `sessionStore.endChunk()` then `sessionStore.persist()`. **Do NOT call `transcriptUI.clearSession()`** — UI keeps showing content.
- Window close: `sessionStore.endSession()` BEFORE `appWindow.close()`.
- "New Session" button: `sessionStore.endSession()` → `transcriptUI.showPlaceholder()` → `sessionStore.init({...})`.

**Non-functional**
- Persist must complete before window closes (await).
- Segment writes are O(1) (no full re-serialization per segment).

## Architecture / Data Flow

```
                      ┌─→ transcriptUI.addOriginal(src) ─→ display
OpenAI onSegment(src,tgt) ─┤
                      └─→ transcriptUI.addTranslation(tgt) ─→ display
                       └─→ sessionStore.addSegment(src,tgt) ─→ JSON  ★ NEW direct path

Soniox: same — wherever app.js currently calls addOriginal/addTranslation, ALSO call sessionStore.addSegment().
Local:  same.
```

Pair-matching for Soniox (which emits original + translation separately, possibly out of order) — keep a small pending-buffer in SessionStore? **Decision: KISS** — for Soniox, push `(src, '')` on `addOriginal`, then on `addTranslation` either update the last empty-tgt segment OR push `('', tgt)`. Document that Soniox pairs may split across segments — acceptable for v1.

Actually simpler: for Soniox specifically, app.js currently calls `addOriginal` then later `addTranslation`. We mirror that same pattern: `sessionStore.addOriginal(src)` updates a buffered pending-pair; `sessionStore.addTranslation(tgt)` finalizes it. Add to SessionStore:

```js
// sessionStore additions for streaming ASR providers
addOriginal(src) { this._pendingSrc = src; }
addTranslation(tgt) {
    this.addSegment(this._pendingSrc || '', tgt);
    this._pendingSrc = null;
}
addPair(src, tgt) { this.addSegment(src, tgt); } // OpenAI atomic path
```

This keeps Soniox/Local two-call flow and OpenAI single-call flow both clean.

## Related Code Files
**Read**: `src/js/openai-realtime-client.js`, `src/js/soniox.js`
**Modify**: `src/js/app.js`, `src/js/session-store.js` (add 3 helper methods), `src/js/ui.js` (delete `clearSession()` calls in `stop()` flow only — keep method for explicit reset)

## Implementation Steps

### Step 1 — Add diagnostic logging FIRST (before changing logic)
1. In `app.js:1328` (OpenAI onSegment), add: `console.log('[OAI segment]', {sourceText, translatedText, sessionLogLen: this.transcriptUI.sessionLog.length});`
2. In `app.js:1682` (stop), add: `console.log('[stop] hasSessionContent:', this.transcriptUI.hasSessionContent(), 'segments:', this.transcriptUI.segments.length);`
3. Reproduce OpenAI bug; capture console — confirm hypothesis.

### Step 2 — Wire SessionStore into init
4. Import `sessionStore` in `app.js`.
5. In `init()` (around line 88, just before "initialized" log):
   ```js
   const lastSession = await this._tryLoadDanglingSession();
   if (lastSession) { /* prompt resume */ }
   else { sessionStore.init({}); }
   ```
6. Add `_tryLoadDanglingSession()` — calls `list_sessions`, filters `ended_at == null`, returns most recent or null.

### Step 3 — beginChunk on start
7. In `start()` after settings captured (around line 1283), call:
   ```js
   sessionStore.beginChunk({
       engine: this.translationMode,
       sourceLang: this.sessionSourceLang,
       targetLang: this.sessionTargetLang,
   });
   ```

### Step 4 — Wire segment hooks per engine
8. **OpenAI (line 1328-1333)**: after `transcriptUI.addTranslation(translatedText)`, add `sessionStore.addPair(sourceText, translatedText);`.
9. **Soniox (line 430-440)**: after `transcriptUI.addOriginal(...)`, add `sessionStore.addOriginal(text);`. After `transcriptUI.addTranslation(...)`, add `sessionStore.addTranslation(text);`.
10. **Local (line 1540-1545)**: same pattern as Soniox.

### Step 5 — Stop = endChunk + persist; remove premature clear
11. In `stop()`, replace the autosave block (lines 1728-1735):
    ```js
    sessionStore.endChunk();
    try {
        await sessionStore.persist();
        const title = sessionStore.title || 'session';
        this._showToast(`Saved: ${title}`, 'success');
    } catch (err) {
        console.error('Persist failed:', err);
        this._showToast('Failed to save session', 'error');
    }
    // DO NOT call transcriptUI.clearSession() — keep display intact
    this.sessionStartTime = null;
    ```
12. Delete the now-dead `_saveTranscriptFile()` method (or feature-flag behind `settings.use_session_store === false`).

### Step 6 — Window close = endSession
13. In btn-close handler (`app.js:156-160`):
    ```js
    await this._saveWindowPosition();
    await this.stop();
    await sessionStore.endSession();
    await this.appWindow.close();
    ```

### Step 7 — Add "New Session" button
14. Add button to overlay header (HTML + handler, see phase-04 for HTML).
15. Handler: confirm dialog → `await sessionStore.endSession()` → `transcriptUI.showPlaceholder()` → `sessionStore.init({})`.

### Step 8 — Verify with logs
16. Repro OpenAI scenario. Check console: `[OAI segment]` fires every final → `[stop]` shows non-empty session → `Saved:` toast.
17. Open transcripts dir → verify `.md` + `.json` exist.

## Todo List
- [ ] Diagnostic logs added; OpenAI bug reproduced and root cause confirmed
- [ ] sessionStore imported, init() wires sessionStore
- [ ] beginChunk in start()
- [ ] OpenAI addPair hook
- [ ] Soniox addOriginal/addTranslation hooks
- [ ] Local addOriginal/addTranslation hooks
- [ ] stop() rewritten — no clearSession()
- [ ] Window close awaits endSession
- [ ] New Session button + handler
- [ ] Manual test all three engines: start → speak → stop → start → speak → stop → close → relaunch → verify file pair

## Success Criteria
- OpenAI mode: stop preserves all displayed content; `.md` + `.json` written.
- Soniox + Local: same.
- Two Start/Stop cycles in one launch → ONE file pair, two chunks in JSON.
- Closing window mid-session → JSON has `ended_at` set; relaunch loads fine.
- New Session button → starts fresh id, old session persisted.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Replacing autosave breaks Soniox flow | M×H | Keep both paths during dev; remove old only after Soniox verified |
| `_cleanupStaleOriginals` still loses UI display for OpenAI | M×M | SessionStore writes are independent of UI; display issue handled in separate ticket |
| `endSession` race with window close (Tauri may kill before promise) | L×H | Await before `appWindow.close()`; settle timeout 2s |
| Re-entry: stop() called twice | M×L | `sessionStore.persist()` idempotent via `_dirty` flag |

## Security Considerations
- All persistence I/O routed through Rust commands (already sanitized in phase 01).
- No new IPC surface; only data semantics changed.
