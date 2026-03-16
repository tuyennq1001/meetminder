# 🛠️ Implementation Plan — Personal Real-time Speech Translator

> **Mục tiêu**: Build bản cá nhân, clean, kết nối trực tiếp Soniox bằng API key riêng  
> **Platform**: macOS (Apple Silicon)  
> **Nguyên tắc**: Không auth, không proxy, không tracking — chỉ giữ core features

---

## 1. So sánh: TranslaBuddy vs Bản cá nhân

| | TranslaBuddy | Bản cá nhân |
|---|---|---|
| STT + Translation | Soniox (qua proxy) | ✅ Soniox (kết nối trực tiếp) |
| API Key | Virtual key từ server | ✅ Tự nhập Soniox key |
| Auth | JWT + login polling | ❌ Bỏ |
| Backend server | translabuddy.com | ❌ Bỏ — không cần server |
| Firebase Remote Config | Có | ❌ Bỏ |
| Sentry | Có | ❌ Bỏ |
| Demo Mode | Có | ❌ Bỏ |
| Forced Update | Có | ❌ Bỏ |
| System Audio Capture | ScreenCaptureKit | ✅ Giữ |
| Microphone Capture | AVFoundation | ✅ Giữ |
| Overlay UI | WebView | ✅ Giữ (đơn giản hóa) |
| Custom Context | Có | ✅ Giữ |
| Settings persistence | JSON file | ✅ Giữ |

**Loại bỏ**: ~60% code phức tạp (auth, proxy, tracking, update checker)  
**Giữ lại**: Core translation pipeline + UI overlay

---

## 2. Lựa chọn Tech Stack

### Đề xuất: **Tauri 2 (Rust + HTML/CSS/JS)**

| Lý do chọn Tauri | |
|---|---|
| ✅ Đã proven hoạt động tốt cho use case này | TranslaBuddy dùng chính stack này |
| ✅ Lightweight | ~5MB binary, không nặng như Electron (~150MB) |
| ✅ Rust backend | Truy cập ScreenCaptureKit qua crate `screencapturekit` |
| ✅ WebView frontend | HTML/CSS/JS quen thuộc, dễ customize UI |
| ✅ Native feel | Window vibrancy, menu bar, overlay support |
| ✅ Cross-platform tiềm năng | Có thể port sang Windows sau nếu cần |

### Alternatives đã cân nhắc

| Stack | Ưu | Nhược | Verdict |
|-------|-----|-------|---------|
| **SwiftUI native** | Native nhất, nhẹ nhất | Phải học Swift/SwiftUI, ScreenCaptureKit API phức tạp | Tốt nhưng learning curve cao |
| **Electron** | Dễ dev, nhiều tài liệu | Nặng (~150MB), tốn RAM | Quá nặng cho app đơn giản |
| **Browser-only** | Đơn giản nhất | Không capture được system audio | Không đủ feature |

---

## 3. Kiến trúc

```
┌─────────────────────────────────────────────────────┐
│              Personal Translator App                 │
│                                                     │
│  ┌──────────────────────┐  ┌──────────────────────┐ │
│  │  Frontend (WebView)  │  │  Backend (Rust)      │ │
│  │                      │  │                      │ │
│  │  • Settings UI       │  │  • system_audio.rs   │ │
│  │  • Transcript display│  │    (ScreenCaptureKit)│ │
│  │  • Soniox WebSocket  │  │  • microphone.rs     │ │
│  │    client            │  │    (AVFoundation)    │ │
│  │  • Overlay window    │  │  • settings.rs       │ │
│  │                      │  │    (JSON persistence)│ │
│  └──────────┬───────────┘  └──────────┬───────────┘ │
│             │ IPC (Tauri)             │              │
│             └─────────────────────────┘              │
└──────────────────────┬──────────────────────────────┘
                       │ WebSocket (trực tiếp)
                       ▼
              ┌─────────────────┐
              │ Soniox STT API  │
              │ wss://stt-rt.   │
              │ soniox.com      │
              └─────────────────┘
              (API key cá nhân)
```

**Không có server trung gian** — app kết nối thẳng đến Soniox.

---

## 4. Cấu trúc Project

