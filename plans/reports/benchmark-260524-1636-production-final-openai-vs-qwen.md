# Benchmark FINAL — OpenAI Realtime vs Qwen-Omni (production code, v0.4.1 OTA)

**Date:** 2026-05-24
**Audio:** Hope-v2 — Japanese ~302s (~5 min). Uematsu Tsutomu talk. JA → VI.
**Method:** Node script streams PCM to each WS at 1× wall-clock, 100 ms chunks.
**Script:** `my-translator-mobile/benchmark-production-final.cjs`
**Raw:** `my-translator-mobile/benchmark-production-final-result.json`

**What changed since the previous "final" report (260523-0050):** mobile
shipped v0.4.1 OTA on 2026-05-24, which switched Qwen to
`modalities: ["text"]` (audio output disabled to break the
speaker→mic translation loop, and to save DashScope tokens). This
re-runs both engines with **the exact session config the mobile app
uses today** so the numbers reflect what real users get.

**Supersedes:** `benchmark-260523-0050-final-openai-vs-qwen-best.md` and
`benchmark-260523-0701-qwen-coherence-improvement.md`.

---

## TL;DR

| | OpenAI Realtime | **Qwen-Omni Realtime (text-only)** |
|---|---|---|
| Completeness | full, 3839 VI chars | full, 4319 VI chars |
| First translated text | **15.7 s** | **7.3 s** |
| First source text (whisper) | 14.3 s | 14.5 s |
| Empty / dropped segments | n/a (delta stream) | 0 of 84 useful |
| Errors | 0 | 1 (harmless tail commit) |
| Streaming shape | continuous deltas | discrete ~3.6 s commits |
| Price | ~$4 / hour | **free (preview)** |

**Bottom line:** both engines now translate the full 5-minute talk end
to end with natural Vietnamese. **Qwen reaches first text in less than
half the time** of OpenAI (7.3 s vs 15.7 s) thanks to client-side
RMS-VAD committing on the first speaker pause. Quality is comparable;
Qwen runs free during preview. **OpenAI remains the recommended
default for the most demanding sessions; Qwen is the recommended
free option for everyday use.**

---

## 1. Completeness — was the whole talk translated?

| Engine | VI chars | JA src chars captured | Notes |
|---|---|---|---|
| OpenAI | 3839 | 1992 | continuous delta stream, no segmentation |
| Qwen   | 4319 | (per-segment, 84 commits) | full transcript, 0 useful empty segs |

Both engines cover the entire talk. Qwen's char count is **12 % higher**
than OpenAI, reflecting slightly more verbose Vietnamese phrasing on
the same content (not extra information). Spot-checks line up
sentence-for-sentence.

## 2. Latency — time to first translated text

| Metric | OpenAI | Qwen | Δ |
|---|---|---|---|
| First source text (whisper) | 14.3 s | 14.5 s | tied |
| **First translated text** | **15.7 s** | **7.3 s** | **Qwen 2.1× faster** |

Whisper input transcription emits at roughly the same time on both —
the first source token appears around the speaker's first natural
pause (~14 s into the audio, after the opening silence).

The latency gap is **on the translation side**: OpenAI waits for its
own internal turn boundary before producing the first translated
delta, whereas Qwen fires `response.create` immediately after the
client-side RMS-VAD detects 400 ms of silence past the 2-second
minimum window — so the first translation comes out 8.4 s sooner.

## 3. Streaming shape — what users see live

- **OpenAI:** continuous delta stream. Translated text flows
  character-by-character as a single live caption. Feels like a video
  caption track.
- **Qwen:** discrete commits (84 of them, average gap **3.6 s**;
  p25/p50/p75 = 2.2 / 3.2 / 4.5 s). Each commit lands a complete
  thought; the screen updates in ~3-second blocks.

Both are usable for live audience reading. UX shape differs:

- OpenAI is smoother for reading along during fast speech.
- Qwen is easier to glance-and-resume: every block is a complete
  sentence, and the silence-based cuts almost always land at natural
  pause boundaries (p50 commit gap ≈ a normal speaker pause).

## 4. Quality of translation

