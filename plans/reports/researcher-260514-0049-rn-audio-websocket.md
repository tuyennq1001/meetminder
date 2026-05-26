# RN + Expo Audio / WebSocket Research — my-translator-mobile

Date: 2026-05-14 · Scope: porting desktop Tauri translator (Soniox + OpenAI Realtime) to React Native + Expo (iOS + Android).

---

## TL;DR

- **Mic capture:** Use **`react-native-audio-api` (Software Mansion, v0.12.2, May 2026)** as primary engine. Mic input is on the roadmap (listed in README) and the library already gives us Web-Audio-shaped APIs + an **official Expo config plugin** that handles iOS background mode + Android `FOREGROUND_SERVICE_MICROPHONE` automatically. Fallback if mic input is not yet GA: **`@fugood/react-native-audio-pcm-stream` v1.1.4 (Oct 2025)** — actively maintained fork of mybigday's lib, gives base64 PCM chunks via `LiveAudioStream.on('data', …)`, supports 16kHz mono 16-bit on both platforms.
- **WebSocket auth:** RN's built-in `WebSocket` **cannot send `Authorization` headers** (same limitation as browser). Soniox works as-is (query-string-like JSON-first-message auth). For OpenAI Realtime: **must use ephemeral client tokens** issued by your own backend (recommended by OpenAI for browser/mobile), OR keep a Rust/Node proxy. **Recommend ephemeral-token + WebSocket** — no native module, no proxy host to operate.
- **Resampling 16k→24k:** Do it in JS with a tiny linear/polyphase resampler (the desktop app already uses linear via `simple_resample` for fallback). For better quality, **`react-native-audio-api`'s `OfflineAudioContext`** can resample natively. Easiest: capture at **24kHz directly** for OpenAI path (both libs allow arbitrary sample rate, including 24000 on Android `AudioRecord`; iOS resamples internally via AVAudioEngine). Then downsample 24k→16k for Soniox in JS (cheap integer 3:2 decimation with light low-pass).
- **PCM playback (24kHz s16le chunks from OpenAI):** Use **`react-native-audio-api`'s `AudioBufferQueueSourceNode`** — purpose-built for "many short buffers", exposes `onBufferEnded` event, supports the exact same scheduling pattern as the desktop `OpenAiAudioOutputQueue`. Direct port of `openai-audio-output-queue.js`.
- **Workflow:** **Expo prebuild + dev client** (CNG). Managed Go won't work — we need `react-native-audio-api` native code, mic permissions, foreground service, background audio. Do NOT eject to fully bare; keep config plugins so EAS Build remains reproducible.

---

## Per-Question Findings

### Q1 — Microphone capture: live PCM stream on iOS + Android

| Library | Live PCM callback? | Sample rate | Bit depth | iOS impl | Android impl | Last release | Verdict |
|---|---|---|---|---|---|---|---|
| `expo-audio` 55.0.14 | **No** — file-based recording only. `useAudioSampleListener` only exposes samples during **playback**, not capture. | configurable | n/a for capture stream | AVAudioRecorder | MediaRecorder | active (Expo SDK 55) | ❌ Wrong shape |
| `expo-av` (deprecated) | No — file-based; **removed in SDK 55**. | — | — | — | — | EOL | ❌ Don't use |
| `react-native-audio-api` 0.12.2 | Microphone listed on README roadmap (✓ ticked). Web-Audio model: `MediaStreamAudioSourceNode` + `AudioWorkletNode` for raw frames. Verify with sample app before commit. | per `AudioContext` | f32 (Web Audio) | AVAudioEngine | AudioRecord/Oboe | 2026-05-13 (very active) | ✅ Primary choice |
| `@fugood/react-native-audio-pcm-stream` 1.1.4 | **Yes** — `LiveAudioStream.on('data', base64)` | 8/16/32/44.1/48 kHz (any) | 8 or 16 | Audio Queue | AudioRecord | 2025-10-21 | ✅ Safe fallback |
| `react-native-live-audio-stream` 1.1.1 | Yes | configurable | 16-bit | Audio Queue | AudioRecord | **2022-05** (stale) | ⚠️ Unmaintained 4yr |
| `@picovoice/react-native-voice-processor` 1.2.3 | Yes (Picovoice-managed) — gives Int16Array frames | configurable (16k typical) | 16 | native | native | active | ✅ Good if licensing OK |
| `@dr.pogodin/react-native-audio` 1.18.1 | Yes — `InputAudioStream` API | configurable | PCM_16BIT mono | native | native | active | ✅ Alternative |
| `@mykin-ai/expo-audio-stream` 0.3.5 | Yes — `subscribeToAudioEvents()` callback | 16/44.1/48 kHz | s16le/f32le | Swift | Kotlin | 2025-12 | ✅ Has Expo plugin baked in |
| `@speechmatics/expo-two-way-audio` | Yes — 16kHz mono s16, **AEC built-in** | 16 only | s16 | native | native | active | ✅ If you want echo cancellation |

