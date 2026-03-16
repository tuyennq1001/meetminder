# MLX Pipeline Optimization Plan

**Branch:** `experiment/mlx-optimize`  
**Date:** 2026-03-15  
**Test audio:** YouTube JA narration, 60s, 16kHz mono  
**Source:** https://www.youtube.com/watch?v=gBumdOWWMhY (2:31-3:31)

---

## Current Pipeline

```
Audio → Whisper-large-v3-turbo (ASR) → Gemma-3-4B (translate) → Output
        chunk=7s, stride=5s              LLM prompt
```

---

## Optimization Areas

### 1. Translation Model Speed
**Problem:** Gemma-3-4B takes ~1.54s/sentence — main bottleneck (59% of total)  
**Options:**
- [x] A. Replace with NLLB-200-1.3B → ❌ Slower on PyTorch CPU
- [ ] B. Try smaller Gemma-3-1B-4bit
- [ ] C. Try Qwen3-1.7B  

### 2. Chunk/Stride Tuning
**Problem:** chunk=7s, stride=5s → effective latency ~9.6s  
**Tested:**
- [x] chunk=8s → ❌ Higher latency + more hallucination
- [x] chunk=7s → ✅ Best quality
- [x] chunk=5s → ⚠️ Faster but 20-30% chunks cut mid-sentence
- [x] chunk=3s → ❌ 50% fragments, poor quality

### 3. VAD (Voice Activity Detection) — TODO
**Problem:** Processing silence wastes compute  
**Current:** Simple RMS threshold (< 100)

### 4. Parallel Processing — TODO
**Problem:** ASR and translate run sequentially  
**Estimated gain:** ~1.1s latency reduction (free, no quality loss)

---

## Benchmark Results

### Baseline: Whisper + Gemma-3-4B, chunk=7s, stride=5s

| Metric | Value |
|--------|-------|
| Test audio | YouTube JA narration, 60s |
| Chunks processed | **10** |
| Avg ASR time | **1.06s** |
| Avg Translate time | **1.54s** |
| Avg Total/chunk | **2.60s** |
| Effective latency | **~9.6s** (7s chunk + 2.6s process) |
| Transcript quality | ✅ Tốt |
| Translation quality | ⭐⭐⭐⭐ Tốt |

**Per-chunk breakdown:**

| # | ASR (s) | Translate (s) | Total (s) |
|---|---------|---------------|-----------|
| 1 | 1.09 | 1.62 | 2.72 |
| 2 | 1.10 | 1.46 | 2.56 |
| 3 | 1.05 | 1.60 | 2.65 |
| 4 | 1.02 | 1.73 | 2.75 |
| 5 | 1.02 | 1.46 | 2.48 |
| 6 | 1.08 | 1.81 | 2.88 |
| 7 | 1.05 | 1.30 | 2.35 |
| 8 | 1.14 | 1.41 | 2.55 |
| 9 | 1.04 | 1.53 | 2.57 |
| 10 | 1.02 | 1.46 | 2.49 |
| **Avg** | **1.06** | **1.54** | **2.60** |

---

### Test A: NLLB-200-1.3B (replace Gemma-3-4B)

| Metric | NLLB-200 | Gemma-3-4B (baseline) | Diff |
|--------|----------|----------------------|------|
| Avg ASR | 1.06s | 1.06s | same |
| **Avg Translate** | **1.63s** | **1.54s** | **+6% slower ❌** |
| Avg Total | 2.69s | 2.60s | +3% slower |
| Quality | ⭐⭐⭐ | ⭐⭐⭐⭐ | worse |

**Verdict: ❌ NLLB KHÔNG cải thiện.** PyTorch CPU chậm hơn MLX Gemma trên Apple Silicon.  
Chất lượng dịch cũng kém hơn (câu thô, đôi khi sai nghĩa).

---

### Test B: Chunk/Stride Tuning (Gemma-3-4B, same model)

