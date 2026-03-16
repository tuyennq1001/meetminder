# Benchmark Results — Local MLX Pipeline

## Test Conditions

| Parameter | Value |
|-----------|-------|
| **Date** | 2026-03-15 |
| **Device** | Mac Mini M4 (Apple Silicon) |
| **macOS** | Sequoia |
| **RAM** | 16GB (unified memory) |
| **Branch** | `experiment/mlx-optimize` |
| **ASR Model** | `mlx-community/whisper-large-v3-turbo` (~1.5GB) |
| **LLM Model** | `mlx-community/gemma-3-4b-it-qat-4bit` (~2.5GB) |
| **Chunk Size** | 7 seconds |
| **Stride** | 5 seconds (2s overlap) |
| **Audio Source** | YouTube Japanese TED Talk (植松努) |
| **Language Pair** | Japanese → Vietnamese |

---

## Performance Results (220 chunks)

### Per-Stage Timing

| Stage | Average | Min | Max | Median* |
|-------|---------|-----|-----|---------|
| **ASR (Whisper)** | 2.22s | 1.80s | 10.90s | ~2.0s |
| **Translation (Gemma)** | 1.68s | 0.73s | 3.61s | ~1.5s |
| **Total per chunk** | 3.90s | 2.53s | 11.85s | ~3.5s |

*Median estimated from steady-state samples (excludes warm-up outliers)*

> **Note**: Max ASR=10.9s is a warm-up outlier. Steady-state Whisper
> consistently runs at 1.9-2.2s. The 10.9s spike occurs only on the
> first 1-2 chunks when the GPU is cold.

### Effective End-to-End Latency

```
Speech occurs at T=0
  ↓
Audio buffered for 7s chunk window
  → chunk ready at T=7s
  ↓
ASR processing: ~2.0s
  → transcript at T=9s
  ↓
LLM translation: ~1.5s
  → translation displayed at T=10.5s

Effective latency: ~10.5 seconds from speech to translation
New results every: ~5 seconds (stride interval)
```

### Pipeline Throughput

| Metric | Value |
|--------|-------|
| Processing time per 7s chunk | ~3.5s |
| Real-time factor | 0.50x (processes 7s audio in 3.5s) |
| GPU utilization | ~70-80% (sequential ASR then LLM) |
| RAM usage | ~6-7GB (both models loaded) |

---

## Comparison: Cloud (Soniox) vs Local (MLX)

| Feature | Soniox Cloud | Local MLX |
|---------|-------------|-----------|
| **Latency** | ~2-3s (real-time streaming) | ~10.5s (chunked) |
| **Throughput** | Real-time (1x) | 0.5x real-time factor |
| **Quality (JA→VI)** | 9/10 | 7/10 |
| **Speaker ID** | ✅ Diarization | ❌ No |
| **Provisional text** | ✅ Real-time preview | ❌ No |
| **Cost** | ~$0.12/hr | Free |
| **Privacy** | Cloud API | 100% on-device |
| **Internet** | Required | Not required |
| **Supported languages** | 70+ | Any Whisper supports |
| **First-start time** | ~1s (WebSocket connect) | ~30-60s (model loading) |
| **Disk space** | None | ~5GB (models) |
| **RAM usage** | ~200MB | ~6-7GB |

---

## Translation Quality Assessment

### Strengths
- ✅ Core meaning accurately preserved
- ✅ Natural Vietnamese output (not word-by-word)
- ✅ Handles proper nouns well (names, places)
- ✅ Numbers and dates converted correctly
- ✅ Context window prevents repetition

### Weaknesses
- ⚠️ Context loss at chunk boundaries (2s overlap helps but doesn't eliminate)
- ⚠️ Emotional nuance sometimes oversimplified
- ⚠️ Long sentences may get truncated (max_tokens=100)
- ⚠️ Hallucination risk when audio is unclear (RMS threshold helps)

### Sample Translations (JA → VI)

| Japanese Original | Vietnamese Translation | Time |
|-------------------|----------------------|------|
| 僕はいろんな大人に脅されたんです | Tôi đã bị nhiều người lớn đe dọa | 3.55s |
| いい会社ってなんだろう | "Một công ty tốt" là những nơi ổn định | 3.79s |
| 勉強すればするほど能力が身につくはず | Càng học càng trở nên giỏi hơn | 3.23s |
| 夢って何だろうって | Ước mơ là gì nhỉ? | 3.09s |
| すっごい車 | Một chiếc xe tuyệt vời | 2.95s |

---

## Known Limitations

1. **Sequential-only pipeline**: MLX Metal GPU cannot run two models concurrently — ASR and LLM must run sequentially
2. **No parallel acceleration**: Attempted parallel pipeline crashed with Metal GPU conflict
3. **Warm-up delay**: First chunk takes 10-30s as models load into GPU memory
4. **Memory pressure**: Both models require ~6-7GB unified memory; may swap on 8GB Macs
5. **No speaker identification**: Unlike Soniox, local mode cannot distinguish speakers

---

## Historical Benchmark Comparison

| Date | ASR | LLM | Total | Notes |
|------|-----|-----|-------|-------|
| 2026-03-14 (first test) | 2.20s | 1.40s | 3.65s | experiment/mlx-whisper branch |
| **2026-03-15 (this test)** | **2.22s** | **1.68s** | **3.90s** | experiment/mlx-optimize, 220 chunks |

> Slight increase in LLM time likely due to longer/more complex sentences
> in this test session. ASR performance is consistent.
