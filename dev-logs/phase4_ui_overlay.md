# Phase 4: UI & Overlay Polish — Dev Log

> **Chi tiết**: xem [docs/03_implementation_plan.md](../docs/03_implementation_plan.md)  
> **Trạng thái**: ✅ Hoàn thành  
> **Phụ thuộc**: Phase 3

## Checklist

- [x] 4.1 Listening animation (sound waves indicator)
- [x] 4.2 Recording pulse glow on Start/Stop button
- [x] 4.3 Keyboard shortcut hint in placeholder (⌘ Enter)
- [x] 4.4 Smooth transcript line removal animation (fading-out)
- [x] 4.5 Active/press states for all interactive elements
- [x] 4.6 Toast notification improvements (max-width, backdrop-blur, longer errors)
- [x] 4.7 Drag region fix — `data-tauri-drag-region` on control-bar and transcript

## Progress

### 2026-03-10
- Đã làm:
  - **Listening indicator**: Animated sound waves (5 bars, staggered animation) hiển thị khi đang chờ transcript đầu tiên
  - **Recording pulse**: Nút Start/Stop phát sáng đỏ nhẹ khi đang recording (`recordPulse` keyframe)
  - **Button states**: Thêm `:active` transform scale cho tất cả buttons (icon-btn, source-btn, action-btn, primary-btn)
  - **Fading-out**: Transcript lines cũ mờ dần khi bị xóa (`fading-out` class with opacity+transform transition)
  - **Shortcut hint**: Hiển thị `⌘ Enter` trong placeholder view
  - **Toast improvements**: `max-width: 90%`, `backdrop-filter`, longer duration (5s) cho errors
  - **Drag region**: Thêm `data-tauri-drag-region` vào `control-bar`, `status-area`, `transcript-container`, `transcript-content`
  - **Error dot glow**: Status dot phát sáng đỏ khi error
