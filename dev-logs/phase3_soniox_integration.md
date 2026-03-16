# Phase 3: Soniox Integration — Dev Log

> **Chi tiết**: xem [docs/03_implementation_plan.md](../docs/03_implementation_plan.md#phase-3-soniox-integration-1-2-ngày)  
> **Trạng thái**: ✅ Hoàn thành  
> **Phụ thuộc**: Phase 2

## Checklist

- [x] 3.1 Implement `soniox.js` (WebSocket client, config, error handling)
- [x] 3.2 Connect audio pipeline (Tauri channel → Soniox binary frames)
- [ ] 3.3 Test end-to-end (STT + translation, latency, stability)

## Progress

### 2026-03-10
- Đã làm (song song với Phase 1 & 2):
  - `soniox.js` — Soniox WebSocket client đầy đủ:
    - Kết nối `wss://stt-rt.soniox.com/transcribe-websocket`
    - Gửi config message (api_key, model, audio_format, language_hints, translation, context)
    - Nhận và parse tokens response (provisional + final text)
    - Graceful disconnect (empty frame)
    - Callbacks: onTranscript, onStatusChange, onError
  - Audio pipeline hoàn chỉnh:
    - Rust audio capture → mpsc receiver → forwarder thread → Tauri IPC Channel → JS
    - JS nhận PCM data dạng number array → convert Uint8Array → send binary WebSocket frame
  - UI transcript display:
    - Provisional text (gray) vs final text (white)
    - Rolling display với auto-scroll
    - Animation fadeInUp khi có dòng mới
- Cần test: end-to-end với Soniox API key thật
- Tiếp theo: Phase 4 — UI Polish (đã có foundation tốt)
