# Phase 04 — Language List + Source Picker Enforcement

## Context Links

- Mobile lang list: `my-translator-mobile/src/lib/languages.ts` `QWEN_LANGS` (60 entries, lines 44–106)
- Existing desktop language pickers: `src/index.html` lines 338–479 (inline `<optgroup>` lists for source + target)
- App.js lang refresh: `src/js/app.js` lines 1207–1231 `_refreshTargetLangList`

## Overview

- **Priority:** P1
- **Status:** pending
- **Description:** When engine = qwen, both source + target `<select>` get rebuilt from `QWEN_LANGS` (60 entries). Source MUST NOT default to "auto" — UI snaps to `en`. When switching back to soniox/local, restore full Soniox-style list. Document mode boundary in `_updateUI`.

## Key Insights

- Desktop today uses **hardcoded HTML `<optgroup>` lists** (~50 langs each) — that list is roughly the Soniox set (includes "Welsh", "Tagalog", etc.).
- Live Flash has its own 60-lang list (see mobile `QWEN_LANGS`) with codes that overlap mostly but DIFFER: e.g., `yue` (Cantonese), `ast` (Asturian), `ceb`, `fil`, `jv`, `tg`, `nb` — not in current HTML. Conversely current list has `cy` (Welsh), `eu` (Basque), `sq` (Albanian), `te` (Telugu), `ta` (Tamil), `lt`, `no`, `sr`, `tl` — NOT in Qwen's 60.
- Live Flash does NOT have a separate "source language" list — but per mobile, source must be explicit. Reuse `QWEN_LANGS` for source picker too (assumption: any target lang can also be source — same as mobile).
- Current `_refreshTargetLangList` only touches target. Extend to also refresh source when engine = qwen.

## Requirements

### Functional

- Centralize `QWEN_LANGS` in JS (60 entries from mobile, exact code+name) as a module constant.
- New helper `_refreshLangListsForEngine(mode)`:
  - mode = `'qwen'`: rebuild source + target from `QWEN_LANGS`. If saved `source_language === 'auto'` or not in list → set select to `'en'`. If saved `target_language` not in list → set to `'vi'`.
  - mode = `'openai'`: target gets `OPENAI_LANGS` (existing behavior); source keeps full inline list (OpenAI auto-detects).
  - mode = `'soniox'` | `'local'`: restore original inline HTML (saved in `_fullTargetLangHTML` + new `_fullSourceLangHTML`).
- Replace `_refreshTargetLangList` body with new helper; keep export name for compatibility.
- Update `_updateUI` comment at line 1207–1208 to reflect new behavior.
- Source-lang `<select>` MUST NOT accept "auto" save when engine = qwen — guarded both in UI (snap on engine change) and at Qwen connect time (Phase 05 guard).

### Non-functional

- New module file `src/js/qwen-langs.js` exporting `QWEN_LANGS` array — single source of truth (DRY); no inline duplication.
- App.js delta ≤ 60 LOC.

## Architecture

```
settings page change(engine) ─┐
                              ├─→ _refreshLangListsForEngine(mode)
                              │      ├─ snapshot full HTML on first call
                              │      ├─ engine = qwen  → rebuild both selects from QWEN_LANGS
                              │      ├─ engine = openai → rebuild target from OPENAI_LANGS, restore source
                              │      └─ engine = soniox/local → restore both
                              │
                              └─→ _updateUI(...) (existing flow continues)
```

## Related Code Files

### Create

- `src/js/qwen-langs.js`:
  ```js
  // Mirrors my-translator-mobile/src/lib/languages.ts QWEN_LANGS.
  // 60 supported languages for qwen3-livetranslate-flash-realtime.
  export const QWEN_LANGS = [ /* paste 60 entries verbatim */ ];
  ```

### Modify

- `src/js/app.js`:
  - Import `QWEN_LANGS` at top
  - Replace `_refreshTargetLangList(mode)` with `_refreshLangListsForEngine(mode)`
  - Update call site at line 1209 to new name
  - Add field `_fullSourceLangHTML` (mirroring `_fullTargetLangHTML`)
  - Update line 1207–1208 comment

### Read

- `src/index.html` lines 342–408 (source select, original) — used to snapshot for restore

## Implementation Steps

