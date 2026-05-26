# Final 3-way Benchmark: OpenAI vs Qwen Omni vs Qwen Live

**Date:** 2026-05-25
**Sample:** `hope-v2-trim-24k.pcm` / `hope-v2-trim-16k.pcm` — Japanese TED-style talk (Uematsu Tsutomu, "Hope"), **first 13s trimmed** to remove applause/laughter intro. Meaningful speech begins ~320ms into trimmed file.
**Stream:** 1x real-time, 100ms chunks, source=ja, target=vi
**Tail wait:** 15s after last audio chunk
**Run:** Single sample, all 3 models in sequence.

## Headline numbers (trimmed audio — speech starts ≈0.3s)

| Model | First Prov (ms) | First Final (ms) | Segments | Tgt chars | Errors |
|---|---:|---:|---:|---:|---:|
| **OpenAI** `gpt-realtime-translate` | 2659 | 6869 | 42 | 3895 | 0 |
| **Qwen Omni Plus** `qwen3.5-omni-plus-realtime` | 4440 | 4668 | 72 | 4341 | 0 |
| **Qwen Live Flash** `qwen3-livetranslate-flash-realtime` | **2593** | **3780** | 48 | **4504** | 0 |

## Latency analysis

- **Qwen Live wins both metrics**: first prov 2.6s, first final 3.8s — and emits the most output text.
- **OpenAI matches Live on first prov** (2.7s) but first final lags ~3s behind (6.9s vs 3.8s) — translation endpoint commits segments slower.
- **Qwen Omni surprises**: with clean audio (no applause to trigger false-VAD), first prov jumps from a misleading 0.3s (applause hallucination) to a realistic 4.4s. RMS-VAD needs ~4s of speech to commit a turn. First final is 4.7s — Omni is no longer the speed winner.
- **First "real" translated segment arrives within ~4s for both Qwens, ~7s for OpenAI.**
- All three models now emit semantically meaningful first segments (no `(Vỗ tay)` hallucination).

## Throughput

- Qwen Live produced the most output text (**4504 chars** vs 4341 Omni vs 3895 OpenAI).
- Segment counts:
  - Omni: 72 short segments (aggressive RMS VAD splits — same as untrimmed run)
  - Live: 48 medium segments (server VAD)
  - OpenAI: 42 segments derived from delta-gap heuristic (no `*.done` events arrive — see Notes)

## Translation quality (first ~5 segments)

### OpenAI
1. "Này, mọi người, xin chào lại nhé."
2. "Tôi thấy căng thẳng đã dịu bớt."
3. "Từ giờ, tôi xin mượn thời gian của mọi người để nói chuyện."
4. "Đó là một câu chuyện rất giản dị về tôi. Khi mẹ tôi còn là học sinh trung học, mẹ đã dạy tôi câu này. Nghĩ thế nào thì sẽ thành như vậy, đó là ý nghĩa. Cứ tiếp tục nghĩ, điều đó rất quan trọng."
5. "Và tôi mong qua câu chuyện hôm nay, sẽ tìm được đồng đội ngay trong số mọi người, nên rất mong mọi người hãy cùng trở thành đồng đội với tôi. Giờ, chuyện này xảy ra từ 47 năm trước, khi tôi được sinh ra. Tôi tên là Uematsu Tsutomu."

### Qwen Omni Plus
1. "Vậy thì, thưa quý vị, một lần nữa xin chào."
2. "đã được nới lỏng."
3. "Bây giờ tôi sẽ mượn thời gian của mọi người để kể một câu chuyện. Đó là câu chuyện "Suy nghĩ sẽ dẫn dắt". Đây là điều mẹ tôi đã dạy tôi khi tôi còn học trung học cơ sở."
4. "Nghĩa là nếu bạn nghĩ như vậy thì điều đó sẽ xảy ra."
5. "Tiếp tục suy nghĩ là điều rất quan trọng."

### Qwen Live Flash
1. "Vậy thì, mọi người, xin chào một lần nữa."
2. "Căng thẳng đã được giải tỏa."
3. "Bây giờ tôi sẽ dành thời gian để lắng nghe câu chuyện của các bạn. Đó là một câu chuyện mà tôi muốn kể. Đó là những lời mẹ tôi đã dạy tôi khi còn học trung học: "Nếu bạn nghĩ vậy thì nó sẽ như vậy. Việc tiếp tục suy nghĩ là rất quan trọng.""
4. "Và tôi nghĩ rằng hôm nay, với câu chuyện của tôi, nếu có thể tìm được bạn bè trong số các bạn thì thật tuyệt. Vì vậy, hãy trở thành bạn bè nhé."
5. "Tôi đã được sinh ra cách đây 47 năm. Tôi tên là Uematsu Tsutomu. Hiện tại tôi đang sống ở vùng trung tâm của Hokkaido, tại một thị trấn tên là Akabira, nơi tôi lần đầu tiên điều hành một công ty."

