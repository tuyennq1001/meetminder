# Future Plans & Feature Requests

---

## Feature Requests from Users

### OCR Real-time Translate + Copy Text
**Date**: 2026-03-22
**Source**: Hùng Vũ (@hungvu.net) — Facebook Messenger
**Request**: Thêm tính năng OCR realtime translate và copy text vào tool.
**Reference**: [TSnap](https://www.tsnap.tech/) — Instant Screenshot Translation for macOS

**Mô tả**: User muốn có khả năng chụp màn hình / capture vùng text bất kỳ trên screen (không cần audio), nhận diện text bằng OCR, dịch realtime và hiển thị kết quả + cho phép copy. Tương tự TSnap nhưng tích hợp vào My Translator.

**Hướng triển khai tiềm năng**:
- Thêm mode mới: Screen OCR (bên cạnh System Audio / Mic)
- Dùng `ScreenCaptureKit` (đã có) để capture vùng màn hình được chọn
- OCR: macOS Vision framework (có sẵn, free, hỗ trợ 18 ngôn ngữ) hoặc Tesseract
- Dịch text qua Soniox (nếu hỗ trợ text input) hoặc Gemini/OpenAI
- Overlay hiển thị kết quả + nút Copy

---

### Hiragana Furigana trên Kanji (Japanese)
**Date**: 2026-03-22
**Source**: Nhat Pham — comment trên bài đăng public
**Request**: Hiển thị phiên âm hiragana (furigana) phía trên kanji trong phần transcript tiếng Nhật — giống ruby text trong sách giáo khoa Nhật.

**Ví dụ mong muốn**:
```
     きょう    いっぱい               にょうぼう
A「今日、一杯どう？」B「女房がうるさいから、
かえ
帰るよ。」
```

**Phản hồi của tác giả**: Kỹ thuật khả thi, nhưng lo ngại niche — chỉ hữu ích cho người học tiếng Nhật, ít người dùng chung.

**Hướng triển khai tiềm năng**:
- Dùng thư viện `kuroshiro` (JS) hoặc `fugashi` (Python) để thêm furigana vào text tiếng Nhật
- Render bằng HTML `<ruby>` tag trong overlay WebView (Tauri hỗ trợ sẵn)
- Làm toggle on/off trong Settings → tránh làm rối UI cho người không cần


---

## Meeting Setup & Best Practices

### Two-way Translation Guide (e.g., VN - JP Video Call)
**Date**: 2026-03-22
**Use Case**: User (Vietnamese) meets with a Partner (Japanese) via Video Call (Google Meet, Zoom, MS Teams). The app is installed ONLY on the User's machine.

**Setup Instructions**:
1. **Audio Source**: Select `Both` (System + Mic) so the app captures both the User's microphone and the Partner's audio from the speakers.
2. **Translation Type**: Select `Two-way`.
3. **Languages**:
   - `Language A`: Vietnamese
   - `Language B`: Japanese

**How Both Parties Can Receive Translations**:
Because My Translator is a local desktop application without a central server, there is no direct link to share. To let the partner understand the transcript, the User has two main methods:
- **Method 1 (Recommended) - Share Screen**: The User shares the "Entire Screen" in the meeting app, positioning the My Translator overlay at the bottom. The partner can read the translations like live subtitles.
- **Method 2 - Text-to-Speech (TTS)**: The User enables TTS with a Japanese voice. When the User speaks Vietnamese, the app translates and reads the Japanese text aloud. This generated audio is picked up by the microphone (or handled via virtual audio routing) and sent to the partner.

**Note on Use Case**: The app acts as a "Personal Translation Assistant", giving the User highly accurate, custom context-aware translations to understand the partner. If screen sharing is not viable, the partner can additionally use the native "Live Captions" feature of Zoom/Meet as a fallback.
