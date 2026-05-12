# OpenAI Realtime Translate — Phát hiện khi tích hợp vào my-translator

> Tài liệu tổng hợp các phát hiện thực nghiệm khi tích hợp `gpt-realtime-translate` (GA tháng 5/2026) vào my-translator. Mục đích: hiểu rõ hành vi thực tế của API mới này và xác định case nào nên/không nên dùng.
>
> Ngày test: **2026-05-08 → 2026-05-10**. Endpoint: `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`.

---

## TL;DR

- API hoạt động tốt cho **listen-only** (xem video, đọc bài) và **2-person conversation** trên 2 thiết bị tách rời.
- API **KHÔNG phù hợp** cho meeting online (Zoom/Meet) khi capture system audio — gây echo loop không tránh được ở tầng app.
- **Không có chế độ text-only** — server reject mọi cách config modality. Phải gate audio output ở client side.
- **Không có speaker diarization** — không phân biệt được Speaker 1/2 như Soniox.
- **Đắt hơn Soniox ~34 lần** (~$4.14/giờ vs ~$0.12/giờ) và chỉ hỗ trợ 13 ngôn ngữ đích.
- Đổi lại: dịch tự nhiên hơn, có sẵn giọng nói 24 kHz, latency chữ đầu tiên thấp hơn ~1.4s.

---

## 1. Schema & API quirks

### 1.1 Endpoint chuyên biệt, KHÔNG phải `/v1/realtime` thông thường

Translation có endpoint riêng:

```
wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate
```

Schema khác hẳn `/v1/realtime` (chat/voice):
- ❌ Không có `voice` ở session level
- ❌ Không có `turn_detection`
- ❌ Không có `instructions` / `tools`
- ✅ Input transcription model = `gpt-realtime-whisper` (cứng)
- ✅ Output language config: `audio.output.language` (NOT `output_modalities`)

Session update tối thiểu hoạt động:

```json
{
  "type": "session.update",
  "session": {
    "audio": {
      "input": {
        "transcription": {"model": "gpt-realtime-whisper"},
        "noise_reduction": {"type": "near_field"}
      },
      "output": {"language": "vi"}
    }
  }
}
```

### 1.2 KHÔNG support text-only modality

Đã thử các config sau, **tất cả đều bị server reject** với `unknown_parameter`:

| Đã thử | Kết quả |
|---|---|
| `session.modalities: ["text"]` | ❌ unknown_parameter |
| `session.output_modalities: ["text"]` | ❌ unknown_parameter |
| `output_modalities: ["text"]` ở root | ❌ unknown_parameter |
| `audio.output.modalities: ["text"]` | ❌ unknown_parameter |

**→ Không có cách tắt audio output ở server side.** Muốn "mute" audio (vd để tiết kiệm cost/bandwidth khi chỉ cần text) phải:
1. Vẫn nhận `session.output_audio.delta` events từ server (đã trả tiền cho audio rồi)
2. Drop chúng ở client side trước khi đẩy vào audio queue

→ Trong my-translator: `OpenAiRealtimeClient.setMuted(true)` chỉ là client-side gate, không giảm cost.

### 1.3 Audio format yêu cầu chặt

| | Input | Output |
|---|---|---|
| **Sample rate** | 24 kHz | 24 kHz |
| **Format** | s16le PCM | s16le PCM |
| **Encoding** | base64 trong JSON event | base64 trong JSON event |
| **Channels** | mono | mono |

App vốn capture ở 16 kHz (Soniox dùng) → phải resample 16k → 24k phía Rust trước khi gửi (xem `audio/resampler.rs`).

### 1.4 Event types đã quan sát

| Event | Mô tả | Xử lý trong app |
|---|---|---|
| `session.created` / `session.updated` | Ack | Bỏ qua |
| `session.input_transcript.delta` | Token transcript ngôn ngữ nguồn | Push vào `_sourceBuffer` |
| `session.output_transcript.delta` | Token bản dịch | Push vào `_provisionalBuffer` |
| `session.output_transcript.done` | Câu dịch hoàn chỉnh | Pair với source buffer → emit segment |
| `session.output_audio.delta` | PCM 24kHz base64 | Decode → audio queue (nếu không mute) |
| `session.closed` | Server đóng | Emit Closed event |
| `error` | Lỗi schema/auth/quota | Forward lên UI |

