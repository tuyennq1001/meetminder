# Windows Port — Known Issues & Potential Problems

## 1. `wasapi.rs` — Chỉ hỗ trợ 32-bit Float

**File:** `src-tauri/src/audio/wasapi.rs`, line 169–173

```rust
let f32_samples = if bits_per_sample == 32 {
    let ptr = buffer_ptr as *const f32;
    std::slice::from_raw_parts(ptr, frame_count * source_channels as usize)
} else {
    return Vec::new(); // Unsupported format — trả về empty = silent
};
```

**Vấn đề:** WASAPI shared mode thường output IEEE Float 32-bit, nhưng **một số audio driver** (đặc biệt device cũ hoặc external DAC) có thể output 16-bit hoặc 24-bit PCM. Trong trường hợp đó, hàm sẽ trả về `Vec::new()` → **không capture được audio mà không báo lỗi**.

**Fix đề xuất:** Thêm xử lý cho 16-bit PCM:
```rust
let f32_samples: Vec<f32> = if bits_per_sample == 32 {
    // IEEE Float — cast trực tiếp
    std::slice::from_raw_parts(buffer_ptr as *const f32, total_samples).to_vec()
} else if bits_per_sample == 16 {
    // PCM s16le — convert sang f32
    let i16_ptr = buffer_ptr as *const i16;
    let i16_samples = std::slice::from_raw_parts(i16_ptr, total_samples);
    i16_samples.iter().map(|&s| s as f32 / 32768.0).collect()
} else {
    eprintln!("[WASAPI] Unsupported bits_per_sample: {}", bits_per_sample);
    return Vec::new();
};
```

---

## 2. `wasapi.rs` — Downsample dùng Nearest-Neighbor

**File:** `src-tauri/src/audio/wasapi.rs`, line 188–195

```rust
let src_idx = (i as f64 * ratio) as usize;  // nearest-neighbor
let sample = mono[src_idx].clamp(-1.0, 1.0);
```

**Vấn đề:** Dùng nearest-neighbor sampling sẽ gây aliasing artifacts, ảnh hưởng chất lượng nhận dạng giọng nói. Trong khi `microphone.rs` đã dùng **linear interpolation** (tốt hơn).

**Fix đề xuất:** Dùng cùng thuật toán linear interpolation như `microphone.rs`:
```rust
for i in 0..output_len {
    let src_pos = i as f64 * ratio;
    let src_idx = src_pos as usize;
    let frac = src_pos - src_idx as f64;

    let sample = if src_idx + 1 < mono.len() {
        mono[src_idx] as f64 * (1.0 - frac) + mono[src_idx + 1] as f64 * frac
    } else if src_idx < mono.len() {
        mono[src_idx] as f64
    } else {
        break;
    };

    let s16 = (sample.clamp(-1.0, 1.0) * 32767.0) as i16;
    pcm_bytes.extend_from_slice(&s16.to_le_bytes());
}
```

---

## 3. `wasapi.rs` — Mono Mixdown chỉ lấy Channel 0

**File:** `src-tauri/src/audio/wasapi.rs`, line 177–180

```rust
let mono: Vec<f32> = f32_samples
    .chunks(source_channels as usize)
    .map(|frame| frame[0])  // chỉ lấy channel đầu tiên
    .collect();
```

**Vấn đề:** Chỉ lấy left channel, bỏ qua right channel. Nếu nội dung audio chỉ phát ở right channel (ví dụ: stereo content không cân bằng), sẽ **mất hoàn toàn âm thanh đó**.

**So sánh:** `microphone.rs` dùng **average tất cả channels**:
```rust
// microphone.rs — cách đúng
.map(|frame| frame.iter().sum::<f32>() / channels as f32)
```

**Fix đề xuất:** Dùng average giống `microphone.rs`:
```rust
let mono: Vec<f32> = f32_samples
    .chunks(source_channels as usize)
    .map(|frame| frame.iter().sum::<f32>() / source_channels as f32)
    .collect();
```

---

## Mức độ ưu tiên

| Issue | Severity | Ảnh hưởng |
|-------|----------|-----------|
| #1 Chỉ hỗ trợ Float32 | 🟡 Medium | Một số device không capture được audio |
| #2 Nearest-neighbor downsample | 🟢 Low | Chất lượng nhận dạng kém hơn nhẹ, nhưng vẫn hoạt động |
| #3 Chỉ lấy Channel 0 | 🟡 Medium | Có thể mất audio ở right-only content |

> **Khuyến nghị:** Fix cả 3 trước khi release, nhưng #2 và #3 nhanh (1 dòng thay đổi mỗi cái).