```
realtime-translator/
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json           # Tauri config
│   ├── capabilities/             # Permissions
│   │   └── default.json
│   └── src/
│       ├── main.rs               # Entry point
│       ├── lib.rs                # Setup & plugin registration
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── audio.rs          # start/stop audio capture
│       │   └── settings.rs       # save/load settings
│       ├── audio/
│       │   ├── mod.rs
│       │   ├── system_audio.rs   # ScreenCaptureKit capture
│       │   └── microphone.rs     # Mic capture (AVFoundation)
│       └── settings.rs           # Settings struct & persistence
│
├── src/                          # Frontend (HTML/CSS/JS)
│   ├── index.html                # Main window
│   ├── styles/
│   │   └── main.css              # Styling (dark theme, overlay)
│   └── js/
│       ├── app.js                # Main app logic
│       ├── soniox.js             # Soniox WebSocket client
│       ├── ui.js                 # UI rendering (transcript display)
│       └── settings.js           # Settings management
│
├── icons/                        # App icons
├── package.json
└── README.md
```

---

## 5. Chi tiết từng module

### 5.1. Rust Backend

#### `audio/system_audio.rs` — Capture System Audio

```rust
// Pseudocode
use screencapturekit::*;

pub struct SystemAudioCapture {
    stream: Option<SCStream>,
    is_capturing: bool,
}

impl SystemAudioCapture {
    pub fn start(&mut self, channel: Channel<Vec<u8>>) -> Result<()> {
        // 1. Check Screen Recording permission
        // 2. Create SCShareableContent (audio only)
        // 3. Configure SCStreamConfiguration (sample rate, channels)
        // 4. Start SCStream
        // 5. Forward PCM audio data via Tauri channel
    }

    pub fn stop(&mut self) -> Result<()> {
        // Stop SCStream
    }
}
```

#### `audio/microphone.rs` — Capture Microphone

```rust
// Pseudocode - dùng cpal hoặc AVFoundation binding
use cpal::traits::*;

pub struct MicCapture {
    stream: Option<cpal::Stream>,
}

impl MicCapture {
    pub fn start(&mut self, channel: Channel<Vec<u8>>) -> Result<()> {
        // 1. Check Microphone permission
        // 2. Get default input device
        // 3. Create audio stream (PCM, 16kHz, mono)
        // 4. Forward audio data via Tauri channel
    }
}
```

#### `commands/audio.rs` — Tauri Commands

```rust
#[tauri::command]
async fn start_capture(
    source: String,  // "system" | "microphone"
    channel: Channel<Vec<u8>>,
    state: State<'_, AudioState>,
) -> Result<(), String> { ... }

#[tauri::command]
async fn stop_capture(
    state: State<'_, AudioState>,
) -> Result<(), String> { ... }

#[tauri::command]
fn check_permissions() -> Result<PermissionStatus, String> { ... }

#[tauri::command]
fn request_permission(permission_type: String) -> Result<(), String> { ... }
```

#### `settings.rs` — Settings Persistence

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    pub soniox_api_key: String,
    pub source_language: String,        // "auto" hoặc ISO 639-1
    pub target_language: String,        // ISO 639-1
    pub audio_source: String,           // "system" | "microphone" | "both"
    pub translation_mode: String,       // "one_way" | "two_way"
    pub overlay_opacity: f64,           // 0.0 - 1.0
    pub overlay_position: String,       // "top" | "bottom" | "floating"
    pub font_size: u32,                 // px
    pub custom_context: Option<Context>,
    pub show_original: bool,            // Hiện text gốc cùng bản dịch
    pub max_lines: u32,                 // Số dòng hiển thị tối đa
}

// Lưu/đọc từ: ~/Library/Application Support/com.personal.translator/settings.json
```

### 5.2. Frontend (HTML/CSS/JS)

#### `js/soniox.js` — Soniox WebSocket Client

```javascript
class SonioxClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.ws = null;
        this.onTranscript = null;  // callback
    }

    connect(config) {
        this.ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');

        this.ws.onopen = () => {
            // Gửi config message
            this.ws.send(JSON.stringify({
                api_key: this.apiKey,
                model: 'stt-rt-preview',
                audio_format: 'pcm_s16le',
                sample_rate: 16000,
                num_channels: 1,
                language_hints: config.languageHints || [],
                context: config.context || {},
                enable_speaker_diarization: config.diarization || false,
                enable_endpoint_detection: true,
                translation: config.translation || null,
            }));
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.tokens && this.onTranscript) {
                this.onTranscript(data);
            }
        };
    }

    sendAudio(pcmData) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(pcmData);  // Binary frame
        }
    }

    disconnect() {
        this.ws?.send('');  // Empty frame = graceful close
    }
}
```

#### `js/ui.js` — Transcript Display

```javascript
class TranscriptUI {
    constructor(container) {
        this.container = container;
        this.lines = [];
        this.maxLines = 5;
    }