**Không có**:
- ❌ Speaker label / diarization (như Soniox `tokens[].speaker`)
- ❌ Confidence score per token
- ❌ Word-level timestamp
- ❌ Endpoint detection event (server tự quyết khi nào "done")

---

## 2. Audio loop limitation (BLOCKER cho meeting use case)

### 2.1 Vấn đề

Khi user:
- Set source = **System Audio** (capture all desktop sound)
- Bật **Audio output ON** (nghe bản dịch qua loa/tai nghe)

→ Audio dịch đi vào loa **lại bị system audio capture nghe lại**, gửi lên OpenAI lần 2, dịch ra ngôn ngữ đích (vốn đã là đích), tạo loop:

```
mic A speaks → captured → OpenAI → translated audio → speaker
                                        ↑                  ↓
                                        └── captured again ┘
```

Hậu quả thực tế: bản dịch ra cùng ngôn ngữ đích, model bị loop, transcript chèn ký tự rác, audio chồng lấn.

### 2.2 Tại sao tai nghe (AirPods) không cứu được

User đeo AirPods nghĩ rằng audio dịch sẽ vào tai → không lọt vào mic → không loop. **Sai**.

macOS system audio capture (qua ScreenCaptureKit hoặc CoreAudio tap) **chặn audio stream TRƯỚC khi nó được route đến output device**. Tức là:

```
[macOS audio engine] → [system tap] → [output device routing → AirPods]
                            ↑
                       capture xảy ra ở đây
                       (KHÔNG phụ thuộc output device)
```

→ Dù output đi đâu, system tap vẫn nghe được.

### 2.3 OpenAI có suppress same-language output không?

Doc OpenAI có nhắc đến: nếu input audio language khớp target language, model "may not produce translated audio". Test thực tế: **không reliable**. Khi loop xảy ra, bản dịch vọng vẫn được model phát ra audio, không bị tự động bỏ qua.

### 2.4 Workaround có thể nhưng KHÔNG implement

Đã cân nhắc và bỏ:

| Workaround | Lý do bỏ |
|---|---|
| Audio ducking (giảm input mic khi đang phát output) | User reject — UX phức tạp, vẫn không giải quyết triệt để |
| AEC (acoustic echo cancellation) | Chỉ work cho mic+speaker vật lý, không work cho system tap |
| Separate output device (ví dụ Soundflower → tai nghe) | Setup phức tạp, không user-friendly |
| Auto-mute khi source = system | Đã thử, user cảm thấy gò bó |

**Kết luận**: với architecture hiện tại của my-translator (system audio capture + cùng device), case này không giải quyết được ở tầng app. Workaround duy nhất là user dùng tai nghe + source = microphone (chỉ nghe được giọng mình, không phù hợp meeting).

---

## 3. Use cases

### 3.1 ✅ Phù hợp

#### a) Listen-only (1 chiều, không cần audio output)
- Xem video không phụ đề (TED, YouTube tiếng nước ngoài)
- Nghe podcast tiếng nước ngoài
- Theo dõi livestream
- Đọc tin tức audio

→ Source = System Audio, **Audio output = OFF**, chỉ đọc text dịch.
→ Không có loop vì không phát audio dịch.

#### b) Two-person conversation (2 thiết bị tách rời)

```
Người A (laptop A)              Người B (laptop B)
mic A → API → text/audio       mic B → API → text/audio
              dành cho B                     dành cho A
```

→ Mic A và speaker B ở 2 thiết bị vật lý khác nhau → không loop.
→ Đây là use case OpenAI thiết kế cho. Cần app riêng (chưa có trong my-translator).

#### c) Phone call style (1 ↔ 1, audio mono trên 1 chiều mỗi lần)

→ Tương tự (b), nhưng có thể chỉ dùng 1 session nếu chỉ 1 người dịch ra cho người kia nghe.

### 3.2 ❌ Không phù hợp

#### a) Meeting online (Zoom, Google Meet, Teams)
- macOS chỉ expose "system audio mixed" hoặc "1 mic stream"
- Không tách được audio per-participant
- Capture system audio → nghe cả tiếng mình + tiếng người khác → loop khi bật audio dịch
- Workaround thực tế: dùng plugin built-in của Zoom/Meet (Zoom AI Companion, Meet captions) thay vì app ngoài

