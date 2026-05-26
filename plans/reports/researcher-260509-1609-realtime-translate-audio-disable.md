# OpenAI Realtime Translate API: Audio Output Disabling Research

**Date:** 2026-05-09 | **Duration:** ~30 min research

---

## Research Question
Can audio output be disabled on the `gpt-realtime-translate` translation endpoint to receive text-only output (translated text deltas without synthesized voice)?

---

## Finding: Audio Cannot Be Disabled for Translation Endpoint

**Direct Answer:** NO — audio output cannot be disabled on the `/v1/realtime/translations` endpoint.

### Evidence

**1. Dedicated Translation Endpoint Design**
The `gpt-realtime-translate` model is purpose-built for **speech-to-speech translation only**. It uses a dedicated `/v1/realtime/translations` endpoint separate from the conversational `/v1/realtime` endpoint.

- Sessions are configured exclusively around speech processing: input audio → translated audio output + transcript deltas
- Server events include mandatory: `session.output_audio.delta` (200ms PCM16 chunks) + `session.output_transcript.delta` (optional, for text)

**Source:** [Realtime Translation Server Events Reference](https://developers.openai.com/api/reference/resources/realtime/translation-server-events)

**2. No Modalities Field in Translation Sessions**
The `modalities` configuration field (used in the conversational Realtime API to select `["text"]` or `["audio"]` or both) is **not exposed** in the translation endpoint schema. 

- Translation session config accepts: `model`, `audio.input`, `audio.output.language`, `voice` 
- Translation sessions are "continuous": client streams audio in → service streams translated audio + optional transcripts out
- Voice selection is not supported ("does not currently support... voice selection parameters")

**Source:** [Build Live Translation Apps Guide](https://github.com/openai/openai-cookbook/blob/main/examples/voice_solutions/realtime_translation_guide.mdx) | [Realtime Translation Guide](https://developers.openai.com/api/docs/guides/realtime-translation)

**3. Architectural Difference: Translation ≠ Conversation**
The translation endpoint differs fundamentally from the conversational Realtime API:

| Aspect | Realtime (gpt-realtime-2) | Translation (gpt-realtime-translate) |
|--------|---------------------------|---------------------------------------|
| **Modalities Support** | Yes; `modalities: ["text"]` disables audio | No modalities field |
| **Audio Output** | Optional, configurable | Always enabled |
| **Use Case** | Multi-turn conversation | One-way speech→speech translation |
| **Output Events** | Conditional (text XOR audio based on config) | Both `output_audio.delta` + `output_transcript.delta` always emitted |

**Sources:** [Realtime Guide](https://developers.openai.com/api/docs/guides/realtime) | [Model Differences](https://www.marktechpost.com/2026/05/08/openai-releases-three-realtime-audio-models-gpt-realtime-2-gpt-realtime-translate-and-gpt-realtime-whisper-in-the-realtime-api/)

---

## Workarounds (Out-of-Scope)

If text-only output is required:
1. **Use conversational endpoint instead:** `/v1/realtime` with `gpt-realtime-2` + `modalities: ["text"]` (but this loses translation optimization)
2. **Client-side filtering:** Receive `output_transcript.delta` events, ignore `output_audio.delta` (still billed for audio)

---

## Caveats

- GA release date: May 2026 (current as of this research)
- Documentation is public but not in beta; features appear stable
- Azure OpenAI may have different constraints; verified only against OpenAI platform
- Price: $0.034/min (all-inclusive; no granular audio/text billing for translation)

---

## Conclusion

**Realtime Translate is an audio-first product.** Text output (transcripts) is an optional side-channel, not a configuration option. Audio synthesis cannot be suppressed at the API level. If your use case requires text-only operation, the translation endpoint is not the right fit.

---

## Sources

- [Realtime Translation Guide](https://developers.openai.com/api/docs/guides/realtime-translation)
- [Translation Server Events Reference](https://developers.openai.com/api/reference/resources/realtime/translation-server-events)
- [Cookbook: Build Live Translation Apps](https://github.com/openai/openai-cookbook/blob/main/examples/voice_solutions/realtime_translation_guide.mdx)
- [Realtime API Core Guide](https://developers.openai.com/api/docs/guides/realtime)
- [MarkTechPost: Release Analysis](https://www.marktechpost.com/2026/05/08/openai-releases-three-realtime-audio-models-gpt-realtime-2-gpt-realtime-translate-and-gpt-realtime-whisper-in-the-realtime-api/)

**Unresolved Questions:** None identified. The distinction between conversational and translation endpoints is clear.
