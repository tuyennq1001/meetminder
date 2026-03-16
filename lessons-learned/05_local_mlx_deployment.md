# Lessons Learned: Local MLX Pipeline Deployment

## 1. ffmpeg Dependency — Bypass, Don't Install

### Problem
`mlx_whisper.transcribe(file_path)` internally calls `whisper.audio.load_audio()` which shells out to `ffmpeg`. On dev machines, `ffmpeg` is installed via Homebrew, but user machines often don't have it.

**Error**: `FileNotFoundError: [Errno 2] No such file or directory: 'ffmpeg'`

### Solution
`mlx_whisper.transcribe()` accepts `numpy.ndarray` directly. Load WAV with Python's built-in `wave` module → convert to float32 numpy array → pass to transcribe. **Zero external dependencies.**

```python
# ❌ BAD — requires ffmpeg on system
result = mlx_whisper.transcribe("audio.wav", ...)

# ✅ GOOD — no ffmpeg needed
import wave, numpy as np
with wave.open("audio.wav", "r") as wf:
    raw = wf.readframes(wf.getnframes())
    audio_np = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
result = mlx_whisper.transcribe(audio_np, ...)
```

### Rule
**Check ALL call sites** — including warm-up/pre-load code. We had 2 places calling `transcribe()` with file paths (warm-up + actual transcribe). First fix only caught one.

---

## 2. Tauri Bundle Resources — Scripts Not Auto-Included

### Problem
Python scripts in `scripts/` were not included in the `.app` bundle. On dev machine, Rust finds them via `CARGO_MANIFEST_DIR` (source tree path). On installed app, only `Contents/Resources/` is available.

**Error**: `Pipeline script not found. Ensure scripts/local_pipeline.py exists.`

### Solution
Add `resources` to `tauri.conf.json` → Tauri copies scripts into `Contents/Resources/scripts/`:

```json
"bundle": {
    "resources": {
        "../scripts/*": "scripts/"
    }
}
```

### Rule
Always verify bundled app structure (`ls MyApp.app/Contents/Resources/`) before release. Don't assume dev-mode paths work in production.

---

## 3. Code Signing — TCC Permissions Don't Persist Without It

### Problem
Tauri builds create `linker-signed` binaries. macOS TCC (Transparency, Consent, and Control) doesn't persist permissions for linker-signed apps → "Quit & Reopen" dialog never appears → user stuck in permission loop.

**Symptom**: User grants Screen Recording permission, but app keeps asking on every launch.

### Solution
Proper ad-hoc signing with entitlements after build:

```bash
codesign --force --deep --sign - --entitlements entitlements.plist "My Translator.app"
```

With `entitlements.plist`:
```xml
<dict>
    <key>com.apple.security.device.audio-input</key>
    <true/>
</dict>
```

### Before vs After

| Property | linker-signed | ad-hoc signed |
|----------|--------------|---------------|
| flags | `adhoc,linker-signed` | `adhoc` |
| Info.plist | `not bound` | `entries=16` |
| Sealed Resources | `none` | `version=2 rules=13` |
| TCC persistence | ❌ | ✅ |

### Rule
**Post-build step is mandatory**: `npm run tauri build` → `codesign` → `hdiutil create`. Never ship a linker-signed binary.

---

## 4. `confirm()` Blocks Tauri Custom Windows

### Problem  
JavaScript `confirm()` dialog is invisible behind Tauri's titlebar-less (`decorations: false`) custom window → app appears frozen.

### Solution
Replace `confirm()` with toast notifications or custom UI modals. Same applies to `alert()` and `prompt()`.

**Details**: See [04_tauri_ui_gotchas.md](04_tauri_ui_gotchas.md)

---

## 5. Platform Detection for Feature Gating

### Problem
Local MLX only works on Apple Silicon. Non-Apple-Silicon users should not see the option at all.

### Solution
Rust command returns platform info, JS hides UI elements:

```rust
#[tauri::command]
fn get_platform_info() -> String {
    format!(r#"{{"os":"{}","arch":"{}"}}"#, 
        std::env::consts::OS, std::env::consts::ARCH)
}
```

```javascript
// JS: hide Local MLX option on non-Apple-Silicon
if (!this.isAppleSilicon) {
    select.querySelector('option[value="local"]').remove();
}
```

### Rule
Feature-gate by platform in UI, not by building separate binaries. One version, features auto-adapt.

---

## Summary: Release Checklist for Local MLX

1. ☑ All `mlx_whisper.transcribe()` calls use numpy arrays (no ffmpeg)
2. ☑ `tauri.conf.json` has `resources` config for scripts
3. ☑ Post-build `codesign` with entitlements
4. ☑ Verify `Contents/Resources/scripts/` exists in .app
5. ☑ Test on clean machine without dev tools
6. ☑ No `confirm()`/`alert()` in JS
7. ☑ Platform detection hides Local option on non-Apple-Silicon
