# Hướng dẫn Text-to-Speech (TTS)

My Translator hỗ trợ **3 nhà cung cấp TTS** để đọc bản dịch thành tiếng. Tài liệu này giải thích cơ chế hoạt động và giúp bạn chọn lựa phù hợp.

---

## So sánh nhanh

| | Edge TTS ⭐ | Web Speech | ElevenLabs |
|---|---|---|---|
| **Chi phí** | Miễn phí | Miễn phí | Trả phí (cần API key) |
| **Chất lượng** | ★★★★★ Tự nhiên | ★★★ Máy móc | ★★★★★ Cao cấp |
| **Tiếng Việt** | ✅ Có sẵn (HoaiMy, NamMinh) | ⚠️ Tùy hệ điều hành | ✅ Có |
| **Internet** | Cần | Không cần | Cần |
| **API Key** | Không cần | Không cần | Cần |
| **Cài đặt** | Không cần — dùng ngay | Windows cần cài thêm voice | Đăng ký tại elevenlabs.io |

> **Khuyến nghị**: Dùng **Edge TTS** (mặc định). Miễn phí, giọng tự nhiên, chạy trên mọi nền tảng mà không cần cấu hình gì.

---

## Edge TTS (Mặc định — Khuyến nghị)

### Cơ chế hoạt động

Edge TTS sử dụng cùng công nghệ chuyển văn bản thành giọng nói của tính năng **"Đọc to"** trong trình duyệt Microsoft Edge. Ứng dụng kết nối trực tiếp đến dịch vụ giọng nói của Microsoft và nhận về âm thanh chất lượng cao.

```
Văn bản → Dịch vụ giọng nói Microsoft (đám mây) → Phát âm thanh tự nhiên
```

### Giọng đọc có sẵn

| Giọng | Ngôn ngữ | Giới tính |
|-------|----------|-----------|
| HoaiMy | Tiếng Việt 🇻🇳 | Nữ |
| NamMinh | Tiếng Việt 🇻🇳 | Nam |
| Jenny | English 🇺🇸 | Nữ |
| Guy | English 🇺🇸 | Nam |
| Nanami | 日本語 🇯🇵 | Nữ |
| SunHi | 한국어 🇰🇷 | Nữ |
| Xiaoxiao | 中文 🇨🇳 | Nữ |

### Điều chỉnh tốc độ

Chỉnh tốc độ từ **-50%** (chậm hơn) đến **+100%** (nhanh gấp đôi) trong Settings → tab TTS.  
Mặc định: **+30%** — nhanh hơn tốc độ nói bình thường một chút.

### Lưu ý
- Cần kết nối internet
- Không cần API key hay tài khoản
- Hoạt động giống nhau trên **macOS và Windows**
- Miễn phí, không giới hạn sử dụng cá nhân

---

## Web Speech API

### Cơ chế hoạt động

Web Speech sử dụng **giọng đọc được cài trên hệ điều hành**. Trình duyệt web dùng bộ tổng hợp giọng nói cục bộ để đọc văn bản.

```
Văn bản → Bộ tổng hợp giọng nói của OS (cục bộ) → Phát âm thanh
```

### ⚠️ Quan trọng: Người dùng Windows

**Windows không có giọng tiếng Việt mặc định.** Nếu bạn chọn Web Speech mà hệ thống chưa cài giọng tiếng Việt, nó sẽ dùng giọng tiếng Anh (David hoặc Zira). Điều này gây ra:

- Văn bản tiếng Việt bị đọc bằng **giọng Anh** — nghe rất lạ
- Giọng Anh có thể bị ứng dụng thu lại, gây **vòng lặp phản hồi**

#### Cách cài giọng tiếng Việt trên Windows

1. Mở **Settings** → **Time & Language** → **Language & region**
2. Nhấn **Add a language**
3. Tìm **Tiếng Việt** (Vietnamese) và cài đặt
4. Vào **Settings** → **Time & Language** → **Speech**
5. Mục **Manage voices**, nhấn **Add voices**
6. Tìm **Vietnamese** và nhấn **Add**
7. Đợi tải xong
8. **Khởi động lại My Translator**

> Sau khi cài, giọng tiếng Việt sẽ tự động xuất hiện trong ứng dụng.

### Người dùng macOS

macOS đã có sẵn giọng tiếng Việt. Không cần cài thêm gì.

### Khi nào nên dùng Web Speech
- ✅ Bạn cần TTS **không cần internet** (offline)
- ✅ Bạn dùng macOS (giọng có sẵn)
- ❌ Không khuyến nghị trên Windows nếu chưa cài giọng tiếng Việt

---

## ElevenLabs (Cao cấp)

### Cơ chế hoạt động

ElevenLabs là dịch vụ giọng nói AI cao cấp, tạo ra giọng nói cực kỳ tự nhiên. Yêu cầu API key trả phí.

```
Văn bản → ElevenLabs API (đám mây) → Phát âm thanh cao cấp
```

### Cài đặt

1. Đăng ký tại [elevenlabs.io](https://elevenlabs.io)
2. Lấy API key từ trang dashboard
3. Trong My Translator: Settings → tab TTS → chọn **ElevenLabs**
4. Dán API key
5. Chọn giọng đọc

### Khi nào nên dùng ElevenLabs
- ✅ Bạn muốn giọng nói **chất lượng cao nhất**
- ✅ Bạn cần **giọng tùy chỉnh** hoặc nhân bản giọng
- ❌ Không miễn phí — tính phí theo ký tự

---

## Xử lý sự cố

### Không có tiếng khi bật TTS
1. Kiểm tra TTS đã bật chưa (nút 🔊 trên overlay phải sáng)
2. Kiểm tra âm lượng hệ thống
3. Thử chuyển sang nhà cung cấp TTS khác trong Settings

### Văn bản tiếng Việt bị đọc bằng giọng Anh
- **Nguyên nhân phổ biến**: Bạn đang dùng Web Speech trên Windows mà chưa cài giọng tiếng Việt
- **Khắc phục**: Chuyển sang **Edge TTS** (khuyến nghị) hoặc cài giọng tiếng Việt (xem hướng dẫn ở trên)

### Edge TTS không hoạt động
- Kiểm tra kết nối internet — Edge TTS cần internet
- Thử khởi động lại ứng dụng
- Nếu vẫn lỗi, chuyển sang Web Speech tạm thời

### Vòng lặp phản hồi âm thanh (giọng TTS bị nhận dạng lại)
- Có thể xảy ra trên **Windows** khi hệ thống thu âm bắt được âm thanh TTS
- **Giải pháp tạm**: Giảm âm lượng TTS, hoặc tạm dừng phiên dịch khi TTS đang đọc

---

## Tóm tắt

Đối với hầu hết người dùng, **Edge TTS là lựa chọn tốt nhất** — miễn phí, giọng tự nhiên, hỗ trợ tiếng Việt sẵn, và không cần cấu hình gì. Chỉ cần bật TTS và nghe! 🎙️
