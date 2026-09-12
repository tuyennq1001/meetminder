# Hướng Dẫn Cài Đặt & Cấu Hình Meet Minder (macOS)

Tài liệu hướng dẫn chi tiết từng bước cài đặt, cấu hình và sử dụng **Meet Minder v1.0** trên hệ điều hành macOS.

---

## 📌 Yêu cầu hệ thống

- **Hệ điều hành**: macOS 13.0 (Ventura) trở lên.
- **Phần cứng hỗ trợ**:
  - **Apple Silicon** (M1 / M2 / M3 / M4) — Tận dụng tối đa hiệu năng và hỗ trợ chế độ dịch ngoại tuyến 100% Local MLX.
  - **Intel Mac** (i5 / i7 / i9) — Hoạt động mượt mà với các engine Cloud (Gemini, Soniox, OpenAI, Qwen).
- **Quyền hệ điều hành**: Cần cấp quyền **Screen & System Audio Recording** và **Microphone** để bắt âm thanh cuộc họp.

---

## Bước 1 — Tải về bản cài đặt v1.0.0

Truy cập trang [**GitHub Releases — Meet Minder**](https://github.com/tuyennq1001/meetminder/releases/latest) và tải file cài đặt tương ứng với dòng máy của bạn:

| Kiến trúc chip | File cài đặt | Đối tượng thiết bị |
| :--- | :--- | :--- |
| **Apple Silicon** | `MeetMinder_1.0.0_aarch64.dmg` | Mac M1, M2, M3, M4 (MacBook, Mac mini, iMac, Mac Studio) |
| **Intel Mac** | `MeetMinder_1.0.0_x64.dmg` | Các dòng máy Mac sử dụng chip Intel Core |

> [!TIP]
> **Cách kiểm tra chip máy Mac của bạn:**
> Nhấp vào biểu tượng ** (Apple)** ở góc trên bên trái màn hình ➔ chọn **Giới thiệu về máy Mac này (About This Mac)**:
> - Nếu hiển thị **Chip: Apple M...** ➔ Chọn bản **`aarch64`**.
> - Nếu hiển thị **Bộ xử lý: Intel Core...** ➔ Chọn bản **`x64`**.

---

## Bước 2 — Cài đặt ứng dụng

1. Mở file `.dmg` vừa tải về.
2. Kéo biểu tượng **Meet Minder** thả vào thư mục **Applications**.
3. Eject ổ đĩa DMG và mở **Meet Minder** từ Applications hoặc Spotlight (`⌘ Space`).

---

## Bước 3 — Cấp quyền âm thanh hệ thống & Microphone

Khi khởi chạy ứng dụng lần đầu, macOS sẽ hiển thị hộp thoại yêu cầu cấp quyền:

1. **Quyền Ghi lại màn hình & Âm thanh hệ thống (Screen & System Audio Recording)**:
   - Nhấp vào nút **Open System Settings** khi được hỏi.
   - Tìm ứng dụng **Meet Minder** trong danh sách và gạt sang **Bật (ON)**.
   - macOS sẽ hiển thị thông báo yêu cầu **Quit & Reopen** (Thoát và mở lại ứng dụng) để quyền có hiệu lực. Bấm xác nhận.
   > *Lưu ý: Meet Minder chỉ sử dụng API ScreenCaptureKit nội bộ để bắt luồng âm thanh phát ra từ loa máy (Zoom, Google Meet, YouTube, Teams), hoàn toàn không quay phim hay chụp ảnh màn hình của bạn.*

2. **Quyền Microphone**:
   - Khi bấm **Start** lần đầu, macOS sẽ hỏi quyền truy cập Microphone. Nhấp **Cho phép (OK)** để ứng dụng có thể thu giọng nói của bạn.

---

## Bước 4 — Lựa chọn & Cấu hình Engine Dịch thuật (AI Engines)

Meet Minder hỗ trợ các giải pháp công nghệ AI tiên tiến, được sắp xếp theo mức độ ưu tiên và tối ưu:

![Meet Minder — Cài đặt Engine Dịch thuật](user_manual/setting_gemini.png)

### 🥇 Lựa chọn 1 (Khuyên dùng): Google Gemini Live API

> 🌟 **Lựa chọn hàng đầu**: Cực kỳ thông minh, tốc độ phản hồi hai chiều thời gian thực qua WebSocket, tự động quét model tối ưu nhất và đặc biệt là **HOÀN TOÀN MIỄN PHÍ (Free Tier)** từ Google.

- **Chi phí**: **0đ / Miễn phí** (Gói Free Tier của Google AI Studio cung cấp hạn ngạch rất lớn, đủ dùng hàng ngày cho các cuộc họp mà không cần thẻ tín dụng).
- **Tính năng nổi bật**:
  - Tự động nhận diện ngôn ngữ và dịch thuật ngữ cảnh sâu.
  - Tích hợp tính năng tự động tổng hợp **Biên bản cuộc họp (Meeting Minutes)** xuất sắc: trích xuất mục tiêu, quyết định trọng tâm (Key Decisions) và đầu việc (Action Items).
  - Tự động nhận diện danh mục từ điển dự án (Project Glossary).

**Các bước lấy API Key Google Gemini (30 giây):**
1. Truy cập [**Google AI Studio**](https://aistudio.google.com).
2. Đăng nhập bằng tài khoản Google cá nhân.
3. Nhấp vào nút **Get API key** ở thanh menu bên trái.
4. Bấm **Create API key** và sao chép mã khoá (dạng `AIzaSy...`).
5. Trong Meet Minder: Mở **Cài đặt (`⌘ ,`)** ➔ **Engine & Dịch thuật** ➔ Chọn **Google Gemini Live** ➔ Dán mã API key ➔ Bấm **Test** để xác nhận kết nối thành công.

---

### 🥈 Lựa chọn 2: Local MLX (100% Ngoại tuyến trên Apple Silicon)

> 🔒 **Bảo mật tuyệt đối**: Dành riêng cho người dùng máy Mac chip M1/M2/M3/M4 muốn phiên dịch ngoại tuyến hoàn toàn, không gửi bất kỳ dữ liệu âm thanh nào lên internet.

- **Chi phí**: **Miễn phí vĩnh viễn**.
- **Yêu cầu**: Máy Mac Apple Silicon, dung lượng trống ~5 GB (tải gói mô hình Whisper + Gemma một lần duy nhất).
- **Cách kích hoạt**:
  1. Vào **Cài đặt (`⌘ ,`)** ➔ **Engine & Dịch thuật** ➔ Chọn **Local MLX**.
  2. Bấm nút **Cài đặt / Tải trước mô hình Local MLX**. Ứng dụng sẽ tự động tải và thiết lập môi trường.
  3. Sau khi hoàn tất, bạn có thể ngắt toàn bộ Wi-Fi và họp ngoại tuyến an toàn.

![Meet Minder — Cài đặt Local MLX](user_manual/setting_local_mlx.png)

---

### 🥉 Các lựa chọn Cloud chuyên dụng khác

- **Soniox Real-time STT (v5)**: Chuyên gia nhận diện tiếng Nhật và đa ngữ cực chuẩn, chi phí siêu rẻ (~$0.12/giờ âm thanh), tích hợp phân tách người nói (Diarization). Lấy key tại [console.soniox.com](https://console.soniox.com).
- **OpenAI Realtime API**: Dịch thuật hội thoại chất lượng cao, phản hồi giọng đọc tự nhiên. Chi phí khoảng $4.00/giờ. Lấy key tại [platform.openai.com](https://platform.openai.com).
- **Qwen LiveTranslate Flash**: Tốc độ dịch siêu nhanh trên Alibaba DashScope (yêu cầu tạo key tại region Singapore).

---

### 📊 Bảng so sánh chi tiết các Engine AI

| Tiêu chí | 🌟 Google Gemini Live | 🖥️ Local MLX | ☁️ Soniox STT | ⚡ OpenAI Realtime | 🌏 Qwen Live |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Chi phí** | **Miễn phí (Free Tier)** | **Miễn phí 100%** | Siêu rẻ (~$0.12/h) | Cao (~$4.00/h) | Miễn phí preview |
| **Độ trễ** | Cực thấp (~1 - 2s) | Thấp (~2 - 3s) | Siêu thấp (< 1s) | Thấp (~1 - 2s) | Siêu thấp (< 1s) |
| **Chạy Ngoại tuyến (Offline)** | Cần Internet | **Có (100% Offline)** | Cần Internet | Cần Internet | Cần Internet |
| **Tạo Biên bản họp (Minutes)** | **Xuất sắc (AI Agent)** | Cơ bản | Hỗ trợ qua Gemini | Tốt | Không hỗ trợ |
| **Bảo mật & Riêng tư** | Trực tiếp máy ➔ Google | **Cực đại (Trên máy)** | Trực tiếp máy ➔ Soniox | Trực tiếp máy ➔ OpenAI | Trực tiếp ➔ Alibaba |
| **Hỗ trợ thiết bị** | Mọi máy Mac & Windows | Apple Silicon (M1 - M4) | Mọi máy Mac & Windows | Mọi máy Mac & Windows | Mọi máy Mac & Windows |

---

## Bước 5 — Cấu hình Tự động Sao lưu (Auto Git Backup)

Meet Minder tích hợp sẵn cơ chế **Auto Git Backup** giúp sao lưu toàn bộ biên bản cuộc họp, ghi chú viết tay Markdown và file âm thanh vào kho Git riêng tư của bạn:

![Cài đặt Sao lưu qua Git](user_manual/setting_backup.png)

1. Mở **Cài đặt (`⌘ ,`)** ➔ chọn mục **Lưu trữ & backup**.
2. Gạt công tắc **Backup qua Git** sang trạng thái **Bật**.
3. Tích chọn:
   - **Commit & push ngay sau khi kết thúc meeting**: Tự động lưu trữ ngay khi bạn bấm nút Lưu cuộc họp (`⌘ T`).
   - **Bật tự động push lên remote**: Đồng bộ lên GitHub / GitLab / Bitbucket định kỳ.
4. Bấm nút **Backup ngay** để kiểm tra đồng bộ tức thì.

---

## Bước 6 — Bắt đầu Cuộc họp & Bảng Phím tắt Tiện ích

Trên màn hình chính (Live Overlay), nhấp nút **Start** hoặc dùng các phím tắt nhanh sau:

![Màn hình Live Meeting](user_manual/meetminder_live.png)

| Phím tắt (macOS) | Thao tác |
| :--- | :--- |
| <kbd>⌘</kbd> + <kbd>S</kbd> | **Bắt đầu (Start)** / **Tạm dừng (Pause)** phiên dịch cuộc họp |
| <kbd>⌘</kbd> + <kbd>C</kbd> | **Tiếp tục (Continue)** sau khi tạm dừng |
| <kbd>⌘</kbd> + <kbd>T</kbd> | **Kết thúc cuộc họp & Lưu dữ liệu (Save & Stop)** |
| <kbd>⌘</kbd> + <kbd>N</kbd> | **Mở / Đóng nhanh ngăn kéo Ghi chú (Take Note Drawer)** |
| <kbd>⌘</kbd> + <kbd>L</kbd> | Chuyển sang màn hình **Trực tiếp (Live mode)** |
| <kbd>⌘</kbd> + <kbd>O</kbd> | Chuyển sang màn hình **Kho lưu trữ & Lịch sử cuộc họp (Meeting Logs)** |
| <kbd>⌘</kbd> + <kbd>1</kbd> | Chọn nguồn thu: **Chỉ âm thanh hệ thống (Loa)** |
| <kbd>⌘</kbd> + <kbd>2</kbd> | Chọn nguồn thu: **Chỉ Microphone** |
| <kbd>⌘</kbd> + <kbd>3</kbd> | Chọn nguồn thu: **Hệ thống + Micro kết hợp (Khuyên dùng khi họp)** |
| <kbd>⌘</kbd> + <kbd>,</kbd> | **Mở Cửa sổ Cài đặt (Settings)** |
| <kbd>⌘</kbd> + <kbd>P</kbd> | Ghim cửa sổ ứng dụng luôn nổi trên cùng (Toggle Pin Always-on-top) |
| <kbd>⌘</kbd> + <kbd>M</kbd> | Thu nhỏ cửa sổ ứng dụng |
| <kbd>?</kbd> | Mở bảng tra cứu phím tắt |
| <kbd>Esc</kbd> | Đóng popup, thoát cài đặt hoặc hủy bỏ thao tác |

---

## Bước 7 — Xem lại Cuộc họp đã lưu, Biên bản AI & Audio

Nhấn <kbd>⌘</kbd> + <kbd>O</kbd> hoặc click **📚 Meeting Logs** để mở giao diện quản lý phiên họp 3 thẻ:

![Biên bản cuộc họp AI](user_manual/session_minutes.png)

- **Biên bản cuộc họp AI**: Tóm tắt mục tiêu, quyết định chính và việc cần làm (hỗ trợ tiếng Anh, Nhật, Việt).
- **Nhật ký cuộc họp song ngữ**: Đối chiếu lời thoại song ngữ, nhấp câu thoại để tua audio, hỗ trợ Re-transcript và xuất phụ đề `.srt` / `.txt`:

![Nhật ký cuộc họp song ngữ & Audio Scrubber](user_manual/session_logs.png)

---

## ℹ️ Thông tin Tác giả & Hỗ trợ kỹ thuật

- **Tác giả & Phát triển**: **Terry**
- **Email hỗ trợ**: [tuyennq1001@gmail.com](mailto:tuyennq1001@gmail.com)
- **GitHub Repository**: [https://github.com/tuyennq1001/meetminder](https://github.com/tuyennq1001/meetminder)
- **Báo lỗi & Đóng góp ý kiến**: [https://github.com/tuyennq1001/meetminder/issues](https://github.com/tuyennq1001/meetminder/issues)
