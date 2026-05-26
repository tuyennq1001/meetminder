# my-translator-mobile — MVP Plan

**Created:** 2026-05-14
**Companion to:** /Users/phucnt/workspace/my-translator (Tauri desktop)
**New repo:** /Users/phucnt/workspace/my-translator-mobile
**Status:** Planning → Ready to execute

## Goal
Minimal RN + Expo app (iOS + Android) that captures phone mic and shows real-time translation. Two engines: Soniox (text-only) + OpenAI Realtime (text + voice). Dual-panel toggle. Nothing else.

## Confirmed stack (do not re-debate)
- Expo SDK 54 (pinned) + TypeScript
- Expo Router v4 (file-based, 2 routes)
- NativeWind v4 (Tailwind on RN, dark mode via `useColorScheme`)
- `react-native-audio-api` (Software Mansion) — capture + playback, one engine
- Fallback: `@fugood/react-native-audio-pcm-stream` if audio-api mic input is unstable
- `expo-secure-store` for API keys
- Expo prebuild + dev client + EAS Build (NOT Expo Go, NOT bare)
- React Context + useRef ring buffer — no Zustand/Redux

## Hard out-of-scope (do not add)
TTS provider config · transcript persistence · two-way mode · system audio · background mode · backend service · App Store / Play Store listing

## Confirmed config decisions
- Bundle ID: `com.phucnt.mytranslator`
- Display name: `My Translator`
- Min OS: iOS 15+, Android 8+ (API 26)
- Expo SDK: 54 (pinned; do not jump to 55 mid-development)
- OpenAI echo on speakerphone: documented as known issue ("use headphones"), still ship in MVP

## Phases
| # | File | Status | Est |
|---|---|---|---|
| 1 | [phase-01-project-setup.md](phase-01-project-setup.md) — Scaffold, deps, prebuild config, EAS account | ☐ | M |
| 2 | [phase-02-soniox-integration.md](phase-02-soniox-integration.md) — Mic 16k + Soniox WS + barebones screen (proof of life) | ☐ | M |
| 3 | [phase-03-openai-realtime-integration.md](phase-03-openai-realtime-integration.md) — **HIGHEST RISK**. WS auth verify on iOS device FIRST. Then port client + 24k playback | ☐ | L |
| 4 | [phase-04-ui-polish.md](phase-04-ui-polish.md) — Settings + Translate UI, NativeWind theming, dual-panel toggle, font controls | ☐ | M |
| 5 | [phase-05-build-and-distribute.md](phase-05-build-and-distribute.md) — EAS profiles, TestFlight, APK GitHub Release, README | ☐ | S |

## Dependency graph
```
phase-01 → phase-02 → phase-04 → phase-05
              ↘ phase-03 ↗
```
Phase 2 ships first as standalone proof of life. Phase 3 runs after phase 2's audio pipeline is verified. Phase 4 wires both engines into final UI.

## Key risks (front-loaded)
1. **OpenAI WS `Authorization` header on iOS** — verify on real device before deep impl (phase 3 step 0).
2. `react-native-audio-api` mic input may not be GA — phase 2 includes a 1hr spike; fall back to `@fugood/react-native-audio-pcm-stream` for capture if blocked.
3. iOS AVAudioSession may resample requested 24k to 48k internally — verify actual delivered rate in phase 3.

## OpenAI WS auth — chosen approach
Try option 1 (native RN WebSocket with `headers: { Authorization: 'Bearer <key>' }`) on real iOS device as the first task of phase 3. If broken → fall back to `react-native-tcp-socket` manual WSS upgrade. No ephemeral tokens, no proxy, no WebRTC. BYOK (paste your own key).

## Success criteria
- [ ] Install dev build on iPhone + Android device via TestFlight / APK
- [ ] Paste Soniox key, pick langs, press Start, see live translation within 3s
- [ ] Paste OpenAI key, switch engine, press Start, see text + hear voice within 2s
- [ ] Dual-panel toggle works; font A−/A+ works; dark mode auto-follows OS
- [ ] No crashes over 10-min continuous session per engine
