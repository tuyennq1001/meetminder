// 16kHz → 24kHz polyphase upsampler for OpenAI Realtime.
// OpenAI Realtime expects 24kHz s16le PCM; our capture pipeline produces 16kHz.

use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};

const INPUT_RATE: usize = 16_000;
const OUTPUT_RATE: usize = 24_000;
const CHUNK_SIZE: usize = 1024;

pub struct UpsamplerTo24k {
    resampler: SincFixedIn<f32>,
    input_buf: Vec<f32>,
}

impl UpsamplerTo24k {
    pub fn new() -> Result<Self, String> {
        let params = SincInterpolationParameters {
            sinc_len: 128,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 128,
            window: WindowFunction::BlackmanHarris2,
        };
        let resampler = SincFixedIn::<f32>::new(
            OUTPUT_RATE as f64 / INPUT_RATE as f64,
            2.0,
            params,
            CHUNK_SIZE,
            1,
        )
        .map_err(|e| format!("resampler init failed: {}", e))?;

        Ok(Self {
            resampler,
            input_buf: Vec::with_capacity(CHUNK_SIZE * 2),
        })
    }

    /// Push s16le 16kHz mono samples; returns 24kHz s16le bytes ready to send.
    pub fn push(&mut self, pcm_s16le: &[u8]) -> Result<Vec<u8>, String> {
        // Decode s16le → f32 normalized
        for chunk in pcm_s16le.chunks_exact(2) {
            let s = i16::from_le_bytes([chunk[0], chunk[1]]);
            self.input_buf.push(s as f32 / 32768.0);
        }

        let mut out_bytes = Vec::new();
        while self.input_buf.len() >= CHUNK_SIZE {
            let frame: Vec<f32> = self.input_buf.drain(..CHUNK_SIZE).collect();
            let input_frames = vec![frame];
            let output = self
                .resampler
                .process(&input_frames, None)
                .map_err(|e| format!("resample failed: {}", e))?;

            for sample in &output[0] {
                let clamped = sample.clamp(-1.0, 1.0);
                let s = (clamped * 32767.0) as i16;
                out_bytes.extend_from_slice(&s.to_le_bytes());
            }
        }

        Ok(out_bytes)
    }
}