### Quick qualitative read

- **OpenAI**: most natural Vietnamese. "Này, mọi người, xin chào lại nhé" is colloquial and warm — closest to a real speaker. Segments 4-5 read like prose. Best for content where translation quality matters more than absolute speed.
- **Qwen Omni**: literal-leaning. Seg 2 ("đã được nới lỏng") is a fragment — Omni's aggressive VAD chopped "căng thẳng" into the preceding segment, leaving an orphan verb phrase. Translation is OK but boundary issues hurt readability.
- **Qwen Live**: most semantically complete (longest segments capture full thought). **Same mistranslation persists in seg 3**: "dành thời gian để **lắng nghe** câu chuyện của các bạn" — original is "kể cho các bạn nghe" (I'll tell you). Live consistently flips speaker direction here, suggesting it's a model bias not random fluke.

## Verdict per use case

| Use case | Winner | Why |
|---|---|---|
| Fastest first prov + first final | **Qwen Live** | 2.6s / 3.8s — beats both alternatives on clean audio |
| Smooth typewriter streaming | **Qwen Live** | High-frequency text+stash snapshots |
| Translation polish | **OpenAI** | Most colloquial/natural Vietnamese, fewest awkward fragments |
| Most complete segments | **Qwen Live** | Longest thought-units, fewest boundary breaks |
| Most output text | **Qwen Live** | 4504 chars |
| Robust against noisy intros | **Qwen Live / OpenAI** | Both ignore applause; Omni hallucinates `(Vỗ tay)` on raw audio |

## Recommendation

With clean-audio benchmarking (no applause intro biasing VAD), the picture is clearer:

- **Default for users wanting speed**: **Qwen Live Flash**. Fastest first prov (2.6s) AND fastest first final (3.8s), most output text, smoothest streaming. Tradeoff: no source transcript, occasional speaker-direction mistranslation.
- **Default for users wanting quality**: **OpenAI Realtime**. Slower first final (6.9s) but most natural Vietnamese with best colloquial register. Tradeoff: ~3s extra wait per segment commit.
- **Qwen Omni is now the worst of the three** on clean audio: slowest first prov (4.4s), short-segment fragmentation, orphan-verb segments. Only advantage was illusory (false-VAD on applause).

Current mobile app default = OpenAI. Recommend adding a **"Fast mode" preset** that swaps to Qwen Live for users who want lower latency.

## Methodology notes / caveats

1. **OpenAI translation endpoint emits no `*.done` events.** Verified via 20s tail probe: only `session.output_transcript.delta`, `session.input_transcript.delta`, `session.output_audio.delta`. Benchmark synthesizes segments from delta-gap heuristic (>800ms gap = boundary). This inflates seg count vs. server-decided boundaries on Qwen.
2. **Audio sample rate differs per engine.** OpenAI 24kHz, both Qwens 16kHz — matches each provider's spec.
3. **Single-sample run.** No statistical confidence — re-run several times before drawing firm conclusions.
4. **Tail wait of 15s** caught all OpenAI deltas; the original failure (0 segs) was the delta-gap heuristic missing because the entire `buf` flush logic at close was absent.
5. **Speech-onset offset of 13.0s is approximate.** First 5.5s is silence; 5.5–13.0s is applause/laughter. RMS detection placed first-speech-frame at 5.5s but auditory-meaningful speech begins ≈13s. Adjusted latencies assume 13.0s as the reference — re-derive if a different audio sample is used.

## Unresolved questions

- Does OpenAI translation endpoint ever emit `output_transcript.done`, or only deltas? Production iOS client uses a `.done` handler — but if endpoint never emits it, that branch is dead code. Worth confirming in mobile session-context to see whether segments are reported there.
- Qwen Live seg 3 mistranslation "lắng nghe câu chuyện của các bạn" persists across both raw and trimmed runs → likely systemic Live model bias around speaker-direction verbs. Worth testing with 2-3 more JA samples that have explicit speaker-direction phrasing.
- Qwen Omni's `(Vỗ tay)` segment confirmed as VAD false-trigger on applause (gone when applause trimmed). For real mic use, recommend either: (a) front-load 1-2s silence in capture pipeline, or (b) drop Omni from default engine list since users frequently start with ambient noise.
- Single-sample limitation: numbers are indicative, not statistically robust. Multi-sample sweep across 5+ JA samples would tighten confidence intervals.