**Recommendation order:** `react-native-audio-api` (unify capture + playback in one engine) → `@fugood/react-native-audio-pcm-stream` (proven, simple) → `@speechmatics/expo-two-way-audio` (only if AEC needed for speakerphone use).

Sources: [picovoice blog](https://picovoice.ai/blog/how-to-record-audio-in-react-native/), [mybigday/react-native-audio-pcm-stream](https://github.com/mybigday/react-native-audio-pcm-stream), [callstack blog](https://www.callstack.com/blog/from-files-to-buffers-building-real-time-audio-pipelines-in-react-native).

---

### Q2 — WebSocket with custom Authorization header

**Hard fact:** RN's `WebSocket` constructor accepts a 3rd `options` arg with `headers` on Android (works), but on iOS the underlying implementation strips `Authorization`/`Sec-*` headers in many RN versions ([facebook/react-native#28450](https://github.com/facebook/react-native/issues/28450)). The OpenAI Agents/Realtime JS SDK explicitly does not work in RN ([openai/openai-agents-js#133](https://github.com/openai/openai-agents-js/issues/133)).

**Per provider:**

- **Soniox:** API key is sent in the first JSON message after open (`configMsg.api_key`) — see `src/js/soniox.js:96`. **No header needed.** Works with RN built-in WS, no change.
- **OpenAI Realtime:** Requires `Authorization: Bearer <key>` on handshake. Three viable options:

  | Option | Pros | Cons |
  |---|---|---|
  | **A. Ephemeral client tokens** (OpenAI's recommended path) — backend mints short-lived `client_secret`, app connects WS with that as Bearer. WebSocket accepts client_secret in some flows; otherwise use WebRTC path. | Official path, no proxy hosting per-stream audio, secure | Needs tiny token-mint endpoint, more recent SDK behavior; **WebRTC** is OpenAI's preferred client transport for mobile |
  | **B. Native module on RN** that opens WS with header (e.g. `react-native-tcp-socket` + manual handshake, or wrap iOS `URLSessionWebSocketTask`) | Keep current message protocol verbatim | Adds native code per platform; reproducing TLS+WS framing is fragile |
  | **C. Keep Rust/Node WS proxy** (like desktop) | Zero changes to JS protocol code | Operational cost: must host a relay; audio bandwidth doubles transit |

  **Pick A (ephemeral) + WebRTC** for OpenAI Realtime translate. The OpenAI WebRTC guide explicitly recommends WebRTC for browser/mobile clients ([Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)). RN WebRTC support: `react-native-webrtc` (mature). WebRTC also handles 48k Opus negotiation natively, so mic→server resampling burden moves to the OS.

  If you want to keep the WebSocket protocol exactly as desktop, **Option C (proxy)** is the smallest code delta but adds infra.

Sources: [OpenAI Realtime WebSocket](https://developers.openai.com/api/docs/guides/realtime-websocket), [Realtime API WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc), [community thread on bearer in WS query](https://community.openai.com/t/realtime-api-please-allow-to-send-the-authentication-bearer-as-a-query-paramater/965275), [openai-agents-js#133](https://github.com/openai/openai-agents-js/issues/133).

---

### Q3 — Resampling 16k ⇄ 24k on-device

Desktop uses `rubato` polyphase upsampler (16→24k) — see `src-tauri/src/audio/resampler.rs` + `src-tauri/src/commands/openai_realtime.rs:19`. On mobile we have three choices:

1. **Capture at 24kHz directly, downsample for Soniox**. Both `@fugood/react-native-audio-pcm-stream` (Android `AudioRecord` accepts any rate ≥ 4kHz; iOS Audio Queue resamples to requested rate internally) and `react-native-audio-api` (set `sampleRate: 24000` on `AudioContext`) support this. To feed Soniox (16k), do an integer 3:2 decimation in JS — for 24k→16k, take 2 of every 3 samples after a simple FIR low-pass. ~30 lines, perfectly fine for speech.
2. **Capture at native (44.1/48k) and resample twice**. Adds CPU, no benefit.
3. **`react-native-audio-api` `OfflineAudioContext`** — does proper polyphase resampling in C++. Best quality, slight latency. Worth it only if Q1 shows audible artifacts from option 1.

**Recommendation:** Option 1 (capture @ 24k for OpenAI path, decimate to 16k for Soniox). The desktop's `simple_resample` in `microphone.rs:254` is also linear and is acceptable per its own comment ("Good enough for speech").

---

### Q4 — Streaming PCM playback (24kHz s16le from OpenAI Realtime)

The desktop player (`src/js/openai-audio-output-queue.js`) creates an `AudioContext({sampleRate: 24000})`, decodes each base64 chunk to `Int16Array → Float32Array`, wraps in `AudioBuffer`, and schedules `AudioBufferSourceNode.start(nextStartTime)` for gapless playback with a 2-second max-ahead drop.

**Direct port target:** **`react-native-audio-api`'s `AudioBufferQueueSourceNode`** — purpose-built ("a player that consists of many short buffers"), with `enqueueBuffer()` / `dequeueBuffer()` and an `onBufferEnded` event carrying `{bufferId, isLastBufferInQueue}`. Same `AudioContext` constructor accepts `sampleRate: 24000`. This is a near-1:1 port of the existing JS code.

| Library | Raw PCM chunk playback | Notes |
|---|---|---|
| `react-native-audio-api` 0.12.2 | ✅ `AudioContext` + `AudioBufferQueueSourceNode` | Best fit; same mental model as Web Audio |
| `expo-audio` 55 | ❌ file-based playback | wrong shape |
| `react-native-track-player` | ❌ HLS/MP3/AAC focused | wrong shape |
| `@mykin-ai/expo-audio-stream` | ✅ `playAudio(base64, turnId, 'pcm_s16le')` | Higher-level; tied to 16/44.1/48k, **does not list 24000 in `SampleRate` type** — would need 24k→48k upsample first |
| `@cjblack/expo-audio-stream` | ✅ similar | same 16/44.1/48 limitation |

**Recommendation:** `react-native-audio-api`. If we adopt it for both capture and playback, the desktop's two JS modules (`openai-audio-output-queue.js`, mic glue) collapse into a single shared `AudioContext` lifecycle.

Sources: [AudioBufferQueueSourceNode docs](https://docs.swmansion.com/react-native-audio-api/docs/sources/audio-buffer-queue-source-node), [issue #363 PCM streaming](https://github.com/software-mansion/react-native-audio-api/issues/363), [Gemini Live 24kHz thread](https://discuss.ai.google.dev/t/best-practices-for-playing-gemini-live-apis-24khz-pcm-audio-stream-in-expo-react-native/95569).

---

### Q5 — iOS background audio + permissions

Requirements:
- `NSMicrophoneUsageDescription` in `Info.plist` (mandatory or App Store rejection).
- `UIBackgroundModes: ["audio"]` to keep capturing while screen locked.
- Call `setAudioModeAsync({ allowsBackgroundRecording: true, ... })` at runtime (expo-audio) or equivalent AVAudioSession category `.playAndRecord` with `.mixWithOthers` if appropriate.

**With Expo managed/prebuild:** trivial via config plugin. For `react-native-audio-api`, the official plugin auto-adds the background mode via `iosBackgroundMode: true` (default) and microphone permission via `iosMicrophonePermission`. With `expo-audio`, use `expo-audio`'s plugin option `enableBackgroundRecording: true`.

**Gotchas:**
- Expo Go (the dev sandbox app) **does NOT honor background modes** — must build a dev client or production binary to actually test backgrounding ([expo/expo#21411](https://github.com/expo/expo/issues/21411), [DEV community guide](https://dev.to/josie/how-to-add-background-audio-to-expo-apps-3fgc)).
- If WebSocket is the transport, iOS will throttle/disconnect networking after a few seconds of background unless `audio` mode is genuinely active (audio session must be playing or recording — silence still counts if a recording session is active).

Sources: [DEV guide](https://dev.to/josie/how-to-add-background-audio-to-expo-apps-3fgc), [expo-audio plugin docs](https://docs.expo.dev/versions/latest/sdk/audio/), [audio-api plugin](https://docs.swmansion.com/react-native-audio-api/docs/other/audio-api-plugin/).

---

### Q6 — Android 14+ foreground service for mic

Android 14 requires:
- Declare `<service android:foregroundServiceType="microphone">` in manifest.
- Permission `android.permission.FOREGROUND_SERVICE_MICROPHONE` (in addition to `RECORD_AUDIO`).
- Permission `android.permission.POST_NOTIFICATIONS` (Android 13+, for the persistent notification).
- Start the service from the foreground (not from a background broadcast).

**With Expo:**
- **Managed-only (no prebuild) won't work** because you can't modify `AndroidManifest.xml` directly.
- **Solution = Expo prebuild + config plugin.** `react-native-audio-api`'s plugin handles all of this via:

  ```jsonc
  // app.json
  "plugins": [
    ["react-native-audio-api", {
      "iosBackgroundMode": true,
      "iosMicrophonePermission": "Allow $(PRODUCT_NAME) to use the microphone for live translation.",
      "androidForegroundService": true,
      "androidFSTypes": ["microphone"],
      "androidPermissions": ["RECORD_AUDIO", "FOREGROUND_SERVICE_MICROPHONE", "POST_NOTIFICATIONS"]
    }]
  ]
  ```

  `expo-audio` has equivalent options (`enableBackgroundRecording: true`).

Alternatives: `@notifee/react-native` for a generic foreground service if your mic lib doesn't ship one. `expo-task-manager` is **not** sufficient for mic — Android requires an actual foreground service of type `microphone`.

Sources: [Android 14 FGS issue](https://github.com/expo/expo/issues/26846), [audio-api plugin](https://docs.swmansion.com/react-native-audio-api/docs/other/audio-api-plugin/), [Medium guide on Expo Android bg](https://drebakare.medium.com/enabling-background-recording-on-android-with-expo-the-missing-piece-41a24b108f6d).

---

### Q7 — Workflow recommendation: managed vs prebuild vs bare

**Verdict: Expo prebuild (CNG) + dev client + EAS Build.**

| Workflow | Verdict | Why |
|---|---|---|
| Managed (no prebuild, Expo Go) | ❌ | Can't load `react-native-audio-api` native module, can't set `foregroundServiceType="microphone"`, Expo Go ignores background modes. |
| **Prebuild + dev client + EAS** | ✅ | Best of both worlds: native modules + config plugins manage `Info.plist` / `AndroidManifest.xml` reproducibly. EAS auto-runs prebuild on every build. Don't commit `ios/` `android/`. |
| Fully bare (ejected) | ❌ overkill | We don't need to hand-edit native projects. Bare loses CNG safety; you must maintain native files on every dep upgrade. |

Standard installs (post-prebuild dev client):

```bash
npx create-expo-app my-translator-mobile -t default
cd my-translator-mobile
npx expo install expo-dev-client react-native-audio-api react-native-worklets
# Fallback mic lib if needed:
npx expo install @fugood/react-native-audio-pcm-stream
# For OpenAI WebRTC path:
npx expo install react-native-webrtc @config-plugins/react-native-webrtc
# Build dev client locally or with EAS:
npx expo prebuild --clean
eas build --profile development --platform ios
```

Sources: [Adopt Prebuild](https://docs.expo.dev/guides/adopting-prebuild/), [CNG](https://docs.expo.dev/workflow/continuous-native-generation/), [Expo 2025 perspective](https://hashrocket.com/blog/posts/expo-for-react-native-in-2025-a-perspective).

---

## Recommended Stack

```jsonc
{
  "expo": "~55.0.x",                                  // SDK 55, expo-av removed
  "expo-dev-client": "latest",
  "react-native-audio-api": "^0.12.2",                // capture + playback engine
  "react-native-worklets": ">=0.6.0",                 // peer of audio-api
  "@fugood/react-native-audio-pcm-stream": "^1.1.4",  // fallback if audio-api mic not ready
  "react-native-webrtc": "latest",                    // for OpenAI Realtime via WebRTC
  "@config-plugins/react-native-webrtc": "latest"
}
```

Module mapping desktop → mobile:

| Desktop file | Mobile replacement |
|---|---|
| `src-tauri/src/audio/microphone.rs` (cpal 16k mono i16) | `react-native-audio-api` `MediaStream` → `AudioWorkletNode` emitting Float32 → JS converts to Int16Array per chunk. Capture at 24k for OpenAI, decimate to 16k for Soniox. |
| `src-tauri/src/audio/resampler.rs` (rubato 16→24k) | Not needed if capturing @ 24k directly. Otherwise: trivial JS linear interp (~20 LOC). |
| `src/js/openai-audio-output-queue.js` (Web Audio scheduler) | Port verbatim to `AudioBufferQueueSourceNode` with `enqueueBuffer()`. |
| `src/js/soniox.js` | **Reuse as-is** — RN WebSocket supports JSON-message auth. Pure JS. |
| `src-tauri/src/commands/openai_realtime.rs` (WS bridge for Auth header) | **Delete.** Replace with: (a) WebRTC client (`react-native-webrtc`) + ephemeral-token mint endpoint on your backend, OR (b) keep the Rust bridge as a hosted relay. Pick (a). |
| `src/js/openai-realtime-client.js` | Rewrite ~40% — drop Tauri `invoke`/`Channel`, talk to WebRTC peer directly. Keep the public callback API (`onSegment`, `onProvisional`, `onSourceProvisional`, `onClosed`, `onError`) so app code stays identical. |

---

## Risks / Unknowns

1. **`react-native-audio-api` microphone GA status.** Roadmap shows ticked, but recording examples in docs focus on file/buffer playback. **Action:** clone repo, run `apps/common-app` mic example on iOS + Android before committing. If immature, fall back to `@fugood/react-native-audio-pcm-stream` for capture and keep `react-native-audio-api` only for playback (they coexist).
2. **iOS WebSocket header behavior on RN 0.74+.** Unverified whether the bug in #28450 is fixed in current RN. If `Authorization` header DOES pass through, option B (native module) becomes unnecessary — but per OpenAI's own guidance, WebRTC is still the recommended client transport. Do not bet on it.
3. **WebRTC vs WebSocket protocol divergence for OpenAI Realtime.** Server event messages are identical, but transport setup differs (SDP offer/answer, ICE). Existing `openai-realtime-client.js` event-handling code (lines 106-149) is reusable; only the connect path changes.
4. **24kHz capture on iOS via AVAudioEngine.** AVAudioSession negotiates sample rate per hardware route; requesting 24000 may yield 48000 on some devices and the library will internally resample. Verify before assuming "no JS resampling needed".
5. **Background audio on iOS while only WebSocket is active.** iOS keeps the app alive only while the audio session is recording (not just while WS is open). The mic must stay armed even during silence; rely on Soniox keepalive (already in `soniox.js:380`) and OpenAI Realtime VAD to avoid emitting zero-byte audio.
6. **App Store review.** Apps that "record audio in background" get extra scrutiny. Need clear in-app UI showing recording state. Don't claim background recording if you can avoid it — most translation use cases are foreground.

---

## Unresolved Questions

1. Does the mobile app **need** background-while-locked capture (Q5/Q6), or is foreground-only acceptable? Foreground-only halves Android complexity (no FGS) and avoids App Store risk.
2. Will the OpenAI Realtime path be **WebSocket-via-proxy** (lowest code delta) or **WebRTC-direct** (no proxy infra)? Affects whether we keep the Rust binary as a hosted service or delete it.
3. Echo cancellation: needed? Desktop uses raw mic with no AEC. On phone speakerphone, the translated TTS will be picked up by the mic → feedback loop. If yes → switch capture lib to `@speechmatics/expo-two-way-audio` or implement AEC via `AVAudioSession.setMode(.voiceChat)` + native AEC on Android (`NoiseSuppressor` + `AcousticEchoCanceler`).
4. Target Expo SDK: latest (55) or pin to 54 for stability? SDK 55 removes `expo-av` entirely — confirms `expo-audio` adoption.
5. Soniox audio chunk size — `soniox.js:236` just forwards whatever buffer arrives. Need to confirm RN WS handles binary `Uint8Array.buffer` chunks the same as the desktop browser does (it does, but worth a smoke test).

---

## Sources

- [picovoice — How to Record Audio in React Native](https://picovoice.ai/blog/how-to-record-audio-in-react-native/)
- [GitHub — mybigday/react-native-audio-pcm-stream](https://github.com/mybigday/react-native-audio-pcm-stream)
- [npm — @fugood/react-native-audio-pcm-stream 1.1.4](https://www.npmjs.com/package/@fugood/react-native-audio-pcm-stream)
- [npm — react-native-audio-api 0.12.2](https://www.npmjs.com/package/react-native-audio-api)
- [Software Mansion — React Native Audio API docs](https://docs.swmansion.com/react-native-audio-api/)
- [Software Mansion — Audio API Expo plugin](https://docs.swmansion.com/react-native-audio-api/docs/other/audio-api-plugin/)
- [GitHub issue #363 — PCM streaming on react-native-audio-api](https://github.com/software-mansion/react-native-audio-api/issues/363)
- [Callstack — From Files to Buffers (real-time audio in RN)](https://www.callstack.com/blog/from-files-to-buffers-building-real-time-audio-pipelines-in-react-native)
- [Expo docs — Audio (expo-audio)](https://docs.expo.dev/versions/latest/sdk/audio/)
- [OpenAI — Realtime API with WebSocket](https://developers.openai.com/api/docs/guides/realtime-websocket)
- [OpenAI — Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [OpenAI community — Bearer in WS query param](https://community.openai.com/t/realtime-api-please-allow-to-send-the-authentication-bearer-as-a-query-paramater/965275)
- [facebook/react-native#28450 — Missing user-agent / headers on iOS WS](https://github.com/facebook/react-native/issues/28450)
- [openai/openai-agents-js#133 — Realtime SDK does not work with React Native](https://github.com/openai/openai-agents-js/issues/133)
- [DEV — How to Add Background Audio to Expo Apps](https://dev.to/josie/how-to-add-background-audio-to-expo-apps-3fgc)
- [expo/expo#21411 — UIBackgroundModes not working on iOS](https://github.com/expo/expo/issues/21411)
- [expo/expo#26846 — SDK 50 Android 14 FGS permission requirements](https://github.com/expo/expo/issues/26846)
- [Medium — Enabling Background Recording on Android with Expo](https://drebakare.medium.com/enabling-background-recording-on-android-with-expo-the-missing-piece-41a24b108f6d)
- [Expo docs — Adopt Prebuild](https://docs.expo.dev/guides/adopting-prebuild/)
- [Expo docs — Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)
- [Hashrocket — Expo for RN in 2025](https://hashrocket.com/blog/posts/expo-for-react-native-in-2025-a-perspective)
- [Gemini API forum — playing 24kHz PCM in Expo RN](https://discuss.ai.google.dev/t/best-practices-for-playing-gemini-live-apis-24khz-pcm-audio-stream-in-expo-react-native/95569)

**Status:** DONE
**Summary:** Recommended stack is Expo prebuild + dev client, `react-native-audio-api` for capture+playback (fallback `@fugood/react-native-audio-pcm-stream` for mic if needed), Soniox JS code reusable as-is, OpenAI Realtime → switch to WebRTC with ephemeral tokens to drop the Rust proxy.
**Concerns:** `react-native-audio-api` mic GA status needs hands-on verification; OpenAI WebRTC migration requires rewriting the connect path of `openai-realtime-client.js` (~40% delta) and standing up a small ephemeral-token endpoint.
