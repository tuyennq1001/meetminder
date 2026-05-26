# Phase 4 — UI Polish

**Priority:** P1 · **Effort:** M (~4h)

## Goal
Apply the wireframe from the UI research report. Two screens (Translate + Settings), NativeWind styling, dark mode auto, dual-panel toggle, font A−/A+, language picker bottom sheet.

## Files to read for reference
- /Users/phucnt/workspace/my-translator/plans/reports/researcher-260514-0049-rn-ui-structure.md (entire — wireframe + component breakdown)
- /Users/phucnt/workspace/my-translator/src/js/ui.js (skim only — desktop reference for what NOT to copy; mobile is simpler)

## Files to create (under /Users/phucnt/workspace/my-translator-mobile/)
- `src/components/start-stop-button.tsx` — 80pt circular, red pulsing when live
- `src/components/language-picker-sheet.tsx` — `@gorhom/bottom-sheet` + search TextInput + FlatList. Accepts list source (Soniox or OpenAI langs) and current selection
- `src/components/engine-pill.tsx` — top-bar chip showing current engine; tap → toggle Soniox ↔ OpenAI
- `src/components/transcript-stream.tsx` — auto-scrolling FlatList; "Jump to live" pill if user scrolled up >100pt; renders source + translation rows when dual mode on, only translation when off
- `src/components/font-size-controls.tsx` — A− / current / A+ buttons, persists to SecureStore (key `pref.fontSize`)
- `app/settings.tsx` — full implementation:
  - Soniox key input (masked, paste button, "saved" indicator)
  - OpenAI key input (masked, paste button)
  - Default engine radio (Soniox / OpenAI)
  - Default source lang chip (opens sheet)
  - Default target lang chip (opens sheet)
  - Default font size buttons
  - "Clear all data" destructive button (wipes SecureStore + AsyncStorage)
- `app/index.tsx` — final layout per wireframe in research report
- `src/state/settings-context.tsx` — flesh out: load from SecureStore on mount, expose setters, persist on change

## Step-by-step todo
- [ ] Build component shells with hardcoded data, verify visuals match wireframe in light + dark mode
- [ ] Wire `SettingsContext` to SecureStore: on mount load `apikey.soniox`, `apikey.openai`, `pref.engine`, `pref.sourceLang`, `pref.targetLang`, `pref.fontSize`
- [ ] Replace phase 2/3 hardcoded values with `useSettings()` reads
- [ ] Implement dual-panel toggle in `TranscriptStream`: state `panelMode: 'single' | 'dual'`, persisted in SettingsContext
- [ ] Font size A−/A+ updates `text-[Npx]` class on transcript rows
- [ ] Status dot in top bar: green (streaming), yellow (connecting), red (error), gray (idle) — driven by SessionContext.status
- [ ] First-launch flow: if no keys saved, redirect to Settings before Translate screen renders
- [ ] Verify dark mode follows OS via `useColorScheme()` — no manual toggle in MVP

## Acceptance criteria
- [ ] App opens to Translate screen if keys present, else Settings
- [ ] Switching engine pill mid-session warns "Stop first" (do not auto-restart)
- [ ] Lang picker bottom sheet: search filters in real time, tap row dismisses sheet and updates chip
- [ ] Dark mode looks correct on both platforms; no white flashes on screen transitions
- [ ] No layout jank when transcript grows past screen height (FlatList virtualization OK)

## Risk + mitigation
- **NativeWind v4 + bottom-sheet portal interactions** — sometimes themes don't apply inside the sheet. Mitigation: wrap sheet children in an explicit `<View className="bg-white dark:bg-zinc-900">`.
- **FlatList auto-scroll fighting user scroll** — use `onScroll` to detect user-initiated scroll-up; pause auto-scroll, show pill; resume on pill tap.
