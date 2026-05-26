# Phase 01 — Rust Backend Rewrite (qwen_realtime.rs + settings.rs)

## Context Links

- Mobile reference: `my-translator-mobile/src/engines/qwen-realtime-client.ts` (lines 42–270)
- Current: `src-tauri/src/commands/qwen_realtime.rs` (486 lines)
- Settings: `src-tauri/src/settings.rs` lines 29–35, 87–88

## Overview

- **Priority:** P1
- **Status:** pending
- **Description:** Replace Omni-Plus session with LiveTranslate Flash. Strip all client-side RMS-VAD. Drop `qwen_audio_output` setting.

## Key Insights

- Live Flash uses **server VAD only** — manual `input_audio_buffer.commit` + `response.create` are rejected with InternalError.
- `session.update` payload changes: drop `instructions`, `voice`, `output_audio_format`; add `input_audio_transcription.language` (required) + `translation.language` (target directive).
- Event schema differs: Live Flash emits `response.text.text` (committed + stash) + `response.text.done`. No `response.text.delta`, no `audio_transcript.*`, no source `input_audio_transcription.completed`.
- Modalities locked to `["text"]` — text-only, audio output disabled.

## Requirements

### Functional

- WS connect to `wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=qwen3-livetranslate-flash-realtime` with `Authorization: Bearer <key>`.
- Send `session.update` with new payload on open.
- Forward `input_audio_buffer.append` (pcm16 @ 16kHz, base64). No commit/response.create.
- Forward `response.text.text` → `QwenEvent::Transcript { is_final: false, text: committed + stash }`.
- Forward `response.text.done` → `QwenEvent::Transcript { is_final: true, text }`. Dedupe by `response_id` (guard against double-fire when text+audio_transcript both finalize, even though `["text"]`-only should fire once — keep guard).
- Forward `error` → `QwenEvent::Error`.

### Non-functional

- `cargo check` passes.
- No unused imports/warnings beyond existing baseline.
- File size < 200 LOC after rewrite (vs 486 LOC current).

## Architecture

```
JS app.js → qwen_realtime_start (Rust IPC)
            ├── tokio::spawn(run_session)
            │   ├── WS handshake (DashScope-intl)
            │   ├── send session.update
            │   └── loop {
            │       on audio_rx  → ws.send(input_audio_buffer.append)
            │       on ws msg    → handle_server_event → event_ch
            │       on stop_rx   → ws.close
            │     }
            └── return session_id
```

No more: RMS-VAD timers, `silence_ms`/`window_ms` state, `commit_turn`, `response_in_flight` flag, `rms_int16` function.

## Related Code Files

### Modify

- `src-tauri/src/commands/qwen_realtime.rs` — full rewrite per layout below
- `src-tauri/src/settings.rs`:
  - Line 29 doc: "Qwen-Omni Realtime" → "Qwen LiveTranslate Flash"
  - Lines 32–35: delete `qwen_audio_output` field block
  - Line 88: delete `qwen_audio_output: false,` default

### Read (unchanged)

- `src-tauri/src/commands/openai_realtime.rs` (for pattern reference on Tauri Channel + Sessions map)
- `src-tauri/src/lib.rs` (to confirm `QwenState` registration still matches)

## Implementation Steps

1. **settings.rs first** (small, low-risk):
   - Delete field `qwen_audio_output` and its default. Update doc comment.
   - Verify struct-level `#[serde(default)]` on line 23 (already present) — handles old JSON with stale field gracefully.
   - `cargo check`.

