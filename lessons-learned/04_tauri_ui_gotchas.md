# Troubleshooting & Known Issues

## Bug History (Fixed)

### 1. `confirm()` Blocks Tauri Custom Window
**Symptom**: Press Play in Local mode → app freezes, no response  
**Root cause**: `confirm()` dialog is a blocking JS call. In Tauri's custom window (no title bar), the dialog renders behind/invisible → main thread blocks forever  
**Fix**: Replaced `confirm()` with auto-setup + toast notification  
**Location**: `src/js/app.js` → `_startLocalMode()`

### 2. Button Click Not Registering (Rapid Start/Stop)
**Symptom**: Button stays as Play, no state change  
**Root cause**: `start()` throws (missing Rust commands), `stop()` immediately resets state. Button changes Play→Stop→Play in <50ms — invisible to human eye  
**Fix**: Added `isStarting` guard + try/catch/finally in click handler  
**Location**: `src/js/app.js` → click handler + constructor

### 3. Duplicate "Listening..." Indicators
**Symptom**: Multiple "Listening..." texts in transcript  
**Root cause**: `showListening()` added indicator without checking if one exists  
**Fix**: `showListening()` now removes existing indicator before adding new one  
**Location**: `src/js/ui.js` → `showListening()`, `hasContent()`

### 4. Missing Local Pipeline Commands
**Symptom**: `invoke('start_local_pipeline')` throws "command not found"  
**Root cause**: `experiment/mlx-optimize` branch was forked from `main` which doesn't have `local_pipeline.rs`  
**Fix**: Copied `local_pipeline.rs` from `experiment/mlx-whisper` branch  
**Location**: `src-tauri/src/commands/local_pipeline.rs`

### 5. MLX Metal GPU Crash (Parallel Pipeline)
**Symptom**: App crashes with Metal error when running ASR + LLM simultaneously  
**Root cause**: Apple Silicon Metal GPU cannot handle two MLX models running concurrently from different threads  
**Fix**: Use sequential pipeline only (ASR then LLM, never parallel)  
**Status**: Architectural limitation — no workaround

---

## Tauri-Specific Gotchas

### `data-tauri-drag-region` on Parent Elements
- **Rule**: Do NOT put `data-tauri-drag-region` on containers with buttons
- **Why**: Drag region event handler intercepts mouse events before buttons can process them
- **Exception**: Tauri v2 actually handles child button clicks correctly — but `confirm()`, `prompt()`, `alert()` do NOT work properly in drag regions
- **Best practice**: Use `data-tauri-drag-region` only on empty areas (status bar, transcript background)

### Blocking JS APIs in Tauri
The following standard browser APIs **should NOT be used** in Tauri custom windows:
- ❌ `confirm()` — blocks thread, dialog may be invisible
- ❌ `alert()` — same issue
- ❌ `prompt()` — same issue
- ✅ Use toast notifications, modal dialogs, or Tauri dialog API instead

### SwiftNativeNSObject Warnings
**Symptom**: Spam in console: "Class SwiftNativeNSObject is implemented in both..."  
**Cause**: Conflict between system Swift runtime and CommandLineTools Swift  
**Impact**: None (cosmetic only)  
**Fix**: Ignore — caused by macOS toolchain mismatch, not app code

---

## DevOps Issues

### Build Doesn't Reflect Changes
**Symptom**: Rebuild app but changes don't appear  
**Root cause**: macOS caches `.app` bundles. Old `/Applications/Personal Translator.app` persists  
**Fix**: Always `rm -rf` the old app before copying new one:
```bash
rm -rf "/Applications/Personal Translator.app"
cp -R src-tauri/target/release/bundle/macos/Personal\ Translator.app /Applications/
```

### Frontend Assets Location
- Tauri embeds frontend files **inside the binary** (not in Resources/)
- Cannot inspect/modify deployed HTML/JS/CSS
- For debugging, use `npm run tauri dev` (live reload)

---

## Performance Debugging

### Pipeline Logs
```bash
# Real-time pipeline log
tail -f /tmp/personal_translator_pipeline.log

# Extract timing data
grep "stdout:" /tmp/personal_translator_pipeline.log | python3 -c "
import json, re, sys
for line in sys.stdin:
    m = re.search(r'{\"type\": \"result\".*}$', line)
    if m:
        d = json.loads(m.group())
        t = d['timing']
        print(f'ASR={t[\"asr\"]}s LLM={t[\"translate\"]}s total={t[\"total\"]}s')
"
```

### GPU Monitoring
```bash
# Check GPU memory usage
sudo powermetrics --samplers gpu_power -i 1000 -n 5

# MLX specific memory
python3 -c "import mlx.core as mx; print(mx.metal.get_active_memory() / 1e9, 'GB')"
```
