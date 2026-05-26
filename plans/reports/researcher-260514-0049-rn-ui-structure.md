# RN + Expo UI/UX & Project Structure Research

**Date:** 2026-05-14
**Scope:** Mobile companion app `my-translator-mobile` — single-screen real-time translator (Soniox text / OpenAI Realtime text+voice). No TTS config, no history, no two-way.

---

## TL;DR (opinionated picks)

- **Flat Expo project, TypeScript, SDK 53+**. No monorepo. No workspaces. Single `package.json`.
- **Expo Router v4** (file-based) over React Navigation manual setup — less boilerplate even for 2 screens.
- **NativeWind v4** for styling (Tailwind on RN) — leanest dark-mode story, matches "minimalist" goal.
- **expo-secure-store** for API keys (Keychain/Keystore). Never AsyncStorage for keys.
- **React Context + useState** only. No Zustand/Redux. Transcript buffer is a `useRef` array capped at ~200 lines.
- **Dual-panel = horizontal split** (source top / translation bottom). Toggle to Single (translation-only) for max readability.
- **Searchable bottom-sheet modal** for language pickers (`@gorhom/bottom-sheet`). Native `Picker` is ugly on Android and 70+ langs needs search.

---

## Per-question findings

### 1. Monorepo layout

**Pick: Flat Expo project, TypeScript.**

No shared package with desktop (Tauri is Rust + vanilla JS; mobile is RN+TS — zero overlap worth extracting). Monorepo tooling (pnpm workspaces, Nx) adds config burden for zero gain on a 2-screen app. Reconsider only if a third surface (web companion) appears.

TypeScript is the default in `npx create-expo-app` since SDK 50 (2024); 2026 community examples are TS-first. Desktop being JS does not matter — no shared code.

### 2. Minimal UI pattern

**Pick: Two screens. Settings (first launch + gear icon) → Translate (the app).**

Apps surveyed:
- **Google Translate "Conversation"**: two stacked panels, one per speaker, mic button between. Optimized for back-and-forth — not our use case.
- **Microsoft Translator "Presentation/Live"**: single rolling caption, large font, language pills top. Closest match.
- **Otter**: single-stream live caption, auto-scroll, speaker labels. Closest UX match for "lecture mode".

Recommended single-screen translate layout:
- Top bar: engine pill (Soniox / OpenAI), source-lang chip, target-lang chip (tap → bottom sheet).
- Body: rolling text. Default **Single panel (translation only, large font)**. Toggle button reveals dual horizontal split.
- Bottom: huge circular Start/Stop button (~80pt). Status dot above it.

