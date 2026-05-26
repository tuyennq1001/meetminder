# Phase 06 — Verify & Test

## Context Links

- All prior phases.
- Mobile precedent: v0.4.3 shipped; same model + same payload.

## Overview

- **Priority:** P1
- **Status:** pending
- **Description:** Static checks (cargo + JS lint), manual end-to-end run, mode-switch matrix, observability sweep. Document stale benchmark reports.

## Key Insights

- No automated test harness exists for the realtime path — manual smoke required.
- Live Flash returns text-only; observable in dev console + main translation panel.
- Source language compliance must be verified on at least two pairs (en→vi, ja→en) because mobile reports auto-detect breaks on real mic.

## Test Matrix

| # | Check | How | Pass criteria |
|---|-------|-----|---------------|
| T1 | Rust compiles | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0, no warnings beyond baseline |
| T2 | Settings load with stale `qwen_audio_output` field | Hand-edit `~/Library/Application Support/com.personal.translator/settings.json` adding `"qwen_audio_output": true` | App loads; field silently dropped on next save |
| T3 | App launches | `pnpm tauri dev` | Window opens; engine pill shows current engine |
| T4 | Engine swap to Qwen | Settings → engine dropdown → "Qwen LiveTranslate Flash" | Lang lists rebuild to QWEN_LANGS; source snaps off "auto" |
| T5 | Connect en→vi | Save settings, hit Start (mic source), speak English | Status "connected" < 5s; provisional Vietnamese ticks; final segment appears |
| T6 | Connect ja→en | Switch source = ja, target = en, restart | Japanese mic → English text |
| T7 | Stop mid-utterance | Speak ~2s of English, hit Stop | Last provisional flushes as final segment (no orphaned text) |
| T8 | Auto-reconnect | Toggle wifi off briefly during session | App shows "session closed — reconnecting"; reconnects on wifi up |
| T9 | Engine swap back | Switch to Soniox during a session | Qwen client closes cleanly; Soniox starts |
| T10 | Lang outside QWEN_LANGS | Set target = `cy` (Welsh) on Soniox, switch engine → Qwen | Target snaps to `vi`; no error |
| T11 | Settings persistence | Save settings, restart app | Settings reload without `qwen_audio_output` |
| T12 | Grep verification | `grep -rn "qwen3.5-omni\|qwen_audio_output\|onSourceProvisional\|targetLanguageName\|qwenOutputQueue" src src-tauri/src` | 0 hits |

## Related Code Files

### Read only (verify state)

- `src-tauri/src/commands/qwen_realtime.rs`
- `src-tauri/src/settings.rs`
- `src/js/qwen-realtime-client.js`
- `src/js/qwen-langs.js`
- `src/js/settings.js`
- `src/js/app.js`
- `src/index.html`

### Update (docs)

- `docs/project-changelog.md` — add entry for desktop Qwen migration
- (optional) Append "STALE" note to top of:
  - `plans/reports/benchmark-260523-0701-qwen-coherence-improvement.md`
  - `plans/reports/benchmark-260523-0050-final-openai-vs-qwen-best.md`
  - `plans/reports/benchmark-260523-0040-qwen-manual-commit-fix.md`
  - `plans/reports/benchmark-260523-0025-qwen-config-variant-sweep.md`
  - `plans/reports/benchmark-260522-2339-openai-vs-qwen-realtime.md`
  Note: these target Omni-Plus + RMS-VAD which no longer exists; preserve for historical record but mark superseded.

## Implementation Steps

1. Run `cargo check`. Address any warnings.
2. Run T2 (settings backward-compat).
3. Launch `pnpm tauri dev`. Walk T3 → T12.
4. For each test, capture in this phase doc as ✓ / ✗ + evidence (1 line).
5. Update changelog with entry like:
   ```
   ## [Desktop] 2026-05-26 — Qwen LiveTranslate Flash
   - Migrated Qwen engine from `qwen3.5-omni-plus-realtime` to `qwen3-livetranslate-flash-realtime`.
   - Removed client-side RMS-VAD; server VAD now drives turn detection.
   - Text-only modality; 60+ target languages; source language now explicit.
   - Mirrors mobile v0.4.3. See plans/260526-1911-qwen-live-flash-desktop/.
   ```
6. Append "**STALE** — superseded by LiveTranslate Flash migration 2026-05-26" header to the five benchmark reports listed above.

## Todo List

- [ ] T1 cargo check
- [ ] T2 settings backward-compat
- [ ] T3 app launch
- [ ] T4 engine swap
- [ ] T5 en→vi live
- [ ] T6 ja→en live
- [ ] T7 stop mid-utterance flush
- [ ] T8 auto-reconnect
- [ ] T9 engine swap back
- [ ] T10 unsupported lang fallback
- [ ] T11 settings persistence
- [ ] T12 grep verification
- [ ] Update `docs/project-changelog.md`
- [ ] Mark stale benchmark reports

## Success Criteria

- T1–T12 all pass.
- Changelog updated.
- Stale reports flagged.
- No regression on Soniox / OpenAI paths (spot-check T3 with each engine before declaring done).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Live Flash target lang non-compliance (e.g., outputs English when asked vi) | Low | High | Mobile already verified on v0.4.3; if regressed, inspect WS frames via `eprintln!` already in `handle_server_event`. |
| Server VAD drops mid-sentence | Low | Med | Documented in mobile report; flushPending fallback covers stop case. Live cases — accept server behavior. |
| Reconnect storm on bad key | Med | Low | Existing 1s setTimeout backoff; error toast informs user. |
| Test signing cert missing in dev | Low | Low | `pnpm tauri dev` (unsigned) is sufficient for smoke. Release-signing untouched. |

## Security Considerations

- API key roundtrip — confirm DevTools network panel never logs the key (Tauri IPC layer keeps it server-side).
- Pre-commit: confirm no `qwen_api_key` value committed.

## Next Steps

- Tag release after successful T1–T12.
- Follow-up: optional `docs/api-key-guide-vi.md` for Qwen DashScope key acquisition (Vietnamese).
- Follow-up: re-enable two-way mode for Qwen by sending two `session.update`s (one per direction) — design TBD.
