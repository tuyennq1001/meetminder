# Benchmark Latency 3-Engine + Soniox Endpoint Tuning

> Ngày: 2026-06-02 · Trigger: feedback Tuan Vu (FB, May 16) — "Soniox/Win, sub gốc hiện liên tục nhưng vẫn delay 2-3s, fix được không hay do API?"
> Audio test: `hope-v2-trim-16k.pcm` (JA→VI, ~290s, single run). Scripts: `benchmarks/benchmark-final-three-way.cjs`, `benchmarks/benchmark-soniox-endpoint-delay.cjs` (mới viết).
> Keys: tái dùng `my-translator-mobile/.env.local`.

## TL;DR

- Delay 2-3s của Soniox là **API floor**, không phải app overhead, không phải tune được bằng `max_endpoint_delay_ms`.
- Bước **dịch chỉ tốn 77-88ms** sau khi source finalize. Toàn bộ lag nằm ở **Soniox ASR finalize** (~3.8-4.0s tới câu dịch đầu).
- Câu hỏi "sao sub gốc chạy liên tục mà dịch phải chờ": vì Soniox **stream original provisional** (live) nhưng **chỉ trả translation khi is_final** (post-endpoint). Không stream được translation provisional → giới hạn API.
- Cải thiện khả thi: (1) bật **OpenAI** cho ai cần dịch hiện-dần (engine duy nhất stream target delta); (2) cho Soniox, không nên giảm endpoint delay (không giúp, chỉ làm segment vụn hơn).

## 1. Benchmark 3-way (số liệu mới 2026-06-02)

| Engine | firstProv (ms) | firstFinal (ms) | segs | chất lượng câu đầu |
|---|---|---|---|---|
| OpenAI `gpt-realtime-translate` | 2659 | **6869** | 42 | "Này, mọi người, xin chào lại nhé." (tự nhiên nhất) |
| Qwen `omni-plus-realtime` | 4440 | **4668** | 72 | "Vậy thì, thưa quý vị, một lần nữa xin chào." |
| Qwen `livetranslate-flash` | 2593 | **3780** ⚡ | 48 | "Vậy thì, mọi người, xin chào một lần nữa." (nhanh nhất) |

Khớp `docs/engine-matrix-vi.md` cũ (OpenAI chậm nhất ~7s, Qwen Live nhanh nhất ~3.8s). Không regression.

> Lưu ý: 3-way script KHÔNG bao gồm Soniox (tên gây hiểu nhầm — thực ra OpenAI + 2 Qwen). Soniox đo riêng ở mục 2.

## 2. Soniox endpoint-delay sweep (câu trả lời chính)

| max_endpoint_delay_ms | firstOrigProv | firstOrigFinal | **firstTransFinal** | orig→trans | segs |
|---|---|---|---|---|---|
| 300  | 2082 | 3861 | **3949** | 88 | 126 |
| 1000 | 1980 | 3750 | **3833** | 83 | 114 |
| 3000 (default app) | 2215 | 4002 | **4079** | 77 | 103 |

**Đọc số:**
- `firstTransFinal` ~3.8-4.1s ở **cả 3 mức** → endpoint delay gần như không đổi latency câu dịch đầu (chênh <250ms, trong sai số single-run).
- `orig→trans` = **77-88ms** → từ lúc source finalize tới lúc có bản dịch gần như tức thì. Dịch KHÔNG phải bottleneck.
- `firstOrigProv` ~2.0s = Soniox cần ~2s "nghe" để nhả token ASR đầu tiên. `firstOrigFinal` ~3.8s = thêm ~1.8s để chốt segment đầu. **Đây là độ trễ nội tại của model `stt-rt-v4`.**
- Tác động thật của endpoint delay: **độ vụn segment** (300ms → 126 segs, 3000ms → 103 segs). Delay thấp = cắt câu nhiều hơn, không nhanh hơn.

**Kết luận:** Giảm `max_endpoint_delay_ms` KHÔNG khắc phục delay 2-3s. Lag là API floor của Soniox ASR.

## 3. Vì sao "sub gốc liên tục, dịch phải chờ"

Pipeline app (`src/js/soniox.js` `_handleResponse`):
- Token `translation_status: "original"`, `is_final:false` → emit `onProvisional` → render **source live** (chạy liên tục).
- Token `translation_status: "translation"` chỉ tới khi `is_final:true` (sau endpoint) → emit `onTranslation`.
- Soniox **không gửi translation provisional**. App không thể render dịch hiện-dần dù có muốn.

App overhead nhỏ: render synchronous trực tiếp từ callback (không debounce), audio chunk 1024 samples ≈ 64ms. Không phải nguồn lag.

## 4. So sánh cơ chế stream (quyết định UX)

| Engine | Source provisional | **Translation hiện dần?** | first-final |
|---|---|---|---|
| Soniox | ✅ live | ❌ chỉ final (post-endpoint) | ~3.9s |
| Qwen Live Flash | ❌ (no source) | ❌ assign cả block, no delta | ~3.8s |
| Qwen Omni | partial | ❌ | ~4.7s |
| OpenAI | ✅ live | ✅ **stream target delta** | ~6.9s (nhưng chữ hiện dần từ ~2.7s) |

→ **Chỉ OpenAI cho cảm giác "dịch chạy real-time"** (target delta). Đổi lại first-final chậm + đắt ($4/hr).

## 5. Đề xuất cải thiện (ưu tiên)

1. **[Trả lời user] Không tune endpoint delay cho Soniox** — đã chứng minh không giúp. Nếu muốn dịch hiện dần → khuyên dùng OpenAI engine.
2. **[P3, optional] "Input Sensitivity / Endpoint" slider** — nếu vẫn muốn expose `max_endpoint_delay_ms` cho user chỉnh độ vụn segment (không phải tốc độ). `endpointDelay` đã có sẵn trong `connect(config)`, chỉ cần wire UI. Giá trị thấp hơn (default 3000→1500) cho segment ngắn gọn hơn, phù hợp meeting hỏi-đáp.
3. **[Không khả thi] Translation provisional cho Soniox** — API không hỗ trợ. Bỏ.
4. **[Doc] Cập nhật `engine-matrix-vi.md`** — thêm cột "translation hiện dần" để user chọn đúng engine theo nhu cầu (OpenAI = hiện dần, Soniox/Qwen = chờ câu).

## Unresolved questions

1. Có muốn implement slider endpoint-delay (mục 5.2) hay chỉ reply user là "API limit"? Slider không giảm lag, chỉ đổi độ vụn — value thấp.
2. Soniox có chế độ low-latency/streaming-translation nào khác model `stt-rt-v4` không? Chưa kiểm tra docs Soniox mới nhất — cần `docs-seeker` nếu muốn đào sâu.
3. Số liệu single-run (1 audio JA). Muốn multi-run / nhiều ngôn ngữ để chắc firstFinal không phải noise?
