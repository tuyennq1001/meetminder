# Qwen-Omni Realtime engine — feature archive

**Status:** Shipped in mobile v0.4.1 (EAS build #6, uploaded to App Store
Connect 2026-05-23).
**Repo:** `my-translator-mobile`.
**Owner:** phucnt.

## What shipped

Third translate engine alongside Soniox + OpenAI: Alibaba Cloud DashScope
Qwen-Omni Realtime. Text + optional spoken voice, free preview pricing.
Lands client-side RMS-VAD manual commit instead of server-VAD — fixed an
~80% content-loss bug and pushed first-token latency to 2.26s (faster
than OpenAI at 14.6s).

## Production config (variant K)

```ts
// session.update
turn_detection: null
modalities: ["text", "audio"]
instructions: hardened (pronoun consistency + full-translate guarantee)

// client commit loop
SILENCE_RMS  = 500    // int16 PCM amplitude threshold
SILENCE_MS   = 400    // sustained quiet → commit
MIN_WINDOW   = 2000ms
MAX_WINDOW   = 7000ms
```

Code: `my-translator-mobile/src/engines/qwen-realtime-client.ts`.

## Benchmark trail (Hope-v2 JA → VI, 302s monologue)

1. [Baseline OpenAI vs Qwen (server-VAD)](../reports/benchmark-260522-2339-openai-vs-qwen-realtime.md)
   — SUPERSEDED. Showed Qwen losing 33-80% content under server-VAD.
2. [Qwen config variant sweep A-E](../reports/benchmark-260523-0025-qwen-config-variant-sweep.md)
   — server-side tuning didn't help; problem was structural.
3. [Manual-commit fix F-I](../reports/benchmark-260523-0040-qwen-manual-commit-fix.md)
   — disabling server-VAD + fixed 5s timer recovered full content.
4. [Final OpenAI vs Qwen-best](../reports/benchmark-260523-0050-final-openai-vs-qwen-best.md)
   — Qwen with manual commit matches OpenAI on completeness, beats on
   latency + price.
5. [Coherence improvement J-L](../reports/benchmark-260523-0701-qwen-coherence-improvement.md)
   — RMS-VAD (K) beats fixed timer on every dimension: coherence,
   latency (2.26s vs 5.4s), and zero errors. **Shipped as v0.4.1.**

## Final scorecard

| Metric         | OpenAI | Qwen (K) |
|----------------|--------|----------|
| Completeness   | 3790   | 4262     |
| First token    | 14.6s  | **2.26s** |
| Pronouns       | high   | high     |
| Price          | $4/hr  | free     |

## Unresolved

- RMS threshold 500 picked from PCM file inspection — may need
  device-mic calibration; easy to expose as a setting if needed.
- Dialogue mode (fast back-and-forth turns) not stress-tested; Hope-v2
  is monologue.
- DashScope key `sk-e6e7…0db6` was pasted in chat — **rotate before
  wider release.**
- Free-preview pricing may change; surface that risk in release notes
  if it becomes paid.
