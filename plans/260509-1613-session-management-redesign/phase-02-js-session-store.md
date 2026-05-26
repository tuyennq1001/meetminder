# Phase 02 — JS SessionStore Module

## Context Links
- Plan overview: `./plan.md`
- Rust API surface: `./phase-01-rust-persistence.md`
- Current callers (to be replaced): `src/js/app.js:1728-1736, 1757-1786`
- UI segment shape: `src/js/ui.js:62-118` (`addOriginal`, `addTranslation`, `sessionLog`)

## Overview
- **Priority**: P1
- **Status**: pending
- **Effort**: 3h
- New module `src/js/session-store.js` (~200 LOC). Single source of truth for session state in JS. Generates MD + JSON, calls Rust commands, owns lifecycle.

## Requirements
**Functional**
- One `SessionStore` instance per app launch.
- Lifecycle: `init()` → `beginChunk()` → `addSegment(src, tgt)` (many) → `endChunk()` → `persist()` (autosave) → ... → `endSession()` (on close / new-session button).
- Generates auto-title from first 5-7 words of first translated text in chunk[0].segments.
- Builds MD with chunk dividers `──── resumed at HH:MM (after Xm) ────`.
- Saves both MD + JSON via `save_session` Tauri command.
- Reload existing session by id (for resume-on-restart).

**Non-functional**
- Idempotent `persist()` — calling twice is safe.
- No I/O on every segment; debounce or call only at `endChunk`.

## Architecture

```
launch → SessionStore.init()
   ├── id = "260509-1430"  (collision: append "-2", "-3"...)
   ├── created_at = ISO now
   └── chunks = []

Start button → store.beginChunk(engine, srcLang, tgtLang)
   → currentChunk = {started_at: now, ended_at: null, segments: []}

OpenAI/Soniox/Local emits final → store.addSegment(src, tgt)
   → currentChunk.segments.push({ts: HH:MM:SS, src, tgt})

Stop button → store.endChunk() → store.persist()
   → currentChunk.ended_at = now
   → push to chunks[]
   → write JSON + MD atomically via Rust

Close window → store.endSession()
   → ended_at = ISO now
   → final persist()

New Session button → store.endSession() → store.init() (fresh id)
```

## API Sketch

```js
// src/js/session-store.js
export class SessionStore {
    constructor() {
        this.id = null;
        this.createdAt = null;
        this.endedAt = null;
        this.title = '';
        this.engine = null;        // 'openai'|'soniox'|'local'
        this.sourceLang = '';
        this.targetLang = '';
        this.chunks = [];
        this.currentChunk = null;  // null when stopped
        this._dirty = false;
    }

    init({ engine, sourceLang, targetLang } = {}) {
        this.id = this._generateId();
        this.createdAt = new Date().toISOString();
        this.engine = engine || null;
        this.sourceLang = sourceLang || '';
        this.targetLang = targetLang || '';
    }

    static async resume(id) { /* invoke('read_session', {id}) → hydrate */ }

    beginChunk({ engine, sourceLang, targetLang }) {
        // Update engine/lang at chunk-start (user may switch between Start cycles)
        this.engine ||= engine;
        this.sourceLang ||= sourceLang;
        this.targetLang ||= targetLang;
        this.currentChunk = {
            started_at: new Date().toISOString(),
            ended_at: null,
            segments: [],
        };
    }

    addSegment(src, tgt) {
        if (!this.currentChunk) return; // defensive
        this.currentChunk.segments.push({
            ts: this._timeStr(new Date()),
            src: src || '',
            tgt: tgt || '',
        });
        this._dirty = true;
    }

    endChunk() {
        if (!this.currentChunk) return;
        this.currentChunk.ended_at = new Date().toISOString();
        if (this.currentChunk.segments.length > 0) this.chunks.push(this.currentChunk);
        this.currentChunk = null;
    }

    async persist() {
        if (!this._dirty || this.chunks.length === 0) return;
        if (!this.title) this.title = this._autoTitle();
        const json = this._toJson();
        const md = this._toMarkdown();
        await invoke('save_session', { id: this.id, mdContent: md, jsonData: json });
        this._dirty = false;
    }

    async endSession() {
        this.endChunk(); // safety
        this.endedAt = new Date().toISOString();
        this._dirty = true;
        await this.persist();
    }

    async setTitle(newTitle) {
        this.title = newTitle.trim().slice(0, 200);
        await invoke('update_session_title', { id: this.id, title: this.title });
    }

    isEmpty() { return this.chunks.length === 0 && !this.currentChunk?.segments.length; }

    // ─── internals ─────────────
    _generateId() {
        const d = new Date();
        const pad = n => String(n).padStart(2,'0');
        return `${String(d.getFullYear()).slice(2)}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
        // collision suffix handled Rust-side (return existing id with -2 etc.)
    }
    _timeStr(d) { /* HH:MM:SS */ }
    _autoTitle() {
        const firstTgt = this.chunks[0]?.segments.find(s => s.tgt)?.tgt || '';
        return firstTgt.split(/\s+/).slice(0, 7).join(' ').slice(0, 80) || 'Untitled session';
    }
    _toJson() {
        return {
            id: this.id,
            created_at: this.createdAt,
            ended_at: this.endedAt,
            title: this.title,
            engine: this.engine,
            source_lang: this.sourceLang,
            target_lang: this.targetLang,
            duration_sec: this._totalDurationSec(),
            chunks: this.chunks,
        };
    }
    _toMarkdown() {
        // YAML frontmatter (id, title, engine, langs, duration, chunk count)
        // For each chunk:
        //   if i > 0: `\n──── resumed at HH:MM (after Xm) ────\n`  (gap from prev.ended_at)
        //   `## Chunk N — HH:MM` header
        //   for seg: `[HH:MM:SS] {src}\n→ {tgt}\n`
    }
    _totalDurationSec() { /* sum of (chunk.ended_at - started_at) */ }
}

