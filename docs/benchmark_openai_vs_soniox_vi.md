# Benchmark — OpenAI Realtime vs Soniox

> Test thực tế song song, chạy ngày **2026-05-08** với cả hai provider nhận cùng một audio đồng thời.

| Audio | `live-test/Hope-v2.mp4` (bài nói TED tiếng Nhật) |
|---|---|
| **Thời lượng** | 5 phút 02 giây, mono 16 kHz s16le |
| **Nguồn → Đích** | Tự nhận diện → Tiếng Việt |
| **Engine Soniox** | `stt-rt-v4` |
| **Engine OpenAI** | `gpt-realtime-translate` (GA tháng 5/2026) |

---

## TL;DR

| | ⚡ OpenAI Realtime | ☁️ Soniox |
|---|---|---|
| **Độ trễ tới chữ dịch đầu tiên** | **~15.0 giây** | ~16.4 giây |
| **Độ trễ kết nối** | 1006 ms | 1062 ms |
| **Giọng nói đầu ra** | ✅ Có sẵn giọng nói dịch 24 kHz | ❌ Chỉ text — cần TTS riêng |
| **Phong cách output** | Token-stream (1269 deltas, ghép phía client) | Câu hoàn chỉnh (92 finals) |
| **Chất lượng dịch (JA→VI)** | Tự nhiên hơn, gọn hơn; bỏ filler | Sát nghĩa hơn, giữ nhịp gốc |
| **Ngôn ngữ đích hỗ trợ** | 13 (en, es, pt, fr, de, it, ru, hi, id, vi, ja, ko, zh) | 70+ (mọi cặp Soniox hỗ trợ) |
| **Chế độ Two-way** | ❌ Không hỗ trợ | ✅ Hỗ trợ |
| **Chi phí** | **~$4.14/giờ** (~$0.069/phút) | **~$0.12/giờ** (~$0.002/phút) |
| **Tỷ lệ chi phí** | **Đắt hơn 34 lần** | mốc cơ sở |

---

## 1. Tốc độ

Cả hai provider đều stream từng phần. Trải nghiệm hiển thị khác nhau:

- **OpenAI** phát **token-level deltas** ngay khi model decode — text hiện ra theo từng từ, cảm giác rất nhanh. Chữ dịch đầu tiên xuất hiện ở giây ~15.0.
- **Soniox** phát **câu hoàn chỉnh** sau khi phát hiện endpoint — text về theo từng đoạn sạch, cảm giác "chắc tay" hơn. Câu dịch đầu tiên ở giây ~16.4.

OpenAI nhanh hơn **~1.4 giây** ở chữ đầu tiên, nhưng cả hai đều cảm thấy real-time trong họp. Thời gian handshake gần như giống nhau (~1 giây).

> App đã tự ghép deltas của OpenAI ở phía client nên trên màn hình bạn vẫn thấy câu hoàn chỉnh — sự khác biệt chỉ ở tốc độ render từng chữ.

---

## 2. Cơ chế dịch

Đây là khác biệt quan trọng nhất về mặt thực tế.

### OpenAI Realtime
- Một WebSocket hai chiều: audio frames vào (24 kHz s16le), token-stream + audio frames ra (24 kHz)
- Model nhìn được **toàn bộ ngữ cảnh audio trong window** — nó có thể "nghe trước" trong khi đang phát token, nên dịch tiếng Việt rất tự nhiên thay vì dịch máy móc từng từ
- Trả về **cả text dịch *và* giọng nói dịch** trên cùng một stream — không cần gọi TTS riêng, không thêm độ trễ
- Giọng nói nghe tự nhiên, ngữ điệu tiếng Việt phù hợp
- **Không tắt được audio output.** Endpoint translation (`gpt-realtime-translate`) không hỗ trợ `modalities: ["text"]` — flag này chỉ tồn tại ở Realtime conversational, không có ở translation. Cần text-only thì phải dùng stack khác (Whisper + GPT, hoặc Soniox)

### Soniox
- ASR streaming liên tục, dịch như một side-channel cấu hình
- Dịch **theo từng câu hoàn chỉnh** — mỗi đoạn tiếng Việt được "chốt" sau khi engine xác định ranh giới câu tiếng Nhật
- Chỉ trả về **text**. Để có giọng nói, bạn truyền text qua Edge TTS / Google Chirp / ElevenLabs (app làm việc này tự động khi bật TTS)
- Chế độ Two-way được xây trên mô hình finalisation theo câu — tự nhận diện ngôn ngữ và route theo segment hoạt động tự nhiên

**Hệ quả khi chọn:** muốn có giọng nói không cần cấu hình và dịch tự nhiên nhất → OpenAI. Cần two-way song ngữ, output tiếng Thái, hoặc cặp ngôn ngữ ít gặp → Soniox.

---

## 3. Chất lượng — Nhật → Việt (quan sát thực tế)

Cả hai bản dịch đều đạt chất lượng có thể publish được. Khác biệt cụ thể từ mẫu 5 phút:

