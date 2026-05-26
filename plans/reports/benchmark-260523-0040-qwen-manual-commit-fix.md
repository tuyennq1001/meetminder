# Benchmark: Qwen-Omni — manual-commit FIXES the content-loss

**Date:** 2026-05-23
**Audio:** Hope-v2 — Japanese ~302s. JA → Vietnamese.
**Goal:** test turn-control strategies the config sweep couldn't reach.
**Script:** `my-translator-mobile/benchmark-qwen-commit.cjs`.

---

## TL;DR

**Solved.** Disabling server-VAD and having the client commit the audio
buffer on a fixed timer (`input_audio_buffer.commit` + `response.create`)
**eliminates the content-loss entirely** — 0 empty segments, full translation
of the whole 5-min talk. Server-VAD was the root cause all along.

Qwen with manual-commit is now **as complete as OpenAI Realtime.**

---

## Results

| Variant | Strategy | segs | empty | tgtChars | errors |
|---|---|---|---|---|---|
| **F** | **manual-commit 5s, VAD off** | 61 | **0** | 3611 | 0 |
| **G** | **manual-commit 3s, VAD off** | 100 | **0** | 3757 | 0 |
| H | server-VAD + forced response.create | 26 | 8 | 682 | 24 |
| I | server-VAD + hardened instruction | 25 | 11 | 737 | 0 |

(For reference: best config-sweep variant B = 9 empty / 23, 794 tgtChars.)

## Findings

1. **Manual-commit is the fix (F, G).** Turn off `turn_detection` and let the
   client commit the buffer every N seconds, each commit followed by an
   explicit `response.create`. Every turn then gets translated — **0 empties,
   ~3600-3750 VI chars** (vs OpenAI's 3790). Coverage "195-199%" is just
   Vietnamese being longer than Japanese for the same content — verified: 61/61
   and 96/100 unique targets, segment text is real translation, no garbage.

2. **5s vs 3s windows (F vs G) — both work; 5s is cleaner.** 3s produces more,
   shorter segments (100 vs 61) and a few duplicate fillers
   ("Tiếng vỗ tay" = applause, repeated). 5s gives fuller sentences per
   segment. **Recommend 5s.**

3. **Forcing response.create under server-VAD (H) does NOT work — and is
   harmful.** 24 errors (firing response.create while a response is already
   active → "conversation_already_has_active_response"-type errors). Still 8
   empties. Server-VAD's own turn lifecycle conflicts with manual triggers.

4. **Hardened instruction (I) does NOT work.** 11 empties — same as baseline.
   The model isn't ignoring the instruction; the turns are simply never handed
   to the translation step under VAD. A prompt cannot fix a transport problem.

5. **Latency unchanged / slightly better.** F first target at 5.4s (vs ~16.7s
   server-VAD baseline) — manual commit at 5s means the first turn finalizes on
   schedule rather than waiting for a VAD silence gap.

6. **Minor artifact:** the very first commit (before any speech) makes Qwen
   emit a self-intro ("Xin chào, tôi là trợ lý...") or "Vỗ tay". Harmless —
   skip the first 1-2 segments, or don't commit until audio energy detected.

## Recommendation

**Switch the Qwen provider from server-VAD to manual-commit.**

In the Qwen realtime client (`my-translator-mobile`, the Qwen provider):
- `session.update`: set `turn_detection: null`, keep
  `modalities: ["text","audio"]`.
- Add a 5s timer: every 5s of streamed audio send
  `input_audio_buffer.commit` then `response.create`.
- Flush a final commit when the mic stops.
- Skip / suppress the first segment (pre-speech intro artifact).

This makes Qwen a **genuinely usable engine** — full coverage, free, ~5s
first-token. It can move from "preview/experimental" to a real option,
possibly even default given it's free.

## Unresolved questions

- Manual-commit segments cut mid-sentence at the 5s boundary (e.g. "Ví dụ như
  cái này." / "À." / "Chiếc xe này"). Translation stays coherent across cuts
  but UI segmentation is arbitrary. Acceptable for live captions; revisit if
  discrete sentence cards are wanted.
- 5s vs 3s vs adaptive (commit on a short silence detected client-side) not
  exhaustively compared — 5s fixed is good enough to ship.
- Not yet tested on-device (RN mic + WS). Behaviour should match; pending
  physical-device test per phase-06.
- The first-segment intro artifact: confirm it's reliably segment index 0 so a
  fixed skip is safe, or gate commits on audio energy.