**Dual-panel orientation:** Horizontal split (source on top, translation bottom). Phones are tall+narrow — left/right wastes width and forces tiny fonts. Translation gets ~60% of vertical space (it's the primary signal).

**Font size:** A−/A+ floating buttons (same as desktop). Persist to SecureStore. Default 22pt (caption-style).

**Rolling buffer:** keep last 200 finalized lines in memory; trim oldest when buffer grows. **Auto-scroll to bottom** on new line UNLESS user scrolled up >100pt (then show "Jump to live" pill at bottom). Standard caption-app pattern.

### 3. Language picker UX

**Pick: Bottom-sheet modal with search input + flat list.**

- Native `@react-native-picker/picker` looks terrible on Android (old spinner) and modal-only on iOS. 70+ Soniox langs makes scroll-pick painful.
- Custom searchable bottom sheet via `@gorhom/bottom-sheet` + `FlatList` + `TextInput`. Standard pattern in 2026 (Discord, Linear mobile).
- Show flag emoji + native name + English name per row. Frequently-used (English, Vietnamese, etc.) pinned to top.
- For OpenAI's 13 langs use the same component — code reuse.

### 4. API key storage

**Pick: `expo-secure-store`.** Keys persisted, encrypted at OS level. Anything else is wrong for credentials.

```ts
import * as SecureStore from 'expo-secure-store';

export const Keys = {
  set: (k: 'soniox' | 'openai', v: string) =>
    SecureStore.setItemAsync(`apikey.${k}`, v, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    }),
  get: (k: 'soniox' | 'openai') => SecureStore.getItemAsync(`apikey.${k}`),
  clear: (k: 'soniox' | 'openai') => SecureStore.deleteItemAsync(`apikey.${k}`),
};
```

Caveats: SecureStore has a ~2KB value limit (fine for keys). Wipes on app uninstall (good). On Android, requires biometric/PIN device lock — if user has no lock set, falls back to encrypted SharedPreferences (still acceptable).

### 5. State management

**Pick: React Context + useState/useReducer.**

Surface area:
- `SettingsContext`: API keys, source/target langs, engine, font size, theme.
- `SessionContext`: status (idle/connecting/streaming/error), transcript lines (use `useRef` array + force-render counter to avoid re-rendering every line on every push).

Zustand is fine but unjustified — adds a dep for what Context handles in 30 lines. Redux/RTK is overkill.

### 6. Navigation

**Pick: Expo Router v4 (file-based).**

For 2 screens it's still less code than `@react-navigation/native` + stack setup. Auto-deeplinking, TS types from file tree, no `NavigationContainer` boilerplate. Standard new-project default in 2026 Expo template.

```
app/
  _layout.tsx       // root: theme provider, settings context
  index.tsx         // translate screen
  settings.tsx      // settings modal
```

### 7. Theming / styling

**Pick: NativeWind v4.**

- Tailwind class strings → leanest dark-mode (`dark:` prefix, automatic via `useColorScheme`).
- No runtime overhead in v4 (compiles to StyleSheet at build time).
- StyleSheet alone is verbose for a UI with theming. styled-components is being deprecated in RN community (slow, large runtime).
- Set `darkMode: 'media'` to follow OS — matches "minimalist" feel; no theme toggle needed in v1.

### 8. Naming

**Pick:**
- Package / repo: `my-translator-mobile` (matches desktop's `my-translator` — clear pairing). Confirmed, no change.
- App display name (stores + home screen): **"My Translator"** (no "Mobile" suffix — users don't care, store listing handles platform).
- Bundle ID: `com.phucnt.mytranslator` (or whatever the user's reverse-DNS is — needs confirmation).

---

## Suggested directory tree

```
my-translator-mobile/
├── app/                          # Expo Router
│   ├── _layout.tsx               # ThemeProvider, SettingsProvider, SessionProvider
│   ├── index.tsx                 # Translate screen
│   └── settings.tsx              # Settings (modal presentation)
├── src/
│   ├── components/
│   │   ├── start-stop-button.tsx
│   │   ├── language-picker-sheet.tsx
│   │   ├── engine-pill.tsx
│   │   ├── transcript-stream.tsx
│   │   └── font-size-controls.tsx
│   ├── engines/
│   │   ├── soniox-client.ts      # WebSocket → Soniox
│   │   └── openai-realtime.ts    # WebRTC → OpenAI Realtime
│   ├── state/
│   │   ├── settings-context.tsx
│   │   └── session-context.tsx
│   ├── lib/
│   │   ├── secure-keys.ts        # expo-secure-store wrapper
│   │   ├── audio-capture.ts      # expo-av / expo-audio mic
│   │   └── languages.ts          # static lang lists
│   └── types/
│       └── index.ts
├── assets/                       # icons, splash
├── app.config.ts                 # dynamic Expo config (env-aware)
├── tailwind.config.js
├── tsconfig.json
├── package.json
└── README.md
```

`app.config.ts` over `app.json` — lets us read env (e.g. eas build profile) without committing secrets.

---

## ASCII wireframe — Translate screen (portrait)

```
┌──────────────────────────────┐
│  ⚙  [⚡ OpenAI ▾]    🟢 Live │ ← top bar: settings, engine pill, status
├──────────────────────────────┤
│  🇬🇧 EN  →  🇻🇳 VI   [⇅ Dual]│ ← lang chips (tap=sheet), view toggle
├──────────────────────────────┤
│                              │
│  Source (when dual on):      │
│  "...the speaker explains    │
│   the concept of entropy..." │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                              │
│  Translation (large):        │
│                              │
│  "…người nói giải thích      │
│   khái niệm về entropy       │
│   trong vật lý thống kê…"    │ ← auto-scroll, font 22pt default
│                              │
│                              │
│         [Jump to live ↓]     │ ← only if scrolled up
├──────────────────────────────┤
│   A−   22   A+    🌗         │ ← font ctrls + theme (optional)
│                              │
│           ╭─────╮            │
│           │  ●  │            │ ← big Start/Stop (red when live)
│           ╰─────╯            │
└──────────────────────────────┘
```

Settings screen (modal): Soniox key, OpenAI key, default engine, default source/target lang, font size default, "Clear all data" button. ~6 rows total, no tabs.

---

## Risks / open questions

- **Background audio:** does the app need to keep capturing when screen locks? iOS requires `UIBackgroundModes: audio` entitlement + active audio session. If yes → must declare in `app.config.ts` and test rejection risk during App Store review (lecture-recording use case is legit, but reviewers vary).
- **WebRTC on RN for OpenAI Realtime:** `react-native-webrtc` works but adds native build complexity (no longer Expo Go compatible — needs dev client). Alternative: raw WebSocket + PCM streaming as desktop does. Need to confirm which path the engines/ files will take.
- **OpenAI Realtime native voice playback** on mobile: needs an audio sink (decode PCM frames → `expo-av` / `expo-audio` player). Latency budget on cellular?
- **Mic permission UX on first Start vs at install** — recommend lazy request on first tap of Start button (iOS HIG + Android best practice).
- **Bundle ID owner:** confirm `com.phucnt.mytranslator` or alternative reverse-DNS for App Store Connect / Play Console.
- **Min OS targets:** Expo SDK 53 supports iOS 15+, Android 7+. Confirm acceptable.
- **EAS Build vs local prebuild** — recommend EAS for first ship (free tier sufficient), but adds Expo account dependency.

---

**Status:** DONE
**Summary:** Opinionated picks delivered for all 8 questions; flat Expo+TS project with Expo Router, NativeWind, SecureStore, Context-only state, and a single-screen translate UI with horizontal dual-panel split.
**Concerns/Blockers:** Background-audio entitlement and WebRTC-vs-WebSocket path for OpenAI Realtime are unresolved — both affect whether Expo Go is usable in dev or whether dev-client is mandatory from day one.
