# Phase 1 — Project Setup

**Priority:** P0 (blocks everything) · **Effort:** M (~3h)

## Goal
Create a working Expo dev client on /Users/phucnt/workspace/my-translator-mobile that boots on iOS Simulator and Android emulator with empty Translate screen.

## Files to read for reference
- /Users/phucnt/workspace/my-translator/plans/reports/researcher-260514-0049-rn-audio-websocket.md (Q5–Q7: permissions, prebuild config)
- /Users/phucnt/workspace/my-translator/plans/reports/researcher-260514-0049-rn-ui-structure.md (sections "Suggested directory tree", "Naming")

## Files to create (under /Users/phucnt/workspace/my-translator-mobile/)
- `package.json` — via `npx create-expo-app`
- `app.config.ts` — dynamic Expo config with permissions plugin block
- `tsconfig.json` — strict TS, paths alias `@/*` → `src/*`
- `tailwind.config.js` + `global.css` — NativeWind v4 setup
- `babel.config.js` — `nativewind/babel`, `react-native-worklets/plugin`
- `metro.config.js` — NativeWind metro transformer
- `eas.json` — `development`, `preview`, `production` profiles
- `app/_layout.tsx` — root layout with Stack, providers stub
- `app/index.tsx` — placeholder Translate screen ("Hello mobile")
- `app/settings.tsx` — placeholder Settings screen
- `src/state/settings-context.tsx` — empty context with TS types
- `src/state/session-context.tsx` — empty context
- `src/lib/secure-keys.ts` — `expo-secure-store` get/set/clear wrapper for `apikey.soniox` / `apikey.openai`
- `src/types/index.ts` — `Engine = 'soniox' | 'openai'`, `LangCode`, etc.
- `assets/icon.png`, `assets/splash.png` — placeholder (1024x1024 + 2048x2048)
- `.gitignore` — node_modules, .expo, ios/, android/, *.env, .easignore
- `README.md` — install + run instructions

## Step-by-step todo

- [ ] `cd /Users/phucnt/workspace && npx create-expo-app my-translator-mobile -t default --no-install`
- [ ] `cd my-translator-mobile && npm install`
- [ ] Install runtime deps: `npx expo install expo-dev-client expo-router expo-secure-store react-native-audio-api react-native-worklets nativewind tailwindcss@^3 react-native-reanimated react-native-safe-area-context react-native-screens @gorhom/bottom-sheet`
- [ ] Configure NativeWind v4 per official docs (tailwind.config.js, global.css import in `_layout.tsx`, babel/metro config)
- [ ] Set bundle ID `com.phucnt.mytranslator`, display name `My Translator`
- [ ] Add `react-native-audio-api` Expo plugin to `app.config.ts`:
  ```ts
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['react-native-audio-api', {
      iosBackgroundMode: false,
      iosMicrophonePermission: 'Allow My Translator to use the microphone for live translation.',
      androidForegroundService: false,
      androidPermissions: ['RECORD_AUDIO']
    }]
  ]
  ```
- [ ] `npx expo prebuild --clean` — generates ios/ + android/ (do NOT commit)
- [ ] `eas init`, `eas build:configure`
- [ ] Build dev client: `eas build --profile development --platform ios` and `--platform android` (or local `npx expo run:ios` / `run:android` for first smoke test)
- [ ] Install dev client, run `npx expo start --dev-client`, verify both screens render
- [ ] Commit initial scaffold; tag `v0.0.1-scaffold`

## Acceptance criteria
- iOS Simulator + Android emulator both boot the app, show "Hello mobile" on Translate screen
- Tap settings icon → navigates to Settings placeholder
- No red-screens, no permission prompts yet (mic only requested on first Start tap, later phase)
- `eas build` succeeds end-to-end for at least one platform

## Risk + mitigation
- **NativeWind v4 + Expo Router v4 + RN worklets** sometimes have peer-dep friction. Mitigation: pin exact versions per NativeWind v4 install guide; if Reanimated babel order causes "worklets not found", swap plugin order (worklets MUST be last).
- **Bundle ID conflict** on App Store Connect. Not blocking until phase 5, but pick `com.phucnt.mytranslator` early to be safe.
