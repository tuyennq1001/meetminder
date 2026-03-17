# Hướng dẫn TTS (Text-to-Speech)

My Translator có thể **đọc thành tiếng bản dịch** ngay khi xuất hiện — như có phiên dịch viên ngồi cạnh. Hỗ trợ 2 nhà cung cấp:

| | Edge TTS ⭐ | ElevenLabs |
|-|-------------|------------|
| **Chi phí** | Miễn phí | Trả phí (~$5/tháng trở lên) |
| **Chất lượng** | Tự nhiên, rõ ràng | Rất tự nhiên, giàu cảm xúc |
| **Tiếng Việt** | ✅ HoaiMy (nữ), NamMinh (nam) | ✅ Có |
| **Cài đặt** | Không cần gì — bật là dùng | Cần đăng ký + API key |
| **Internet** | Cần | Cần |

---

## Edge TTS (Mặc định — Miễn phí)

### Edge TTS là gì?

Edge TTS sử dụng cùng công nghệ giọng nói mà Microsoft tích hợp trong trình duyệt **Microsoft Edge** (tính năng "Đọc to" / "Read Aloud"). Khi bạn mở một trang web trên Edge và nhấn "Read Aloud", trình duyệt gửi văn bản lên server Microsoft và nhận lại giọng đọc neural — chất lượng rất cao, nghe như người thật.

My Translator kết nối đến **cùng dịch vụ đó** để đọc bản dịch.

### Tại sao miễn phí?

Microsoft cung cấp Edge TTS miễn phí vì đây là **một phần của hệ sinh thái Edge/Windows**, không phải sản phẩm bán riêng:

- **Mục đích chính**: Tăng trải nghiệm người dùng Edge — đọc báo, đọc sách, accessibility
- **Không có API key**: Không cần tài khoản, không cần đăng ký — bất kỳ ai cũng dùng được
- **Không giới hạn rõ ràng**: Microsoft không công bố rate limit cụ thể cho endpoint này
- **Chiến lược kinh doanh**: Microsoft thu lợi gián tiếp qua việc người dùng ở lại hệ sinh thái (Edge, Windows, Bing)

> ⚠️ Đây là dịch vụ miễn phí cho mục đích cá nhân. Microsoft có thể thay đổi chính sách bất kỳ lúc nào, nhưng đến nay vẫn hoạt động ổn định.

### Giọng có sẵn

| Giọng | Ngôn ngữ | Giới tính |
|-------|----------|-----------|
| HoaiMy | Tiếng Việt 🇻🇳 | Nữ |
| NamMinh | Tiếng Việt 🇻🇳 | Nam |
| Jenny | English 🇺🇸 | Nữ |
| Guy | English 🇺🇸 | Nam |
| Nanami | 日本語 🇯🇵 | Nữ |
| SunHi | 한국어 🇰🇷 | Nữ |
| Xiaoxiao | 中文 🇨🇳 | Nữ |

### Tốc độ

Chỉnh trong Settings → TTS → Speed. Mặc định **+50%** (nhanh hơn giọng nói bình thường).

---

## ElevenLabs (Trả phí)

### ElevenLabs là gì?

ElevenLabs là công ty chuyên về **AI voice**, nổi tiếng với giọng nói cực kỳ tự nhiên, có cảm xúc và ngữ điệu phong phú. Đây là dịch vụ trả phí với API key riêng.

### Edge TTS vs ElevenLabs — khác gì?

| | Edge TTS | ElevenLabs |
|-|----------|-----------|
| **Ngữ điệu** | Tốt, đều đều | Giàu cảm xúc, biết nhấn nhá |
| **Giọng Việt** | Rõ ràng, tự nhiên | Rất tự nhiên, ít "máy" hơn |
| **Tuỳ chỉnh** | Chọn giọng + tốc độ | Chọn giọng + voice cloning |
| **Giá** | $0 | ~$5–$22/tháng |
| **Phù hợp** | Đa số người dùng | Cần chất lượng cao nhất |

**Nói ngắn gọn**: Edge TTS đủ tốt cho 90% nhu cầu. ElevenLabs chỉ cần khi bạn muốn giọng đọc "sống" hơn hoặc cần voice cloning.

### Cài đặt ElevenLabs

1. Đăng ký tại [elevenlabs.io](https://elevenlabs.io)
2. Vào Dashboard → lấy API key
3. Trong app: Settings → TTS → chọn **ElevenLabs** → dán API key

---

## Xử lý sự cố

- **Không có tiếng?** Kiểm tra nút 🔊 đã bật và âm lượng hệ thống.
- **Edge TTS không hoạt động?** Kiểm tra kết nối internet. Edge TTS cần mạng.
- **Giọng TTS bị thu lại?** Giảm âm lượng TTS hoặc tạm dừng phiên dịch khi đang đọc.
