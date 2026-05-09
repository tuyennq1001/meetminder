# Phase 04 — Sessions List/Viewer UI Redesign

## Context Links
- Existing markup: `src/index.html:743-779`
- Existing list logic: `src/js/app.js:1916-1988` (`_showSessions`, `_openSession`, `_parseSessionMeta`)
- Rust API: `./phase-01-rust-persistence.md` (`list_sessions`, `read_session`, `update_session_title`, `delete_session`, `search_sessions`)
- Plan overview: `./plan.md`

## Overview
- **Priority**: P2
- **Status**: pending
- **Effort**: 2h
- Redesign `#sessions-view` to show rich metadata, support search, edit-title, delete, and open in viewer.

## Requirements
**Functional**
- List item shows: auto-title (or user title), engine badge, lang pair (`ja → vi`), date+time, duration, chunks count.
- Search box at top of list — debounced 200ms — calls `search_sessions`.
- Click item → opens viewer (existing pane).
- Pencil icon next to title → inline input → save via `update_session_title`.
- Trash icon → confirm → `delete_session` → re-render list.
- "New Session" button visible in main overlay header (NOT here — in app overlay; handler defined in phase 03).
- Legacy `.md`-only items: render with grey "Legacy" badge, no edit/delete (read-only).
- Empty state and error state handled gracefully.

**Non-functional**
- List render < 100ms for 200 items.
- Search uses backend full-text scan (not JS).

## Architecture

```
#sessions-view
 ├── header (back, "Sessions" title)
 ├── #sessions-search-bar (NEW)
 │    └── <input type="search" placeholder="Search sessions...">
 ├── #sessions-list-panel
 │    └── #sessions-list
 │         └── .session-item × N
 │              ├── .session-item-row1: <title> <pencil> <trash>
 │              ├── .session-item-row2: <engine-badge> <lang-pair> <date-time>
 │              └── .session-item-row3: <duration> · <chunks> chunks
 └── #session-viewer (existing — minor: add export buttons)
      ├── header (back, title-editable, copy)
      ├── + .session-export-bar: [Export .srt] [Export .txt]    (phase 05)
      └── content
```

## Related Code Files
**Read**: `src/index.html:743-779`, `src/js/app.js:1914-1988`
**Modify**: `src/index.html` (add search bar, item template change), `src/styles.css` (.session-item layout), `src/js/app.js` (rewrite `_showSessions`, `_openSession`, add `_renderSessionItem`, `_searchSessions`, `_editTitle`, `_deleteSession`)
**Create**: none

## Implementation Steps
1. **HTML**: insert `<div id="sessions-search-bar"><input id="sessions-search-input" type="search" placeholder="Search..."></div>` above `#sessions-list-panel` inside `#sessions-view`.
2. **CSS** (`src/styles.css`): style search bar (~36px tall), `.session-item` 3-row flex layout, `.engine-badge` color-coded (`openai`=purple, `soniox`=blue, `local`=green), `.legacy-badge` grey.
3. **app.js — rewrite `_showSessions`**:
   ```js
   async _showSessions() {
       const items = await invoke('list_sessions');
       this._allSessions = items; // cache for client-side filter fallback
       this._renderSessionList(items);
   }
   ```
4. **`_renderSessionList(items)`**: generate item DOM via `_renderSessionItem(s)` for each. Empty state: "No sessions yet."
5. **`_renderSessionItem(s)`**: returns HTML — title, edit/delete icons (hidden if `s.has_legacy_only`), engine badge, langs, datetime, duration, chunk count.
6. **Search wiring**: input `oninput` → debounce 200ms → `await invoke('search_sessions', {query})` → re-render.
7. **`_openSession(id)`**: replace `read_transcript` call with `read_session` → renders `data.md` in viewer; stash `data.json` for export buttons.
8. **`_editTitle(id, currentTitle)`**: inline replace title span with `<input>`; on Enter/blur → `await invoke('update_session_title', {id, title})` → re-render row.
9. **`_deleteSession(id)`**: `if (!confirm('Delete this session?')) return;` → `invoke('delete_session', {id})` → re-fetch list.
10. **Legacy fallback**: when `s.has_legacy_only`, click handler reads via `read_transcript({filename})` instead of `read_session`.
11. **Format helpers**:
    - `_formatLangPair(src, tgt)` → `🇯🇵 ja → 🇻🇳 vi` (reuse emoji map from ui.js, or just `${src.toUpperCase()} → ${tgt.toUpperCase()}`).
    - `_formatDuration(sec)` → `12m 34s` or `1h 05m`.
    - `_formatDateTime(iso)` → `May 9, 14:30`.

## Todo List
- [ ] Search bar HTML + CSS
- [ ] `.session-item` redesigned CSS (3-row layout, badges)
- [ ] `_showSessions` rewritten to use `list_sessions`
- [ ] `_renderSessionItem` with all metadata
- [ ] Search input wired with debounce
- [ ] Edit-title inline flow
- [ ] Delete-with-confirm flow
- [ ] Legacy item rendering (read-only)
- [ ] `_openSession` uses `read_session`
- [ ] Manual test: 5+ sessions including legacy, search, edit, delete

## Success Criteria
- All metadata visible on each item.
- Search returns matches as user types.
- Title edit persists across reloads (verified by reopening app).
- Delete removes both `.md` and `.json` from disk.
- Legacy items render and open without errors; no edit/delete shown.

## Risk Assessment
| Risk | Mitigation |
|------|-----------|
| Search debounce + rapid-typing → out-of-order responses | Use request-id; ignore stale responses |
| Inline edit blur fires after Enter → double-save | Track `_isSaving` flag |
| Empty title submitted | Reject; revert to previous |
| Massive session count (1000+) → slow scroll | Virtualize later; not in v1 (YAGNI) |

## Security Considerations
- Title input escaped via `_esc` (existing helper).
- `id` passed back to Rust validates format server-side (phase 01).
- Search query: no SQL — Rust does substring match, safe.
