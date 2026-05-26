# Benchmark — OpenAI Realtime vs Soniox

> Real-world side-by-side test, run on **2026-05-08** with both providers receiving identical audio bytes simultaneously.

| Audio | `live-test/Hope-v2.mp4` (Japanese TED-style talk) |
|---|---|
| **Duration** | 5 min 02 s, mono 16 kHz s16le |
| **Source → Target** | Auto-detect → Vietnamese |
| **Soniox engine** | `stt-rt-v4` |
| **OpenAI engine** | `gpt-realtime-translate` (May 2026 GA) |

---

## TL;DR

| | ⚡ OpenAI Realtime | ☁️ Soniox |
|---|---|---|
| **Latency to first translated word** | **~15.0 s** | ~16.4 s |
| **Latency to connect** | 1006 ms | 1062 ms |
| **Voice output** | ✅ Native 24 kHz translated speech included | ❌ Text only — needs separate TTS |
| **Output style** | Token-stream (1269 deltas, joined client-side) | Sentence-final segments (92 finals) |
| **Translation quality (JA→VI)** | More idiomatic, terser; drops fillers | More literal, preserves cadence |
| **Languages — target** | 13 (en, es, pt, fr, de, it, ru, hi, id, vi, ja, ko, zh) | 70+ (any Soniox-supported pair) |
| **Two-way mode** | ❌ Not supported | ✅ Supported |
| **Cost** | **~$4.14/hr** (~$0.069/min) | **~$0.12/hr** (~$0.002/min) |
| **Cost ratio** | **34× more expensive** | baseline |

---

## 1. Speed

Both providers stream incrementally. The visual experience differs:

- **OpenAI** emits **token-level deltas** as the model decodes — text appears word-by-word, very fast feel. First translated word arrived at ~15.0 s into the clip.
- **Soniox** emits **sentence-final segments** after endpoint detection — text arrives in clean chunks, slightly more "settled" feel. First final arrived at ~16.4 s.

OpenAI's first-final is **~1.4 s faster**, but both feel real-time during a meeting. Connect/handshake time is essentially identical (~1 s).

> The app concatenates OpenAI's deltas client-side so what you see on screen is regular sentences — the streaming difference is invisible to the user except for the speed-of-render.

---

## 2. Translation mechanism

This is the most important practical difference.

### OpenAI Realtime
- Single bidirectional WebSocket: audio frames in (24 kHz s16le), token-stream + audio frames out (24 kHz)
- The model sees **the full audio context window** — it can "hear ahead" while emitting tokens, which is why it produces such idiomatic Vietnamese instead of word-by-word literal translation
- Returns **translated text *and* translated voice** in a single stream — no second TTS call, no extra latency
- The voice sounds natural and uses appropriate Vietnamese intonation
- **Audio output cannot be disabled.** The translation endpoint (`gpt-realtime-translate`) does not accept `modalities: ["text"]` — that flag exists on the conversational Realtime endpoint but not the translation one. If you need text-only, you have to pick a different stack (Whisper + GPT, or Soniox)

### Soniox
- Continuous-streaming ASR with translation as a configured side-channel
- Translates **per finalised sentence** — each Vietnamese segment is locked once the engine commits to a Japanese sentence boundary
- Returns **text only**. To speak the translation you pipe the text through Edge TTS / Google Chirp / ElevenLabs (this is what the app does for you when TTS is enabled)
- Two-way mode is built around this sentence-finalisation model — language detection + per-segment routing works naturally

**Implication for choice:** if you want zero-config voice output and the most idiomatic phrasing → OpenAI. If you want two-way bilingual meetings, Thai output, or unusual language pairs → Soniox.

---

## 3. Quality — Japanese → Vietnamese (curated observations)

Both transcripts are publishable quality. Specific differences from the 5-min sample:

| Aspect | OpenAI | Soniox |
|---|---|---|
| Speaker name "Uematsu Tsutomu" | Mishears as `tsutomu` only | **Captures full name correctly** |
| Place name 赤平 (Akabira) | **Spelled `Akabira` ✓** | Spelled `Akahira` (one consonant off) |
| Loanword 「マグネット」 | **Keeps as `Magnet` ✓** | Translates literally as `nam châm` |
| Apollo Moon-landing emotional beat | **Idiomatic** — "ông mừng lắm" | Slightly stilted — "vui mừng đến mức chưa từng thấy" |
| Filler words "Vâng, ờ" | Dropped, starts at substantive sentence | Preserved (more faithful to live speech) |
| Teacher dialogue register | **Crisp Vietnamese register** | Natural Vietnamese register |
| End-of-clip coverage | Reaches same endpoint | Reaches same endpoint |

