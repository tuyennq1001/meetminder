# Benchmark FINAL: OpenAI Realtime vs Qwen-Omni (best config)

**Date:** 2026-05-23
**Audio:** Hope-v2 — Japanese, ~302s (~5 min). Uematsu Tsutomu talk. JA → VI.
**Method:** Node script streams PCM to each WS at 1x speed, 100ms chunks.
**Scripts:** `benchmark-realtime.cjs`, `benchmark-qwen-commit.cjs`.

**Supersedes:** [benchmark-260522-2339-openai-vs-qwen-realtime.md] (Qwen
under server-VAD — wrong default, dropped 80% of content) and
[benchmark-260523-0025-qwen-config-variant-sweep.md] (no `session.update`
tuning fixes it) and [benchmark-260523-0040-qwen-manual-commit-fix.md]
(root cause + fix).

---

## TL;DR

| | OpenAI Realtime | **Qwen-Omni (manual-commit 5s)** |
|---|---|---|
| **Completeness** | ~full, 3790 VI chars | **~full, 3611 VI chars** |
| **Empty/dropped turns** | n/a (delta stream) | **0 of 61** |
| **First translated text** | 14.6s | **5.4s** |
| **Quality** | high, natural | high, natural |
| **Price** | ~$4 / hr | **free (preview)** |
| **Verdict** | production-ready (default) | **production-viable (free option)** |

**Bottom line — changed from the earlier benchmark:** Qwen, configured
correctly, is **as complete as OpenAI** and **faster to first token**. The
~80% content-loss seen previously was caused by Qwen's server-VAD, not the
model. Switching to client-driven manual-commit eliminates the loss.

---

## 1. Completeness — was the whole talk translated?

| Engine | VI chars produced | Empty turns | Notes |
|---|---|---|---|
| OpenAI | 3790 | n/a — continuous delta stream, no turns | full transcript intact |
| Qwen (server-VAD, old) | 743 | 7/21 (~33%) | **80% of content dropped** |
| **Qwen (manual-commit 5s)** | **3611** | **0/61** | full transcript intact |

- Both engines now translate **the entire 5-minute talk end to end**.
- Qwen's VI char count is slightly lower (~5% less) but spot-checking shows
  no missing content — just slightly more compact phrasing.

## 2. Latency — time to first translated text

| Engine | First target text |
|---|---|
| OpenAI | 14.6s |
| Qwen (server-VAD, old) | 16.7s |
| **Qwen (manual-commit 5s)** | **5.4s** |

- Manual-commit makes Qwen **~9s faster** to first output than OpenAI,
  because the first turn finalizes on the fixed 5s timer rather than waiting
  for the speaker's first natural pause + buffering.
- OpenAI's 14.6s is dominated by the talk's long opening pause before the
  first utterance. Not an engine flaw, but a real UX difference: Qwen feels
  much more responsive at the start of a session.
- Steady-state streaming feel: OpenAI is a continuous live caption; Qwen is
  discrete 5s segments. Both are usable; different UX shape.

## 3. Quality of translation

Both engines produce **natural, accurate Vietnamese**. Spot checks:

- JA `はいでは皆さん改めましてこんにちは` →
  OpenAI: `Vâng, vậy thì, xin chào mọi người lần nữa.`
  Qwen:   `Vâng, thưa quý vị, một lần nữa xin chào.`
- Both handle long narrative passages (grandmother / Karafuto / Apollo)
  coherently and fluently.
- OpenAI artifact: leaves some proper nouns romanized (e.g. `Omo wa
  manekuuchi` instead of translating 思うは招く). Qwen translates it as
  "câu chuyện về việc suy nghĩ sẽ dẫn đến hành động" — context-rendered
  rather than literal.
- Qwen artifact (manual-commit only): segments are cut at the fixed 5s
  boundary, so sentences sometimes split (e.g. "Ví dụ như cái này." /
  "À." / "Chiếc xe này"). Meaning stays coherent across cuts; live-caption UX
  is fine.
- Qwen artifact (manual-commit only): the very first commit (before any
  speech) makes Qwen emit a self-intro like "Xin chào, tôi là trợ lý..." or
  "Vỗ tay" (applause). Skip segment 0 in the client.

**Verdict on quality:** roughly even. OpenAI has marginally better proper-noun
handling on this clip; Qwen has marginally better idiomatic Vietnamese. No
deal-breakers either way.

## 4. Price

| Engine | Pricing | 5-min session | 1 hour |
|---|---|---|---|
| OpenAI Realtime | ~$4 / hr (paid, billed to user key) | ~$0.33 | $4.00 |
| Qwen-Omni Realtime | **free** (DashScope preview) | $0 | $0 |

- Qwen is free **for now**; DashScope states pricing may change post-preview.
- OpenAI is real money but modest per session; sustainable for low-volume
  personal use, costly for always-on / heavy use.
- **At equal quality and completeness, "free" is a decisive advantage** for
  any user willing to accept preview-status risk.

## 5. Architectural notes (developer-facing)

| | OpenAI translations endpoint | Qwen (manual-commit) |
|---|---|---|
| Endpoint | `/v1/realtime/translations` | `/v1/realtime?model=qwen3.5-omni-plus-realtime` |
| Segmentation | none — delta-only stream | client-driven, every 5s |
| `session.update` | minimal | `turn_detection: null`, modalities `["text","audio"]` |
| Client work | accumulate deltas, no `.done` ever | timer → `commit` + `response.create` every 5s |
| Audio | PCM 24kHz | PCM 16kHz |

The Qwen client must be slightly more active (own a timer, fire commits).
The OpenAI client is simpler (just stream and accumulate) but loses VAD
segmentation entirely — segments are synthesized client-side.

---

## Recommendation

1. **Keep OpenAI as the default engine** for users with an OpenAI key — most
   battle-tested, slightly better source coverage, no preview risk.
2. **Promote Qwen from "preview/experimental" to a real option** once the
   provider is switched to manual-commit. It is genuinely competitive on
   completeness and quality, faster to first token, and free.
3. **Update the Qwen provider** in `my-translator-mobile`: set
   `turn_detection: null`, add a 5s commit timer, suppress the first segment
   (pre-speech intro artifact). See [benchmark-260523-0040-qwen-manual-commit-fix.md]
   for the exact protocol.

## Unresolved questions

- Will Qwen's pricing survive the preview period at $0, or will it move to a
  paid tier? Affects long-term recommendation order.
- Manual-commit segment cuts are arbitrary (5s wall-clock, not sentence
  boundaries). Acceptable for live captions; revisit if discrete "sentence
  cards" UX is wanted (could try adaptive commit on detected client-side
  silence).
- Pre-speech intro artifact: confirm it's always segment index 0 so a fixed
  skip is safe across recording conditions.
- Not yet validated on physical iOS device — pending phase-06 device test.
