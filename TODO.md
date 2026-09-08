# TODO

## Sửa lỗi phát file ghi âm dài

### Bối cảnh

File ghi âm được lưu thành công và WAV header hợp lệ, nhưng file dài khoảng 2 giờ trở lên có thể báo **“Lỗi khi phát file ghi âm”**.

Nguyên nhân dự kiến: cơ chế phát hiện tại đọc toàn bộ file vào bộ nhớ, mã hóa thành Base64 rồi truyền vào `new Audio(dataUrl)`. Một file WAV khoảng 289 MB sẽ thành chuỗi Base64 khoảng 385 MB, khiến WebView có thể không tải hoặc giải mã được.

Việc transcript chưa hoàn tất không phải nguyên nhân trực tiếp. Audio được ghi và finalize độc lập với quá trình transcript.

### Phương án sửa đề xuất

- Thêm Tauri command trả về đường dẫn file ghi âm đã được kiểm tra, thay vì trả về toàn bộ nội dung Base64.
- Dùng asset protocol/URL nội bộ của Tauri để phát trực tiếp từ ổ đĩa.
- Cho `Audio` nhận URL file nội bộ để WebView đọc theo luồng, không tạo chuỗi vài trăm MB trong RAM.
- Giữ `read_session_audio` cho các tác vụ backend như re-transcript nếu vẫn cần; không dùng nó cho playback.
- Hỗ trợ cả thư mục lưu mặc định và thư mục lưu tùy chỉnh.

### UX cần bổ sung

- Hiển thị trạng thái `Đang tải bản ghi...`.
- Disable thao tác tua trong lúc chưa tải được metadata.
- Hiển thị lỗi cụ thể nếu file không tồn tại, file hỏng hoặc codec không được hỗ trợ.
- Có nút `Thử lại`.
- Reset trạng thái player khi tải/phát thất bại.

### Gia cố quá trình ghi

- Không bỏ qua lỗi `write`, `flush` và cập nhật WAV header.
- Ghi log rõ khi không thể finalize file.
- Kiểm tra kích thước file thực tế khớp với kích thước trong WAV header sau khi dừng ghi.

### Trạng thái triển khai

- [x] Phát WAV trực tiếp qua Tauri asset protocol, không dùng Base64 cho playback.
- [x] Hiển thị loading, khóa tua khi đang tải và reset player khi lỗi.
- [x] Phân loại lỗi đọc/giải mã/codec và hướng dẫn thử lại.
- [x] Import file bằng kéo-thả hoặc chọn file local, có validation trước khi xử lý.
- [x] Upload import/re-transcript theo stream, tránh giữ bản sao toàn bộ file nặng trong RAM.
- [x] Nới timeout theo kích thước/thời lượng và hiển thị thời gian đã xử lý ở mốc 88%.
- [x] Ghi log lỗi write, flush, finalize WAV và kiểm tra kích thước sau khi dừng.
- [x] Build bản Dev và chạy unit test Rust.
- [ ] Kiểm tra thủ công playback file WAV 289 MB trên bản Dev.
- [ ] Xác nhận với người dùng trước khi commit/merge vào `main`.

### Checklist kiểm thử

- [ ] Phát file WAV ngắn.
- [ ] Phát file WAV khoảng 289 MB hiện có.
- [ ] Phát cuộc họp dài 2–3 giờ.
- [ ] Đóng app khi transcript còn đang xử lý.
- [ ] Pause/Start nhiều lần trong cùng một cuộc họp.
- [ ] Phát file import dạng WAV, MP3 và M4A.
- [ ] Xử lý file bị thiếu hoặc bị hỏng.
- [x] Kiểm tra trên bản Dev bằng `npm run build:dev`.

### Lưu ý triển khai

- Khi bắt đầu sửa mã nguồn, tạo nhánh mới với tiền tố `codex/`.
- Kiểm thử hoàn tất trên bản Dev trước khi cân nhắc merge vào `main`.
- Thay đổi hiện nằm trên nhánh `codex/fix-large-audio-playback`, chưa commit hoặc merge.

## Tách Meeting Logs và System Logs

### Ý tưởng

- Đổi tên khu vực/danh sách `Logs` thành `Meeting Logs` để thể hiện đây là
  lịch sử và nội dung các cuộc họp đã lưu.
- Trong nhóm `CẤU HÌNH HỆ THỐNG`, thêm mục `System Logs`.
- `System Logs` là nhật ký vận hành của ứng dụng, tách biệt với dữ liệu cuộc
  họp.

### Bảng System Logs đề xuất

- `#`
- `Loại`: `Transcript`, `Recording`, `Error`
- `Trạng thái`: `Thành công`, `Thất bại`, `Cảnh báo`
- `Chi tiết`: mô tả ngắn, lý do lỗi, engine/provider và thông tin liên quan
- `Ngày giờ xảy ra`: hiển thị theo giờ địa phương

Nên tách `Loại` và `Trạng thái`; `Lỗi` phù hợp hơn với trạng thái hoặc mức độ,
không nên đặt cùng nhóm với `Transcript` và `Recording`.

### Nội dung và bảo mật

- Mỗi dòng là một sự kiện hệ thống, không phải một cuộc họp.
- Không ghi toàn bộ transcript hoặc dữ liệu âm thanh thô vào System Logs; chỉ
  ghi tóm tắt và liên kết tới Meeting Logs liên quan nếu cần.
- Không ghi API key, token hoặc thông tin nhạy cảm vào log.
- Lỗi cần có mô tả dễ hiểu, bước tiếp theo và phần `Technical details` có thể
  mở rộng.
- Cân nhắc chính sách lưu log, ví dụ giữ 30 hoặc 90 ngày, để log không tăng vô
  hạn.

### UX đề xuất

- Có filter theo loại và trạng thái, ô tìm kiếm, sort theo ngày giờ và nút
  `Xoá bộ lọc`.
- Mặc định sắp xếp mới nhất trước.
- Có trạng thái loading, chưa có dữ liệu, không có kết quả phù hợp và lỗi tải
  dữ liệu.
- Với tab chi tiết cuộc họp hiện đang dùng tên `Logs`, cân nhắc đổi thành
  `Transcript` hoặc `Bản ghi` thay vì thay thế máy móc toàn bộ bằng
  `Meeting Logs`.
- Có thể đổi tên nhóm `CẤU HÌNH HỆ THỐNG` thành `HỆ THỐNG & CHẨN ĐOÁN` nếu
  muốn phản ánh đúng mục đích của System Logs.

### Câu hỏi cần chốt trước khi triển khai

- System Logs sẽ ghi những sự kiện nào: khởi động/dừng ghi âm, transcript,
  lỗi engine, quyền microphone, lưu file, import và re-transcript?
- Có cần mở chi tiết hoặc nhảy tới cuộc họp liên quan từ mỗi dòng không?
- Người dùng có được xoá log thủ công không, hay chỉ áp dụng thời hạn lưu tự
  động?
- `Recording` nên gọi là `Ghi âm` trong giao diện tiếng Việt hay giữ tiếng Anh
  để đồng bộ với tên loại log?

### Lưu ý triển khai

- Chưa triển khai hoặc commit thay đổi này.
- Khi bắt đầu sửa mã nguồn, tạo nhánh mới với tiền tố `codex/`.
- Kiểm thử trên bản Dev trước khi cân nhắc merge vào `main`.
