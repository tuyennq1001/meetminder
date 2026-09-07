# Hướng Dẫn Phát Hành & Cập Nhật Tự Động (Release & Auto-Update Guide)

Tài liệu này mô tả chi tiết quy trình phát triển, đóng gói và phân phối bản cập nhật tự động của ứng dụng **Meet Minder**. Mọi nhà phát triển và AI Agent cần tuân thủ quy trình này để đảm bảo tính ổn định của ứng dụng và quyền hệ thống trên máy người dùng.

---

## 1. Mô hình hai phiên bản (Dev vs Release)

Để đảm bảo vừa có thể lập trình, debug liên tục vừa có bản ứng dụng ổn định để họp thực tế hàng ngày, Meet Minder sử dụng mô hình 2 ứng dụng độc lập trên cùng một máy macOS:

| Thuộc tính | 🛠️ Bản Dev (`Meet Minder Dev`) | 🚀 Bản Release (`Meet Minder`) |
| :--- | :--- | :--- |
| **Mục đích** | Phát triển, sửa lỗi, thử nghiệm tính năng mới | Sử dụng họp chính thức với đối tác, khách hàng |
| **Vị trí cài đặt** | Chạy mã nguồn (`npm run dev`) hoặc `/Applications/Meet Minder Dev.app` | `/Applications/Meet Minder.app` |
| **Bundle Identifier** | `com.meetminder.desktop.dev` | `com.meetminder.desktop` |
| **Quyền macOS (TCC)** | Quyền Screen & Microphone độc lập, không mất quyền khi rebuild | Quyền Screen & Microphone cố định cho bản chính thức |
| **DevTools (F12)** | **Bật** (soi console log, network, audio streams) | **Tắt** (giao diện tối ưu, bảo mật) |
| **Auto-Updater** | **Tắt** (không cập nhật đè lên source code) | **Bật** (tự động nhận update qua GitHub Releases) |

### Cấu hình máy Local Dev (`.env`):
File `.env` ở thư mục gốc (đã được `.gitignore`) chứa các biến override dành riêng cho bản Dev:
```bash
APP_IDENTIFIER=com.meetminder.desktop.dev
APP_SIGNING_IDENTITY=Apple Development: tuyennq1001@gmail.com (DGWT97FSZ4)
```
Script `scripts/tauri-with-env.mjs` sẽ tự động đọc cấu hình này khi chạy `npm run dev` hoặc `npm run build:dev`.

---

## 2. Quy trình 4 bước phát hành phiên bản mới (Release Flow)

### Bước 1: Phát triển & Kiểm thử trên Bản Dev
- Tạo nhánh phụ bắt đầu bằng tiền tố `codex/` (hoặc tên chỉ định).
- Khởi chạy bản Dev:
  ```bash
  npm run dev
  ```
- Kiểm tra tính năng mới, kiểm tra lỗi trên Console DevTools (F12).

### Bước 2: Nâng số Version (Version Bump)
Khi tính năng đã hoàn thiện và sẵn sàng phát hành chính thức, đồng bộ version mới (ví dụ `0.9.2`) tại **3 file**:
1. `package.json`:
   ```json
   "version": "0.9.2"
   ```
2. `src-tauri/tauri.conf.json`:
   ```json
   "version": "0.9.2"
   ```
3. `src-tauri/Cargo.toml`:
   ```toml
   version = "0.9.2"
   ```
4. Thêm tóm tắt các điểm mới vào `docs/project-changelog.md` dưới mục `## v0.9.2`.

### Bước 3: Đưa lên GitHub & Kích hoạt GitHub Actions
Chạy các lệnh Git để commit, merge vào `main` và gắn tag:
```bash
# 1. Commit và merge vào main
git commit -am "chore: release v0.9.2"
git checkout main
git merge codex/<nhanh-lam-viec>
git push origin main

# 2. Tạo Git Tag và push để trigger CI Release
git tag v0.9.2
git push origin v0.9.2
```

**Hoạt động tự động của GitHub Actions (`.github/workflows/release.yml`):**
- Tự động build ứng dụng cho 3 kiến trúc:
  - macOS Apple Silicon (arm64 / M1/M2/M3/M4)
  - macOS Intel (x86_64)
  - Windows (x86_64)
- Tự động ký chữ ký số Tauri (`TAURI_SIGNING_PRIVATE_KEY`).
- Dùng thêm `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` nếu private key được tạo có mật khẩu; để trống secret này nếu key không có mật khẩu.
- Workflow bật updater artifacts qua `src-tauri/tauri.release.conf.json`, nên build Dev vẫn giữ `createUpdaterArtifacts: false` và không cần signing key updater.
- Tự động tạo các gói update nén `.app.tar.gz`, chữ ký `.sig` và file định tuyến `latest.json`.
- Tự động trích xuất release notes từ `docs/project-changelog.md`.
- Tạo một bản Release (Draft) trên GitHub.

**Xuất bản Release:**
- Vào `https://github.com/tuyennq1001/meetminder/releases`.
- Kiểm tra các file đính kèm và nhấn **"Publish release"**.

### Bước 4: Trải nghiệm cập nhật tự động (Auto-Update) trên máy người dùng
Khi bản Release được Publish trên GitHub:
1. **Kiểm tra tự động:** Mỗi khi người dùng mở `Meet Minder.app` (sau 3s khởi động), app tự fetch:
   `https://github.com/tuyennq1001/meetminder/releases/latest/download/latest.json`
2. **Tải ngầm (Silent Background Download):** Nếu thấy version mới hơn, app tự động tải ngầm file update và giải nén đè vào thư mục app mà không gây lag hay hiện popup cản trở công việc.
3. **Banner thông báo sẵn sàng (Update Ready Banner):**
   - Khi tải xong, banner xuất hiện ở góc dưới màn hình.
   - Nút **[Khởi động lại]**: Relaunch app ngay để áp dụng phiên bản mới.
   - Nút **[Để sau]** / **[✕]** / phím **`Escape`**: Đóng thông báo. Lần tới mở lại app sẽ tự động là phiên bản mới.
   - Trạng thái dismiss được lưu vào `sessionStorage` để không spam trong cùng một phiên.
4. **Bảo vệ cuộc họp:** Nếu người dùng đang họp (`Start`), thông báo sẽ tạm hoãn và chỉ xuất hiện sau khi kết thúc phiên họp.

---

## 3. Quản lý Chữ ký số (Code Signing) & Quyền Screen Recording

- **Bảo toàn quyền Screen Recording qua các lần update:**
  macOS TCC ghi nhớ quyền dựa trên Bundle ID và Identity của chứng chỉ ký số. Khi mọi bản release đều dùng **cùng một Certificate ổn định**, người dùng **không bao giờ phải cấp lại quyền** sau mỗi lần update.
- **Đối với máy người dùng mới (Cài lần đầu):**
  - Tải file `.dmg` từ GitHub Releases ➔ Kéo vào `/Applications`.
  - Mở Terminal chạy lệnh: `xattr -cr "/Applications/Meet Minder.app"` (chỉ cần làm 1 lần duy nhất để vượt Gatekeeper).
  - Cấp quyền Screen Recording trong System Settings.
  - Các lần update tiếp theo app sẽ tự update qua in-app updater mà không bị hỏi lại quyền.
