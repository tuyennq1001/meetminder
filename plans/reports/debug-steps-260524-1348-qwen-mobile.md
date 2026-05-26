# Mobile Qwen Debug — Step-by-Step (chi tiết)

**Bug:** TestFlight v0.4.1, Qwen mode hiển thị tiếng Nhật (source) trong CẢ source panel VÀ target panel — không dịch.
**Working reference:** Desktop v0.7.0 (Tauri) dịch đúng → code logic không sai, vấn đề nằm ở mobile-specific layer (WS auth / timing).

---

## Step 1 — Thu log từ thiết bị (BLOCKING — chưa làm sẽ không debug được)

Mục đích: thấy được Qwen server trả về gì cho app. Log đã in sẵn trong code (`console.log("[qwen-realtime] ...")`) — chỉ cần "moi" nó ra khỏi iPhone qua dây cáp.

### 1.1 — Chuẩn bị 1 lần (skip nếu đã có)

**Cài Xcode (nếu chưa có):**
1. Mở App Store trên Mac
2. Search "Xcode" → Install (~10GB, mất 30-60 phút)
3. Sau khi cài, mở Xcode ít nhất 1 lần để nó cài thêm "Command Line Tools" (popup tự hiện, bấm Install)

**Trust iPhone với Mac (lần đầu):**
1. Cắm cáp Lightning/USB-C từ iPhone vào Mac
2. iPhone hiện popup "Trust This Computer?" → bấm **Trust**
3. Nhập passcode iPhone xác nhận
4. (Nếu không thấy popup) → unlock iPhone, mở Settings → General → VPN & Device Management → check không có gì block

### 1.2 — Mở Xcode Devices Console (cách chính)

1. Mở **Xcode** (icon búa xanh)
2. Menu bar trên cùng → **Window** → **Devices and Simulators** (phím tắt `⇧⌘2` = Shift+Cmd+2)
3. Cửa sổ mới hiện ra. Bên trái có 2 tab trên cùng: **Devices** | **Simulators** → chọn **Devices**
4. Sidebar trái → chọn tên iPhone của bạn (vd "phucnt's iPhone")
   - Nếu không thấy: đợi 10-20s sau khi cắm cáp; hoặc rút ra cắm lại
   - Lần đầu Mac sẽ "Preparing iPhone for development..." — đợi nó xong (1-2 phút)
5. Panel phải hiện thông tin device. Tìm và bấm nút **Open Console** (góc phải trên), HOẶC:
   - Cách khác: cùng cửa sổ Devices, có nút "View Device Logs" (xem crash) — KHÔNG dùng cái này
   - Đúng là **"Open Console"** → mở 1 cửa sổ Console riêng, đã filter sẵn theo device

### 1.3 — Filter log để chỉ thấy Qwen

Cửa sổ Console vừa mở sẽ tuôn log rất nhiều (cả OS lẫn app). Lọc:

1. Ô **Search** ở góc phải trên cùng cửa sổ Console
2. Gõ chính xác: `qwen-realtime`
3. Bấm Enter → giờ chỉ còn log có chữ "qwen-realtime"
4. Bấm nút **"Start"** (hoặc **"Resume"**) nếu log đang pause

(Nếu không thấy "Open Console" hoặc Xcode bị crash, dùng **macOS Console.app** thay — xem 1.5 bên dưới)

### 1.4 — Reproduce bug và copy log

1. Trên iPhone: mở app **My Translator**
2. Vào Settings → đảm bảo:
   - Translation mode = **Qwen-Omni Realtime**
   - DashScope API key đã paste
   - Target language = Vietnamese
3. Quay về màn hình chính → bấm ▶ Start
4. **Nói (hoặc bật loa phát) 1-2 câu tiếng Nhật** trong ~10s
5. Bấm ⏹ Stop
6. Quay lại Xcode Console — sẽ thấy hàng loạt dòng `[qwen-realtime] ...`
7. **Click chuột vào ô log → ⌘A (Select All) → ⌘C (Copy)**
8. Paste vào file text, hoặc paste thẳng vào chat ở đây

**Quan trọng:** copy CẢ session — từ dòng `evt: session.created` đầu tiên đến dòng `evt: response.done` cuối cùng. Đừng cắt giữa.

### 1.5 — Cách B: macOS Console.app (nếu Xcode không xài được)

1. `⌘+Space` → gõ "Console" → mở **Console.app** (icon hình terminal đen)
2. Cột sidebar trái → mục **Devices** → chọn tên iPhone
   - Nếu không thấy iPhone: rút cáp, cắm lại, đợi 20s
3. Phải đang ở chế độ "Streaming" (góc trên có nút "Start streaming") — bấm Start nếu chưa stream
4. Ô **Search** trên cùng → gõ `qwen-realtime` → Enter
5. Làm bước 1.4 phần "Reproduce" giống Xcode

### 1.6 — Không có Mac? (fallback)

Nếu phải debug từ Windows/Linux:
- Cài app **3uTools** hoặc **iMazing** trên Windows — cả 2 đều có chức năng "Real-time Log" cho iPhone
- Free trial đủ dùng 1-2 lần
- Filter theo `qwen-realtime` y hệt

---

## Step 2 — Phân loại bug từ log

Sau khi paste log về, soi 3 câu hỏi:

### Q1: Có thấy dòng `[qwen-realtime] evt: session.updated` không?

- **KHÔNG** → WebSocket handshake fail / auth fail → **đi Step 3A**
- **CÓ** → tiếp Q2

