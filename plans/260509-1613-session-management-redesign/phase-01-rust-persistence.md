# Phase 01 — Rust Persistence Layer

## Context Links
- Current code: `src-tauri/src/commands/transcript.rs`
- Registry: `src-tauri/src/lib.rs:47-67`
- Plan overview: `./plan.md`

## Overview
- **Priority**: P1 (blocker for everything else)
- **Status**: pending
- **Effort**: 3h
- Extend transcript.rs with session-aware commands (MD + JSON pair). Keep legacy commands for fallback.

## Requirements
**Functional**
- Save/read/list/delete sessions; update title; export .srt + .txt.
- Atomic write (tmp → rename) so partial writes never corrupt.
- Sanitize filename (no `/`, `\`, `..`).
- List returns lightweight metadata (read .json sidecar, NOT .md body).

**Non-functional**
- IO errors must return readable `String` to JS.
- List must scale to 500+ sessions (avoid O(N²)).

## Architecture
```
transcripts/
├── session-260509-1430.md     ← human readable
├── session-260509-1430.json   ← structured (source of truth for reload)
├── session-260508-2210.md
├── session-260508-2210.json
└── 2026-03-27_10-21-05.md     ← legacy (no .json) → still listable
```

JSON schema (matches plan.md):
```rust
#[derive(Serialize, Deserialize)]
pub struct SessionData {
    pub id: String,                     // "260509-1430"
    pub created_at: String,             // ISO8601
    pub ended_at: Option<String>,       // None = still in progress / crashed
    pub title: String,
    pub engine: String,                 // "openai"|"soniox"|"local"
    pub source_lang: String,
    pub target_lang: String,
    pub duration_sec: u64,
    pub chunks: Vec<Chunk>,
}
#[derive(Serialize, Deserialize)]
pub struct Chunk {
    pub started_at: String,
    pub ended_at: Option<String>,
    pub segments: Vec<Segment>,
}
#[derive(Serialize, Deserialize)]
pub struct Segment {
    pub ts: String,                     // "HH:MM:SS"
    pub src: String,
    pub tgt: String,
}
```

## Related Code Files
**Read**: `src-tauri/src/commands/transcript.rs` (existing pattern)
**Modify**: `src-tauri/src/commands/transcript.rs`, `src-tauri/src/lib.rs`
**Create**: none (extend existing file; if >300 LOC, split into `transcript.rs` + `session_store.rs`)

## Implementation Steps
1. Add `serde_json` to `Cargo.toml` if not present (`cargo add serde_json` or check first).
2. Define `SessionData`, `Chunk`, `Segment` structs with `Serialize + Deserialize`.
3. Add `SessionListItem` struct: `{id, title, engine, source_lang, target_lang, created_at, ended_at, duration_sec, chunk_count, has_legacy_only: bool}`.
4. Implement helper `fn session_paths(dir: &Path, id: &str) -> (PathBuf, PathBuf)` returning `(md, json)`.
5. Implement `fn write_atomic(path: &Path, bytes: &[u8])`: write to `path.tmp`, fsync, rename.
6. Add commands:
   - `save_session(app, id, md_content, json_data: SessionData)` — writes both atomically (json first, then md).
   - `list_sessions(app)` — scan dir; for each `*.json`, parse → `SessionListItem`; for orphan `*.md` (legacy, no matching json), emit with `has_legacy_only: true`. Sort by `created_at` desc.
   - `read_session(app, id) -> {md: String, json: SessionData}` — returns both.
   - `delete_session(app, id)` — remove md + json (best effort, warn on missing).
   - `update_session_title(app, id, title)` — load json, mutate title, regenerate md from json + write atomic.
   - `export_session_srt(app, id) -> String` — generate .srt body from json segments using `ts` as start, +3s default end (or next-ts).
   - `export_session_txt(app, id) -> String` — plain `tgt` lines joined by `\n`.
   - `search_sessions(app, query: String) -> Vec<SessionListItem>` — case-insensitive substring match against title + concatenated segments.
7. Reuse `transcript_dir(&app)` (rename internally to `sessions_dir` if clearer; keep public path stable).
8. Register all new commands in `lib.rs:invoke_handler`.
9. `cargo build` — fix compile errors directly.

## Todo List
- [ ] Verify `serde_json` is available
- [ ] Add structs + atomic-write helper
- [ ] `save_session`
- [ ] `list_sessions` (with legacy detection)
- [ ] `read_session`
- [ ] `delete_session`
- [ ] `update_session_title`
- [ ] `export_session_srt`
- [ ] `export_session_txt`
- [ ] `search_sessions`
- [ ] Register in `lib.rs`
- [ ] `cargo build` clean

## Success Criteria
- `cargo build` passes; no warnings on new code.
- Manual test via Tauri CLI: invoke `save_session` → file pair appears in `~/Library/Application Support/.../transcripts/`.
- `list_sessions` returns both new pairs and legacy `.md` orphans.
- Killing process mid-write leaves the OLD file intact (atomic rename guarantees this).

## Risk Assessment
| Risk | Mitigation |
|------|-----------|
| JSON corruption from concurrent writes | Mutex around session write OR rely on atomic rename + JS-side single-writer |
| .srt timestamp generation with no end time | Default to next segment's `ts` or +3s clamp |
| Legacy file detection misclassifies | Strict pattern: `^session-\d{6}-\d{4}\.(md|json)$` for new format |

## Security Considerations
- Sanitize `id` parameter: must match `^[a-zA-Z0-9-]+$` (block path traversal).
- Reject `id` longer than 64 chars.
- Title input: strip control chars before persisting.
