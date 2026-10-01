# Quy tắc viết code — Meet Minder

Áp dụng cho code mới và phần code được sửa. Giữ nguyên hành vi người dùng trừ khi yêu cầu có nói rõ cần thay đổi.

## Cấu trúc và trách nhiệm

- Một hàm làm một việc có thể mô tả ngắn gọn; một module có một nhóm trách nhiệm rõ ràng.
- Tách giao diện, nghiệp vụ, lưu trữ và kết nối dịch vụ theo ranh giới dễ kiểm thử.
- Module sở hữu trạng thái của mình. Module khác thay đổi trạng thái qua hàm/API được cung cấp.
- Không tạo import vòng, biến toàn cục có thể sửa tùy ý hoặc module `utils` chứa các trách nhiệm không liên quan.
- Ưu tiên ghép các hàm/module nhỏ. Chỉ thêm lớp, abstraction, cấu hình hoặc kế thừa khi giải quyết nhu cầu hiện tại.

## Dễ đọc và thay đổi an toàn

- Chọn giải pháp đơn giản nhất đáp ứng yêu cầu; dùng guard clause để giảm điều kiện lồng nhau.
- Dùng tên mô tả ý định. Tên giá trị thời gian, khoảng cách, dung lượng phải nêu đơn vị, ví dụ `timeoutMs`.
- Tránh cờ boolean khó hiểu ở nơi gọi. Dùng object có tên thuộc tính khi danh sách tham số không tự giải thích được ý nghĩa.
- Tránh lặp logic nghiệp vụ. Chỉ gom chung đoạn code có cùng ý nghĩa và cùng lý do thay đổi.
- Hạn chế sửa dữ liệu đầu vào; nếu hàm làm thay đổi dữ liệu, hợp đồng phải thể hiện rõ.
- Tách tính toán thuần khỏi tác động bên ngoài như DOM, filesystem, audio và network.
- Xóa code chết, import không dùng và đoạn code bị comment. Comment nên giải thích lý do, ràng buộc hoặc workaround.

## Lỗi, dữ liệu và tài nguyên

- Mọi lỗi phải được xử lý hoặc truyền tiếp với đủ ngữ cảnh. Không `catch` rỗng và không báo thành công khi thao tác lưu thất bại.
- Hàm/module cần có đầu vào, đầu ra và lỗi rõ ràng. JavaScript dùng JSDoc cho API module; Rust dùng kiểu dữ liệu và `Result` phù hợp.
- Mọi thao tác bất đồng bộ phải xử lý thành công, lỗi, hủy và kết quả đến muộn. Trước khi cập nhật, xác minh kết quả còn thuộc phiên đang hoạt động.
- Dọn timer, event listener, kết nối và audio stream khi chủ sở hữu kết thúc vòng đời.
- Test dùng API giả lập, dữ liệu mẫu và thư mục tạm; không đọc/ghi settings, cuộc họp hoặc API key thật của người dùng.
- Không đưa credential hoặc nội dung cuộc họp vào log không cần thiết.
- Khi đổi định dạng dữ liệu, phải kiểm tra dữ liệu cũ và hành vi lưu/mở lại.

## Ngưỡng và cách kiểm soát

Ngưỡng ban đầu cho code mới: tối đa 500 dòng vật lý mỗi file, 60 dòng mỗi hàm, độ phức tạp nhánh 10 và ba tầng lồng nhau. File JavaScript mới được quality gate giới hạn 500 dòng; file JavaScript cũ được so với baseline để không tăng độ dài. Ranh giới trách nhiệm, độ dài hàm, độ phức tạp và code Rust hiện do reviewer kiểm soát; chưa được tự động lint hết.

File sinh tự động, vendor, dữ liệu dịch và test cần phạm vi kiểm tra phù hợp. Baseline JavaScript nằm trong `scripts/quality-baseline/js-lines.json`; chỉ cập nhật khi file giảm dòng hoặc khi có lý do được review. Với code cũ vượt ngưỡng, không làm tăng vi phạm và giảm dần theo mỗi lần sửa. Không tắt rule cho toàn dự án và không chia file/hàm tùy tiện chỉ để đạt con số.

Bug fix phải có test tái hiện lỗi. Refactor thuần túy phải giữ test hành vi trước và sau. Test bị bỏ qua cần ghi lý do và cách kiểm tra thay thế. Chạy kiểm tra liên quan và build bản Dev theo `AGENTS.md`; build thành công không thay thế kiểm tra thao tác trên app thật.
