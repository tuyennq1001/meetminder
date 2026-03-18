# Hướng Dẫn Cài Đặt My Translator

Hướng dẫn từng bước cài đặt và sử dụng **My Translator** trên macOS.

---

## Yêu cầu

- macOS 13 trở lên (Apple Silicon — chip M1/M2/M3/M4)
- **Chế độ Cloud**: API key của [Soniox](https://soniox.com) (trả theo dùng, ~$0.12/giờ)
- **Chế độ Local**: ~5 GB dung lượng ổ cứng (cho mô hình AI, tải một lần)
- **Thuyết minh TTS** (tuỳ chọn): API key của [ElevenLabs](https://elevenlabs.io) (gói Starter $5/tháng)

---

## Bước 1 — Tải về

Tải file `.dmg` mới nhất tại: [**Releases — macOS**](https://github.com/phuc-nt/my-translator/releases/tag/v0.4.3)

---

## Bước 2 — Cài đặt

Mở file `.dmg` vừa tải → kéo **My Translator** vào thư mục **Applications**.

![Kéo My Translator vào Applications](user_manual/mytrans_01.png)

---

## Bước 3 — Gỡ chặn Gatekeeper

> ⚠️ App chưa có chữ ký Apple Developer (đang chờ duyệt), nên macOS sẽ chặn lần mở đầu tiên.

Mở **Terminal** và chạy lệnh sau (chỉ cần chạy **một lần duy nhất**):

```bash
xattr -cr /Applications/My\ Translator.app
```

![Chạy lệnh xattr trong Terminal](user_manual/mytrans_02.png)

Sau đó mở My Translator từ Applications bình thường.

---

## Bước 4 — Cấp quyền Screen Recording

Lần đầu mở app, macOS sẽ hỏi quyền **Screen & System Audio Recording**. Đây là quyền bắt buộc để app bắt được âm thanh hệ thống.

Bấm **Open System Settings** để đến trang cài đặt quyền.

![Yêu cầu cấp quyền Screen Recording](user_manual/mytrans_03.png)

---

## Bước 5 — Bật quyền trong System Settings

Tìm **My Translator** trong danh sách và **bật công tắc** sang ON.

![Bật quyền Screen & System Audio Recording](user_manual/mytrans_04.png)

macOS sẽ yêu cầu **Quit & Reopen** app — bấm nút đó để app khởi động lại với quyền mới.

![Quit & Reopen để áp dụng quyền](user_manual/mytrans_05.png)

---

## Bước 6 — Chọn chế độ dịch

Sau khi app mở lại, bấm ⚙️ (hoặc `⌘ ,`) để vào **Settings**.

Đầu tiên, chọn **Translation Engine** (bộ máy dịch):

| Chế độ | Tốc độ | Chất lượng | Chi phí | Internet |
|--------|--------|------------|---------|----------|
| ☁️ **Soniox API (Cloud)** | Real-time (~2 giây) | 9/10 | ~$0.12/giờ | Cần |
| 🖥️ **Local MLX (Offline)** | ~10 giây delay | 7/10 | Miễn phí | Không cần |

### Lựa chọn A: Chế độ Cloud (Soniox)

1. Chọn **☁️ Soniox API (Cloud)** làm Translation Engine
2. Dán API key của Soniox
3. Chọn ngôn ngữ nguồn & đích
4. Bấm **Save & Close** (nút ✓ ở trên hoặc dưới)

![Cài đặt — Soniox API key và ngôn ngữ](user_manual/mytrans_setting_1.png)

> 💡 **Lấy API key Soniox ở đâu?**
> 1. Vào [console.soniox.com](https://console.soniox.com) → tạo tài khoản
> 2. Nạp tiền ($10 tối thiểu, dùng rất lâu với ~$0.12/giờ)
> 3. Vào **API Keys** → tạo và copy key

![Soniox Console — Billing](user_manual/mytrans_key_1.png)

### Lựa chọn B: Chế độ Local (MLX — chỉ Apple Silicon)

1. Chọn **🖥️ Local MLX (Offline)** làm Translation Engine
2. Chọn ngôn ngữ nguồn & đích
3. Bấm **Save**
4. Lần đầu sử dụng, app sẽ **tự động tải** mô hình AI (~5 GB, chỉ tải một lần)
5. Lần khởi động đầu, model mất ~30-60 giây để nạp

> ⚠️ Chế độ Local yêu cầu Apple Silicon (M1/M2/M3/M4) và ~6-7 GB RAM.
> Không khả dụng trên Mac Intel.

---

## Bước 7 — Bật Thuyết Minh TTS (Tuỳ chọn)

Muốn bản dịch được **đọc thành lời**? Bật tính năng TTS:

1. Trong Settings, cuộn xuống phần **TTS Narration**
2. Tick **"Đọc bản dịch thành lời (Enable narration)"**

![Cài đặt — TTS tắt](user_manual/mytrans_setting_2.png)

3. Nhập **API key ElevenLabs**
4. Chọn **giọng nói** (2 nữ, 2 nam — đều hỗ trợ tiếng Việt)
5. Bấm **Save & Close**

![Cài đặt — TTS bật với API key và giọng nói](user_manual/mytrans_setting_3.png)

> 💡 **Lấy API key ElevenLabs ở đâu?**
> 1. Vào [elevenlabs.io](https://elevenlabs.io) → tạo tài khoản
> 2. Đăng ký gói **Starter** ($5/tháng, ~60 phút TTS)
> 3. Vào **Developers → API Keys** → tạo key với quyền "Text to Speech"

![ElevenLabs — Gói Subscription](user_manual/mytrans_key_2.png)
![ElevenLabs — Tạo API Key](user_manual/mytrans_key_3.png)

> 💡 TTS là tuỳ chọn. Nếu tắt, app hoạt động như bình thường — chỉ dịch text.

---

## Bước 8 — Bắt đầu dịch!

Quay lại màn hình chính → bấm ▶ (hoặc `⌘ Enter`) để bắt đầu.

App sẽ hiện **Listening...** — bây giờ hãy phát bất kỳ audio nào trên máy (YouTube, Zoom, podcast...) và bản dịch sẽ xuất hiện real-time!

Nếu TTS đã bật, bạn có thể bật/tắt bằng nút **TTS** hoặc `⌘ T`.

![App đang dịch với TTS bật](user_manual/mytrans_tts_1.png)

---

## Phím tắt

| Phím tắt | Chức năng |
|----------|-----------|
| `⌘ Enter` | Bắt đầu / Dừng |
| `⌘ ,` | Mở Settings |
| `Esc` | Đóng Settings |
| `⌘ 1` | Chuyển sang System Audio |
| `⌘ 2` | Chuyển sang Microphone |
| `⌘ T` | Bật/tắt thuyết minh TTS |

---

## Xử lý sự cố

### App báo "damaged and can't be opened"
→ Chạy `xattr -cr /Applications/My\ Translator.app` trong Terminal (xem Bước 3).

### Không nghe thấy bản dịch / không có text
→ Kiểm tra đã bật quyền **Screen & System Audio Recording** trong System Settings chưa (xem Bước 5).

### Lỗi "No API key"
→ Vào Settings (⚙️) và dán API key (xem Bước 6).

### Lỗi "No microphone found"
→ Mac Mini không có mic tích hợp. Cần kết nối mic ngoài (USB, headset, AirPods).
