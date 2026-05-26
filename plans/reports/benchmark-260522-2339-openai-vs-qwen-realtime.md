# Benchmark: OpenAI Realtime vs Qwen-Omni Realtime

> **⚠ SUPERSEDED 2026-05-23 —** the Qwen numbers below were measured under
> server-VAD, which is the wrong default. With manual-commit, Qwen reaches
> ~full coverage and BEATS OpenAI on first-token latency (5.4s vs 14.6s).
> See **[benchmark-260523-0050-final-openai-vs-qwen-best.md]** for the
> current comparison. Root cause + fix:
> [benchmark-260523-0040-qwen-manual-commit-fix.md].

**Date:** 2026-05-22
**Audio:** Hope-v2.mp4 — Japanese speech, ~302s (~5 min). Uematsu Tsutomu talk.
**Task:** real-time speech translation Japanese → Vietnamese
**Method:** Node script streams PCM to each engine's WebSocket at 1x wall-clock
speed (100ms chunks), records every event with timestamps. Sequential runs (no
network contention). Script: `my-translator-mobile/benchmark-realtime.cjs`.

---

## TL;DR

| | OpenAI Realtime | Qwen-Omni Realtime |
|---|---|---|
| **Latency (first text)** | 14.6s | 16.7s |
| **Translation completeness** | ~full (3790 chars VI) | **severe loss (743 chars VI)** |
| **Coverage** | whole talk translated | ~20% — 7/21 segments empty |
| **Quality (translated parts)** | high, natural | high, natural |
| **Price** | ~$4/hr (paid) | free (preview) |
| **Verdict** | **production-ready** | not reliable yet — drops content |

**Bottom line:** OpenAI wins decisively on the metric that matters most —
*completeness*. Qwen's translated sentences are good quality, but it silently
drops the majority of the audio. Qwen's free pricing does not compensate for
losing 80% of the content.

---

## 1. Latency (time to first translated text)

| Engine | First source text | First target text |
|--------|-------------------|--------------------|
| OpenAI | 14.6s | 14.6s |
| Qwen   | 16.8s | 16.7s |

- Both ~similar; OpenAI ~2s faster to first output.
- High absolute latency (~15s) on both — driven by the long opening pause +
  buffering before the first utterance finalizes. Not a per-engine flaw.
- **Streaming behavior differs fundamentally** (see §3) — this single number
  understates how differently they feel in use.

## 2. Translation completeness — THE decisive difference

| Engine | Source chars captured | Target chars produced |
|--------|----------------------|----------------------|
| OpenAI | 1992 (delta stream) → full transcript | **3790** |
| Qwen   | 1029 (21 segments)   | **743** |

- OpenAI translated essentially the **entire 5-minute talk**, end to end.
- Qwen produced only **743 chars of Vietnamese** — roughly **20%** of the
  content. **7 of 21 segments had an empty target** (source transcribed, but no
  translation emitted). Several more were truncated mid-sentence ("V", "Nh",
  "Đối").
- Qwen captured source audio reasonably (long Japanese segments transcribed
  fine) but the **translation step dropped most of it** — the omni model under
  server-VAD does not reliably translate every committed turn.

## 3. Streaming architecture — they are not the same shape

| | OpenAI translations endpoint | Qwen-Omni realtime |
|---|---|---|
| Segmentation | none — continuous delta stream | server-VAD turn segments |
| Events | `*.delta` only, no `.done` | `.completed` / `.done` per turn |
| Feel | continuous live caption | discrete sentence cards |

- **OpenAI** (`/v1/realtime/translations`): a dedicated translation endpoint.
  Streams `session.input_transcript.delta` + `session.output_transcript.delta`
  continuously. Never sends `.done` — no VAD boundaries. Best modeled as a
  rolling live subtitle.
- **Qwen** (`qwen3.5-omni-plus-realtime`): a general omni model. Server VAD
  commits each turn, emits `.completed` (source) and `.text.done` /
  `.audio_transcript.done` (target). Discrete segments — but this is also where
  content gets dropped (a turn can finalize with no translation).
- App impact: the OpenAI client must synthesize segment boundaries itself; the
  Qwen client gets them free from VAD. Both client implementations already
  handle their respective shapes.

## 4. Quality of the parts that *were* translated

Both engines, where they produced output, translated to **natural, accurate
Vietnamese**. Examples:

- JA `はいでは皆さん改めましてこんにちは` →
  OpenAI `Vâng, vậy thì, xin chào mọi người lần nữa.` /
  Qwen `Vâng, thưa mọi người, xin chào lần nữa.` — both good.
- OpenAI handled long narrative passages coherently (grandmother / Karafuto /
  Apollo story all intact and fluent).
- OpenAI minor artifacts: left some proper nouns romanized (`Omo wa manekuuchi`
  for 思うは招く) instead of translating the phrase.
- Qwen's translated segments read just as naturally — quality is **not** the
  problem; coverage is.

## 5. Price

| Engine | Pricing | 5-min session cost |
|--------|---------|--------------------|
| OpenAI | ~$4 / hour (paid, billed to user key) | ~$0.33 |
| Qwen   | free (DashScope preview) | $0 |

- Qwen is free **for now** — DashScope states pricing may change once it leaves
  preview.
- OpenAI's cost is real but modest per session.

---

## Recommendation

1. **Keep OpenAI as the default voice+text engine.** It is the only one that
   reliably translates a full conversation.
2. **Keep Qwen available as a free option**, but it should be presented as
   *preview / experimental* (already done in Settings UI) — users must know it
   can drop content.
3. Qwen content-loss is the blocker. Worth a follow-up investigation before
   recommending Qwen for anything beyond short utterances.

## Unresolved questions

- Why does Qwen finalize turns with an empty translation? Possible causes:
  modality config (`["text"]` vs `["text","audio"]`), VAD `silence_duration_ms`
  too aggressive splitting mid-thought, or the omni model deprioritizing the
  translation instruction under rapid turns. Needs an isolated retry with
  `["text","audio"]` + longer VAD silence.
- Does Qwen drop less content with shorter `silence_duration_ms` or with manual
  commit instead of server-VAD?
- OpenAI proper-noun romanization — acceptable, or worth a prompt tweak? (The
  translations endpoint has no `instructions` knob — limited control.)
- Latency was measured off-device over a Node WebSocket. On-device iOS
  (NSURLSession header-auth, real mic) may differ — still pending physical
  device test per phase-06.
