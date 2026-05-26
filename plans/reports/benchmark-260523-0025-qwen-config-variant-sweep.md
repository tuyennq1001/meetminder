# Benchmark: Qwen-Omni Realtime — config variant sweep

**Date:** 2026-05-23
**Audio:** Hope-v2 — Japanese, ~302s (~5 min). JA → Vietnamese.
**Goal:** find a `session.update` config that reduces Qwen's content-loss
(baseline benchmark: ~80% dropped, 7/21 segments empty target).
**Method:** same PCM streamed at 1x to Qwen WS, 5 configs sequential, 8s tail.
Script: `my-translator-mobile/benchmark-qwen-variants.cjs`.

---

## TL;DR

**No config makes Qwen reliable.** Best run still drops ~33% of content
(coverage 67%, 9/23 segments empty). The content-loss is structural to the
omni model under server-VAD, not a tunable parameter. **Conclusion stands:
keep OpenAI as default, Qwen stays preview/experimental.**

---

## Results

| Variant | Config | segs | empty | tgtChars | coverage |
|---|---|---|---|---|---|
| A baseline | text, VAD 800ms, thr 0.5 | 25 | 12 | 848 | 55% |
| **B** | **text+audio, VAD 800ms** | 23 | 9 | 794 | **67%** ← best |
| C | text, VAD 2000ms | 6 | 3 | 218 | 13% |
| D | text, VAD 800ms, thr 0.2 | 24 | 11 | 707 | 47% |
| E | text+audio, VAD 2000ms | 6 | 3 | 174 | 10% |

(coverage = tgtChars / srcChars; rough proxy — Qwen's per-segment src capture
varies run to run, so treat ±10% as noise.)

## Findings

1. **`modalities: ["text","audio"]` helps a bit (A→B: 55%→67%).** Asking the
   omni model to also speak the answer seems to keep the translation path
   "engaged" — fewer turns finalize empty. Cheapest win available.
2. **Long VAD silence (2000ms) is actively harmful (C, E: ~10-13%).** Fewer,
   bigger turns → the model translates only the tail of each block and drops
   the rest wholesale. Worst configs in the sweep. Do NOT raise silence.
3. **Lower VAD threshold (0.2) does not help (D: 47%, slightly worse than A).**
   More sensitive segmentation just makes more turns, same drop rate.
4. **Empty-target turns are not random** — they cluster on long declarative
   JA sentences (company description, "47 years ago" recurring). The model
   transcribes the source fine but emits no translation. Looks like the omni
   model deprioritizes the translate instruction on dense turns.
5. **Quality of translated parts: still good** across all variants. Natural
   Vietnamese. The problem remains coverage, never quality.

## Recommendation

- If Qwen must stay in the app: ship variant **B** config
  (`modalities: ["text","audio"]`, VAD 800ms, threshold 0.5) — best of a bad
  set. Update the Qwen provider's `session.update` accordingly.
- Keep Qwen labelled **preview / experimental** in Settings — even tuned it
  drops ~1/3 of content. Not safe as a primary engine.
- OpenAI Realtime remains the only engine that translates a full conversation.

## Unresolved questions

- Does manual `input_audio_buffer.commit` (no server-VAD) drop less? Not tested
  — would need explicit chunk-boundary logic in the client.
- Would a stronger/explicit per-turn instruction (e.g. re-sent on each
  `response.create`) reduce empty turns? Untested.
- Coverage % is a proxy; a human-graded segment count would be more reliable
  but wasn't done here.
