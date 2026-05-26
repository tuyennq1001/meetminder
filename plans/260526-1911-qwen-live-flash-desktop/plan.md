---
title: "Migrate desktop Qwen engine: Omni Plus → LiveTranslate Flash"
description: "Replace Qwen-Omni Plus realtime client (with RMS-VAD) by Qwen LiveTranslate Flash, mirroring mobile v0.4.3"
status: pending
priority: P1
effort: 6h
branch: feature/openai-realtime
tags: [qwen, realtime, dashscope, migration, desktop, tauri]
created: 2026-05-26
---

## Overview

Desktop app currently runs `qwen3.5-omni-plus-realtime` with client-side RMS-VAD in Rust. Mobile v0.4.3 already moved to `qwen3-livetranslate-flash-realtime` (server-VAD, text-only, 60+ langs, source lang must be explicit). This plan ports the same swap to desktop. Strategy = REPLACE (no toggle, no dual-mode).

## Phases

| # | File | Status | Effort | Blockers |
|---|------|--------|--------|----------|
| 01 | [phase-01-rust-backend-rewrite.md](phase-01-rust-backend-rewrite.md) | pending | 2h | — |
| 02 | [phase-02-js-client-rewrite.md](phase-02-js-client-rewrite.md) | pending | 45m | 01 (event schema) |
| 03 | [phase-03-settings-and-ui-strings.md](phase-03-settings-and-ui-strings.md) | pending | 30m | — |
| 04 | [phase-04-language-list-and-source-picker.md](phase-04-language-list-and-source-picker.md) | pending | 1h | 03 |
| 05 | [phase-05-app-js-wiring.md](phase-05-app-js-wiring.md) | pending | 45m | 02, 04 |
| 06 | [phase-06-verify-and-test.md](phase-06-verify-and-test.md) | pending | 1h | 01–05 |

## Key Dependencies

- Mobile reference (authoritative): `my-translator-mobile/src/engines/qwen-realtime-client.ts`
- Mobile lang list: `my-translator-mobile/src/lib/languages.ts` (`QWEN_LANGS`, 60 entries)
- Existing desktop files to mutate:
  - `src-tauri/src/commands/qwen_realtime.rs` (486 lines, full rewrite)
  - `src-tauri/src/settings.rs` (drop `qwen_audio_output`)
  - `src/js/qwen-realtime-client.js` (148 → ~120 lines, full rewrite)
  - `src/js/settings.js` (drop `qwen_audio_output`)
  - `src/js/app.js` (rewrite `_startQwenMode`, update `_refreshTargetLangList`, add source-lang refresh)
  - `src/index.html` (engine card/option labels + hint copy + lang option lists optional)

## File Ownership (parallel-safe groupings)

- Phases 01 and 03 touch disjoint files → can run in parallel.
- Phase 02 reads Phase 01 event names (read-only dep).
- Phase 04 modifies `app.js` `_refreshTargetLangList`; Phase 05 modifies `_startQwenMode` — different functions, same file. Serialize 04 → 05.

## Cross-Cutting Risks

1. **Settings schema drift** — removing `qwen_audio_output` is a breaking serde change. Existing field uses `#[serde(default)]` at struct level → unknown fields are silently dropped on read (verified line 23 `#[serde(default)]`). Removing the field is safe; old saved JSON still loads. Confirm in Phase 01.
2. **Live Flash rejects `source=auto`** — must guard at JS connect time and fall back to `en` (mirror mobile line 105–108). Phase 04 enforces UI also disallows "auto" when engine=qwen.
3. **Translation directive locked via `translation.language` field** — no more freeform `instructions` prompt. Verify target language compliance on `vi`/`ja` in Phase 06.
4. **Old benchmark reports stale** — `benchmark-260523-0701-qwen-coherence-improvement.md` and variant-K sweep reports describe Omni-Plus + RMS-VAD; flag stale in plan footer but do not delete (historical record).
5. **Vietnamese user docs** — desktop has `installation_guide_vi.md`, no Qwen-specific API key doc. Optional follow-up: add `docs/api-key-guide-vi.md` analogue if mobile shipped one. Out of scope for this plan; note as follow-up.
6. **Auto-reconnect loop** (`app.js` line 1556–1564) — survives because event surface only shrinks (no new failure modes). Recheck after Phase 05.

## Test Matrix

| Layer | Unit | Integration | E2E |
|-------|------|-------------|-----|
| Rust session | n/a (no pure-fn extracted) | `cargo check` + manual session in dev | full Start/Stop in app |
| JS client | n/a (thin IPC wrapper) | event roundtrip via console | dual-panel UI render |
| Settings serde | manual: load pre-migration JSON | verify `qwen_audio_output` ignored | save → reload → no diff |
| Lang picker | DOM-rebuild on engine switch | source-lang "auto" → snaps to "en" | Vietnamese/Japanese translation test |

## Rollback

Each phase touches disjoint or small-region edits; revert via git revert on a per-phase commit basis. The Rust rewrite is the riskiest — keep commits small (one per phase). If Phase 06 reveals broken language compliance, fall back to git revert of Phases 01+02 and ship without engine change.

## Success Criteria

- App starts, engine pill = Qwen, status reaches "connected" in < 5s.
- Live Vietnamese translation appears from English mic input; provisional ticks visible.
- Switching source lang between `en` / `ja` works without reconnect errors.
- No `instructions` / `voice` / `audio_output` / `RMS_VAD` references remain in repo (excluding benchmark reports).
- `cargo check` clean; app launches in `pnpm tauri dev`.

## Out of Scope

- Two-way mode for Qwen (Live Flash session has single `translation.language`; two-way would need session reset per direction — defer).
- Voice/TTS for Qwen output (Live Flash modalities locked to text).
- Updating historical benchmark reports.
- Adding `docs/api-key-guide-vi.md` for Qwen (defer to follow-up).

## Unresolved Questions

1. Should we hide the "Auto-detect" source option entirely when engine=qwen, or just snap it to `en` on save? Mobile snaps in client. Recommend: same — JS guard in `_startQwenMode` + UI keeps option but shows warning hint.
2. Two-way mode flag — should the engine picker disable two-way when qwen selected (current Soniox/OpenAI flow has two_way path)? Suggest: disable two-way for qwen for now, document as known limitation.