    update(tokens) {
        // Render tokens: provisional = gray/italic, final = white/bold
        // Auto-scroll, limit to maxLines
        // Show original + translation nếu cấu hình
    }

    clear() { ... }
    setOpacity(value) { ... }
    setFontSize(px) { ... }
}
```

---

## 6. Các screens cần làm

### Screen 1: Main Overlay (Transcript Display)

```
┌──────────────────────────────────────────────┐
│  ⚙️                              [🎤] [🔊]  │  ← Controls bar
├──────────────────────────────────────────────┤
│                                              │
│  こんにちは、今日のミーティングを始めましょう        │  ← Original (optional)
│  Xin chào, hãy bắt đầu cuộc họp hôm nay     │  ← Translation
│                                              │
│  次のスライドをお願いします                       │
│  Xin hãy chuyển sang slide tiếp theo          │
│                                              │
└──────────────────────────────────────────────┘
    ↑ Overlay window, always-on-top, adjustable opacity
```

### Screen 2: Settings Panel

```
┌──────────────────────────────────────────────┐
│  ⚙️ Settings                                 │
├──────────────────────────────────────────────┤
│                                              │
│  🔑 Soniox API Key                           │
│  ┌──────────────────────────────────────┐    │
│  │ ••••••••••••••••••••                 │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  🌐 Languages                                │
│  Source: [Auto-detect     ▾]                 │
│  Target: [Vietnamese      ▾]                 │
│  Mode:   [One-way ▾]                         │
│                                              │
│  🎤 Audio Source                              │
│  ○ System Audio  ○ Microphone  ○ Both        │
│                                              │
│  🎨 Display                                  │
│  Opacity:    [━━━━━━●━━━] 80%                │
│  Font size:  [━━━●━━━━━━] 16px               │
│  Max lines:  [━━━━●━━━━━] 5                  │
│  ☑ Show original text                        │
│                                              │
│  📝 Custom Context (Optional)                │
│  Domain: [Meeting           ]                │
│  Terms:  [sprint, deploy... ]                │
│                                              │
│  [Save & Close]                              │
└──────────────────────────────────────────────┘
```

---

## 7. Implementation Phases

### Phase 1: Foundation (2-3 ngày)

```
□ 1.1  Init Tauri 2 project
       $ npx -y create-tauri-app@latest ./ --template vanilla
       
□ 1.2  Configure tauri.conf.json
       - Window: transparent, decorations off, always-on-top
       - Permissions: microphone, screen recording
       - CSP: chỉ cho phép wss://stt-rt.soniox.com
       
□ 1.3  Implement settings.rs
       - Settings struct + load/save JSON
       - Tauri commands: get_settings, save_settings
       
□ 1.4  Build Settings UI
       - API key input
       - Language selection
       - Audio source selection
       - Display options
```

### Phase 2: Audio Capture (2-3 ngày)

```
□ 2.1  Add Rust dependencies
       - screencapturekit = "1.5"
       - cpal = "0.15" (hoặc coreaudio-rs)
       
□ 2.2  Implement system_audio.rs
       - ScreenCaptureKit stream (audio only)
       - PCM output: 16kHz, mono, s16le
       - Permission check & request
       
□ 2.3  Implement microphone.rs
       - cpal default input device
       - PCM output: 16kHz, mono, s16le
       - Permission check & request
       
□ 2.4  Implement Tauri commands
       - start_capture(source, channel)
       - stop_capture()
       - check_permissions()
       
□ 2.5  Test audio capture
       - Verify PCM data is correct
       - Test with system audio (play YouTube)
       - Test with microphone
```

### Phase 3: Soniox Integration (1-2 ngày)

```
□ 3.1  Implement soniox.js
       - WebSocket client
       - Config message builder
       - Audio streaming (binary frames)
       - Response parser (tokens → text)
       