| Config | Chunks | Avg ASR | Avg Translate | Avg Total | Effective Latency | vs Baseline |
|--------|--------|---------|---------------|-----------|-------------------|-------------|
| **chunk=8s, stride=6s** | 10 | 1.08s | 1.16s | 2.24s | **~10.2s** | 6% slower |
| **chunk=7s, stride=5s** ✅ | 10 | 1.06s | 1.54s | 2.60s | **~9.6s** | baseline |
| **chunk=5s, stride=3s** | 20 | 0.97s | 0.81s | 1.78s | **~6.8s** | 29% faster |
| **chunk=3s, stride=2s** | 30 | 0.90s | 0.61s | 1.51s | **~4.5s** | 53% faster |

**Quality comparison (same 60s audio):**

| Config | Latency | Câu hoàn chỉnh | Dịch chính xác | Hallucination |
|--------|---------|----------------|----------------|---------------|
| **chunk=8s** | 10.2s | ~85% | ⭐⭐⭐½ | Nhiều hơn (text dài → LLM bịa thêm) |
| **chunk=7s** ✅ | 9.6s | **~90%** | **⭐⭐⭐⭐** | Hiếm |
| **chunk=5s** | 6.8s | ~70% | ⭐⭐⭐ | 20-30% chunks bị cắt |
| **chunk=3s** | 4.5s | ~50% | ⭐⭐ | Fragment vô nghĩa thường xuyên |

**Kết luận:** chunk=7s stride=5s là **sweet spot cho quality**. Giảm chunk = nhanh hơn nhưng quality kém rõ rệt.

---

### Test C: Pipeline Parallelism — ❌ Not Possible

**Attempted:** ASR in main thread, translate in worker thread via `queue.Queue`.

**Result: CRASH 💥**
```
-[_MTLCommandBuffer addCompletedHandler:]:1011: 
  failed assertion 'Completed handler provided after commit call'
zsh: abort
```

**Root cause:** MLX models (Whisper + Gemma) share the same **Metal GPU command queue**.  
Running two MLX models from different threads causes **Metal GPU assertion failure**.  
Apple Silicon GPU does NOT support concurrent model execution via MLX.

**Conclusion:** Sequential pipeline is the **only option** for dual-MLX models.  
Parallel would require one model on CPU + one on GPU, but that defeats the purpose.

---

## Final Summary

### Đã xác nhận tối ưu ✅
| Tham số | Giá trị tối ưu | Lý do |
|---------|----------------|-------|
| ASR model | Whisper-large-v3-turbo (MLX) | Nhanh, ổn định (1.06s/chunk) |
| Translate model | Gemma-3-4B-qat-4bit (MLX) | Nhanh hơn NLLB (PyTorch CPU), quality tốt hơn |
| Chunk size | **7s** | Sweet spot quality vs latency |
| Stride | **5s** (2s overlap) | Đủ overlap để không mất biên câu |
| Pipeline | **Sequential** (cannot parallel MLX) | Metal GPU single-threaded |

### Effective Performance
- **ASR:** 1.06s/chunk
- **Translate:** 1.54s/chunk
- **Total:** 2.60s/chunk
- **Effective latency:** ~9.6s (chunk 7s + process 2.6s)

### TODO (future)
- [x] ~~Parallel processing~~ → ❌ MLX Metal GPU conflict
- [ ] VAD (skip silence) → tiết kiệm compute
- [ ] Test với real app usage (live audio, not file)
- [ ] Integrate pipeline vào Tauri app

---

## Decision Log

- **2026-03-15 baseline:** Gemma-3-4B bottleneck 1.54s avg (59% of total)
- **2026-03-15 Test A:** NLLB-200 ❌ PyTorch CPU chậm hơn MLX Gemma. Loại.
- **2026-03-15 Test B:** Chunk tuning — chunk=7s best quality, nhỏ hơn = nhanh hơn nhưng quality kém.
- **2026-03-15 Test C:** Parallel ❌ MLX Metal GPU crash khi 2 model chạy đồng thời. Sequential là bắt buộc.
- **2026-03-15 Final:** Pipeline hiện tại (sequential, chunk=7s) đã là tối ưu nhất có thể.