Both produce **natural, accurate Vietnamese**. Examples:

```
JA: はい、では皆さん改めましてこんにちは。緊張がほぐれました。
OpenAI: Vâng, xin chào lại mọi người. Tôi đã bớt căng thẳng rồi.
Qwen:   Vâng, vậy thì mọi người. … Xin chào. … Tôi đã cảm thấy thoải mái hơn.
```

OpenAI joins the three short Japanese sentences into one flowing
Vietnamese sentence; Qwen keeps them as three commits matching the
speaker's pacing. Both are correct.

```
JA: 思うは招くというお話です。僕のお母さんが中学生の時に教えてくれた言葉です。
OpenAI: Đó là lời mẹ tôi dạy khi tôi còn học trung học cơ sở. Nghĩ là được, ý là vậy.
Qwen:   (rendered across 2 commits) Câu chuyện về 'nghĩ tức là gọi mời.' …
        Đây là lời mẹ tôi dạy khi tôi học cấp 2.
```

Both render the idiom 思うは招く naturally — neither leaves it as
romaji. (Earlier benchmarks caught OpenAI leaving proper-noun-like
phrases romanized; that did not reproduce in this run.)

Pronoun consistency (the historical Qwen weak point): the hardened
instructions plus RMS-VAD cuts keep the speaker singular and
first-person throughout. Spot-checks across the grandpa/Apollo passage
no longer trip the plural-pronoun bug.

## 5. Production config snapshot

Both engines use **exactly** what `my-translator-mobile` v0.4.1
ships today:

**OpenAI** (`src/engines/openai-realtime-client.ts`):
- WS: `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`
- `session.update.audio.input.transcription.model = "gpt-realtime-whisper"`
- `noise_reduction = "near_field"`
- `output.language = "vi"`
- No client-side turn control — server drives segmentation.

**Qwen** (`src/engines/qwen-realtime-client.ts`):
- WS: `wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-plus-realtime`
- `session.update.modalities = ["text"]` — **new in v0.4.1**, no audio synthesis
- `turn_detection = null` — server-VAD disabled (dropped ~80% of content in prior runs)
- Client RMS-VAD: silence threshold int16 amp 500, silence ≥400 ms ⇒ commit,
  min window 2000 ms, max window 7000 ms
- Hardened instructions: pronoun consistency + cross-turn continuity +
  "translate every utterance fully" + "output target only"

Disabling audio output on Qwen (the v0.4.1 change) had **no measurable
quality regression** versus prior runs that kept `["text","audio"]`.
First-token latency improved marginally (7.3 s vs 7.4 s in coherence
benchmark run K) and DashScope token usage for the session dropped
roughly proportionally to the audio bytes Qwen no longer synthesises.

## 6. Cost

| Engine | Rate | Cost for the 5-min Hope-v2 run |
|---|---|---|
| OpenAI Realtime | ~$4 / hour | ~$0.33 |
| Qwen-Omni Realtime | free (preview) | $0.00 |

Qwen pricing will change when it exits preview — Alibaba has not
announced rates. Even at OpenAI parity, Qwen would remain attractive
because of the latency edge.

---

## Verdict

| Use case | Recommendation |
|---|---|
| Production default, demanding session, must have a continuous caption | **OpenAI Realtime** |
| Free / preview / latency-sensitive opening / first impression | **Qwen-Omni Realtime** |
| Cost-controlled daily use | Qwen while it's free; otherwise Soniox |

Both engines are production-ready in the mobile app shipping today
(TestFlight v0.4.1 build 6, OTA 2026-05-24).

---

## Unresolved questions

- Qwen logged 1 invalid_request_error at session end ("buffer too small,
  or have no audio") — harmless tail commit on trailing silence; worth
  guarding in the client to avoid the noise even though it doesn't
  affect output.
- Single-run numbers — not averaged. Latency variance between runs has
  been ±0.5 s historically; the 8.4 s OpenAI/Qwen gap dwarfs that, so
  the ordering is solid. A 3-run average would tighten the absolute
  numbers if anyone wants to publish them externally.
- Cost numbers are list price; no Q4 2026 OpenAI/DashScope discounting
  applied.
