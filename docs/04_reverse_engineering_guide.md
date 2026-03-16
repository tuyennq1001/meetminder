# Reverse Engineering Binary — Hướng dẫn & Phòng chống

> Giải thích đơn giản cách dịch ngược logic từ file binary, và cách bảo vệ code

---

## 1. Từ DMG → Logic: Quy trình thực tế

```
TranslaBuddy_0.2.6_aarch64.dmg
  → mount → TranslaBuddy.app/Contents/MacOS/translabuddy  ← binary chính
```

### 4 công cụ duy nhất đã dùng

| # | Lệnh | Tìm được gì | Ví dụ kết quả |
|---|-------|-------------|---------------|
| 1 | `file <binary>` | Loại file, platform | `Mach-O 64-bit arm64` |
| 2 | `otool -L <binary>` | Danh sách thư viện phụ thuộc | `ScreenCaptureKit`, `WebKit` |
| 3 | `strings <binary>` | **Mọi text** nằm trong binary | URLs, API keys, error messages |
| 4 | `grep` | Lọc text theo từ khóa | Tìm "api", "auth", "wss://" |

### Tại sao `strings` hiệu quả?

Khi dev viết code:
```rust
let url = "wss://stt-rt.soniox.com/transcribe-websocket";
println!("[auth] Failed to decode JWT token");
```

Sau compile → code thành mã máy, **nhưng text vẫn nằm nguyên** trong binary vì máy cần text gốc để hiển thị / gửi mạng.

```bash
strings translabuddy | grep "wss://"
# → wss://stt-rt.soniox.com/transcribe-websocket   ← lộ endpoint
# → wss://translabuddy.com                          ← lộ backend
```

### Những gì lộ qua `strings`

```bash
# URLs & API endpoints
strings binary | grep -iE "https?://|wss://"

# Auth logic (từ error messages)
strings binary | grep -i "auth\|token\|login\|api_key"

# Settings keys
strings binary | grep -i "settings\|config\|mode"

# Dependencies + versions
strings binary | grep -iE "tauri|sentry|soniox|crate"

# Developer info (build paths)
strings binary | grep "/Users/"

# Content Security Policy
strings binary | grep "connect-src"
```

### Giới hạn — Không thấy được

| Thấy ✅ | Không thấy ❌ |
|---------|-------------|
| URLs, endpoints | Logic if/else, thuật toán |
| Error messages | Tên biến, tên hàm gốc |
| Tên thư viện | Mã nguồn |
| Settings keys | Server-side code |

> Không cần decompiler. Chỉ `strings` + suy luận là đủ hiểu **app kết nối đi đâu, dùng gì, và ai kiểm soát gì**.

---

## 2. Phòng chống: Làm sao giấu code triệt để?

### Level 1: Cơ bản (dễ làm, chặn được `strings`)

| Kỹ thuật | Mô tả | Chặn được |
|----------|--------|-----------|
| **String obfuscation** | Mã hóa tất cả string literals, decrypt runtime | `strings` không thấy text |
| **Strip symbols** | `strip -x binary` — xóa debug symbols | Không lộ function names |
| **Release build** | Compile với `--release`, bật LTO | Xóa debug info, tối ưu code |

```rust
// ❌ Lộ:
let url = "wss://stt-rt.soniox.com";

// ✅ Giấu: encode compile-time, decode runtime
let url = decode(b"\x77\x73\x73\x3a\x2f\x2f\x73\x74\x74...");
// hoặc dùng macro obfuscation
let url = obfstr::obfstr!("wss://stt-rt.soniox.com");
```

### Level 2: Trung bình (cần effort, chặn được RE cơ bản)

| Kỹ thuật | Mô tả |
|----------|--------|
| **Code obfuscation** | Xáo trộn control flow, thêm dead code, rename symbols |
| **Anti-debugging** | Detect debugger (ptrace, sysctl), tự kill nếu bị debug |
| **Integrity check** | Binary tự hash chính nó, crash nếu bị patch |
| **Encrypt configs** | API endpoints, keys lưu encrypted, key nằm ở server |

```rust
// Anti-debug check
unsafe {
    let mut info: libc::kinfo_proc = std::mem::zeroed();
    // ... check P_TRACED flag
    if is_debugged { std::process::exit(1); }
}
```

### Level 3: Nâng cao (phức tạp, chặn hầu hết RE)

| Kỹ thuật | Mô tả |
|----------|--------|
| **Server-side logic** | Chuyển logic nhạy cảm lên server — client chỉ là UI |
| **Code signing + notarization** | Apple notarize → detect tampered binary |
| **Runtime key exchange** | Endpoint URLs nhận từ server sau auth, không hardcode |
| **Certificate pinning** | Chỉ accept cert cụ thể → chặn MITM/proxy sniffing |
| **Obfuscation tools** | `obfuscator-llvm`, Rust `goldberg` crate |

```
// Thay vì hardcode URL:
❌  let url = "wss://stt-rt.soniox.com";

// Nhận URL từ server sau khi auth:
✅  let config = fetch("https://myserver.com/config", auth_token);
    let url = config.stt_endpoint;  // URL không bao giờ nằm trong binary
```

### Level 4: "Tối đa" (cho enterprise/security-critical)

| Kỹ thuật | Mô tả |
|----------|--------|
| **White-box cryptography** | Key mã hóa được nhúng vào thuật toán, không tách rời được |
| **Homomorphic encryption** | Xử lý data mã hóa mà không cần decrypt |
| **Hardware-backed security** | Dùng Secure Enclave (Apple) để lưu keys |
| **Virtual machine protection** | Code chạy trong custom VM bytecode |

---

## 3. TranslaBuddy đã bảo vệ ở mức nào?

| Kỹ thuật | TranslaBuddy dùng? |
|----------|:---:|
| String obfuscation | ❌ Không — mọi URL/message đọc được bằng `strings` |
| Strip symbols | ⚠️ Một phần — vẫn còn build paths |
| Release build | ✅ Có |
| Anti-debugging | ❌ Không |
| Server-side logic | ⚠️ Một phần — auth ở server, nhưng URLs hardcode |
| Certificate pinning | ❌ Không |
| Code signing | ❌ Không (macOS cảnh báo "unidentified developer") |

→ **Mức bảo vệ: Rất thấp**. Chỉ cần `strings` là lộ gần hết kiến trúc.

---

## 4. Tóm tắt

```
Muốn RE app?           Muốn chống RE?
─────────────           ──────────────
strings + grep          String obfuscation
otool -L                Strip debug symbols
Info.plist              Server-side logic
Suy luận                Runtime key exchange
                        Anti-debug + integrity check
```

> **Sự thật**: Không có cách nào chống RE 100%. Client-side code **luôn** có thể bị dịch ngược nếu đủ kiên nhẫn. Giải pháp tốt nhất là **đừng để logic nhạy cảm ở client** — chuyển hết lên server.
