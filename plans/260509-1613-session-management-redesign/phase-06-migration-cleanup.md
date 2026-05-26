# Phase 06 — Migration + Cleanup

## Context Links
- Legacy command: `src-tauri/src/commands/transcript.rs:save_transcript` (still needed?)
- Legacy caller: `src/js/app.js:1779` (gone after phase 03)
- Plan overview: `./plan.md`

## Overview
- **Priority**: P3
- **Status**: pending
- **Effort**: 0.5h
- Final cleanup pass: deprecate dead code, ensure legacy `.md`-only files remain accessible, document.

## Requirements
**Functional**
- Existing `.md` files in `transcripts/` (pre-redesign) are listable + viewable in new UI.
- No data loss — never auto-migrate or rename old files.
- `save_transcript` Rust command stays for now (zero callers, kept as escape hatch); add `#[deprecated]` note.
- `read_transcript` stays for legacy item viewer (phase 04 uses it).

**Non-functional**
- Plan-level docs note any migration considerations.

## Architecture
No code architectural changes — this is housekeeping.

## Related Code Files
**Read**: all files modified in phases 01-05
**Modify**: `src-tauri/src/commands/transcript.rs` (deprecation comments), `src/js/app.js` (delete dead `_saveTranscriptFile` if not already, delete `_parseSessionMeta` if obsoleted), `docs/codebase-summary.md` (note new session model)
**Create**: none

## Implementation Steps
1. Search for callers of `save_transcript`:
   ```bash
   grep -rn "save_transcript" src/ src-tauri/
   ```
   Confirm zero JS callers after phase 03. Mark Rust command with `// DEPRECATED: kept for emergency manual save` comment.
2. Delete `_saveTranscriptFile()` in `app.js` (or confirm phase 03 already removed it).
3. Delete `_parseSessionMeta` if `_renderSessionItem` from phase 04 fully replaced it.
4. Verify `list_transcripts` is still imported nowhere — if confirmed, mark deprecated; do NOT remove (legacy fallback in phase 04 may use `read_transcript`).
5. Update `docs/codebase-summary.md`:
   - Add section "Session Persistence (v0.6+)" describing JSON+MD pair.
   - Mention legacy `.md`-only files coexist.
6. Add a one-liner to `docs/system-architecture.md` mentioning launch-scoped sessions.
7. Run `cargo build` + `npm run tauri dev` once for smoke check.
8. Commit with `feat: redesign session management (launch-scoped MD+JSON)`.

## Todo List
- [ ] Confirm zero JS callers of `save_transcript`
- [ ] Add deprecation comments in Rust
- [ ] Remove dead JS helpers
- [ ] Update `docs/codebase-summary.md`
- [ ] Update `docs/system-architecture.md`
- [ ] Final build + smoke test

## Success Criteria
- Build clean (no warnings on touched files).
- Loading a legacy `.md`-only transcript in new sessions UI works.
- Docs reflect new session model.

## Risk Assessment
| Risk | Mitigation |
|------|-----------|
| Deleting `save_transcript` Rust command breaks future emergency path | Keep it; only deprecate via comment |
| Legacy users confused why old files have no title/engine | UI shows "Legacy" badge; tooltip explains |

## Security Considerations
- None new.

## Next Steps
- Future enhancement (out of scope): bulk export, cloud sync, session merging, full-text search across `.md` body.