export const sessionStore = new SessionStore();
```

## Related Code Files
**Read**: `src/js/ui.js`, `src/js/app.js` (lifecycle hooks)
**Create**: `src/js/session-store.js`
**Modify**: none in this phase

## Implementation Steps
1. Create `src/js/session-store.js` per sketch above.
2. Implement `_generateId`, `_timeStr`, `_autoTitle`, `_toMarkdown`, `_totalDurationSec`.
3. Add `_toMarkdown` divider logic: compute `(currentChunk.started_at - prevChunk.ended_at)` in minutes.
4. Add static `resume(id)` that invokes `read_session` and rehydrates fields.
5. Export singleton `sessionStore` (matches pattern of `sonioxClient`, `audioPlayer`).
6. Sanity-test in DevTools console: `import('./session-store.js').then(m => { m.sessionStore.init({engine:'soniox',sourceLang:'ja',targetLang:'vi'}); m.sessionStore.beginChunk({}); m.sessionStore.addSegment('こんにちは','Xin chào'); m.sessionStore.endChunk(); m.sessionStore.persist();})`.

## Todo List
- [ ] Skeleton class + singleton
- [ ] ID + time formatters
- [ ] beginChunk / addSegment / endChunk
- [ ] persist() with `save_session` invoke
- [ ] _toMarkdown with divider
- [ ] _autoTitle
- [ ] resume() static
- [ ] setTitle()
- [ ] Manual smoke test in DevTools

## Success Criteria
- After smoke test, file pair `session-{id}.md` + `.json` exists with one chunk.
- MD shows YAML header + chunk header + segment block.
- Multiple `beginChunk/endChunk` cycles produce divider line in MD.
- File length < 200 LOC (modularize if creeping over).

## Risk Assessment
| Risk | Mitigation |
|------|-----------|
| ID collision when relaunching within same minute | Rust returns adjusted id with suffix; JS accepts returned id |
| Auto-title is gibberish (RTL languages, emoji-heavy) | Cap at 80 chars; fallback "Untitled session"; user can edit |
| `persist()` race when stop() called twice | `_dirty` flag + idempotent body |

## Security Considerations
- No user-supplied paths; id is generated server-side.
- Title input sanitization happens Rust-side; trim+length cap JS-side too.
- No localStorage of API keys here.
