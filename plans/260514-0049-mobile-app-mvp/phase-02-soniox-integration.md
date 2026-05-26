# Phase 2 — Soniox Integration (Ship This First)

**Priority:** P0 (proof of life) · **Effort:** M (~5h)

## Goal
End-to-end working translation via Soniox on a single bare screen. No polish. Tap Start → see live translation text. Tap Stop → stops. This is the first shippable internal build.

## Files to read for reference
- /Users/phucnt/workspace/my-translator/src/js/soniox.js (entire file — port verbatim, drop only the Web Audio bits if any)
- /Users/phucnt/workspace/my-translator/src-tauri/src/audio/microphone.rs (lines around 250 — `simple_resample` for understanding decimation; we'll do 24→16 in JS though phase 2 captures at 16k natively)
- /Users/phucnt/workspace/my-translator/plans/reports/researcher-260514-0049-rn-audio-websocket.md (Q1, Q2, Q3)

## Files to create (under /Users/phucnt/workspace/my-translator-mobile/)
- `src/engines/soniox-client.ts` — TS port of `soniox.js`. Keep public API identical: `connect(config)`, `sendAudio(ArrayBuffer)`, `disconnect()`, callbacks `onOriginal / onTranslation / onProvisional / onStatusChange / onError / onConfidence`. WebSocket(SONIOX_ENDPOINT) — auth via first JSON message, no headers needed.
- `src/lib/audio-capture.ts` — wraps `react-native-audio-api`:
  - `AudioContext({ sampleRate: 16000 })`
  - `MediaStreamAudioSourceNode` → `AudioWorkletNode` emitting Float32 frames
  - Convert Float32 → Int16Array → `ArrayBuffer` for Soniox
  - Single exported class `AudioCapture` with `start(onPcmChunk)`, `stop()`
- `src/lib/languages.ts` — minimal static lists: SONIOX_LANGS (top 15 hardcoded: en, vi, ja, ko, zh, es, fr, de, ru, pt, it, id, th, hi, ar), OPENAI_LANGS (13 from desktop)
- `app/index.tsx` — replace placeholder with: source/target lang TextInput stubs (use literal `en`/`vi` for now), big Start/Stop button, scrollable Text view showing rolling translations
- `src/state/session-context.tsx` — implement: `status`, `translations: string[]` (capped 200 via ref + counter), `start()`, `stop()`

## Step-by-step todo
- [ ] **Spike (1h):** verify `react-native-audio-api` mic input on iOS sim + Android emulator. Build smallest possible repro emitting Float32 frames. If broken on either platform → swap to `@fugood/react-native-audio-pcm-stream` for capture only (keep audio-api for phase 3 playback). Document decision in code comment.
- [ ] Port `soniox.js` → `soniox-client.ts` line by line. Strip `window.` references. Keep make-before-break session reset and keepalive logic.
- [ ] Implement `AudioCapture`: start mic at 16kHz mono, emit `ArrayBuffer` chunks (~100ms = 3200 bytes) via callback.
- [ ] Wire `SessionContext.start()`: request mic permission via `react-native-audio-api`'s helper or `expo-audio` perm hook, then start `AudioCapture`, then `SonioxClient.connect()`, route `onTranslation` → push to translations ref.
- [ ] `app/index.tsx`: hardcode Soniox key from `SecureStore.getItemAsync('apikey.soniox')` (set manually via dev menu first), render translations in `<ScrollView>` auto-scrolled to bottom, big TouchableOpacity Start/Stop with red-when-live tint.
- [ ] Test on physical iPhone via dev client. Confirm: translations appear within ~2s, no crashes for 5min continuous, stop cleanly releases mic.
- [ ] Test on physical Android device. Same checks.

## Acceptance criteria
- [ ] Tap Start (after mic perm granted) → live English speech produces Vietnamese text in <3s on Wi-Fi
- [ ] Tap Stop → mic LED off, no orphan WS connections (check via Soniox dashboard if accessible)
- [ ] Session reset at 3min boundary is seamless (no visible glitch)
- [ ] App can be backgrounded and foregrounded once (mic may pause — that's fine for MVP since background mode is off)

## Risk + mitigation
- **`react-native-audio-api` mic NOT yet GA** (per research roadmap). Mitigation = pre-spike step above. If fallback triggered, `@fugood/react-native-audio-pcm-stream` returns base64 PCM strings — decode to ArrayBuffer before `ws.send()`.
- **iOS denying mic permission silently** — call `Audio.requestPermissionsAsync()` (or library equivalent) and check status before starting; show inline error if denied.
- **WebSocket binary frame size** — Soniox accepts any reasonable chunk size. Keep at ~100ms (3200 bytes at 16k/16bit) to match desktop cadence.
