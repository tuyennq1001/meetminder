# Lessons Learned — Dev Build & macOS Permissions Workflow

## Vấn đề

Mỗi lần `npm run tauri build -- --debug`, binary thay đổi → macOS **xóa** TCC permission đã cấp → phải cấp lại Screen Recording + Microphone. Rất tốn thời gian khi develop.

## Nguyên nhân

macOS lưu TCC permissions theo **code signature** của binary. Binary unsigned (ad-hoc signed) thay đổi signature mỗi lần compile → macOS coi là app mới → reset permissions.

## Workflow tối ưu: Tách "sửa code" và "cấp quyền"

### Nguyên tắc vàng

> **Build 1 lần → Cấp quyền 1 lần → Test nhiều lần**
>
> Chỉ rebuild khi THẬT SỰ cần (thay đổi Rust code). Nếu chỉ sửa JS/CSS/HTML → tìm cách hot-reload.

### Flow phát triển tính năng mới

```
┌─────────────────────────────────────────────┐
│ 1. SỬA CODE (JS/CSS/HTML + Rust)            │
│    - Sửa hết tất cả trước khi build        │
│    - Test logic bằng console.log trước      │
│    - Đảm bảo không cần sửa thêm            │
├─────────────────────────────────────────────┤
│ 2. BUILD 1 LẦN DUY NHẤT                    │
│    npm run tauri build -- --debug           │
├─────────────────────────────────────────────┤
│ 3. RESET & CẤP QUYỀN                       │
│    tccutil reset ScreenCapture              │
│    tccutil reset Microphone                 │
│    open ".../Personal Translator.app"       │
│    → Bấm ▶ → Allow permissions             │
│    → ⌘Q thoát app                          │
├─────────────────────────────────────────────┤
│ 4. TEST (mở lại KHÔNG rebuild)              │
│    open ".../Personal Translator.app"       │
│    → Test thoải mái, quyền đã được lưu     │
│    → ⌘Q rồi mở lại bao nhiêu lần cũng OK  │
├─────────────────────────────────────────────┤
│ 5. CHỈ QUAY LẠI BƯỚC 1 KHI CẦN SỬA CODE   │
│    (phải rebuild → lặp lại từ bước 2)       │
└─────────────────────────────────────────────┘
```

### Phân loại thay đổi

| Loại thay đổi | Cần rebuild? | Mất quyền? |
|----------------|:---:|:---:|
| Sửa Rust code | ✅ Có | ✅ Có |
| Sửa JS / CSS / HTML | ✅ Có (embedded) | ✅ Có |
| Thay đổi tauri.conf.json | ✅ Có | ✅ Có |
| Thay đổi settings (runtime) | ❌ Không | ❌ Không |
| Test lại app (không sửa code) | ❌ Không | ❌ Không |

### Mẹo giảm số lần rebuild

1. **Gộp nhiều fix vào 1 lần build**: Sửa hết rồi build 1 phát, đừng fix 1 bug → build → fix 1 bug → build
2. **Test logic JS bằng browser dev tools trước**: Right-click → Inspect → Console để test JS snippet
3. **Dùng `console.log` thay vì suy đoán**: Thêm log đầy đủ trước khi build để 1 lần test thấy hết vấn đề
4. **Dùng `npm run tauri dev` cho thay đổi không cần permission**: UI-only changes có thể test bằng dev mode (hot reload) rồi mới build .app bundle cuối

### Commands hay dùng

```bash
# Build .app bundle (debug)
npm run tauri build -- --debug

# Reset permissions
tccutil reset ScreenCapture
tccutil reset Microphone

# Mở app (KHÔNG rebuild)
open "src-tauri/target/debug/bundle/macos/Personal Translator.app"

# Full rebuild + reset + open (khi cần build mới)
npm run tauri build -- --debug && \
tccutil reset ScreenCapture && \
tccutil reset Microphone && \
open "src-tauri/target/debug/bundle/macos/Personal Translator.app"
```

## Giải pháp triệt để (tương lai)

| Giải pháp | Effort | Hiệu quả |
|-----------|:---:|:---:|
| **Apple Developer Certificate** | Đăng ký $99/năm | Signature ổn định, không mất quyền |
| **External frontend** | Sửa Tauri config | Sửa JS không cần rebuild binary |
| **Dev mode + separate permission binary** | Config riêng | Tách dev vs permission testing |

## Key Insight

> Frontend Tauri **embedded trong binary** → mọi thay đổi JS/CSS đều cần rebuild → binary mới → mất quyền.
>
> Nếu có Apple Developer Certificate ($99/năm), signature sẽ ổn định qua các lần build, không cần cấp lại quyền.
