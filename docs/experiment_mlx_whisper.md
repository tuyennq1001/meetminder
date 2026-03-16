# Experiment: Local Speech Translation (MLX Models)

## Mục tiêu

Thay thế Soniox API (cloud, trả phí) bằng local models chạy trên Apple Silicon.
Use case chính: **Audio tiếng Nhật → Text tiếng Việt**.

## Cấu hình máy test

- Mac Mini M4, 24GB RAM
- macOS, `mlx` 0.31.1, `mlx-whisper` 0.4.3

---

## Research: Model Options

### A. Speech-to-Text (Transcribe)

| Model | Size | Speed (3s chunk) | Chất lượng | RAM | Ghi chú |
|-------|------|-------------------|------------|-----|---------|
| **whisper-large-v3-turbo** (MLX) | ~1.5GB | 0.8s (warm) | ✅ Rất tốt | 1.5GB | Đã test, đã cache trên máy |
| Whisper-large-v3 (MLX) | ~3GB | ~1.5s | ✅ Tốt nhất | 3GB | Nặng hơn, chậm hơn |
| **Qwen3-ASR-0.6B** | ~400MB | chưa test | ? | 0.8GB | 🔥 All-in-one: audio → text + translate |
| Qwen3-ASR-1.7B | ~1.2GB | chưa test | ? | 1.5GB | Bản lớn hơn |

### B. Translation (JA → VI)

| # | Model | Type | Size | Speed | Chất lượng JA→VI | RAM |
|---|-------|------|------|-------|-------------------|-----|
| 1 | **Helsinki-NLP/opus-mt-ja-vi** | Chuyên dụng | 311MB | ⚡ 0.15s/câu | ❌ Kém — sai nghĩa nhiều câu | 0.5GB |
| 2 | **NLLB-200-distilled-600M** | Chuyên dụng | 600MB | ⚡ ~0.3s/câu | ⭐⭐⭐ Khá | 1GB |
| 3 | **NLLB-200-distilled-1.3B** | Chuyên dụng | 1.3GB | ~0.5s/câu | ⭐⭐⭐⭐ Tốt | 2GB |
| 4 | **M2M-100 (418M)** | Chuyên dụng | 418MB | ⚡ ~0.2s/câu | ⭐⭐⭐ Khá | 0.8GB |
| 5 | **Qwen2.5-14B-Instruct-4bit** | LLM general | 9GB | 🐌 2-7s/câu | ⭐⭐⭐⭐⭐ Rất tốt | 10GB |
| 6 | **Qwen3-0.6B** | LLM nhỏ | ~400MB | ⚡ ~0.3s/câu | ⭐⭐⭐ Khá (chưa test) | 0.8GB |
| 7 | **Qwen3-1.7B** | LLM nhỏ | ~1.2GB | ~0.5s/câu | ⭐⭐⭐⭐ Tốt (chưa test) | 1.5GB |
| 8 | **Qwen3-4B** | LLM vừa | ~2.5GB | ~1s/câu | ⭐⭐⭐⭐ Tốt+ (chưa test) | 3GB |

### C. All-in-one (Audio → Translate trực tiếp)

| Model | Size | RAM | Ghi chú |
|-------|------|-----|---------|
| **Qwen3-ASR-0.6B** | ~400MB | 0.8GB | Audio input → transcript + translate, 52 ngôn ngữ |
| **Qwen3-ASR-1.7B** | ~1.2GB | 1.5GB | Bản lớn hơn, accuracy tốt hơn |

---

## Benchmark đã thực hiện

### 1. Whisper transcribe (English audio, 8 giây)

```
Model: mlx-community/whisper-large-v3-turbo
Cold: 3.2s | Warm: 0.8s per 3s chunk
Accuracy: hoàn hảo
```

### 2. opus-mt-ja-vi (JA → VI translation)

```
Model loaded: 27s (first time, download 311MB)  
Speed: 0.11-0.17s per sentence
Quality: KÉM — nhiều câu dịch sai hoàn toàn
  ✅ "会議は午後3時に始まります" → "Cuộc họp bắt đầu lúc 3 giờ chiều"
  ❌ "この製品の品質は非常に高いです" → "Và đây là những gì chúng tôi đã làm..."
  ❌ "日本語からベトナム語への翻訳テスト" → "Đây là một ví dụ từ Việt Nam"
```

### 3. Qwen2.5-14B-4bit (JA → VI translation)

```
Model loaded: 3.3s (cached)
Speed: 1.88-7.46s per sentence (chậm, hay kèm giải thích thừa)
Quality: TỐT — dịch chính xác nhưng output dài dòng
  ✅ "こんにちは、今日はいい天気ですね" → "Xin chào, hôm nay trời đẹp nhỉ"
  ✅ "会議は午後3時に始まります" → "Cuộc họp sẽ bắt đầu vào 3 giờ chiều"
  ✅ "来月、東京で新しいプロジェクトを始めます" → "Tháng tới, tôi sẽ bắt đầu dự án mới tại Tokyo"
```

---

## RAM Budget (24GB total)

| Pipeline | Whisper | Translate | Total | Khả thi |
|----------|---------|-----------|-------|---------|
| Qwen3-ASR-0.6B only | — | — | 0.8GB | ✅✅✅ |
| Qwen3-ASR-1.7B only | — | — | 1.5GB | ✅✅✅ |
| Whisper + NLLB-600M | 1.5GB | 1GB | 2.5GB | ✅✅ |
| Whisper + NLLB-1.3B | 1.5GB | 2GB | 3.5GB | ✅✅ |
| Whisper + Qwen3-1.7B | 1.5GB | 1.5GB | 3GB | ✅✅ |
| Whisper + Qwen2.5-14B | 1.5GB | 10GB | 11.5GB | ⚠️ Dùng gần nửa RAM |

---

## Kết luận sơ bộ

**Ưu tiên test theo thứ tự:**

1. 🥇 **Qwen3-ASR** — All-in-one, nhẹ nhất, nếu chất lượng tốt thì không cần gì khác
2. 🥈 **Whisper + NLLB-200-1.3B** — Pipeline chuyên dụng, nhanh, nhẹ
3. 🥉 **Whisper + Qwen3-1.7B** — Backup nếu NLLB không đủ tốt
