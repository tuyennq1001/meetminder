# OpenAI gpt-realtime-translate Integration

**Created:** 2026-05-08
**Target version:** v0.6.0
**Status:** Planning → Ready to execute

## Goal

Add OpenAI's new `gpt-realtime-translate` (GA May 2026) as a third translation provider alongside existing **Soniox cloud** and **MLX local**. The OpenAI provider returns translated text + translated speech audio in one stream — no separate TTS needed.

## Why

- Lower latency (estimated ~500–800ms vs Soniox ~2–3s).
- Single-stream design reduces glue code (text + audio together).
- Tone/emotion preservation reportedly better than traditional MT pipelines.
- Cost trade-off: $2.04/hr vs Soniox $0.12/hr (17×). User opt-in only.

## Source reports

- API research: [researcher-260508-2010-gpt-realtime-integration.md](../reports/researcher-260508-2010-gpt-realtime-integration.md)
- Architecture scan: [scout-260508-2010-current-architecture.md](../reports/scout-260508-2010-current-architecture.md)

## Key technical decisions

| Decision | Choice | Why |
|---|---|---|
| WebSocket location | Rust backend | Browser WS API can't set `Authorization` header; backend keeps key safe |
| Audio resample | Rust side, 16k → 24k | OpenAI requires 24kHz PCM; do it once in capture pipeline |
| Resampler crate | `rubato` | Already de-facto Rust standard; quality > linear |
| Output audio playback | Web Audio API in JS | Reuse existing audio player; bypass TTS pipeline entirely |
| Two-way mode | NOT supported in v1 | gpt-realtime-translate is single-direction; gate behind one-way only |
| TTS toggle | Force-disabled when provider = openai | Audio comes built-in |
| Session limit | Auto-reconnect at 60min | Use `previous_response_id` for context restore |
| Cost guard | Inline warning in UI | "$2.04/hr — 17× Soniox" near provider selector |

## Phases

| # | File | Status | Owner | Est |
|---|---|---|---|---|
| 1 | [phase-01-backend-foundation.md](phase-01-backend-foundation.md) — Settings field + audio resampler util + Tauri command skeleton | ☐ | backend | 2h |
| 2 | [phase-02-rust-websocket-client.md](phase-02-rust-websocket-client.md) — Rust WS client to OpenAI, event parsing, Tauri channel emit | ☐ | backend | 4h |
| 3 | [phase-03-frontend-client.md](phase-03-frontend-client.md) — JS wrapper module + Web Audio output queue | ☐ | frontend | 3h |
| 4 | [phase-04-ui-and-app-wiring.md](phase-04-ui-and-app-wiring.md) — Settings UI, provider dropdown, app.js branch, cost warning | ☐ | frontend | 2h |
| 5 | [phase-05-testing-and-docs.md](phase-05-testing-and-docs.md) — End-to-end test, changelog, README, install guide | ☐ | mixed | 2h |

**Total estimate:** ~13h dev + QA.

## Dependencies between phases

```
phase-01 ──► phase-02 ──► phase-03 ──┐
                                     ├──► phase-04 ──► phase-05
                          phase-03 ──┘
```

Phase 1 must finish before 2 (settings field + resampler used by WS client).
Phase 3 can start once phase 2 has stub Tauri command emitting events.
Phase 4 depends on both 2 and 3.
Phase 5 last.

## Out of scope (v1)

- Two-way mode for OpenAI provider (gate to one-way only; revisit when OpenAI adds dual output).
- `gpt-realtime-whisper` STT-only mode (separate provider; Soniox already covers STT well at lower cost).
- `gpt-realtime-2` voice agent reasoning (different use case — agent, not translation).
- Cost dashboard / per-session usage tracking (nice-to-have, not blocking).
- Custom voice picking for output speech (use OpenAI default voice in v1).

## Risks

1. **Latency in real-world conditions unverified.** Mitigation: phase 5 measures actual TTFT.
2. **Vietnamese output quality untested.** Mitigation: ship as opt-in; user can switch back to Soniox.
3. **Browser WS in Tauri WebView may have quirks.** Mitigation: WS lives in Rust, not WebView.
4. **24kHz output audio playback** — need to handle PCM playback at 24kHz not 16kHz. Web Audio API supports this natively.
5. **Cost runaway** — show big warning + log estimated cost per session.

## Success criteria

- [ ] User can pick "OpenAI Realtime" in Settings, paste API key, restart, and start translating.
- [ ] Translated text appears in transcript view as audio plays through speakers.
- [ ] No regressions in Soniox or Local MLX modes.
- [ ] Audio resampling 16k→24k doesn't introduce audible artifacts.
- [ ] Auto-reconnect works when session hits 60-minute boundary (or on 1006 close).
- [ ] Cost warning is visible before user activates OpenAI provider.
