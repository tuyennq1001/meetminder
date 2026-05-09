# Phase 05 — Resume-on-Restart + .srt/.txt Export

## Context Links
- Rust commands: `./phase-01-rust-persistence.md` (`export_session_srt`, `export_session_txt`)
- SessionStore.resume: `./phase-02-js-session-store.md`
- Hook in init: `./phase-03-app-integration.md` (Step 2, `_tryLoadDanglingSession`)
- Viewer DOM: `src/index.html:760-778`

## Overview
- **Priority**: P3
- **Status**: pending
- **Effort**: 1.5h
- Two small features that polish the experience.

## Requirements

### 5a — Resume-on-Restart
**Functional**
- On app launch, after `list_sessions`, find sessions with `ended_at == null`.
- If found AND most-recent is < 24h old: show modal "Resume previous session? (Created X minutes ago, N segments)" with [Resume] [Start New].
- Resume → `SessionStore.resume(id)` rehydrates state. UI shows transcript content from JSON (call new `transcriptUI.loadFromSegments(segments)`).
- Start New → mark old session ended (`endedAt = now`, persist), then `init()` fresh.
- Crash safety: if user ignores prompt and just clicks Start, treat as Start New (auto-close old).

### 5b — Export .srt / .txt
**Functional**
- Two buttons in `#session-viewer` header: "Export .srt", "Export .txt".
- Click → invoke Rust → get string content → trigger browser download via `Blob` + anchor link (no new Tauri dialog needed).
- File names: `{title}-{id}.srt` / `.txt`, slugified.

## Architecture
```
launch
  └─ list_sessions()
       └─ filter(s => s.ended_at == null && age < 24h)
             ├─ found → show resume modal
             │   ├─ Resume → SessionStore.resume + transcriptUI.loadFromSegments
             │   └─ New    → mark old ended, init fresh
             └─ none → init fresh

viewer header
  └─ [Export .srt] → invoke('export_session_srt', {id}) → blob download
  └─ [Export .txt] → invoke('export_session_txt', {id}) → blob download
```

## Related Code Files
**Read**: `src/js/app.js` (init, modal helpers), `src/js/ui.js` (segment shape)
**Modify**: `src/index.html` (add export buttons in viewer header, add resume-modal markup), `src/js/app.js` (resume flow + export handlers), `src/js/ui.js` (add `loadFromSegments(segments)`), `src/js/session-store.js` (already has `resume` static — flesh out)
**Create**: none

## Implementation Steps

### 5a — Resume
1. Add resume modal markup in `index.html` (similar pattern to setup-modal, hidden by default).
2. In `app.js init()`:
   ```js
   const dangling = await this._findDanglingSession();
   if (dangling) {
       const choice = await this._promptResume(dangling);
       if (choice === 'resume') {
           await sessionStore.resume(dangling.id);
           this.transcriptUI.loadFromSegments(this._flattenChunks(sessionStore.chunks));
       } else {
           await this._closeDanglingSession(dangling.id);
           sessionStore.init({});
       }
   } else {
       sessionStore.init({});
   }
   ```
3. Implement `_findDanglingSession()`: list_sessions → first item with `ended_at == null` and `(now - created_at) < 24h`.
4. Implement `_promptResume(s)`: show modal, return Promise<'resume'|'new'>.
5. Implement `_closeDanglingSession(id)`: invoke `read_session` → set `ended_at` → invoke `save_session` again. Or add a Rust shortcut `close_session(id)` (KISS — one-liner Rust).
6. Add `transcriptUI.loadFromSegments(segments)` in `ui.js`:
   ```js
   loadFromSegments(segments) {
       this.clear();
       this.sessionLog = [];
       for (const s of segments) {
           if (s.src) this.addOriginal(s.src, null, null);
           if (s.tgt) this.addTranslation(s.tgt);
       }
   }
   ```
7. Helper `_flattenChunks(chunks)`: returns a single segment array; insert sentinel divider entries between chunks (visual only — `{src: '──── resumed ────', tgt: ''}`).

### 5b — Export
8. Add buttons in `#session-viewer` header:
   ```html
   <button id="btn-session-export-srt" class="session-copy-btn">Export .srt</button>
   <button id="btn-session-export-txt" class="session-copy-btn">Export .txt</button>
   ```
9. In `app.js`, after opening session save `this._currentViewerSessionId = id`.
10. Add handlers:
    ```js
    document.getElementById('btn-session-export-srt').addEventListener('click', () => {
        this._exportSession('srt');
    });
    document.getElementById('btn-session-export-txt').addEventListener('click', () => {
        this._exportSession('txt');
    });
    ```
11. Implement `_exportSession(format)`:
    ```js
    const id = this._currentViewerSessionId;
    if (!id) return;
    const cmd = format === 'srt' ? 'export_session_srt' : 'export_session_txt';
    const text = await invoke(cmd, {id});
    const blob = new Blob([text], {type: 'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this._slugify(this._currentViewerTitle)}-${id}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    ```
12. `_slugify(s)` — lowercase, replace non-alphanum with `-`, trim, max 50 chars.

## Todo List
- [ ] Resume modal markup
- [ ] `_findDanglingSession`
- [ ] `_promptResume` modal helper
- [ ] `_closeDanglingSession` (or `close_session` Rust cmd)
- [ ] `transcriptUI.loadFromSegments`
- [ ] `sessionStore.resume(id)` (verify hydration)
- [ ] Export buttons in viewer
- [ ] `_exportSession` handler with blob download
- [ ] Slugify helper
- [ ] Manual test: kill app mid-session, relaunch, click Resume → continue
- [ ] Manual test: export .srt opens in VLC; .txt readable

## Success Criteria
- Force-quit app while running → relaunch → modal appears with correct meta.
- Resume → display restored; new Start appends to same session.
- Start New (after dangling) → fresh id; old has `ended_at` set.
- .srt file is valid (timestamps `HH:MM:SS,000 --> HH:MM:SS,000`).
- .txt is plain target translations.

## Risk Assessment
| Risk | Mitigation |
|------|-----------|
| Resume restores 10k segments → slow render | Cap UI display to last 500; full data still in JSON |
| .srt has zero-length when only one segment | Default end = start + 3s |
| Browser blob download blocked in Tauri webview | Tauri 2 supports it; fallback to writing via Rust temp file if not |
| User opens dangling-modal twice (rapid relaunch) | Single-fire flag in init |

## Security Considerations
- No new IPC surface beyond phase 01 commands.
- Slugify strips all non-alphanum to prevent path injection in filename.
