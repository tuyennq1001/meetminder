# TranslaBuddy — Cơ chế hoạt động bên trong

> **Phân tích từ**: static analysis trên binary `TranslaBuddy_0.2.6_aarch64.dmg`  
> **Ngày**: 2026-03-10  
> **Phương pháp**: `strings`, `otool`, `file` — không decompile

---

## Mục lục

1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Cơ chế capture audio](#2-cơ-chế-capture-audio)
3. [Cơ chế Speech-to-Text (STT)](#3-cơ-chế-speech-to-text-stt)
4. [Cơ chế Translation](#4-cơ-chế-translation)
5. [Cơ chế Authentication](#5-cơ-chế-authentication)
6. [Cơ chế Virtual API Key](#6-cơ-chế-virtual-api-key)
7. [Cơ chế Auto-Update](#7-cơ-chế-auto-update)
8. [Cơ chế Settings & Context](#8-cơ-chế-settings--context)
9. [Cơ chế Deep Link](#9-cơ-chế-deep-link)
10. [Cơ chế Error Tracking](#10-cơ-chế-error-tracking)
11. [Data Flow tổng thể](#11-data-flow-tổng-thể)

---

## 1. Tổng quan kiến trúc

TranslaBuddy được xây dựng trên **Tauri 2.10.3** — framework cho phép viết desktop app bằng:
- **Backend**: Rust (xử lý logic nặng, system API, network)
- **Frontend**: HTML/CSS/JS chạy trong WebView (WKWebView trên macOS)

### Cấu trúc source code (reconstruct từ debug symbols)

```
translabuddy_lib/
├── src/
│   ├── lib.rs                    # Entry point, khởi tạo Tauri app
│   ├── system_audio.rs           # Capture system audio (ScreenCaptureKit)
│   ├── auth_store.rs             # Đọc/ghi auth.json
│   ├── settings_store.rs         # Đọc/ghi settings.json
│   ├── deep_link.rs              # Xử lý URL scheme translabuddy://
│   └── commands/
│       ├── auth.rs               # Tauri commands: login_poll
│       ├── audio.rs              # Tauri commands: audio capture control
│       ├── demo.rs               # Tauri commands: change_demo_mode
│       ├── update_checker.rs     # Tauri commands: check_for_update
│       └── window.rs             # Tauri commands: set_ignore_mouse, etc.
```

### Giao tiếp Frontend ↔ Backend

Frontend gọi backend qua **Tauri IPC** (Inter-Process Communication):

```javascript
// Frontend gọi backend command
window.__TAURI_INTERNALS__.invoke('login_poll', { session: '...' })

// Backend emit event cho frontend
app.emit('auth-state-changed', payload)
```

Cơ chế này được bảo vệ bởi `__TAURI_INVOKE_KEY__` — mỗi session có key riêng để ngăn frontend giả mạo.

---

## 2. Cơ chế capture audio

### Vấn đề cần giải quyết
App cần bắt audio từ 2 nguồn:
- **Microphone**: giọng nói của user
- **System audio**: âm thanh từ Zoom, Google Meet, YouTube... (người đối diện đang nói)

### Giải pháp kỹ thuật

| Component | Detail |
|-----------|--------|
| macOS API | `ScreenCaptureKit.framework` |
| Rust binding | crate `screencapturekit 1.5.1` |
| Permission | Yêu cầu "Screen Recording" permission |
| Module | `translabuddy_lib::system_audio` |

**Tại sao cần Screen Recording permission để bắt audio?**

Trên macOS, không có API public nào cho phép bắt system audio trực tiếp. `ScreenCaptureKit` (ra mắt từ macOS 12.3) là API chính thức duy nhất, nhưng nó thiết kế cho screen recording. Để bắt chỉ audio, app vẫn phải xin quyền Screen Recording.

### Flow hoạt động

```
1. User bật System Audio capture trong app
2. App kiểm tra permission:
   → Chưa có: mở System Preferences > Privacy > Screen Recording
     (qua deep link: x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture)
   → Đã có: tiếp tục

3. App khởi tạo ScreenCaptureKit stream (chỉ audio, không video)
4. Audio data (PCM) được buffer và stream qua WebSocket đến Soniox
```

### Microphone permission

```
# App kiểm tra quyền mic qua AppleScript:
osascript -e 'use framework "AVFoundation"
return (current application's AVCaptureDevice's 
  authorizationStatusForMediaType:(current application's AVMediaTypeAudio)) as integer'

# Nếu chưa có quyền, mở:
# x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone
```

---

## 3. Cơ chế Speech-to-Text (STT)

### Provider: Soniox

TranslaBuddy sử dụng **Soniox** — một 3rd-party Speech AI platform, KHÔNG tự build STT engine.

| Thuộc tính | Giá trị |
|-----------|---------|
| Provider | [Soniox](https://soniox.com) |
| WebSocket endpoint | `wss://stt-rt.soniox.com/transcribe-websocket` |
| Model | `stt-rt-v4` (real-time, low latency) |
| Chi phí | ~$0.12/giờ (AI provider trả, không phải user) |
| Hỗ trợ | 60+ ngôn ngữ, mixed-language, speaker diarization |

### Protocol chi tiết

**Bước 1: Mở WebSocket connection**

```
ws = new WebSocket("wss://stt-rt.soniox.com/transcribe-websocket")
```

**Bước 2: Gửi config message (JSON)**

```json
{
  "api_key": "<SONIOX_API_KEY hoặc VIRTUAL_API_KEY>",
  "model": "stt-rt-preview",
  "audio_format": "auto",
  "language_hints": ["en", "ja"],
  "context": {
    "general": [
      {"key": "domain", "value": "Meeting"}
    ],
    "terms": ["specific terminology"],
    "translation_terms": [
      {"source": "hello", "target": "xin chào"}
    ]
  },
  "enable_speaker_diarization": true,
  "enable_language_identification": true,
  "translation": {
    "type": "one_way",
    "target_language": "vi"
  }
}
```

**Bước 3: Stream audio (binary frames)**

```
→ Gửi PCM audio data liên tục qua binary WebSocket frames
→ Tối đa 300 phút/session
```

**Bước 4: Nhận kết quả (JSON, liên tục)**

```json
{
  "tokens": [
    {
      "text": "Hello",
      "start_ms": 600,
      "end_ms": 760,
      "confidence": 0.97,
      "is_final": true,
      "speaker": "1"
    }
  ],
  "final_audio_proc_ms": 760,
  "total_audio_proc_ms": 880
}
```

Mỗi response chứa **tokens** — các đoạn text nhỏ kèm:
- `is_final`: `true` = text đã xác nhận, `false` = provisional (có thể thay đổi)
- `confidence`: độ tin cậy (0–1)
- `speaker`: ID của speaker (nếu bật diarization)
- `start_ms`, `end_ms`: thời gian trong audio stream

**Bước 5: Kết thúc**

```
→ Gửi empty WebSocket frame
← Nhận finished response
← Connection đóng
```

### Điểm đặc biệt

Soniox hỗ trợ **transcription + translation cùng lúc** trong 1 WebSocket session. Nghĩa là:
- Không cần gọi STT xong rồi mới gọi translation riêng
- Latency cực thấp vì chỉ cần 1 connection
- Đây là lý do TranslaBuddy claim "dưới 300ms latency"

---

## 4. Cơ chế Translation

### Translation KHÔNG phải ở TranslaBuddy backend

Từ phân tích CSP và API calls, translation được xử lý bởi **Soniox**, không phải backend `translabuddy.com`.

Soniox hỗ trợ 2 chế độ dịch:

| Chế độ | Mô tả | Ví dụ |
|--------|--------|-------|
| `one_way` | Dịch 1 chiều: nguồn → đích | Nhật → Việt |
| `two_way` | Dịch 2 chiều: language_a ↔ language_b | Nhật ↔ Việt (tự nhận diện) |

Config trong WebSocket:
```json
// One-way: mọi audio → dịch sang tiếng Việt
{"translation": {"type": "one_way", "target_language": "vi"}}

// Two-way: tự detect Nhật↔Anh, dịch sang ngôn ngữ kia
{"translation": {"type": "two_way", "language_a": "en", "language_b": "ja"}}
```

### Vai trò của `translabuddy.com` WebSocket

`wss://translabuddy.com` có thể đóng vai trò **proxy/relay**:

```
Client → wss://translabuddy.com → wss://stt-rt.soniox.com
                                   (dùng API key thật của tác giả)
```

Hoặc có thể là kênh riêng cho các tính năng khác (session sync, analytics...).

---

## 5. Cơ chế Authentication

### Flow: Browser-based login polling

TranslaBuddy dùng pattern "Electron Auth" — giống cách Spotify desktop, Discord login:

```
┌──────────┐                    ┌──────────┐                    ┌──────────┐
│   App    │                    │ Browser  │                    │  Server  │
└────┬─────┘                    └────┬─────┘                    └────┬─────┘
     │ 1. Tạo session_id             │                               │
     │──────────────────────────────────────────────────────────────►│
     │  GET /api/auth/electron?session=abc123                        │
     │                                │                               │
     │ 2. Mở browser ────────────────►│                               │
     │                                │ 3. User đăng nhập             │
     │                                │──────────────────────────────►│
     │                                │                               │
     │ 4. Poll (lặp lại, tối đa 5 phút)                             │
     │──────────────────────────────────────────────────────────────►│
     │  GET /api/auth/electron/poll?session=abc123                   │
     │                                │                               │
     │◄──────────────────────────────────────────────────────────────│
     │  Response:                                                     │
     │  {                                                             │
     │    "status": "ok",                                             │
     │    "token": "<JWT>",                                           │
     │    "virtual_api_key": "<key>"                                  │
     │  }                                                             │
     │                                │                               │
     │ 5. Decode JWT                  │                               │
     │ 6. Lưu vào auth.json          │                               │
     │ 7. Emit "auth-state-changed"   │                               │
```

### Dữ liệu lưu trữ (`auth.json`)

```json
{
  "token": "<JWT token>",
  "user_id": "...",
  "email": "user@example.com",
  "avatar_url": "https://...",
  "virtual_api_key": "<proxy key>",
  "isLoggedIn": true
}
```

File này lưu **plaintext** trong app data directory:
```
~/Library/Application Support/com.translabuddy.desktop/auth.json
```

---

## 6. Cơ chế Virtual API Key

Đây là cơ chế quan trọng nhất — nó giải thích tại sao user **không cần API key** mà vẫn dùng được.

### Concept

```
┌─────────────┐    virtual_api_key     ┌──────────────────┐    real_soniox_key    ┌────────┐
│    Client    │ ─────────────────────► │ TranslaBuddy     │ ──────────────────►   │ Soniox │
│ (Desktop app)│                        │ Backend Proxy    │                       │  API   │
└─────────────┘                        └──────────────────┘                       └────────┘
```

### Cách hoạt động

1. User đăng nhập → nhận `virtual_api_key` từ backend
2. Khi cần transcribe/translate, client kết nối qua `wss://translabuddy.com`
3. Backend nhận request, verify `virtual_api_key`, rồi proxy đến Soniox với API key thật
4. Kết quả từ Soniox được relay ngược về client

### Tại sao dùng virtual key?

| Lý do | Giải thích |
|-------|-----------|
| **Bảo mật** | API key thật của Soniox không bao giờ rời khỏi server |
| **Kiểm soát** | Backend có thể revoke virtual key bất cứ lúc nào |
| **Theo dõi** | Backend biết ai dùng bao nhiêu, dùng làm gì |
| **Giới hạn** | Có thể áp rate limit, quota per user |
| **Free tier** | User không cần tự mua Soniox API key |

### Evidence từ binary

```
"Missing token/virtual_api_key in response"
"[auth] Poll status=ok but missing token/virtual_api_key"
```

---

## 7. Cơ chế Auto-Update

### Firebase Remote Config

App không tự check server riêng cho update — dùng **Firebase Remote Config** như một "control panel" từ xa:

```
App → GET https://firebaseremoteconfig.googleapis.com/v1/projects/<id>/namespaces/firebase:fetch?key=<api_key>

Response:
{
  "entries": {
    "minimum_version": "0.2.6",
    "download_url": "https://github.com/TRANSLABUDDY/release/releases/..."
  }
}
```

### Logic xử lý

```rust
// Pseudocode reconstruct từ strings
fn check_for_update() {
    let remote_config = fetch_firebase_remote_config();
    let minimum_version = remote_config.entries.get("minimum_version");
    
    if current_version < minimum_version {
        emit("updateRequired", {
            currentVersion: "0.2.6",
            minimumVersion: minimum_version,
            downloadUrl: remote_config.entries.get("download_url"),
            os_version: get_os_version()
        });
    }
}
```

### Download source

Bản cài đặt được host trên GitHub:
- Windows: `github.com/TRANSLABUDDY/release/releases/download/v0.2.6/TranslaBuddy_0.2.6_x64-setup.exe`
- macOS: `github.com/TRANSLABUDDY/release/releases/download/v0.2.6/TranslaBuddy_0.2.6_aarch64.dmg`

---

## 8. Cơ chế Settings & Context

### Settings file (`settings.json`)

Lưu tại: `~/Library/Application Support/com.translabuddy.desktop/settings.json`

```json
{
  "activeContextId": "meeting",
  "useDemoMode": false,
  "sonioxApiKey": "",
  "sourceLanguage": "ja",
  "targetLanguage": "vi",
  "audioSource": "system",
  "panelOpacity": 0.8,
  "customContexts": [...],
  "uiLanguage": "vi",
  "transcriptColor": "#ffffff",
  "showCharacter": true
}
```

### Custom Context

TranslaBuddy cho phép user tạo **context** riêng cho từng use case. Context được gửi kèm trong Soniox API để cải thiện độ chính xác:

```json
// Ví dụ context cho cuộc họp
{
  "general": [
    {"key": "domain", "value": "Business Meeting"},
    {"key": "topic", "value": "Sprint Planning"}
  ],
  "terms": ["sprint", "backlog", "deployment"],
  "translation_terms": [
    {"source": "PR", "target": "Pull Request"}
  ]
}
```

### Tauri Commands cho Settings

| Command | Chức năng |
|---------|-----------|
| `save_settings` | Lưu toàn bộ settings |
| `change_context` | Đổi context đang active |
| `save_custom_context` | Thêm/sửa custom context |
| `delete_custom_context` | Xóa custom context |
| `change_api_key` | Đổi Soniox API key (nếu user tự có) |
| `change_demo_mode` | Bật/tắt demo mode |

---

## 9. Cơ chế Deep Link

App đăng ký URL scheme `translabuddy://` để xử lý deep links:

| URL | Mục đích |
|-----|---------|
| `translabuddy://...` | Mở app từ browser/link bên ngoài |
| `deep-link://new-url` | Xử lý navigation nội bộ |

Dùng Tauri plugin: `tauri-plugin-deep-link 2.4.7`

---

## 10. Cơ chế Error Tracking

### Sentry Integration

| Thuộc tính | Giá trị |
|-----------|---------|
| Provider | Sentry |
| Crate | `sentry 0.34.0` |
| Endpoint | `https://*.ingest.us.sentry.io` |
| Platform | `sentry.rust/0.34.0` |

Sentry thu thập:
- Crash reports
- Error logs
- Device info: `os`, `os_version`, `device_name`, `locale`, `app_version`
- Session data: `check_in`, `schedule`, `duration`

---

## 11. Data Flow tổng thể

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER'S MAC                                 │
│                                                                     │
│  🎤 Microphone ──┐                                                  │
│                    ├──► system_audio.rs ──► Audio Buffer (PCM)       │
│  🔊 System Audio ─┘    (ScreenCaptureKit)        │                  │
│                                                   │                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    TAURI APP                                  │   │
│  │                                                              │   │
│  │  Frontend (WebView)              Backend (Rust)              │   │
│  │  ┌────────────────┐             ┌──────────────────────┐     │   │
│  │  │                │    IPC      │ commands/audio.rs     │     │   │
│  │  │  Overlay UI    │◄──────────►│ commands/auth.rs      │     │   │
│  │  │  (transcript   │             │ commands/demo.rs      │     │   │
│  │  │   + translation│             │ commands/update.rs    │     │   │
│  │  │   display)     │             │ auth_store.rs         │     │   │
│  │  │                │             │ settings_store.rs     │     │   │
│  │  └───────┬────────┘             └──────────┬───────────┘     │   │
│  │          │                                  │                │   │
│  └──────────┼──────────────────────────────────┼────────────────┘   │
│             │                                  │                     │
└─────────────┼──────────────────────────────────┼─────────────────────┘
              │ WebSocket                        │ HTTPS
              ▼                                  ▼
   ┌───────────────────┐            ┌─────────────────────────┐
   │ Soniox STT API    │            │ TranslaBuddy Backend    │
   │ stt-rt.soniox.com │            │ translabuddy.com        │
   │                   │            │                         │
   │ • Transcription   │            │ • Auth (JWT)            │
   │ • Translation     │            │ • Virtual API Key       │
   │ • Diarization     │            │ • WebSocket relay?      │
   │ • Language ID     │            │                         │
   └───────────────────┘            └────────────┬────────────┘
                                                 │
                                    ┌────────────┼────────────┐
                                    ▼            ▼            ▼
                              ┌──────────┐ ┌──────────┐ ┌──────────┐
                              │ Firebase │ │  Sentry  │ │  GitHub  │
                              │ Remote   │ │ Error    │ │ Releases │
                              │ Config   │ │ Tracking │ │          │
                              └──────────┘ └──────────┘ └──────────┘
```

---

*Tài liệu này được tạo từ kết quả reverse engineering (static analysis) trên TranslaBuddy 0.2.6. Các thông tin được suy luận từ strings, debug symbols, linked libraries và CSP policy trong binary.*