| Khía cạnh | OpenAI | Soniox |
|---|---|---|
| Tên người "Uematsu Tsutomu" | Nghe nhầm chỉ thành `tsutomu` | **Bắt đúng tên đầy đủ** |
| Địa danh 赤平 (Akabira) | **Đúng `Akabira` ✓** | Sai một phụ âm `Akahira` |
| Từ mượn 「マグネット」 | **Giữ nguyên `Magnet` ✓** | Dịch sát nghĩa thành `nam châm` |
| Đoạn cảm xúc Apollo lên Mặt Trăng | **Tự nhiên** — "ông mừng lắm" | Hơi cứng — "vui mừng đến mức chưa từng thấy" |
| Filler "Vâng, ờ" | Bỏ, vào thẳng câu chính | Giữ lại (trung thành với speech gốc) |
| Đối thoại với thầy giáo | **Văn phong tiếng Việt gọn ghẽ** | Văn phong tiếng Việt tự nhiên |
| Coverage cuối clip | Tới cùng điểm kết | Tới cùng điểm kết |

**Tổng kết chủ quan:**
- **OpenAI** đọc như văn bản đã được dịch giả Việt biên tập lại sau buổi nói — gọn, tự nhiên, bỏ disfluency
- **Soniox** đọc như phiên dịch trực tiếp — giữ texture của speech gốc bao gồm cả ngắc ngứ, đôi khi hơi cứng nhưng luôn trung thành

Cho phần lớn use-case, output OpenAI đọc thoải mái hơn. Khi cần giữ trọn sắc thái nguồn (học thuật/pháp lý/tòa án), độ literal của Soniox lại an toàn hơn.

---

## 4. Chi phí (giá list của provider, tính đến 2026-05)

| | mỗi phút | mỗi giờ | run 5 phút này |
|---|---|---|---|
| **OpenAI Realtime** | ~$0.069 (audio in + text out + audio out) | **~$4.14** | $0.348 |
| **Soniox stt-rt-v4 + translate** | ~$0.002 | **~$0.12** | $0.010 |

**OpenAI đắt hơn Soniox khoảng 34 lần** ở giá list provider.

Lưu ý quan trọng: đây **không** phải so sánh sát ngang. OpenAI đã bao gồm giọng nói dịch. Để có cùng UX cuối cùng với Soniox, cần thêm lớp TTS:

| TTS thêm vào Soniox | Chi phí thêm | Tổng Soniox + TTS |
|---|---|---|
| Edge TTS (miễn phí) | $0/giờ | ~$0.12/giờ |
| Google Chirp 3 HD | ~$0/giờ (trong free tier 1M char/tháng) | ~$0.12/giờ |
| ElevenLabs (Starter) | ~$5/tháng, ~60 phút | thay đổi |

Kể cả khi cộng Google Chirp 3 HD vào, **Soniox + TTS vẫn rẻ hơn OpenAI khoảng 30 lần** — và chất lượng giọng Chirp 3 HD rất gần với giọng có sẵn của OpenAI.

Lý do chọn OpenAI **không** phải vì chi phí trên phút — mà vì chất lượng dịch và voice không cần cấu hình. Nếu chi phí được tính cho khách hàng hoặc cho buổi thuyết trình quan trọng, $4/giờ là không đáng kể. Còn dùng cá nhân hằng ngày, Soniox + Edge TTS rẻ hơn rất nhiều.

---

## 5. Khi nào nên dùng cái nào

| Use case | Khuyên dùng |
|---|---|
| Họp song ngữ (chế độ two-way) | **Soniox** — engine duy nhất hỗ trợ two-way |
| Tiếng Thái hoặc ngôn ngữ ngoài 13 đích | **Soniox** — OpenAI không hỗ trợ |
| Xem YouTube / podcast cá nhân | **Soniox** — tiết kiệm, chất lượng rất tốt |
| Họp business quan trọng (gặp khách hàng) | **OpenAI** — dịch tốt nhất, có sẵn giọng nói, $4/giờ chấp nhận được |
| Đã có ElevenLabs/Google TTS sẵn | **Soniox** — TTS đã giải quyết |
| Muốn không cấu hình TTS | **OpenAI** — giọng nói có sẵn |
| Offline / không internet | **Local MLX** (lựa chọn thứ 3, không có trong benchmark này) |
| Muốn transcript sát nghĩa, trung thành | **Soniox** |
| Muốn bản dịch tự nhiên, đọc thuận | **OpenAI** |

App cho phép đổi engine theo từng session, nên bạn có thể giữ cả hai key cùng lúc và chọn đúng công cụ cho từng tình huống.

---

## 6. Phương pháp test

- Cùng file audio stream song song tới cả hai provider từ một harness Rust duy nhất (`live-test/comparison-rs/src/compare.rs`)
- Chunks 200 ms, pacing real-time, PCM mono 16 kHz (upsample lên 24 kHz cho OpenAI theo yêu cầu của model)
- Tất cả event được timestamp tới mili-giây
- Log event thô: [`live-test/report/comparison-260508-2122-raw.json`](../live-test/report/comparison-260508-2122-raw.json)
- Transcript đầy đủ song song: [`live-test/report/comparison-260508-final.md`](../live-test/report/comparison-260508-final.md)
- 0 lỗi cả hai bên trong suốt 5 phút

---

## 7. Lưu ý

- **Một mẫu duy nhất 5 phút**, một cặp ngôn ngữ (Nhật → Việt), một speaker (monologue kiểu TED, audio studio sạch). Quan sát chất lượng có tính định hướng, không phải thống kê
- Số liệu chi phí là **giá list provider**, không phải giá enterprise đàm phán
- `gpt-realtime-translate` của OpenAI là sản phẩm GA mới (5/2026); giá và hành vi có thể thay đổi
- App nạp tiền vào tài khoản **của bạn** tại OpenAI / Soniox trực tiếp — không có phí phụ thu, không có relay