**Subjective summary:**
- **OpenAI** reads like it was written by a Vietnamese translator listening to the talk afterwards — terser, more idiomatic, drops disfluencies
- **Soniox** reads like a real-time interpreter — preserves more of the original speech texture including hesitations, occasionally awkward but always faithful

For most use-cases, OpenAI's output is the more pleasant read. For preserving every nuance of the source (academic/legal/court context), Soniox's literalness is actually the safer choice.

---

## 4. Cost (provider list rates, as of 2026-05)

| | per minute | per hour | this 5-min run |
|---|---|---|---|
| **OpenAI Realtime** | ~$0.069 (audio in + text out + audio out) | **~$4.14** | $0.348 |
| **Soniox stt-rt-v4 + translate** | ~$0.002 | **~$0.12** | $0.010 |

**OpenAI is ~34× more expensive than Soniox** at provider list rates.

Important: this is **not** apples-to-apples. OpenAI includes translated speech audio. To get the same final UX with Soniox, you add a TTS layer:

| TTS provider added on top of Soniox | Extra cost | Combined Soniox + TTS |
|---|---|---|
| Edge TTS (free) | $0/hr | ~$0.12/hr |
| Google Chirp 3 HD | ~$0/hr (within 1M char/mo free tier) | ~$0.12/hr |
| ElevenLabs (Starter) | ~$5/mo subscription, ~60 min | varies |

Even with Google Chirp 3 HD layered on, **Soniox + TTS is ~30× cheaper than OpenAI** — and the voice quality of Chirp 3 HD is very close to OpenAI's native voice.

The case for OpenAI is **not** about cost-per-minute — it's about quality-of-translation and zero-config voice output. If you bill the cost back to a client meeting or a high-stakes presentation, $4/hr is trivial. For everyday personal use, Soniox + Edge TTS is dramatically more economical.

---

## 5. When to pick which

| Use case | Recommendation |
|---|---|
| Bilingual meeting (two-way mode) | **Soniox** — only engine that supports two-way |
| Thai or other non-13 target language | **Soniox** — OpenAI doesn't support it |
| Personal YouTube / podcast watching | **Soniox** — economical, very good quality |
| High-stakes business meeting (client-facing) | **OpenAI** — best translation, native voice, $4/hr is tolerable |
| You already have ElevenLabs/Google TTS configured | **Soniox** — TTS is solved |
| You want zero TTS configuration | **OpenAI** — voice is included |
| Offline / no internet | **Local MLX** (third option, not benchmarked here) |
| You want literal, faithful transcription | **Soniox** |
| You want idiomatic, natural-reading translation | **OpenAI** |

The app lets you switch engines per-session, so you can keep both keys configured and pick the right tool per situation.

---

## 6. Test methodology

- Same audio file streamed simultaneously to both providers from a single Rust harness (`live-test/comparison-rs/src/compare.rs`)
- 200 ms chunks, real-time pacing, 16 kHz mono PCM (upsampled to 24 kHz for OpenAI as required by the model)
- All events timestamped to millisecond precision
- Raw event log: [`live-test/report/comparison-260508-2122-raw.json`](../live-test/report/comparison-260508-2122-raw.json)
- Curated full transcripts side-by-side: [`live-test/report/comparison-260508-final.md`](../live-test/report/comparison-260508-final.md)
- 0 errors on either side over the full 5-min run

---

## 7. Caveats

- **Single 5-min sample**, single language pair (Japanese → Vietnamese), single speaker (TED-style monologue, clean studio audio). Quality observations are directional, not statistical
- Cost numbers are **provider list rates**, not negotiated enterprise rates
- OpenAI's `gpt-realtime-translate` is a fresh GA product (May 2026); pricing and behaviour may change
- The app charges your **own** OpenAI / Soniox accounts directly — there is no markup or relay
