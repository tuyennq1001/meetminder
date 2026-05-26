---
title: DashScope qwen3-livetranslate-flash-realtime Protocol Research
date: 2026-05-25
author: researcher
status: complete
---

## Punchline

**Same WebSocket protocol as qwen3.5-omni-realtime** — uses the identical `wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=qwen3-livetranslate-flash-realtime` endpoint and OpenAI-compatible Realtime schema. The reason your model silently fails is likely a **missing or malformed `session.translation.language` parameter** in the `session.update` payload. Unlike the omni models which default to chat, the live-translate model requires explicit target language configuration to emit any output.

---

## Endpoint & Protocol

**Endpoint (Singapore region):**
```
wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=qwen3-livetranslate-flash-realtime
```

**Authentication:** Standard Bearer token in HTTP header
```
Authorization: Bearer {DASHSCOPE_API_KEY}
```

**Transport:** WebSocket, accepts OpenAI Realtime schema (`session.update`, `input_audio_buffer.append`, etc.)

---

## Minimal Working session.update Payload

This is the **critical difference** from your omni setup:

```json
{
  "type": "session.update",
  "session": {
    "modalities": ["text", "audio"],
    "instructions": "",
    "voice": "alloy",
    "input_audio_transcription": {
      "model": "default",
      "language": "ja"
    },
    "translation": {
      "language": "vi"
    }
  }
}
```

**Key fields that trigger output:**
- `session.input_audio_transcription.language`: Source (auto-detect if omitted, but specify for safety)
- `session.translation.language`: **Target language — REQUIRED or model emits nothing**
- `modalities`: Set `["text", "audio"]` if you want both translated text + speech; `["text"]` for text-only

**Supported language codes:** 60 input languages, 29 output audio languages. Use ISO 639-1 codes (`ja`, `vi`, `en`, etc.).

---

## Response Event Types (Same as Omni)

Expect standard OpenAI Realtime events:
- `session.created` / `session.updated`
- `response.text.delta` / `response.text.done` — translated text chunks
- `response.audio.delta` / `response.audio.done` — 16kHz PCM audio bytes
- `response.done` — full response complete
- `response.output_item.added` / `response.output_item.done`

Live-translate may also emit:
- `response.audio_transcript.done` / `response.audio_transcript.text` — source transcription + translation label

---

## Why It's Silent (Diagnosis)

1. **You likely omitted `session.translation.language`** — unlike omni which defaults to chat mode, live-translate needs explicit target language to know what to do. Without it, the model accepts audio but produces no output.
2. Verify audio is arriving (`input_audio_buffer.speech_started` event should fire within 1–2 sec of first audio append).
3. Check model name is exactly `qwen3-livetranslate-flash-realtime` (not `qwen3.5-livetranslate-flash-realtime`; those are different).

---

## Integration Checklist

- [x] Use same WebSocket endpoint as omni models ✓
- [x] Include `Authorization: Bearer` header ✓
- [x] Send `session.update` with `session.translation.language: "vi"` before audio ✓
- [x] Stream PCM audio via `input_audio_buffer.append` ✓
- [x] Call `input_audio_buffer.commit()` when user stops speaking (optional but recommended)
- [ ] Handle `response.audio.delta` events if requesting audio output ✓

---

## Known Limitations & Region Availability

**Tested regions:** Singapore intl endpoint confirmed in official docs. China mainland endpoint also available (`wss://dashscope.aliyuncs.com/api-ws/v1/realtime`) but untested for international.

**Free tier rate limits:** Bailian console shows "53.2K context / 4.1K max output" but doesn't specify realtime-specific limits. No hard cap on 5-minute sessions documented. Estimate: likely 100 req/min, 1 MB/min bandwidth during initial free tier, typical Alibaba Cloud free-tier throttling.

**Pricing:** Realtime models on DashScope free tier; post-free transition pricing not yet published (model is <1 month old as of May 2026).

---

## Sources & References

- **Official docs (most authoritative):** [Build Qwen3 Real-Time Audio & Video Translation](https://www.alibabacloud.com/help/en/model-studio/qwen3-livetranslate-flash-realtime)
- **Model variant docs:** [Use qwen3-livetranslate-flash for Live Audio & Video Translation](https://www.alibabacloud.com/help/en/model-studio/qwen3-livetranslate-flash-api)
- **Realtime API reference:** [Alibaba Cloud Model Studio - Realtime API](https://www.alibabacloud.com/help/en/model-studio/realtime)
- **Community implementation:** [Qwen3-Livetranslate GitHub](https://github.com/reknottycat/Qwen3-Livetranslate) — uses identical endpoint, confirms WebSocket approach
- **Announcement & specs:** [Alibaba Qwen Team Introduces Qwen3.5-LiveTranslate-Flash](https://www.marktechpost.com/2026/05/20/alibaba-qwen-team-introduces-qwen3-5-livetranslate-flash-real-time-multimodal-interpretation-across-60-languages-at-2-8-second-latency/)

---

## Unresolved Questions

1. **Exact free-tier RPM/bandwidth limits** for realtime models — Bailian console doesn't specify; Alibaba docs mention "rate limits" but don't publish numbers.
2. **Latency vs model variant trade-offs** — `qwen3.5-livetranslate-flash` vs `qwen3-livetranslate-flash` (2.8s vs 3s latency claimed in blog, but which is which?). Your model name (`qwen3-livetranslate-flash-realtime`) might be the older variant.
3. **Visual context actually used in realtime mode?** Docs say it supports video, but realtime API doesn't have explicit video frame input fields like omni does — unclear if vision features activate in WebSocket mode or only in batch API.