#### b) Karaoke / live music translation
- Audio nguồn không phải speech thuần → whisper input transcription kém
- Latency 15s không phù hợp

#### c) Transcribe-only use case (không cần dịch)
- Dùng `gpt-4o-transcribe` hoặc Whisper thường rẻ hơn nhiều
- `gpt-realtime-translate` luôn dịch, không có mode "chỉ transcribe"

#### d) Multi-speaker meeting cần phân biệt người nói
- Không có diarization → không biết câu nào của ai
- Phải dùng `gpt-4o-transcribe-diarize` (batch, không realtime)
- Hoặc Soniox với `enable_speaker_tags: true`

---

## 4. So sánh nhanh với Soniox

| Tiêu chí | OpenAI Realtime | Soniox |
|---|---|---|
| **Latency chữ đầu tiên** | ~15.0s | ~16.4s |
| **Audio output** | ✅ Có (24kHz built-in) | ❌ Phải TTS riêng |
| **Diarization** | ❌ | ✅ |
| **Two-way mode** | ❌ | ✅ |
| **Số ngôn ngữ đích** | 13 | 70+ |
| **Endpoint detection** | Server tự | Configurable delay |
| **Token-level deltas** | ✅ (1269 deltas/5min) | ❌ (sentence finals) |
| **Cost / giờ** | ~$4.14 | ~$0.12 |
| **Cost ratio** | **34×** | baseline |
| **Phù hợp listen-only** | ✅ | ✅ |
| **Phù hợp meeting** | ❌ (loop) | ⚠️ (vẫn có loop nhưng không có audio output) |
| **Phù hợp 2-device call** | ✅ | ✅ |

→ Khi quyết định provider: **Soniox** cho cost-sensitive/multilingual/diarization, **OpenAI** cho UX premium (audio dịch tự nhiên, dịch chất lượng cao hơn cho cặp ngôn ngữ phổ biến).

---

## 5. Implementation notes (cho lần build sau)

### 5.1 Browser KHÔNG kết nối trực tiếp được

Browsers không cho phép set `Authorization` header trên WebSocket → phải có Rust/Node bridge ở backend cầm API key.

Trong my-translator: `src-tauri/src/commands/openai_realtime.rs` chạy WS connection, frontend gọi qua Tauri commands.

### 5.2 Resampling 16k → 24k

App vốn pipeline 16k cho Soniox. Khi thêm OpenAI:
- Giữ capture 16k (tương thích Soniox)
- Resample 16k → 24k chỉ cho leg OpenAI (ở Rust, dùng linear interpolation đủ chất lượng với speech)

### 5.3 Settings persistence pitfall

Pattern `settingsManager.save()` → emit notify → `_applySettings()` đọc lại. Nếu runtime state (ví dụ `currentSource`, `audioOutput`) chỉ thay đổi ở memory mà không persist, lần notify kế tiếp sẽ overwrite về settings cũ.

→ Mọi runtime toggle PHẢI gọi `settingsManager.save({...})` đồng thời, không chỉ mutate `this.xxx`.

### 5.4 Mute toggle: pass value trực tiếp

Vì `save()` async, đừng đọc `settingsManager.get()` ngay sau `save()` — sẽ thấy giá trị cũ. Pass giá trị mới trực tiếp vào hàm refresh UI.

### 5.5 Flush pending khi disconnect

Nếu user bấm Stop giữa câu, partial transcript chưa final sẽ mất. Cần `flushPending()` emit luôn provisional buffer như 1 segment final trước khi đóng session.

---

## 6. Câu hỏi mở

- OpenAI có roadmap thêm `output_modalities: ["text"]` cho translation endpoint không? (giảm cost cho listen-only use case)
- Có kế hoạch hỗ trợ diarization không?
- API có expose per-speaker stream input nào không cho meeting platforms?
- Pricing có giảm khi GA stable không? (~$4/giờ là barrier lớn cho consumer apps)

---

## Tham khảo

- Endpoint: `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`
- Code reference: [`src-tauri/src/commands/openai_realtime.rs`](../src-tauri/src/commands/openai_realtime.rs) (trên branch `feature/openai-realtime`)
- Benchmark thực tế: [`benchmark_openai_vs_soniox_vi.md`](./benchmark_openai_vs_soniox_vi.md) (trên branch `feature/openai-realtime`)
