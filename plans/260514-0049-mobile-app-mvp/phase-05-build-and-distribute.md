# Phase 5 — Build and Distribute

**Priority:** P1 · **Effort:** S (~2h)

## Goal
Get the app onto the user's own iPhone + Android device. TestFlight for iOS, signed APK on GitHub Release for Android. No store listings.

## Files to read for reference
- /Users/phucnt/workspace/my-translator/plans/reports/researcher-260514-0049-rn-audio-websocket.md (Q7 — workflow)
- Expo docs: EAS Build, EAS Submit (consult at impl time for current command flags)

## Files to create / modify (under /Users/phucnt/workspace/my-translator-mobile/)
- `eas.json` — finalize:
  ```jsonc
  {
    "build": {
      "development": { "developmentClient": true, "distribution": "internal" },
      "preview":     { "distribution": "internal", "ios": { "simulator": false }, "android": { "buildType": "apk" } },
      "production":  { "ios": { "autoIncrement": true }, "android": { "buildType": "apk", "autoIncrement": true } }
    },
    "submit": { "production": { "ios": { "appleId": "...", "ascAppId": "..." } } }
  }
  ```
- `README.md` — install instructions:
  - "Download APK from Releases" → enable unknown sources → install
  - "TestFlight invite link" → install TestFlight → accept invite
  - Get API keys: link to Soniox console + OpenAI platform keys page
  - Paste keys in Settings → start translating
- `.github/workflows/release.yml` (optional, defer if EAS handles it) — trigger EAS build on tag push, attach APK to GitHub Release

## Step-by-step todo
- [ ] Apple Developer account: confirm enrollment status; create App ID `com.phucnt.mytranslator` on developer.apple.com (no App Store Connect listing needed for TestFlight internal testing)
- [ ] `eas build --profile production --platform ios` → wait → `eas submit --platform ios --latest` to push to TestFlight
- [ ] Add user's Apple ID as internal tester on App Store Connect (no review wait)
- [ ] `eas build --profile production --platform android` → download APK artifact
- [ ] Create GitHub Release on /Users/phucnt/workspace/my-translator-mobile repo (push to GitHub first), attach APK
- [ ] Install on both devices, run full smoke test (Soniox path + OpenAI path)
- [ ] Tag `v0.1.0`

## Acceptance criteria
- [ ] iPhone receives TestFlight invite, installs build, runs end-to-end
- [ ] Android device installs APK from GitHub Release, runs end-to-end
- [ ] README has copy-paste install steps a non-developer could follow

## Risk + mitigation
- **Apple TestFlight review for External Testing** can take 24h. Mitigation: use Internal Testing (100 testers from your team, no review).
- **Android APK signing key loss** = can never update. Mitigation: EAS stores the keystore; back up via `eas credentials` export to a password manager.
- **OpenAI key in SecureStore** could be exfiltrated if device is jailbroken / rooted. Mitigation: documented in README "use a key with low spending limit"; out of scope to defend further.
- **Bundle ID collision** with another developer. Pre-check via App Store Connect before phase 1 completes.