1. Create `src/js/qwen-langs.js` with the 60-entry list copied from mobile `QWEN_LANGS`.
2. In `app.js`, import: `import { QWEN_LANGS } from './qwen-langs.js';`
3. Add private snapshot helper called once: stash `select-source-lang.innerHTML` into `this._fullSourceLangHTML` and `select-target-lang.innerHTML` into `this._fullTargetLangHTML` if not already cached.
4. Implement `_refreshLangListsForEngine(mode)`:
   ```js
   _refreshLangListsForEngine(mode) {
     const src = document.getElementById('select-source-lang');
     const tgt = document.getElementById('select-target-lang');
     if (!src || !tgt) return;
     if (!this._fullSourceLangHTML) this._fullSourceLangHTML = src.innerHTML;
     if (!this._fullTargetLangHTML) this._fullTargetLangHTML = tgt.innerHTML;

     const curSrc = src.value, curTgt = tgt.value;

     if (mode === 'qwen') {
       const opts = QWEN_LANGS
         .map(l => `<option value="${l.code}">${l.name}</option>`).join('');
       src.innerHTML = opts;
       tgt.innerHTML = opts;
       const codes = new Set(QWEN_LANGS.map(l => l.code));
       src.value = (curSrc && curSrc !== 'auto' && codes.has(curSrc)) ? curSrc : 'en';
       tgt.value = codes.has(curTgt) ? curTgt : 'vi';
     } else if (mode === 'openai') {
       tgt.innerHTML = OPENAI_LANGS_HTML; // existing literal
       tgt.value = OPENAI_CODES.has(curTgt) ? curTgt : 'vi';
       src.innerHTML = this._fullSourceLangHTML;
       src.value = curSrc || 'auto';
     } else {
       src.innerHTML = this._fullSourceLangHTML;
       tgt.innerHTML = this._fullTargetLangHTML;
       src.value = curSrc || 'auto';
       tgt.value = curTgt || 'vi';
     }
   }
   ```
5. Replace call at line 1209 (`this._refreshTargetLangList(mode);`) with `this._refreshLangListsForEngine(mode);`.
6. Update comment at lines 1207–1208 to:
   ```js
   // Lang pickers vary by engine:
   //   openai → target restricted to 13 OpenAI langs, source keeps full list
   //   qwen   → source + target both swapped to QWEN_LANGS (60); source forced off "auto"
   //   soniox/local → full inline lists from index.html
   ```
7. On engine switch event handler (settings page), confirm `_refreshLangListsForEngine` runs after each change. (Existing `_updateUI` covers this — verify in Phase 06.)

## Todo List

- [ ] Create `src/js/qwen-langs.js` with 60-entry array
- [ ] Import `QWEN_LANGS` in `app.js`
- [ ] Rename `_refreshTargetLangList` → `_refreshLangListsForEngine`
- [ ] Cache `_fullSourceLangHTML` on first run
- [ ] Add qwen branch: rebuild both selects, snap source off "auto"
- [ ] Update soniox/local branch to also restore source
- [ ] Update call site line 1209
- [ ] Update comment lines 1207–1208
- [ ] Manual UI check: switch engine soniox → qwen → openai → soniox, verify lists swap correctly

## Success Criteria

- Switching engine to "qwen" with stored `source_language = 'auto'` results in select showing "English" (en).
- All 60 QWEN_LANGS visible in both source + target on qwen mode.
- Switching back to soniox restores full original list including Welsh/Basque/Tagalog.
- No duplicate option entries after multiple toggles.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| User had `source_language: 'auto'` saved → Qwen 422 error | High | High | UI snaps to `en` immediately on engine switch; Rust also defaults `auto → en` (Phase 01 belt+suspenders). |
| User had target = `cy` (Welsh, not in QWEN_LANGS) | Med | Med | Snap to `vi`. Toast "Target lang not supported on Qwen; switched to Vietnamese" — optional polish. |
| Snapshot of original HTML happens AFTER first engine toggle → wrong restore | Low | Med | Cache lazily on FIRST call before mutating; idempotent guard `if (!this._fullSourceLangHTML)`. |
| QWEN_LANGS lacks codes like `te`, `ta` (Tamil/Telugu) — user reports missing | Low | Low | Documented per Alibaba spec; list is authoritative. |

## Security Considerations

- N/A.

## Next Steps

- Phase 05 consumes `source_language` from settings (after this phase guarantees it's a valid Qwen code).
