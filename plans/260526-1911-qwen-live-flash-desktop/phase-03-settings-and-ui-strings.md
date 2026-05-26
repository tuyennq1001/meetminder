# Phase 03 — Settings (JS) and UI Strings

## Context Links

- `src/js/settings.js` line 12 — `qwen_audio_output: true`
- `src/index.html` lines 194, 267, 272 — Omni branding
- Phase 01 drops Rust `qwen_audio_output`; this phase aligns the JS default and copy.

## Overview

- **Priority:** P2
- **Status:** pending
- **Description:** Remove `qwen_audio_output` from JS DEFAULT_SETTINGS. Refresh user-facing labels to "Qwen LiveTranslate Flash". Update hint copy ("60+ languages").

## Key Insights

- `DEFAULT_SETTINGS` line 12 contains `qwen_audio_output: true` — must be deleted so spread no longer reintroduces it after backend strips the field.
- Three UI strings reference "Qwen-Omni":
  - engine card (engine-picker view) line 194
  - settings dropdown option line 267
  - hint text line 272
- No CSS/JS expects the old name.

## Requirements

### Functional

- Engine card title: "Qwen LiveTranslate Flash"
- Dropdown option: "🌏 Qwen LiveTranslate Flash"
- Hint: "Cloud · 60+ languages · text-only · free preview"
- (Optional) Engine card meta: "Free preview · text-only" → keep
- (Optional) Engine card feats: change "Multilingual" → "60+ languages"; "Fast first token (~7s)" → "Server VAD · explicit source lang"

### Non-functional

- No string mismatches between settings hint and engine card.

## Related Code Files

### Modify

- `src/js/settings.js` line 12 — delete `qwen_audio_output: true,`
- `src/index.html`:
  - Line 194: `Qwen-Omni Realtime` → `Qwen LiveTranslate Flash`
  - Line 195: `Free preview · text-only` (already correct) — keep
  - Lines 197–199 (`<li>` feats): tweak as above
  - Line 267: option label `🌏 Qwen-Omni Realtime` → `🌏 Qwen LiveTranslate Flash`
  - Line 272: hint copy → `Cloud · 60+ languages · text-only · free preview`

### Read

- `src-tauri/src/settings.rs` (verify Phase 01 left struct-level `#[serde(default)]` so old `qwen_audio_output` field in saved JSON is silently dropped on reload)

## Implementation Steps

1. Edit `src/js/settings.js` line 12 — delete the `qwen_audio_output: true,` line.
2. Edit `src/index.html` per the diff above.
3. Grep `Omni` across src/ → expect 0 hits remaining (excluding comments referencing migration history).

## Todo List

- [ ] settings.js: remove `qwen_audio_output: true,` default
- [ ] index.html: line 194 engine card name
- [ ] index.html: line 267 dropdown option
- [ ] index.html: line 272 hint copy
- [ ] index.html: lines 197–199 engine card feats (optional polish)
- [ ] grep -rn "Omni" src/ → 0 hits

## Success Criteria

- Settings save → JSON written has no `qwen_audio_output` key.
- All visible UI strings show "Qwen LiveTranslate Flash" or "Qwen LiveTranslate".

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Existing saved settings still contain `qwen_audio_output: true` | High | None | Struct serde drops unknown fields on Rust reload; JS spread `{...DEFAULT_SETTINGS, ...settings}` no longer carries it forward, so next save persists clean JSON. |
| Hint text overflows the settings panel | Low | Cosmetic | Visual check during Phase 06. |

## Security Considerations

- N/A.

## Next Steps

- Phase 04 reshapes the language picker for Qwen mode.