2. **qwen_realtime.rs rewrite** (replace whole file):
   - Update top comment to describe Live Flash, server-VAD, text-only.
   - Constants: change URL model param. Delete `SILENCE_RMS`, `SILENCE_MS`, `MIN_WINDOW_MS`, `MAX_WINDOW_MS`, `SAMPLE_RATE_HZ`, `BYTES_PER_SAMPLE`.
   - `QwenRealtimeConfig`:
     ```rust
     pub struct QwenRealtimeConfig {
         pub api_key: String,
         pub source_language: String,   // BCP-47, "auto" → "en" fallback
         pub target_language: String,   // BCP-47, sent as translation.language
     }
     ```
     Drop `target_language_name`, `audio_output`. Drop `default_true` helper.
   - `QwenEvent`: drop `SourceTranscript` + `AudioChunk` variants. Keep `Status`, `Transcript`, `Error`, `Closed`.
   - `run_session` loop body simplified:
     - On `audio_rx`: just b64 + send `input_audio_buffer.append`. Drop all VAD logic.
     - On `stop_rx`: drop the "commit pending window" branch — just close.
     - On WS msg: `handle_server_event(text, &event_ch, &mut last_done_response_id)`.
   - `build_session_update`:
     ```rust
     let source = if cfg.source_language.is_empty() || cfg.source_language == "auto" {
         "en"
     } else {
         &cfg.source_language
     };
     let session = json!({
         "modalities": ["text"],
         "input_audio_format": "pcm",
         "input_audio_transcription": { "language": source },
         "translation": { "language": cfg.target_language },
         "turn_detection": serde_json::Value::Null,
     });
     ```
   - `handle_server_event` — match arms:
     - `"session.created" | "session.updated" | "response.created" | "response.done"` → no-op
     - `"response.text.text"` → read `text` + `stash` strings, concat, emit `QwenEvent::Transcript { text: snapshot, is_final: false }` if non-empty
     - `"response.text.done"` → dedupe by `response_id` (or `item_id`), emit `is_final: true` with `text` or fall back to last provisional (but Rust side doesn't buffer provisional — JS does; just emit `data.text`)
     - `"error"` → `QwenEvent::Error { code, message }`
     - else → drop
   - Delete `commit_turn`, `rms_int16` functions.
   - Keep `qwen_realtime_start`, `qwen_realtime_send_audio`, `qwen_realtime_stop` signatures unchanged.

3. `cargo check --manifest-path src-tauri/Cargo.toml`.

## Todo List

- [ ] settings.rs: drop `qwen_audio_output` field + default + update doc comment
- [ ] cargo check after settings.rs edit
- [ ] qwen_realtime.rs: rewrite top doc comment
- [ ] qwen_realtime.rs: update QWEN_REALTIME_URL constant
- [ ] qwen_realtime.rs: delete RMS-VAD constants block
- [ ] qwen_realtime.rs: rewrite QwenRealtimeConfig struct (drop fields, add source_language)
- [ ] qwen_realtime.rs: rewrite QwenEvent enum (drop SourceTranscript, AudioChunk)
- [ ] qwen_realtime.rs: simplify run_session loop (no VAD, no commit_turn)
- [ ] qwen_realtime.rs: rewrite build_session_update (text-only, translation.language, source fallback "en")
- [ ] qwen_realtime.rs: rewrite handle_server_event (text.text / text.done schema; dedupe by response_id)
- [ ] qwen_realtime.rs: delete commit_turn + rms_int16 helpers
- [ ] cargo check passes
- [ ] grep -r "qwen3.5-omni\|SILENCE_RMS\|rms_int16\|commit_turn" src-tauri/src → empty

## Success Criteria

- `cargo check` clean.
- Final file ≤ ~180 LOC.
- Grep for `omni|RMS|VAD|commit_turn|audio_output` in `qwen_realtime.rs` returns 0 hits.
- `Settings::default()` no longer constructs `qwen_audio_output`.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Existing user's settings.json has `qwen_audio_output` → serde error | Med | Low | Struct-level `#[serde(default)]` on line 23 already ignores unknown fields. Verify by saving a settings.json with extra field, loading via Settings::load. |
| Live Flash rejects empty source lang | Med | High | Default `cfg.source_language.is_empty() || == "auto"` → `"en"` in `build_session_update` and again in JS layer. |
| `response.text.done` dedupe unnecessary (only `["text"]` modality) | Low | Low | Keep guard — cheap insurance, matches mobile pattern. |
| Removing AudioChunk variant breaks compile elsewhere | Low | Med | Grep usages: only JS-side via Channel evt.type — JS rewrite (Phase 02) drops that arm. Rust enum is self-contained. |

## Security Considerations

- API key still passes via Bearer header; no logging of key.
- WS error/message dumps to stderr — confirm no secret leakage in `handle_server_event`'s `eprintln!`.

## Next Steps

- Phase 02 (JS client rewrite) consumes the new event schema.
- Phase 03 (settings.js + index.html) parallels this phase.
