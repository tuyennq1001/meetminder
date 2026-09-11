# Repository workflow

- Trước khi bắt tay vào bug fix, feature hoặc thay đổi mã nguồn, phải tách một nhánh phụ với tiền tố `codex/`; không sửa trực tiếp trên `main`.
- Sau khi kiểm tra/build/test phù hợp, phải xác nhận với người dùng rằng mọi thứ đã sửa xong và không còn vấn đề cần xử lý.
- Chỉ sau xác nhận đó mới được commit thay đổi và merge nhánh phụ vào `main`.
- Sau khi merge thành công vào `main`, được phép push `main` lên remote.
- Sau mỗi lần phát triển hoặc sửa code, luôn tự động build bản Dev bằng `npm run build:dev`, ký bằng identity ổn định, cài đè và mở lại `/Applications/Meet Minder Dev.app` để người dùng test; không chờ người dùng nhắc lại. Chỉ dừng và báo blocker nếu build, ký hoặc cài đặt không thể hoàn tất.
- Không dùng ad-hoc signing cho bản Dev vì có thể làm mất quyền Screen Recording/Microphone; giữ nguyên `/Applications/Meet Minder.app` cho bản Release chính thức dùng khi họp.
- Dùng tiền tố `codex/` cho nhánh phụ do Codex tạo, trừ khi người dùng chỉ định tên khác.

## Release & Auto-Update workflow

Mô hình 2 phiên bản độc lập và luồng phát hành chuẩn của dự án:
- **Bản Dev (`Meet Minder Dev`)**:
  - Dùng để code, debug, thử nghiệm (`npm run dev` hoặc `npm run build:dev`).
  - Bundle ID: `com.meetminder.desktop.dev` (được override từ `.env`).
  - DevTools: Bật (F12). Auto-updater: Tắt.
  - Quyền Screen Recording riêng biệt, không bị mất quyền hay ảnh hưởng bản chính khi rebuild.
- **Bản Release (`Meet Minder`)**:
  - Dùng để họp chính thức hàng ngày, nằm tại `/Applications/Meet Minder.app`.
  - Bundle ID: `com.meetminder.desktop`. DevTools: Tắt. Auto-updater: Bật.

### Quy trình 4 bước khi ra bản Release chính thức:
1. **Phát triển & Kiểm thử:** Toàn bộ code/bug fix phải được kiểm tra chạy ổn định trên bản Dev trước khi merge.
2. **Nâng số Version (Version Bump):** Đồng bộ phiên bản mới ở 3 file:
   - `package.json` (`"version": "X.Y.Z"`)
   - `src-tauri/tauri.conf.json` (`"version": "X.Y.Z"`)
   - `src-tauri/Cargo.toml` (`version = "X.Y.Z"`)
   - Cập nhật ghi chú phát hành trong `docs/project-changelog.md` dưới mục `## vX.Y.Z`.
3. **Commit & Push Git Tag:**
   - Commit thay đổi: `git commit -am "chore: release vX.Y.Z"`
   - Merge vào `main` và push: `git push origin main`
   - Tạo tag và push: `git tag vX.Y.Z && git push origin vX.Y.Z`
   - GitHub Actions (`.github/workflows/release.yml`) sẽ tự động build đa nền tảng (macOS Silicon, macOS Intel, Windows), ký số, tạo gói update và tạo bản Release trên GitHub.
4. **Cơ chế Auto Background Update:**
   - Các máy người dùng (và bản `/Applications/Meet Minder.app`) tự động tải ngầm bản mới khi mở app.
   - Khi tải xong, app hiển thị banner sẵn sàng cài đặt kèm nút `[Khởi động lại]` và `[Để sau]` / `[✕]`.
   - Nếu người dùng đang trong cuộc họp (`Start`), thông báo sẽ hoãn lại cho tới khi kết thúc cuộc họp.
   - Chi tiết hướng dẫn kỹ thuật xem tại `docs/release-guide.md`.

## UX conventions

- Khi thiết kế, sửa hoặc review UI/UX, phải đọc và áp dụng
  `docs/ux-playbook.md`, đặc biệt với data table, filter, sort header,
  dialog/popup, keyboard interaction, trạng thái loading/error/empty và việc
  giữ ngữ cảnh người dùng.
- Nếu agent hỗ trợ skill package, có thể nạp trực tiếp
  `skills/meet-minder-ux/SKILL.md`; đây là bản portable để dùng ngoài Codex.
- Nếu một bug fix hoặc pattern lặp lại tạo ra bài học UX mới, cập nhật
  `docs/ux-playbook.md` cùng thay đổi đó để các dự án khác có thể tái sử dụng.
