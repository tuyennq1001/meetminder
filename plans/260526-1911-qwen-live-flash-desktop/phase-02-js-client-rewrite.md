# Phase 02 — JS Client Rewrite (qwen-realtime-client.js)

## Context Links

- Mobile reference: `my-translator-mobile/src/engines/qwen-realtime-client.ts` lines 69–245 (`QwenRealtimeClient` class)
- Current: `src/js/qwen-realtime-client.js` (148 lines)
- Depends on Phase 01 event schema.

## Overview

- **Priority:** P1
- **Status:** pending
- **Description:** Strip output queue handling, drop source-side provisional, drop `targetLanguageName`, add `sourceLanguage` to connect config. Mirror mobile callbacks.

## Key Insights

- Desktop client is a thin Tauri IPC wrapper — it does NOT open WS itself (Rust does). So mobile's `ws.onopen` / `session.update` logic stays in Rust; JS only translates Tauri `Channel` events into callbacks.
- Provisional buffer lives in JS (Rust emits raw `text.text` snapshots); JS just forwards them.
- Drop `_pendingSourceFinals`, `_sourceBuffer`, `_lastFinalSource`, `setMuted`, `outputQueue` — all unused with text-only Live Flash.
- Keep `flushPending` simplified (emit last provisional as final on disconnect — mirrors mobile line 173–177).

## Requirements

### Functional

- `connect({ apiKey, sourceLanguage, targetLanguage })` → invoke `qwen_realtime_start` with snake_case payload `{ api_key, source_language, target_language }`.
- Tauri `Channel` events:
  - `status` → `onStatusChange(state, message)`
  - `transcript { is_final: false }` → `onProvisional(text)`
  - `transcript { is_final: true }` → `onSegment("", text)` (source text not emitted by Live Flash)
  - `error` → `onError(code, message)`
  - `closed` → `onClosed(reason)`
- `sendAudio(arrayBuffer)` — same as today; bytes → `qwen_realtime_send_audio`.
- `flushPending()` — emit last buffered provisional as `onSegment("", buf)`; clear.
- `disconnect()` — flushPending → invoke `qwen_realtime_stop`.

### Non-functional

- ≤ 100 LOC.
- No reference to `outputQueue`, `audio_output`, `setMuted`, `onSourceProvisional`, `_pendingSourceFinals`.

## Architecture

```
app.js wires callbacks → QwenRealtimeClient
                          ├── connect(cfg) → invoke('qwen_realtime_start', { config, onEvent: Channel })
                          ├── Channel.onmessage → _handleEvent
                          │       ├── status      → onStatusChange
                          │       ├── transcript  → onProvisional | onSegment
                          │       ├── error       → onError
                          │       └── closed      → onClosed
                          ├── sendAudio(buf)     → invoke('qwen_realtime_send_audio')
                          └── disconnect()        → flushPending; invoke('qwen_realtime_stop')
```

## Related Code Files

### Modify

- `src/js/qwen-realtime-client.js` — full rewrite (~100 lines)

### Read (unchanged)

- `src/js/openai-realtime-client.js` (similar pattern, still uses outputQueue + sourceProvisional — DO NOT copy that, follow mobile)

## Implementation Steps

1. Replace constructor: drop `outputQueue`, `_sourceBuffer`, `_pendingSourceFinals`, `_lastFinalSource`, `onSourceProvisional`, `_muted`, `setMuted`.
2. New fields: `sessionId`, `channel`, `isConnected`, `_provisionalBuffer`, `_lastFinalTarget`, plus callbacks: `onStatusChange`, `onSegment`, `onProvisional`, `onError`, `onClosed`.
3. Rewrite `connect(cfg)`:
   ```js
   async connect(cfg) {
     this.channel = new Channel();
     this.channel.onmessage = (evt) => this._handleEvent(evt);
     this.sessionId = await invoke('qwen_realtime_start', {
       config: {
         api_key: cfg.apiKey,
         source_language: cfg.sourceLanguage || 'en',
         target_language: cfg.targetLanguage,
       },
       onEvent: this.channel,
     });
     this.isConnected = true;
   }
   ```
   Remove the second `outputQueue` arg.
4. Rewrite `_handleEvent`:
   ```js
   case 'transcript':
     if (evt.is_final) {
       const t = evt.text || this._provisionalBuffer;
       this._provisionalBuffer = '';
       this._lastFinalTarget = t || '';
       if (t) this.onSegment('', t);
     } else {
       this._provisionalBuffer = evt.text;       // Rust sends full snapshot, not delta
       this.onProvisional(this._provisionalBuffer);
     }
   ```
   Delete `source_transcript`, `audio_chunk` arms.
5. Rewrite `flushPending`:
   ```js
   flushPending() {
     const t = this._provisionalBuffer;
     this._provisionalBuffer = '';
     if (t && t !== this._lastFinalTarget) this.onSegment('', t);
   }
   ```
6. `disconnect()` — same logic, drop `this.outputQueue?.flush()`.

## Todo List

- [ ] Replace `src/js/qwen-realtime-client.js` per plan above
- [ ] Verify no callers other than `app.js` (grep across `src/js`)
- [ ] Re-check `evt.text` payload shape matches Rust `QwenEvent::Transcript { text, is_final }` — snake_case `is_final` survives Tauri serialization (existing OpenAI path uses same convention)

## Success Criteria

- File ≤ 100 LOC.
- No occurrence of `outputQueue`, `audioOutput`, `targetLanguageName`, `onSourceProvisional`, `_pendingSourceFinals`, `_sourceBuffer`, `setMuted`.
- Console smoke: connect → ready → provisional ticks → final segment → close.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Rust sends `text` snapshot but old code expects delta-append | Will happen | High | Phase 02 mandates `_provisionalBuffer = evt.text` (assignment, not concat). Mobile does the same. |
| `flushPending` echoes already-finalized text | Low | Low | Guard `t !== this._lastFinalTarget`. |
| Stale `onSourceProvisional` callback wired in app.js | Med | Med | Phase 05 deletes the wiring. Until then, `onSourceProvisional` is undefined on client → no-op since callers check `this.transcriptUI.setSourceProvisional?.` |

## Security Considerations

- API key never logged client-side.

## Next Steps

- Phase 05 (app.js wiring) drops `onSourceProvisional` handler and queue cleanup.
