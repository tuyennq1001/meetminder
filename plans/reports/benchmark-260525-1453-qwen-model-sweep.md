# Qwen Realtime Model Sweep — Mobile App

**Date:** 2026-05-25
**Audio:** Hope-v2 JA ~302s → Vietnamese
**Config:** 16kHz PCM, 100ms chunks, identical to mobile production client (mirrored from `my-translator-mobile/src/engines/qwen-realtime-client.ts`)
**Script:** `my-translator-mobile/benchmark-qwen-models.cjs`
**Endpoint:** `wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime` (Singapore)

## Models tested

| Key | Model | Notes |
| --- | --- | --- |
| plus | `qwen3.5-omni-plus-realtime` | **Currently shipped on mobile.** Most expensive ($2.1/$12.4 per M tokens in/out) |
| flash | `qwen3.5-omni-flash-realtime` | Flash 3.5, ~4× cheaper ($0.55/$3.3 per M tokens) |
| live | `qwen3-livetranslate-flash-realtime` | Purpose-built for live translation, server-side VAD |

## Results

| Metric | plus | flash | live |
| --- | --- | --- | --- |
| segs | 67 | 75 | 48 |
| empty segs | 0 | 0 | 0 |
| tgtChars | 3921 | 4799 | 4536 |
| firstSrc_ms | 969 | 676 | n/a* |
| firstTgt_ms | 2680 | 2405 | n/a* |
| avgGap_ms | 4029 | 4028 | 5999 |
| tailLag_ms | 0 | -1393 | -3293 |
| errors | 1 | 0 | 0 |

\* live model doesn't emit `input_audio_transcription.delta`; firstTgt timestamp not captured in current script (it streams `response.text.delta` continuously without explicit first-emit marker mid-response).

## Protocol differences

**plus / flash (omni Realtime chat schema):**
- `instructions` field in `session.update`
- Client-side RMS-VAD (threshold int16=500, ≥400ms silence, 2-7s window)
- Manual `input_audio_buffer.commit` + `response.create` per turn

**live (LiveTranslate schema):**
- `translation.language: "vi"` + `input_audio_transcription.language: "ja"` required (no `instructions`)
- **Server-side VAD** — manual commit/response.create are rejected (`Invalid value: 'input_audio_buffer.commit'`)
- First benchmark run had 144 errors from extra commit calls; cleaned up by skipping commit when `key === "live"`

## Quality assessment (subjective, JA→VI)

Sampled first 15 + last 5 segments per model:

**plus** — Decent but with first-segment chat-garbage ("Tôi", "Xin chào, bạn có thể nói gì đó...") triggered when RMS-VAD committed full-silence opening window. Translations otherwise faithful.

**flash** — Same chat-garbage opening as plus (same VAD config). Slightly more segs (75 vs 67) suggests it commits/responds a hair faster. Quality similar to plus on completed segments.

**live** — **Best quality output of the three.** No chat-garbage opener — server-side VAD ignores the silent intro. Sentences are longer, more coherent, more idiomatic Vietnamese. Example:
- live: *"Bây giờ tôi sẽ dành thời gian để lắng nghe câu chuyện của các bạn. Đó là một câu chuyện mà tôi muốn kể."*
- plus/flash: shorter, choppier turns because client-side VAD commits sooner

Trade-off: live's avgGap is ~6s vs ~4s for plus/flash — first translation token lands later because it waits for server-side segmentation.

## Recommendation

**Switch mobile from `qwen3.5-omni-plus-realtime` → `qwen3-livetranslate-flash-realtime`.**

Reasons:
1. Best translation quality of the three (longer, more coherent, idiomatic VI)
2. No chat-garbage on silent opening (server-side VAD handles it correctly — plus/flash both leak chat-mode responses on silent windows)
3. "Flash" pricing tier — significantly cheaper than plus (Alibaba doesn't publish exact USD per-minute yet for this model, but Flash family is ~4× cheaper than Plus on omni)
4. Purpose-built for live translation — protocol designed around streaming source-language audio in, translated text out

Trade-offs accepted:
- Higher first-token latency (~6s avg gap vs ~4s) — but quality gain outweighs since translation is for reading not real-time conversation
- Different protocol: requires `translation.language` + `input_audio_transcription.language` in session config and removing manual commit/response.create from client code
- VAD is opaque (server-controlled) — can't tune silence threshold; need to verify it handles long pauses (applause breaks) gracefully in real-world use

## Implementation changes needed for mobile switch

In `my-translator-mobile/src/engines/qwen-realtime-client.ts`:

1. Model name: `qwen3-livetranslate-flash-realtime`
2. `session.update` payload:
   ```ts
   {
     modalities: ["text"],
     input_audio_format: "pcm",
     input_audio_transcription: { model: "default", language: "<src>" },
     translation: { language: "<tgt>" },
     turn_detection: null,
   }
   ```
   Drop `instructions`, drop `output_audio_format`.
3. Remove RMS-VAD silence detection + manual commit loop. Just `input_audio_buffer.append` continuously.
4. Source/target language codes must be ISO 639-1 (`ja`, `vi`, `en`, `zh`, …) — confirm Hope-v2 used `ja`/`vi`, matches.

## Caveats / unknowns

- Live model's source-language coverage may be narrower than omni's "multilingual" claim — needs verification against the language matrix users actually pick (en, zh, ko, vi, ja minimum)
- Per-minute pricing not yet listed publicly for `qwen3-livetranslate-flash-realtime` (preview tier free for now)
- Server-side VAD behavior on extended silence (>10s) not tested — could affect overlay UX during meeting pauses
- This benchmark is one 5-minute JA→VI sample (single speaker, conference recording). EN→VI, ZH→VI, noisy/conversational audio not tested

## Unresolved questions

1. Should we ship `qwen3-livetranslate-flash-realtime` as a **separate engine option** in the engine picker, or **silently replace** `qwen3.5-omni-plus-realtime` under the existing "Qwen" engine? (Different protocol = different failure modes; might want feature flag during preview)
2. The 4536 vs 4799 tgtChars (live vs flash) — is the deficit dropped content or just tighter translation? Need ground-truth alignment to know.
3. Does live model support 70+ Soniox-equivalent source languages, or a smaller set? Check Alibaba docs.
