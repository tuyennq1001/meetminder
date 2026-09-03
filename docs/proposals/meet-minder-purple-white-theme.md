# Proposal: đổi tông màu Meet Minder sang tím và trắng

**Trạng thái:** Draft — chờ duyệt trước khi triển khai
**Ngày:** 2026-09-03
**Phạm vi:** Visual theme/UI, không bao gồm thay đổi chức năng

## Tóm tắt đề xuất

Đồng bộ màu giao diện Meet Minder với logo bằng cách dùng tím logo làm màu
nhận diện chính và trắng làm màu chữ/biểu tượng trên nền tím. Nền ứng dụng
vẫn giữ tối trung tính; tím được dùng có chủ đích cho CTA, tab đang chọn,
focus ring, control đang hoạt động và các điểm nhấn thương hiệu.

Đây là đề xuất ưu tiên tính nhất quán thương hiệu nhưng vẫn bảo toàn độ đọc
của transcript, notes và meeting minutes. Việc người dùng thực sự cảm nhận
giao diện nhất quán hơn hiện là một giả thuyết cần kiểm chứng [A1].

## Cơ sở hiện tại

- Logo repository dùng tím `#431A46` và trắng `#FFFFFF` làm hai màu chính [S1].
- Design tokens hiện tại vẫn dùng xanh dương làm primary `#A8C7FA` và
  secondary `#C2E7FF`; violet mới chỉ đang là tertiary [S2].
- Giao diện có nhiều vùng cần phân cấp màu: live controls, transcript,
  notes, session library, settings và các trạng thái thành công/cảnh báo/lỗi
  [S3].
- Không có baseline telemetry để đặt KPI định lượng cho một đổi màu giao diện;
  tiêu chí trước mắt là visual QA, khả năng đọc và không hồi quy chức năng [S4].

## Định hướng hình ảnh

### Nguyên tắc

1. Tím là màu thương hiệu và hành động chính, không phủ toàn bộ màn hình.
2. Trắng dành cho chữ/biểu tượng có vai trò cao trên nền tím, bám theo logo.
3. Bề mặt chính giữ tối trung tính để nội dung dài không bị “nhuộm màu”.
4. Error, warning và success vẫn giữ màu ngữ nghĩa riêng; không đổi sang tím.
5. Mọi trạng thái hover, active và focus phải có phân biệt rõ ràng, không chỉ
   dựa vào độ sáng.

### Bảng màu đề xuất

| Vai trò | Token đề xuất | Giá trị ban đầu | Cách dùng |
|--------|---------------|-----------------|-----------|
| Brand purple | `--md-sys-color-primary-container` | `#431A46` — lấy từ logo [S1] | Surface/container thương hiệu, tab active và selected state |
| Accessible purple accent | `--md-sys-color-primary` | Tím sáng hơn — đề xuất để giữ contrast | CTA, chữ accent, focus ring và control tương tác |
| On primary | `--md-sys-color-on-primary` | Tím rất đậm — đề xuất để giữ contrast | Chữ và icon trên accent sáng |
| Primary hover | `--accent-hover` | Tím sáng hơn primary — đề xuất, cần QA | Hover/focus giàu tương phản |
| Primary container | `--md-sys-color-primary-container` | Tím đậm hơn primary — đề xuất, cần QA | Badge, selected surface, trạng thái nhẹ |
| On primary container | `--md-sys-color-on-primary-container` | Trắng tím nhạt — đề xuất, cần QA | Chữ trên primary container |
| Surface | `--md-sys-color-surface*` | Giữ nhóm nền tối trung tính hiện tại [S2] | Canvas, transcript, editor, settings |
| Text | `--md-sys-color-on-surface*` | Giữ trắng/xám hiện tại [S2] | Nội dung chính và phụ |
| Semantic status | `--md-sys-color-success/warning/error` | Giữ nguyên [S2] | Trạng thái hệ thống và cảnh báo |

Các giá trị “đề xuất, cần QA” là điểm xuất phát thiết kế, chưa phải màu đã
được chốt. Khi triển khai sẽ chọn giá trị cụ thể sau khi kiểm tra contrast trên
các bề mặt thực tế.

## Phạm vi triển khai

### Bao gồm

- Cập nhật lớp CSS custom properties trong `src/styles/main.css` để primary,
  secondary/tertiary và các alias legacy cùng theo hệ tím-trắng.
- Chuẩn hóa các màu xanh hard-code đang xuất hiện ở button, active state,
  focus ring, selected state và glow để không còn lệch khỏi token.
- Rà soát các vùng chính: top bar, CTA Start/Stop, tab Live/Logs, notes,
  session viewer, settings và các input/select.
- Giữ nguyên các màu trạng thái thành công, cảnh báo, lỗi và màu nội dung
  transcript/editor trừ khi visual QA phát hiện vấn đề tương phản.

### Không bao gồm

- Không đổi logo, icon, tên sản phẩm hoặc layout.
- Không thay đổi logic dịch, audio, lưu session, settings hay shortcut.
- Không thêm light theme hoặc hệ thống tùy chỉnh màu theo người dùng.
- Không đặt KPI sản phẩm mới khi chưa có baseline [S4].

## Kế hoạch thực hiện sau khi được duyệt

1. Cập nhật token màu ở một nơi làm nguồn chuẩn.
2. Thay các màu accent hard-code bằng token hoặc biến opacity tương ứng.
3. Kiểm tra trực quan các trạng thái idle, hover, active, focus, disabled,
   translating và error trên các view chính.
4. Kiểm tra contrast của text/icon và rà soát để không còn màu xanh dương
   thương hiệu sót lại.
5. Build app macOS và kiểm tra bản app chạy thực tế theo workflow của repo.

## Tiêu chí nghiệm thu

- Giao diện nhận diện được là hệ tím-trắng ngay từ top bar và CTA chính.
- Các control primary, tab active, focus ring và selected state dùng cùng một
  logic token, không bị pha trộn xanh dương/violet ngoài chủ ý.
- Chữ và icon trắng vẫn dễ đọc trên các bề mặt tím và nền tối.
- Transcript, notes, meeting minutes và settings không bị giảm khả năng đọc.
- Error, warning và success vẫn được phân biệt bằng màu ngữ nghĩa riêng.
- Không thay đổi hành vi hoặc dữ liệu của app.
- Visual QA không phát hiện màu xanh dương cũ trong các điểm nhấn tương tác.

## Rủi ro và cách giảm thiểu

| Rủi ro | Mức độ | Giảm thiểu |
|-------|--------|------------|
| Dùng tím quá nhiều làm mất phân cấp | Trung bình | Chỉ dùng tím cho điểm nhấn; giữ surface và text trung tính [A2] |
| Tím đậm làm giảm contrast | Cao | Dùng trắng trên primary, kiểm tra từng cặp foreground/background trước khi chốt |
| Mất ý nghĩa màu trạng thái | Trung bình | Giữ nguyên success/warning/error; chỉ thay màu thương hiệu |
| Còn sót màu xanh hard-code | Trung bình | Rà soát toàn bộ CSS sau khi thay token và kiểm tra các inline style liên quan |

## Quyết định cần xác nhận

Phê duyệt hướng “tím logo làm primary + trắng làm foreground + nền tối trung
tính”. Sau khi được duyệt, proposal này có thể chuyển thành thay đổi mã nguồn
trên một nhánh `codex/` riêng; chưa có mã nguồn nào được thay đổi trong bước
proposal này.
