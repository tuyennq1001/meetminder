# Benchmark: Qwen-Omni — coherence improvement sweep

**Date:** 2026-05-23
**Audio:** Hope-v2 JA ~302s → Vietnamese.
**Goal:** improve Qwen pronoun/coherence (weak point vs OpenAI) without
adding latency. Baseline = variant F (manual-commit fixed 5s).
**Script:** `my-translator-mobile/benchmark-qwen-coherence.cjs`.

---

## TL;DR

**RMS-based client VAD (variant K) wins on every dimension.** Compared to
the fixed-5s baseline F: better coherence (pronouns consistent across cuts),
**2.4× faster first token** (2.26s vs 5.4s), more sentence-respecting cuts,
0 empty turns, no errors. Adding 300ms overlap (L) is neutral. Tier-1
(fixed 5s + overlap, variant J) **broke** — internal Qwen error mid-stream
returned only 6 segments.

**Recommendation: ship variant K** — replace fixed timer with RMS-VAD
client-side. Skip overlap (no measurable benefit, complicates code).

---

## Results

| Variant | Strategy | segs | commits | avgGap | empty | tgtChars | firstTgt | errors |
|---|---|---|---|---|---|---|---|---|
| F (baseline) | fixed 5s commit | 61 | ~60 | 5000ms | 0 | 3611 | 5357ms | 0 |
| **K** | **RMS-VAD silence-commit** | **83** | 85 | 3635ms | **0** | **4262** | **2260ms** | **0** |
| L | RMS-VAD + 300ms overlap | 82 | 85 | 3636ms | 0 | 4072 | 2234ms | 0 |
| J | fixed 5s + hardened + overlap | 6 | 7 | 4401ms | 0 | 264 | 5310ms | **1 (InternalError)** |

RMS-VAD config: silence threshold int16 amplitude 500, silence ≥400ms ⇒
commit, min window 2000ms, max window 7000ms.

## Findings

1. **K is the clear winner.** Coherence is better, latency is better, no
   errors. The cuts land at natural pauses (gap distribution p25=2.3s /
   p50=3.2s / p75=4.5s — most cuts ride a real silence). Translation reads
   more sentence-shaped because each commit is a near-complete thought.

2. **Pronoun consistency improved.** Spot-check on the grandpa/Apollo
   passage:
   - F[33] "Họ xoa đầu tôi" (wrong — plural pronoun for one person).
   - K[46] "Ông ấy sẽ dùng bàn tay to lớn của mình xoa đầu tôi" (correct).

   Hardened instruction + adaptive cuts together let the model resolve
   pronouns from the prior turn — the bug was structural, not promptable.

3. **First-token 2.26s** — F was 5.4s. K commits the first turn as soon as
   the speaker's opening pause is detected (min 2s) rather than waiting for
   the 5s timer. **Latency improved, not increased** by going adaptive.

4. **Overlap 300ms (L) has no measurable benefit.** L = K minus 190 tgtChars
   (slightly less content), same gap profile, same first-token time. The
   audio context bridge the overlap is supposed to give is already provided
   by session conversation memory. **Drop overlap from the plan.**

5. **J broke — do NOT combine fixed-timer + overlap.** Got an
   "InternalError" from Qwen after 6 commits and the run stopped producing
   responses. Likely cause: re-appending audio right after `response.create`
   raced with an in-flight response. RMS-VAD K avoids this because commits
   land on silence (no in-flight content) and L works because cuts are
   spaced more naturally.

6. **K's failure modes** (still imperfect):
   - K[20] "Chúng tôi không thể làm được. Nhưng chúng tôi đã tự mình cố
     gắng và chế tạo ra nó." — translates 「誰も売っていないから買うことが
     できません」 as "we can't do it" (should be "no one sells it so we can't
     buy it"). Pure model error, not a cut issue.
   - K[44] "Không có đâu" — appears to misfire on a short clause. Rare; 1 in
     83 segments.

## Recommendation

**Ship variant K to the Qwen provider.** Settings:

```ts
// session.update
turn_detection: null,
modalities: ["text", "audio"],
instructions: INSTRUCTIONS_HARDENED, // pronoun-consistency + full-translate rules

// client commit loop
const SILENCE_RMS = 500;        // int16 amplitude
const SILENCE_MS  = 400;        // sustained quiet → commit
const MIN_WINDOW  = 2000;
const MAX_WINDOW  = 7000;
// On each PCM chunk: track windowMs + silenceMs; if (windowMs >= MAX) or
// (windowMs >= MIN && silenceMs >= SILENCE_MS): commit + response.create.
```

No overlap, no fixed timer fallback. Skip first segment (still emits the
pre-speech intro artifact from variant F).

**Impact on the OpenAI vs Qwen comparison:**

| Metric | OpenAI | Qwen (variant K) |
|---|---|---|
| Completeness | full (3790) | full (4262) |
| First token | 14.6s | **2.26s** ⬇ 6× faster |
| Coherence/pronouns | high | **high** (was weak under F) |
| Price | $4/hr | free |

Qwen K is now **better than OpenAI on every measurable dimension except
preview-status risk**.

## Unresolved questions

- RMS threshold 500 was picked from quick inspection of the source audio —
  may need tuning per real-mic noise floor on device. Easy to expose as a
  setting.
- Window min/max (2s/7s) seem fine for this talk; not stress-tested on rapid
  back-and-forth dialogue.
- Will K's commit pattern still feel responsive in conversation mode (two
  speakers, faster turns)? Hope-v2 is monologue — needs a dialogue test.
- Pre-speech intro artifact at segment 0 still present. Either skip seg 0 in
  client or gate commits on first detected speech (RMS > threshold once).
- On-device test pending (RN mic energy values may differ from PCM file
  RMS; threshold may need calibration).
