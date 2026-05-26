# Phase 3 — OpenAI Realtime Integration (HIGHEST RISK)

**Priority:** P0 (MVP-blocking but isolated) · **Effort:** L (~8h)

## Goal
Second engine: OpenAI Realtime via direct WebSocket from the device with user's API key. Streams text + 24kHz PCM voice back. No backend, no proxy, no WebRTC.

## Files to read for reference
- /Users/phucnt/workspace/my-translator/src/js/openai-realtime-client.js (full — port the event handlers verbatim; rewrite the connect/transport bits)
- /Users/phucnt/workspace/my-translator/src/js/openai-audio-output-queue.js (full — near-1:1 port to `AudioBufferQueueSourceNode`)
- /Users/phucnt/workspace/my-translator/src-tauri/src/commands/openai_realtime.rs (read once for understanding the OpenAI event protocol: `session.update`, `input_audio_buffer.append`, `response.audio.delta`, `response.audio_transcript.delta`, `conversation.item.input_audio_transcription.delta/.done`)
- /Users/phucnt/workspace/my-translator/plans/reports/researcher-260514-0049-rn-audio-websocket.md (Q2, Q4 — critical for WS auth + playback)

## Files to create (under /Users/phucnt/workspace/my-translator-mobile/)
- `src/engines/openai-realtime.ts` — direct WS client. URL: `wss://api.openai.com/v1/realtime?model=gpt-realtime-translate-...` (use current model name from OpenAI docs at impl time). Header: `Authorization: Bearer <apiKey>`, `OpenAI-Beta: realtime=v1`. Send `session.update` on open with translation config + 24k pcm16 audio format. Public API mirrors desktop's `OpenAiRealtimeClient`: `connect`, `sendAudio(ArrayBuffer)`, `disconnect`, callbacks `onSegment(src,tgt) / onProvisional / onSourceProvisional / onStatusChange / onClosed / onError`.
- `src/lib/openai-audio-output-queue.ts` — port of desktop file to `react-native-audio-api`'s `AudioBufferQueueSourceNode`. Constructor creates `AudioContext({ sampleRate: 24000 })`. `push(base64Pcm)` decodes → Int16Array → Float32Array → `enqueueBuffer()`. Honor 2s max-ahead drop.
- `src/lib/audio-capture.ts` (extend from phase 2) — add capture at 24kHz mode for OpenAI path. Same exported class, just take `sampleRate` constructor arg.

## Step-by-step todo
**STEP 0 IS GATING — do not start anything else before it returns a verdict.**

- [ ] **STEP 0 (highest priority, real iOS device, ~30 min):** Create a 20-line script in a throwaway file that opens `new WebSocket('wss://echo.websocket.org', '', { headers: { Authorization: 'Bearer test' } })` on a physical iPhone. Log handshake result via a public test echo server that reflects request headers (e.g. `wss://ws.postman-echo.com/raw`). Verify `Authorization` is delivered. **If yes** → proceed with native WS. **If no** → integrate `react-native-tcp-socket` and build a manual WSS handshake module (~3h extra). Document outcome in `src/engines/openai-realtime.ts` header comment.
- [ ] Port the event-handler switch from `openai-realtime-client.js` lines 106–149 verbatim into `openai-realtime.ts` — these are independent of transport.
- [ ] Implement connect: open WS, on open send:
  ```json
  { "type": "session.update", "session": {
      "modalities": ["text","audio"],
      "input_audio_format": "pcm16",
      "output_audio_format": "pcm16",
      "input_audio_transcription": { "model": "whisper-1" },
      "turn_detection": { "type": "server_vad" },
      "instructions": "Translate from <src> to <tgt>...",
      "voice": "alloy"
  }}
  ```
  (Exact schema per current OpenAI docs at impl time — version drift is likely.)
- [ ] `sendAudio`: convert `ArrayBuffer` → base64 string, send `{ type: 'input_audio_buffer.append', audio: '<b64>' }`. No commit needed when server VAD is on.
- [ ] Port `OpenAiAudioOutputQueue` → `openai-audio-output-queue.ts` using `AudioBufferQueueSourceNode.enqueueBuffer()`. Test with a single canned PCM file first if possible.
- [ ] Wire into `SessionContext`: when `engine === 'openai'`, instantiate `OpenAIRealtimeClient` + `OpenAiAudioOutputQueue`, route audio chunks to queue.
- [ ] **Verify 24kHz capture actually delivers 24kHz** on iOS — log first chunk's actual frame count vs expected. If iOS resamples internally to 48k and the library doesn't expose it, add a 48→24 decimation step in `audio-capture.ts`.
- [ ] Test on physical iPhone + Android: English speech → Vietnamese text + Vietnamese voice playback, latency <2s.

## Acceptance criteria
- [ ] STEP 0 verdict documented in source
- [ ] OpenAI engine produces translated text and audible voice on both iOS and Android physical devices
- [ ] Latency under 2s for short utterances
- [ ] No echo loop when using device speaker (loud handheld use). If echo is bad → document as known issue; AEC is out of scope for MVP.
- [ ] Disconnect cleanly stops WS and flushes audio queue

## Risk + mitigation
- **RN WS Authorization header on iOS** — STEP 0 settles it. Fallback path adds ~3h but is well-defined.
- **OpenAI Realtime schema drift** — model names and event shapes change. Mitigation: implement against the live docs at execution time, not against the desktop code's snapshot.
- **24k capture on iOS may not be honored** — verify, add JS decimation if needed (48→24 is trivial 2:1 averaging).
- **Audio feedback loop on speakerphone** — out of scope; document. Users should headset for OpenAI engine.
- **Cost** — OpenAI Realtime is expensive. Show inline note in Settings: "OpenAI Realtime ≈ $4/hr — billed to your key". One-line text, no dashboard.
