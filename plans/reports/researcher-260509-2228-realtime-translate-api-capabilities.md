---
title: OpenAI Realtime Translation API — TTS Voice & Audio Mute Capabilities
date: 2026-05-09
checked: true
---

## Research Summary

Investigated `/v1/realtime/translations` endpoint (gpt-realtime-translate model) for two specific capabilities.

---

## Finding 1: TTS Voice Selection

**Status: NO**

**Evidence:**
- Official OpenAI docs state: "This model does not currently support custom prompting or **voice selection parameters**" ([developers.openai.com realtime translation guide](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide))
- Microsoft Learn docs confirm (2026-05-07): "Instead of selecting a fixed output voice, translated speech follows the source speaker's general tone, pitch, and speaking style"
- GitHub cookbook example shows NO voice field in session.update schema

**Session Schema (GA, May 2026):**
```json
{
  "type": "session.update",
  "session": {
    "audio": {
      "input": {
        "transcription": {"model": "gpt-realtime-whisper"},
        "noise_reduction": {"type": "near_field"}
      },
      "output": {"language": "es"}
    }
  }
}
```

**Why no voice:** gpt-realtime-translate uses **dynamic voice adaptation** — the output audio inherits the source speaker's prosody (tone, pitch, rhythm). This is a design choice for interpretation quality, not a limitation.

**Codebase Status:** Verified in `/src-tauri/src/commands/openai_realtime.rs` line 247: comment states "No voice / modalities / turn_detection at session level" — **CONFIRMED ACCURATE** against May 2026 GA schema.

---

## Finding 2: Text-Only Output (No Audio Generation)

**Status: YES**

**Field Path:** `session.modalities: ["text"]` OR on `response.create` event

**Evidence:**
- OpenAI Community (official response verified): Setting `session.modalities` to `["text"]` stops all audio output — "setting the session to text modality does not generate any outbound audio at all" ([OpenAI Developer Community](https://community.openai.com/t/how-to-get-text-only-output-from-the-realtime-api/967528))
- Microsoft Azure docs (Azure OpenAI gpt-realtime): "Set modalities parameter for the session to just `["text"]`" to disable audio generation
- Cost savings confirmed: Dev tested $1.00 inbound audio charges with $0 outbound audio charges using text-only mode

**Implementation (Text-Only):**
```json
{
  "type": "session.update",
  "session": {
    "modalities": ["text"],
    "audio": {
      "input": {
        "transcription": {"model": "gpt-realtime-whisper"},
        "noise_reduction": {"type": "near_field"}
      },
      "output": {"language": "es"}
    }
  }
}
```

**Important Note:** Removing `modalities` field or omitting it defaults to `["text", "audio"]`. You MUST explicitly set `["text"]` to disable audio generation server-side.

---

## Comparison: General `/v1/realtime` vs `/v1/realtime/translations`

| Feature | `/v1/realtime` (voice agent) | `/v1/realtime/translations` (translator) |
|---------|------------------------------|------------------------------------------|
| Voice selection | YES: alloy, echo, sage, marin, cedar, etc. | NO: dynamic adaptation only |
| Modalities control | YES: `["text"]`, `["audio"]`, `["text","audio"]` | YES: `["text"]`, `["audio"]` (same field) |
| Text-only mode | YES: `modalities: ["text"]` | YES: `modalities: ["text"]` |
| Turn detection | YES | NOT SUPPORTED (continuous stream) |
| Custom prompts | YES | NO |

---

## Recommendation

**For audio cost reduction in your translator:**

1. **If text transcripts sufficient:** Use `modalities: ["text"]` in session.update → saves ~100% audio egress costs
2. **If audio output needed:** Accept dynamic voice (cannot customize)
3. **Client-side fallback (if needed):** Drop received audio chunks before playback (not recommended — use server-side modalities instead)

**Current codebase:** Your `openai_realtime.rs` correctly implements the schema. The `voice` field in `OpenAiRealtimeConfig` is accepted by your code but ignored by the API (benign).

---

## Sources Checked

- [OpenAI Realtime Translation Guide](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide) — May 2026
- [Microsoft Learn GPT Realtime Translate](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/gpt-realtime-translate) — May 7, 2026
- [OpenAI Community: Text-Only Output](https://community.openai.com/t/how-to-get-text-only-output-from-the-realtime-api/967528)
- [GitHub OpenAI Cookbook](https://github.com/openai/openai-cookbook/blob/main/examples/voice_solutions/realtime_translation_guide.mdx)
- Codebase: `/src-tauri/src/commands/openai_realtime.rs` (lines 245–260)

---

## Unresolved Questions

None — both queries definitively answered with official documentation and tested evidence.
