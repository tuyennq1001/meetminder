//! Acoustic echo cancellation for the combined system-audio and microphone mode.

use sonora::config::{EchoCanceller as SonoraEchoCanceller, TransparentModeType};
use sonora::{AudioProcessing, Config, StreamConfig};

const SAMPLE_RATE: u32 = 16_000;
const FRAME_SAMPLES: usize = 160; // 10 ms at 16 kHz
const RENDER_CAPTURE_DELAY_MS: i32 = 0;

pub(crate) struct EchoCanceller {
    processor: AudioProcessing,
}

impl EchoCanceller {
    pub(crate) fn new() -> Result<Self, String> {
        let config = StreamConfig::new(SAMPLE_RATE, 1);
        let mut processor = AudioProcessing::builder()
            .config(Config {
                echo_canceller: Some(SonoraEchoCanceller {
                    transparent_mode: TransparentModeType::Hmm,
                    ..Default::default()
                }),
                ..Default::default()
            })
            .capture_config(config)
            .render_config(config)
            .build();

        processor
            .set_stream_delay_ms(RENDER_CAPTURE_DELAY_MS)
            .map_err(|err| format!("Failed to configure echo-cancellation delay: {err}"))?;

        Ok(Self { processor })
    }

    pub(crate) fn reset(&mut self) -> Result<(), String> {
        *self = Self::new()?;
        Ok(())
    }

    /// Feed the speaker reference and microphone capture to AEC3 as one 10 ms frame.
    pub(crate) fn process_frame(
        &mut self,
        render: &[i16],
        capture: &[i16],
    ) -> Result<Vec<i16>, String> {
        if render.len() != FRAME_SAMPLES || capture.len() != FRAME_SAMPLES {
            return Err(format!(
                "AEC expected {FRAME_SAMPLES}-sample frames, got render={} capture={}",
                render.len(),
                capture.len()
            ));
        }

        let mut render_out = [0_i16; FRAME_SAMPLES];
        self.processor
            .process_render_i16(render, &mut render_out)
            .map_err(|err| format!("AEC render processing failed: {err}"))?;

        let mut capture_out = [0_i16; FRAME_SAMPLES];
        self.processor
            .process_capture_i16(capture, &mut capture_out)
            .map_err(|err| format!("AEC microphone processing failed: {err}"))?;

        Ok(capture_out.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::{EchoCanceller, FRAME_SAMPLES};

    #[test]
    fn aec3_reduces_delayed_far_end_echo_after_adaptation() {
        const TOTAL_FRAMES: usize = 3_000;
        const WARMUP_FRAMES: usize = 2_000;
        const DELAY_FRAMES: usize = 5;

        let mut canceller = EchoCanceller::new().expect("AEC3 should initialize");
        let mut reference_history = vec![[0_i16; FRAME_SAMPLES]; DELAY_FRAMES];
        let mut random = 0x1234_5678_u32;
        let mut render_memory = 0.0_f64;
        let mut residual_echo_energy = 0.0_f64;
        let mut original_echo_energy = 0.0_f64;

        for frame_index in 0..TOTAL_FRAMES {
            let mut render = [0_i16; FRAME_SAMPLES];
            for sample in &mut render {
                random = random.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let noise = ((random >> 16) as i16) as f64;
                render_memory = render_memory * 0.82 + noise * 0.18;
                *sample = render_memory as i16;
            }

            let history_index = frame_index % DELAY_FRAMES;
            let delayed = reference_history[history_index];
            reference_history[history_index] = render;
            let mut capture = [0_i16; FRAME_SAMPLES];
            for index in 0..FRAME_SAMPLES {
                // A 50% speaker echo delayed by 50 ms.
                let echo = delayed[index] as f64 * 0.5;
                capture[index] = echo.clamp(i16::MIN as f64, i16::MAX as f64) as i16;
                if frame_index >= WARMUP_FRAMES {
                    original_echo_energy += echo * echo;
                }
            }

            // Each frame is supplied once as playout reference and once as mic capture.
            let processed = canceller
                .process_frame(&render, &capture)
                .expect("AEC3 should process valid 10 ms frames");

            if frame_index >= WARMUP_FRAMES {
                for output in processed {
                    let residual = output as f64;
                    residual_echo_energy += residual * residual;
                }
            }
        }

        let reduction_db = 10.0 * (original_echo_energy / residual_echo_energy.max(1.0)).log10();
        assert!(
            reduction_db >= 15.0,
            "echo reduction was only {reduction_db:.1} dB"
        );
    }

    #[test]
    fn aec3_preserves_near_end_voice_when_system_reference_is_silent() {
        const TOTAL_FRAMES: usize = 150;
        let mut canceller = EchoCanceller::new().expect("AEC3 should initialize");
        let mut input_energy = 0.0_f64;
        let mut output_energy = 0.0_f64;

        for frame_index in 0..TOTAL_FRAMES {
            let mut microphone = [0_i16; FRAME_SAMPLES];
            for (index, sample) in microphone.iter_mut().enumerate() {
                let phase = (frame_index * FRAME_SAMPLES + index) as f64;
                *sample = (phase * std::f64::consts::TAU * 220.0 / 16_000.0)
                    .sin()
                    .mul_add(2_000.0, 0.0) as i16;
            }

            let processed = canceller
                .process_frame(&[0; FRAME_SAMPLES], &microphone)
                .expect("AEC3 should process mic-only frames");
            for (input, output) in microphone.iter().zip(processed) {
                input_energy += (*input as f64).powi(2);
                output_energy += (output as f64).powi(2);
            }
        }

        let retained_level = (output_energy / input_energy.max(1.0)).sqrt();
        assert!(
            retained_level >= 0.7,
            "near-end voice level was reduced to {:.0}%",
            retained_level * 100.0
        );
    }

    #[test]
    fn aec3_can_be_recreated_and_process_silence_after_stop() {
        for _ in 0..2 {
            let mut canceller = EchoCanceller::new().expect("AEC3 should initialize per session");
            let output = canceller
                .process_frame(&[0; FRAME_SAMPLES], &[0; FRAME_SAMPLES])
                .expect("silence frames should be accepted");
            assert_eq!(output.len(), FRAME_SAMPLES);
        }
    }
}
