# Phase 05 — app.js Wiring (`_startQwenMode` + cleanup)

## Context Links

- Current `_startQwenMode`: `src/js/app.js` lines 1517–1601
- Stop cleanup: `src/js/app.js` lines 1945–1951 (qwenOutputQueue branch)
- TTS gate (already correct): line 1424
- Reconnect branch (auto-retry): line 1556–1564

## Overview

- **Priority:** P1
- **Status:** pending
- **Description:** Drop output-queue plumbing; drop `onSourceProvisional` wiring; pass `sourceLanguage` + `targetLanguage` to client; drop `targetLanguageName` lookup.

## Key Insights

- After Phase 02 the QwenRealtimeClient.connect signature accepts a single config object — no second outputQueue arg.
- After Phase 04 settings.source_language is guaranteed to be a valid Qwen code (UI snaps off auto), but defensively pass `'en'` if empty.
- Reconnect closure (line 1561) re-reads settings on retry — must continue to work.
- Stop branch must skip `qwenOutputQueue.close()` since the field no longer exists.

## Requirements

### Functional

- `_startQwenMode(settings)` connects with:
  ```js
  await this.qwenClient.connect({
    apiKey: settings.qwen_api_key,
    sourceLanguage: (settings.source_language && settings.source_language !== 'auto')
      ? settings.source_language : 'en',
    targetLanguage: settings.target_language || 'vi',
  });
  ```
- Drop `targetLanguageName` lookup (lines 1528–1530).
- Drop `qwenOutputQueue` field, instantiation, and cleanup.
- Drop `this.qwenClient.onSourceProvisional = ...` handler (lines 1539–1541) — Phase 02 removed the callback from the client.
- Stop/cleanup branch: remove the `if (this.qwenOutputQueue)` block.
- TTS gate at line 1424 already excludes qwen — leave untouched.

### Non-functional

- No `qwenOutputQueue` references remain anywhere in app.js.
- No `targetLanguageName` references in qwen path.

## Architecture

Same auto-reconnect pattern as OpenAI; only the client config changes.

## Related Code Files

### Modify

- `src/js/app.js`:
  - Lines 1520: drop `OpenAiAudioOutputQueue` import inside `_startQwenMode` (only used for qwenOutputQueue)
  - Lines 1525: drop `this.qwenOutputQueue = new ...`
  - Lines 1528–1530: drop `targetSelect` / `targetLanguageName` resolution
  - Lines 1539–1541: drop `onSourceProvisional` handler
  - Lines 1566–1572: rewrite connect call (signature change)
  - Lines 1949–1951: drop `qwenOutputQueue.close()` block

### Read

- `src/js/qwen-realtime-client.js` (post-Phase-02) to confirm signature

## Implementation Steps

1. Inside `_startQwenMode`:
   - Delete import line `const { OpenAiAudioOutputQueue } = await import(...)`.
   - Delete `this.qwenOutputQueue = new OpenAiAudioOutputQueue();`.
   - Delete the targetSelect lookup block.
   - Delete `this.qwenClient.onSourceProvisional = ...`.
   - Rewrite `connect` call: pass single object with `apiKey`, `sourceLanguage`, `targetLanguage`. No second arg.
2. In stop/cleanup (search for `this.qwenOutputQueue`), delete the entire `if (this.qwenOutputQueue) { ... }` block.
3. Verify reconnect retry (line 1561 `if (this.isRunning) this._startQwenMode(settingsManager.get());`) still resolves with the new signature — it does, since it just re-invokes the function.
4. Confirm `_refreshLangListsForEngine` (Phase 04) is called from `_updateUI` so that engine-switch flow updates pickers BEFORE `start()` is hit.

## Todo List

- [ ] Drop `OpenAiAudioOutputQueue` import in `_startQwenMode`
- [ ] Drop `qwenOutputQueue` field instantiation
- [ ] Drop targetSelect / targetLanguageName resolution
- [ ] Drop `onSourceProvisional` callback wiring
- [ ] Rewrite `qwenClient.connect(...)` to new signature (apiKey, sourceLanguage, targetLanguage)
- [ ] Drop `qwenOutputQueue.close()` from stop cleanup block
- [ ] Grep `qwenOutputQueue\|targetLanguageName\|onSourceProvisional` in app.js → 0 hits

## Success Criteria

- App.js compiles (no syntax errors; pnpm tauri dev launches).
- `_startQwenMode` body ≤ 55 lines.
- Manual: start qwen session — status reaches "connected"; first provisional text within ~3s of speaking.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Stale code path references `qwenOutputQueue` elsewhere (e.g., mute toggle) | Med | Med | Grep before commit; expect only the two locations (start + stop). |
| User toggles engine mid-session → mode switch leaves stale client | Low | Med | `stop()` cleanup runs before re-`start()`; existing pattern. |
| Reconnect after socket close uses stale settings | Low | Low | Closure re-reads `settingsManager.get()` each time. |

## Security Considerations

- N/A.

## Next Steps

- Phase 06 — end-to-end verification.
