# Phase 5 — Testing, Docs, Release

**Status:** ☐ Pending
**Estimate:** 2h
**Owner:** Mixed
**Depends on:** phases 1-4

## Overview

End-to-end smoke test, latency measurement, docs/changelog updates, version bump to 0.6.0, tag release.

## Test plan

### A. Connection & basic flow (must pass)

1. Settings → pick "OpenAI Realtime" → paste valid key → save.
2. Switch to one-way mode, source = `auto`, target = `vi`.
3. Hit Start. Status should go: `connecting` → `listening` within 2s.
4. Speak a short EN sentence ("hello, this is a test").
5. Within ~1s expect:
   - Translated text "xin chào, đây là một bài thử" (or similar) in transcript.
   - Vietnamese speech audible from speakers.
6. Stop. No errors in console.

### B. Latency measurement

Add temporary `console.time` / `console.timeEnd` markers:
- T0: first PCM byte sent after speech_started.
- T1: first `response.audio_transcript.delta`.
- T2: first `response.audio.delta`.

Target: T1-T0 < 1000ms; T2-T0 < 1500ms. Document actual numbers in changelog.

### C. Language coverage spot check

Run a 10-second test for each combo. Just verify text appears (subjective quality is QA, not gating):

| Source | Target | Pass? |
|---|---|---|
| en | vi | ☐ |
| ja | vi | ☐ |
| ko | vi | ☐ |
| zh | vi | ☐ |
| en | ja | ☐ |
| vi | en | ☐ |

### D. Error paths

- Empty key → expect inline error before start.
- Invalid key → expect `error` event with auth code; UI shows error status.
- Network drop mid-session → expect auto-reconnect within 1s.
- Stop mid-utterance → audio queue flushes, no zombie audio.

### E. Provider switch hygiene

- Start in Soniox, stop, switch to OpenAI, start. No leak from previous session.
- Switch back to Soniox. Full language list restored. TTS toggle re-enabled.

### F. Regression: existing modes still work

- Soniox EN→VI one-way: works.
- Soniox JA↔VI two-way: works.
- Local MLX: works (if MLX env installed).
- TTS providers (Edge / Google / ElevenLabs) in Soniox mode: works.

## Docs to update

### 1. `docs/project-changelog.md` — new entry

```md
## v0.6.0 - 2026-05-XX

### New Features

- **OpenAI Realtime translation provider**: added `gpt-realtime-translate` (May 2026 GA) as a third provider alongside Soniox and Local MLX. Streams translated text + translated speech audio in a single WebSocket connection — no separate TTS step. Lower latency than Soniox in our tests (~XXms vs ~Ys).
- 13 output languages supported: en, es, pt, fr, de, it, ru, hi, id, vi, ja, ko, zh.

### Caveats

- Cost: $0.034/min (~$2/hr) — about 17× Soniox. Charged to user's OpenAI account. Cost warning shown in Settings.
- Two-way mode and custom TTS provider are unavailable while using OpenAI Realtime (audio is streamed natively).
- Thai is not supported by OpenAI Realtime; users must stick with Soniox/Local for Thai output.

### Technical

- Added `rubato`-based 16k→24k upsampler in Rust audio pipeline.
- Tauri command surface: `openai_realtime_start`, `openai_realtime_send_audio`, `openai_realtime_stop`.
- Web Audio API output queue plays continuous 24kHz s16le PCM.
```

### 2. `README.md` — Provider table

Add a row for OpenAI in the providers table. Update the "Translation backends" section to mention 3 options.

### 3. `docs/installation_guide.md` & `installation_guide_vi.md`

Add a short section "Using OpenAI Realtime":
- Get API key at platform.openai.com
- Paste in Settings → Translation provider → OpenAI Realtime
- Cost note

### 4. `AGENTS.md` — if it has a provider list, update it.

## Version bump

Three files (matching existing pattern):
- `package.json`: `"version": "0.6.0"`
- `src-tauri/Cargo.toml`: `version = "0.6.0"`
- `src-tauri/tauri.conf.json`: `"version": "0.6.0"`

Run `cargo check` to bump `Cargo.lock`.

## Release flow

1. Commit all phase work in logical groups (feat: backend, feat: frontend, docs: changelog).
2. Final commit: `feat: add OpenAI Realtime translation provider (v0.6.0)`.
3. Push to main.
4. Tag `v0.6.0`, push tag.
5. Watch GitHub Actions release workflow — should auto-build mac (arm/intel) + win and publish a draft.
6. Manually QA the draft release notes (now sourced from `docs/project-changelog.md` per workflow change in v0.5.2).
7. Publish via `gh release edit v0.6.0 --draft=false`.

## Todo list

- [ ] Run all tests in section A–F
- [ ] Record actual latency numbers (T1-T0, T2-T0) for changelog
- [ ] Update `docs/project-changelog.md`
- [ ] Update `README.md` providers table
- [ ] Update both `installation_guide*.md`
- [ ] Bump version to 0.6.0 in 3 files
- [ ] `cargo check` to bump Cargo.lock
- [ ] Commit, push, tag, watch CI, publish

## Success criteria

- All test sections A–F pass on macOS.
- Latency numbers documented.
- Release v0.6.0 published with artifacts for mac + win.
- No regressions in existing modes.

## Risks

- **Windows untested locally** — same situation as v0.5.2/v0.5.3. Rely on CI compile + user feedback. If a Windows-specific bug appears, hotfix v0.6.1.
- **OpenAI translation schema may have shifted** between research date and our implementation — first connection may surface schema errors. Use `error` event to diagnose; iterate quickly via tag bumps.
- **Latency numbers may disappoint** — if not noticeably faster than Soniox, the cost can't be justified. Document honestly; user opts in or doesn't.

## Unresolved questions (for runtime to answer)

1. Does `previous_response_id`-based reconnect actually preserve context, or is it just metadata? Test at 60-min boundary post-launch.
2. Vietnamese / Japanese / Korean translation quality vs Soniox — needs user QA over real conversations, not benchmarkable in 2h smoke test.
3. Concurrent session limit per OpenAI key tier — only matters if user runs multiple windows; document discovered limit if hit.
