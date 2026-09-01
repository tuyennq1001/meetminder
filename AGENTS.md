# Repository workflow

- Trước khi bắt tay vào bug fix, feature hoặc thay đổi mã nguồn, phải tách một nhánh phụ với tiền tố `codex/`; không sửa trực tiếp trên `main`.
- Sau khi kiểm tra/build/test phù hợp, phải xác nhận với người dùng rằng mọi thứ đã sửa xong và không còn vấn đề cần xử lý.
- Chỉ sau xác nhận đó mới được commit thay đổi và merge nhánh phụ vào `main`.
- Sau khi merge thành công vào `main`, được phép push `main` lên remote.
- Mỗi lần build app macOS, phải thay bản build mới vào `/Applications/Meet Minder.app` và khởi động app từ vị trí đó để kiểm tra bản đang chạy.
- Dùng tiền tố `codex/` cho nhánh phụ do Codex tạo, trừ khi người dùng chỉ định tên khác.
