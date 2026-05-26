# Qwen Mobile Bug — Cross-Platform Analysis

**Date:** 2026-05-24
**Context:** Desktop Tauri implementation works correctly. Mobile (Expo) shows source language in BOTH source + target panels (echo, not translation).

## Side-by-Side

| Aspect | Desktop (works) | Mobile (bug) |
|---|---|---|
| WebSocket impl | Rust `tokio-tungstenite` | RN `WebSocket` polyfill |
| Audio capture | `cpal` s16le 16kHz mono | `react-native-audio-api` 16kHz |
| Auth on WS handshake | HTTP `Authorization: Bearer` header set in Rust | RN 3rd-arg `{ headers }` — non-standard, polyfill-dependent |
| `session.update` payload | Identical JSON | Identical JSON |
| RMS-VAD logic | Identical (port from TS) | Original TS |
| Event mapping | Identical | Identical |
| Source/target pairing | `pendingSourceFinals` queue | Same queue |
| Dedup on `response_id` | Yes | Yes |

Code-level: **the two clients are line-for-line equivalents** (Rust port mirrors TS shape). Bug is NOT in app logic.

## Bug Signature

Mobile target panel renders Japanese (source language) verbatim, not Vietnamese translation. This means Qwen is NOT applying our `instructions` block — it's running a default chat completion that echoes the input.

Possible roots:

1. **WS handshake auth header dropped by RN polyfill.** RN's WebSocket does not officially support custom headers — passing a 3rd-arg `{ headers }` object works on iOS via the bridge sometimes, fails silently on others. If server rejects auth, some providers fall back to a default unauthenticated session that just echoes.
2. **`session.update` not delivered before first audio chunk.** RN `ws.onopen` fires after handshake; on a slow channel `session.update` may race with `input_audio_buffer.append`, leaving the session on defaults.
3. **DashScope int'l endpoint silently downgrades unauth'd sessions** to a passthrough mode for the model (no instructions, no translation).

## Diagnostic Asks (for the user)

The verbose log already lives at mobile `qwen-realtime-client.ts:288-294` — it dumps `session.updated`'s `session` payload. From the Xcode Console log, check:

- Does `[qwen-realtime] session.updated` ever print? If NO → session.update was never accepted → auth failure.
- Does the dumped session JSON include the `instructions` string? If NO → server ignored our update.
- Does an `error` event arrive immediately after WS open? Capture the `code` field.

## Proposed Fixes (priority order)

### Option A — Match desktop architecture: native WS proxy

Move the WS to a native module (Expo modules API or a thin Swift/Kotlin bridge). Same model as desktop's Rust proxy. JS keeps the callback interface; native handles HTTP upgrade with proper headers.

**Pros:** Eliminates the entire class of RN polyfill bugs. Reuses ~80% of existing TS logic.
**Cons:** New native module per platform; build complexity.

### Option B — Query-param auth (if DashScope supports it)

Some realtime endpoints accept `?api_key=...` instead of header auth. Check DashScope docs. If supported, swap header for query param.

**Pros:** Single-line change in `connect()`.
**Cons:** Key leaks in URL bar of any logging middleware between device and server; some firewalls strip query strings from upgrade requests.

### Option C — Subprotocol auth

`new WebSocket(url, [`Bearer.${apiKey}`])` — pass auth in the `Sec-WebSocket-Protocol` header via the protocols array (officially supported by RN). DashScope must explicitly accept this scheme for it to work.

**Pros:** RN-native, no polyfill hacks.
**Cons:** Provider-specific — needs DashScope confirmation.

### Option D — Defer first audio until `session.updated` arrives

If the bug is race condition (not auth), gate `sendAudio` behind a `sessionUpdated` flag — buffer or drop chunks until server confirms.

**Pros:** Pure-JS, ships fast.
**Cons:** Adds 100-500ms perceived latency on session start.

## Recommended Sequence

1. **Read the Xcode log first.** It will discriminate auth (option A/B/C) from race (option D) in seconds — the verbose `session.updated` dump is the deciding signal.
2. **If auth:** try Option C (subprotocol) for a 1-line test. If DashScope rejects → Option A (native module).
3. **If race:** Option D.

## Unresolved Questions

- Does DashScope international endpoint accept `Sec-WebSocket-Protocol` auth? (Need to test with `wscat -s "Bearer.$KEY" wss://...` or similar.)
- Does DashScope have a query-param auth option documented?
- On the user's failing TestFlight install: was `session.updated` ever logged? (Blocks all diagnosis.)
