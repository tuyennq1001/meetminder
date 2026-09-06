# Repository workflow

- Trước khi bắt tay vào bug fix, feature hoặc thay đổi mã nguồn, phải tách một nhánh phụ với tiền tố `codex/`; không sửa trực tiếp trên `main`.
- Sau khi kiểm tra/build/test phù hợp, phải xác nhận với người dùng rằng mọi thứ đã sửa xong và không còn vấn đề cần xử lý.
- Chỉ sau xác nhận đó mới được commit thay đổi và merge nhánh phụ vào `main`.
- Sau khi merge thành công vào `main`, được phép push `main` lên remote.
- Sau mỗi lần sửa code, bắt buộc phải build lại app macOS, thay bản build mới vào `/Applications/Meet Minder.app`, rồi khởi động lại app từ vị trí đó để kiểm tra bản đang chạy.
- Dùng tiền tố `codex/` cho nhánh phụ do Codex tạo, trừ khi người dùng chỉ định tên khác.

## UX conventions

- Khi thiết kế, sửa hoặc review UI/UX, phải đọc và áp dụng
  `docs/ux-playbook.md`, đặc biệt với data table, filter, sort header,
  dialog/popup, keyboard interaction, trạng thái loading/error/empty và việc
  giữ ngữ cảnh người dùng.
- Nếu agent hỗ trợ skill package, có thể nạp trực tiếp
  `skills/meet-minder-ux/SKILL.md`; đây là bản portable để dùng ngoài Codex.
- Nếu một bug fix hoặc pattern lặp lại tạo ra bài học UX mới, cập nhật
  `docs/ux-playbook.md` cùng thay đổi đó để các dự án khác có thể tái sử dụng.