### Q2: Ngay sau `evt: session.updated` có dòng `[qwen-realtime] session.updated {...}`, trong JSON đó có chuỗi `"instructions": "You are a professional simultaneous interpreter..."` không?

- **KHÔNG có instructions** → server reject `session.update` payload → **đi Step 3A**
- **CÓ instructions** → tiếp Q3

### Q3: Có dòng `[qwen-realtime] DONE response.text.done text=...` (hoặc `audio_transcript.done`) — text trong đó là tiếng gì?

- **Tiếng Nhật** → Qwen thực sự trả về source language → **đi Step 3B** (server logic bug)
- **Tiếng Việt** → app render bug, không phải server → **đi Step 3C**
- **Rỗng / không có DONE** → response chưa hoàn thành → **đi Step 3D**

---

## Step 3A — Fix WebSocket auth (most likely)

RN WebSocket polyfill có thể bỏ qua `{ headers: { Authorization: ... } }` ở 3rd-arg. Thử 3 phương án theo thứ tự:

### 3A.1 — Test subprotocol auth (1-line change, thử trước)

Trong `src/engines/qwen-realtime-client.ts`, đổi:

```ts
ws = new WSCtor(QWEN_REALTIME_URL, null, {
  headers: { Authorization: `Bearer ${cfg.apiKey}` },
});
```

thành:

```ts
ws = new WebSocket(QWEN_REALTIME_URL, [`Bearer.${cfg.apiKey}`]);
```

→ Build EAS Update OTA → cài lại → coi Step 2 Q2 có instructions không.

**Nếu DashScope không nhận subprotocol** (error code arrive ngay sau onopen) → bỏ, sang 3A.2.

### 3A.2 — Test query-param auth

Đổi URL:

```ts
const url = `${QWEN_REALTIME_URL}&api_key=${encodeURIComponent(cfg.apiKey)}`;
ws = new WebSocket(url);
```

→ EAS Update → test lại. (Key sẽ xuất hiện trong logs nếu có proxy ghi URL — chỉ test, không ship production.)

### 3A.3 — Native module proxy (giải pháp ổn định nhất)

Nếu 3A.1 + 3A.2 fail, làm theo desktop pattern:
- Viết Expo native module (Swift + Kotlin) hold WebSocket connection
- JS gửi `start(config)` / `sendAudio(b64)` / `stop()` qua bridge — giống `invoke('qwen_realtime_*')` của Tauri
- Native module emit events qua `EventEmitter`

**Effort:** 1-2 ngày. **Lợi:** loại bỏ hẳn cả class polyfill bug.

---

## Step 3B — Server logic bug (Qwen trả tiếng Nhật)

Nếu `DONE` text là tiếng Nhật → Qwen nhận instructions nhưng vẫn output source:

1. **Voice "Tina" có thể không support Japanese audio output** → modal `audio` fall back to passthrough. Thử text-only:

   ```ts
   modalities: ["text"],
   ```

2. **Instructions bị weight thấp khi audio modality on** → reinforce:

   ```
   CRITICAL: NEVER output the source language. ALWAYS translate to ${cfg.targetLanguageName}. If you cannot translate, output an empty string.
   ```

---

## Step 3C — Render bug (text đúng nhưng UI sai)

Nếu log có `DONE text=Tôi xin chào...` (đã dịch) nhưng UI hiện tiếng Nhật → bug ở `session-context.tsx` / `transcript-stream.tsx`.

Thêm log:
```ts
onSegment: (src, tgt) => {
  console.log("[render] onSegment src=", src.slice(0,80), "tgt=", tgt.slice(0,80));
  // existing code
}
```

→ EAS Update → repro → coi `src` và `tgt` có đúng thứ tự không. Nếu đúng thì bug ở component render (verify panel source dùng `segment.source`, panel target dùng `segment.translated`, không swap).

---

## Step 3D — Response chưa hoàn thành

Nếu log không có DONE → Qwen không finalize response. Khả năng:
- RMS-VAD không fire commit (audio quá nhỏ — SILENCE_RMS=500 có thể chưa phù hợp mic iPhone)
- `input_audio_buffer.commit` gửi nhưng server không nhận

Log thêm trong `commitTurn()`:
```ts
console.log("[qwen-realtime] commit windowMs=", this.windowMs, "energy>=", this.hasAudioInWindow);
```

Nếu `commit` không in ra → tăng nhạy: hạ `SILENCE_RMS = 200`.

---

## Step 4 — Verify fix sau mỗi attempt

```bash
cd /Users/phucnt/workspace/my-translator-mobile
eas update --branch <branch> --message "qwen-debug-attempt-N"
```

TestFlight install không cần build mới — OTA tự pickup khi mở app lại (đợi 5-30s, hoặc force-close + open lại).

Reproduce theo Step 1 → confirm Step 2 Q3 trả về tiếng Việt.

---

## Step 5 — Cleanup khi xong

- Remove verbose `console.log` ở `qwen-realtime-client.ts` (giữ behind `__DEV__` gate)
- Bump mobile version + EAS build mới (không chỉ OTA)
- Update mobile changelog

---

## Unresolved Questions

- DashScope international endpoint có officially support subprotocol auth không? (Cần `wscat -s "Bearer.$KEY" wss://dashscope-intl.aliyuncs.com/...` ngoài CI)
- DashScope có endpoint trả về error rõ ràng khi auth fail (HTTP 401 trên upgrade vs silent passthrough)?
- Mobile có log nào từ trước đến giờ chưa thu thập được? (Block toàn bộ Step 2.)
