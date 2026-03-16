# Lessons Learned — macOS App Permissions (TCC)

## Vấn đề

App sử dụng `ScreenCaptureKit` (qua crate `screencapturekit`) để thu system audio. Khi chạy ở dev mode (`npm run tauri dev`), macOS **luôn từ chối quyền Screen Recording** dù đã bật trong System Settings.

**Error message:**
```
Failed to get shareable content (Screen Recording permission needed): 
No shareable content available: Content unavailable: 
The user declined TCCs for application, window, display capture
```

## Nguyên nhân gốc

### 1. Dev binary ≠ App bundle

`npm run tauri dev` chạy binary trơn (`target/debug/personal-translator`), **không có**:
- `Info.plist` → macOS không biết app cần quyền gì
- `CFBundleIdentifier` → macOS không thể lưu permission cho app
- Code signature ổn định → mỗi lần build lại, macOS coi là app khác

### 2. macOS TCC yêu cầu

Trên macOS 13+, `SCShareableContent::get()` yêu cầu:
- App phải là `.app` bundle đúng chuẩn
- Có `NSScreenCaptureUsageDescription` trong Info.plist
- Có `NSMicrophoneUsageDescription` (nếu dùng mic)
- Entitlements khai báo `com.apple.security.device.screen-capture`

### 3. `tccutil reset` không đủ

Dù đã reset TCC database và thêm binary vào System Settings thủ công, macOS vẫn từ chối vì binary không có proper bundle identity.

## Giải pháp

### Build `.app` bundle thay vì chạy dev binary

```bash
# Build debug .app bundle
npm run tauri build -- --debug

# Mở app bundle (có Info.plist, entitlements đầy đủ)
open "src-tauri/target/debug/bundle/macos/Personal Translator.app"
```

### Files cần tạo

**`src-tauri/Info.plist`:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
    <key>NSScreenCaptureUsageDescription</key>
    <string>Personal Translator needs screen recording access to capture system audio.</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>Personal Translator needs microphone access for speech translation.</string>
</dict>
</plist>
```

**`src-tauri/Entitlements.plist`:**
```xml
<dict>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.device.screen-capture</key>
    <true/>
</dict>
```

**`src-tauri/tauri.conf.json` (bundle section):**
```json
"macOS": {
    "entitlements": "Entitlements.plist",
    "minimumSystemVersion": "13.0"
}
```

## Bài học từ TranslaBuddy (reverse engineering)

Phân tích `TranslaBuddy_0.2.6_aarch64.dmg` bằng `strings` + `otool` cho thấy:
- TranslaBuddy cũng dùng `screencapturekit` crate (v1.5.1)
- Có đầy đủ `NSScreenCaptureUsageDescription` trong Info.plist
- Là `.app` bundle được sign đúng cách
- Sử dụng `SCContentSharingPicker` (API mới hơn cho phép user chọn nội dung chia sẻ)

## Vấn đề phụ: `libswift_Concurrency.dylib`

Khi chạy binary trực tiếp, gặp thêm lỗi:
```
dyld: Library not loaded: @rpath/libswift_Concurrency.dylib
```

**Nguyên nhân:** `screencapturekit` crate link tới Swift concurrency qua `@rpath`, nhưng trên macOS 15+ library nằm trong dyld shared cache, không phải file riêng.

**Fix:** Thêm rpath trong `build.rs`:
```rust
println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
```

## Checklist cho tương lai

- [ ] Luôn test với `.app` bundle, không chạy binary trơn cho permission-sensitive features
- [ ] Đảm bảo `Info.plist` có `NS*UsageDescription` cho mọi permission cần dùng
- [ ] Đảm bảo `Entitlements.plist` khai báo đúng capabilities
- [ ] Nếu dùng `screencapturekit` crate, cần fix rpath cho Swift concurrency
- [ ] `tccutil reset ScreenCapture` để reset permission nếu bị kẹt