□ 3.2  Connect audio → Soniox
       - Receive PCM from Rust via Tauri channel
       - Forward to Soniox WebSocket as binary frames
       - Receive transcription tokens
       
□ 3.3  Test end-to-end
       - System audio → Soniox → transcript
       - Microphone → Soniox → transcript
       - Verify latency < 500ms
```

### Phase 4: UI & Overlay (1-2 ngày)

```
□ 4.1  Build overlay window
       - Transparent background
       - Always-on-top
       - Draggable (data-tauri-drag-region)
       - Resizable
       
□ 4.2  Build transcript display
       - Rolling text display
       - Provisional text (gray) vs final (white)
       - Original + translation layout
       - Auto-scroll
       
□ 4.3  Build control bar
       - Start/Stop button
       - Audio source toggle
       - Settings gear icon
       - Status indicator (connected/disconnected)
       
□ 4.4  Styling
       - Dark theme, glassmorphism
       - Adjust opacity via settings
       - Font size customizable
```

### Phase 5: Polish (1 ngày)

```
□ 5.1  Error handling
       - API key invalid → clear message
       - Permission denied → guide to System Preferences
       - Network error → reconnect logic
       - Soniox errors (402, 429) → display message
       
□ 5.2  UX improvements
       - Keyboard shortcuts (start/stop, toggle overlay)
       - Remember window position
       - Menu bar icon (optional)
       - Smooth animations
       
□ 5.3  Build & test
       - cargo tauri build --target aarch64-apple-darwin
       - Test trên macOS thật
       - Verify clean: không gọi đến bất kỳ server nào ngoài Soniox
```

---

## 8. Ước tính thời gian

| Phase | Nội dung | Thời gian |
|-------|---------|-----------|
| 1 | Foundation (project setup, settings) | 2-3 ngày |
| 2 | Audio Capture (system + mic) | 2-3 ngày |
| 3 | Soniox Integration | 1-2 ngày |
| 4 | UI & Overlay | 1-2 ngày |
| 5 | Polish & Build | 1 ngày |
| **Tổng** | | **7-11 ngày** |

---

## 9. Chi phí sử dụng (cá nhân)

| Soniox Pricing | |
|---|---|
| Giá | ~$0.12/giờ audio |
| 1 cuộc họp 1h | ~$0.12 |
| 4h/ngày × 20 ngày | ~$9.60/tháng |
| 8h/ngày × 20 ngày | ~$19.20/tháng |

→ **Dưới $20/tháng** cho sử dụng cá nhân chuyên nghiệp. Rẻ hơn nhiều so với subscription dịch vụ tương tự.

### Lấy API Key

1. Đăng ký tại [console.soniox.com](https://console.soniox.com/signup/)
2. Tạo API key trong Console
3. Nhập vào app → Bắt đầu dùng

---

## 10. So sánh kết quả

```
TranslaBuddy (original)          Bản cá nhân (target)
┌──────────────────────┐         ┌──────────────────────┐
│ ✅ Feature-rich       │         │ ✅ Core features only │
│ ❌ 6 hidden controls  │         │ ✅ No hidden controls │
│ ❌ Phụ thuộc server   │         │ ✅ Trực tiếp Soniox  │
│ ❌ Virtual API key    │         │ ✅ API key cá nhân    │
│ ❌ Auth + tracking    │         │ ✅ Không ai track     │
│ ❌ Tác giả trả tiền  │         │ ✅ Tự trả, tự chủ    │
│ ❌ Có thể shutdown    │         │ ✅ Chạy mãi (nếu trả)│
│ ? Audio qua proxy    │         │ ✅ Audio → Soniox only│
└──────────────────────┘         └──────────────────────┘
```

---

## 11. Prerequisites

Trước khi bắt đầu, cần cài đặt:

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add aarch64-apple-darwin

# Node.js (cho Tauri frontend)
# Đã có sẵn hoặc: brew install node

# Tauri CLI
cargo install tauri-cli

# Xcode Command Line Tools (cho ScreenCaptureKit)
xcode-select --install
```

---

*Plan này ưu tiên đơn giản, clean, và tự chủ. Không có bất kỳ dependency nào vào server trung gian — chỉ Soniox API trực tiếp.*
