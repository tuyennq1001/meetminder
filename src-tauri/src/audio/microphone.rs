use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;

use super::TARGET_SAMPLE_RATE;

/// 2nd-order Biquad filter (Direct Form II Transposed).
#[derive(Clone, Copy, Debug)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    fn new_lowpass(sample_rate: f64, cutoff: f64, q: f64) -> Self {
        let omega = std::f64::consts::TAU * cutoff / sample_rate;
        let sin_omega = omega.sin();
        let cos_omega = omega.cos();
        let alpha = sin_omega / (2.0 * q);

        let b0 = (1.0 - cos_omega) / 2.0;
        let b1 = 1.0 - cos_omega;
        let b2 = (1.0 - cos_omega) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_omega;
        let a2 = 1.0 - alpha;

        Self {
            b0: (b0 / a0) as f32,
            b1: (b1 / a0) as f32,
            b2: (b2 / a0) as f32,
            a1: (a1 / a0) as f32,
            a2: (a2 / a0) as f32,
            z1: 0.0,
            z2: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

/// 4th-order Butterworth low-pass filter (cascade of two biquads, -24 dB/octave).
/// Provides a maximally flat passband for speech with steep roll-off to suppress aliasing.
#[derive(Clone, Copy, Debug)]
struct Butterworth4thOrderLowPass {
    stage1: Biquad,
    stage2: Biquad,
}

impl Butterworth4thOrderLowPass {
    fn new(source_rate: u32, target_rate: u32) -> Option<Self> {
        if source_rate <= target_rate {
            return None;
        }
        // Cutoff at ~7200 Hz gives a transparent speech passband (0-7kHz)
        // while attenuating everything at and above the 8kHz Nyquist of 16kHz audio.
        let cutoff = (target_rate as f64 * 0.45).min(source_rate as f64 * 0.45);
        let fs = source_rate as f64;
        // Butterworth 4th order Q factors: Q1 = 1 / (2 * cos(pi/8)), Q2 = 1 / (2 * cos(3*pi/8))
        let q1 = 1.0 / (2.0 * (std::f64::consts::PI / 8.0).cos());
        let q2 = 1.0 / (2.0 * (3.0 * std::f64::consts::PI / 8.0).cos());

        Some(Self {
            stage1: Biquad::new_lowpass(fs, cutoff, q1),
            stage2: Biquad::new_lowpass(fs, cutoff, q2),
        })
    }

    #[inline]
    fn process(&mut self, sample: f32) -> f32 {
        self.stage2.process(self.stage1.process(sample))
    }
}

/// Stateful resampling keeps the fractional source position between CPAL
/// callbacks. Re-starting interpolation at zero for every callback drops a
/// different number of source frames (especially at 44.1/48 kHz), producing
/// periodic timing discontinuities and audible roughness.
pub(crate) struct StreamingLinearResampler {
    step: f64,
    position: f64,
    samples: Vec<f32>,
    lowpass: Option<Butterworth4thOrderLowPass>,
}

impl StreamingLinearResampler {
    pub(crate) fn new(source_rate: u32, target_rate: u32) -> Self {
        Self {
            step: source_rate as f64 / target_rate as f64,
            position: 0.0,
            samples: Vec::new(),
            lowpass: Butterworth4thOrderLowPass::new(source_rate, target_rate),
        }
    }

    pub(crate) fn push(&mut self, input: &[f32]) -> Vec<f32> {
        if input.is_empty() {
            return Vec::new();
        }
        if self.step == 1.0 {
            return input.to_vec();
        }

        if let Some(lowpass) = &mut self.lowpass {
            self.samples
                .extend(input.iter().map(|&sample| lowpass.process(sample)));
        } else {
            self.samples.extend_from_slice(input);
        }

        let mut output = Vec::with_capacity((input.len() as f64 / self.step).ceil() as usize);
        while self.position + 1.0 < self.samples.len() as f64 {
            let index = self.position.floor() as usize;
            let fraction = self.position - index as f64;
            output.push(
                (self.samples[index] as f64 * (1.0 - fraction)
                    + self.samples[index + 1] as f64 * fraction) as f32,
            );
            self.position += self.step;
        }

        // Retain the sample immediately before the next interpolation point
        // so the next callback joins continuously to this one.
        let removable = (self.position.floor() as usize).min(self.samples.len() - 1);
        if removable > 0 {
            self.samples.drain(..removable);
            self.position -= removable as f64;
        }
        output
    }
}

pub(crate) fn f32_to_pcm_s16le(samples: &[f32]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|&sample| ((sample.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes())
        .collect()
}

/// Microphone capture using cpal.
/// Captures from the default input device and converts to PCM s16le 16kHz mono.
pub struct MicCapture {
    is_capturing: Arc<AtomicBool>,
    received_samples: Arc<AtomicU64>,
    nonzero_samples: Arc<AtomicU64>,
    rms_milli: Arc<AtomicU64>,
    /// We store the stream here to keep it alive.
    /// cpal::Stream is !Send, so can't move to another thread.
    /// Using Box<dyn StreamTrait> to erase the concrete type.
    _stream: Option<cpal::Stream>,
}

// SAFETY: MicCapture is only accessed through Mutex in AudioState,
// so concurrent access is properly synchronized. The cpal::Stream
// is created and dropped on the same thread (main thread via Tauri command).
unsafe impl Send for MicCapture {}

impl MicCapture {
    pub fn new() -> Self {
        Self {
            is_capturing: Arc::new(AtomicBool::new(false)),
            received_samples: Arc::new(AtomicU64::new(0)),
            nonzero_samples: Arc::new(AtomicU64::new(0)),
            rms_milli: Arc::new(AtomicU64::new(0)),
            _stream: None,
        }
    }

    /// Start capturing from the microphone.
    /// Returns a receiver that yields PCM s16le 16kHz mono audio chunks.
    pub fn start(&mut self) -> Result<mpsc::Receiver<Vec<u8>>, String> {
        if self.is_capturing.load(Ordering::SeqCst) {
            return Err("Already capturing".to_string());
        }

        let host = cpal::default_host();

        // List available input devices for debugging
        let input_devices: Vec<String> = match host.input_devices() {
            Ok(devs) => devs.filter_map(|d| d.name().ok()).collect(),
            Err(e) => {
                eprintln!("[Mic] Failed to enumerate input devices: {}", e);
                Vec::new()
            }
        };
        println!("[Mic] Available input devices: {:?}", input_devices);

        // Do not reject an empty enumeration immediately: on macOS, CoreAudio
        // can temporarily hide devices while microphone permission is pending.
        let device = host.default_input_device().ok_or_else(|| {
            if input_devices.is_empty() {
                "No microphone input device is available. Check that a mic is connected and that Meet Minder has Microphone permission in System Settings > Privacy & Security > Microphone.".to_string()
            } else {
                "No default microphone found. Select a default input device in System Settings > Sound > Input.".to_string()
            }
        })?;

        println!("[Mic] Device: {:?}", device.name().unwrap_or_default());

        // Try default config first, fallback to supported configs
        let default_config = device
            .default_input_config()
            .or_else(|e| {
                println!(
                    "[Mic] default_input_config failed: {}, trying supported configs",
                    e
                );
                // Fallback: find a supported config
                let mut configs = device
                    .supported_input_configs()
                    .map_err(|e2| format!("No supported input configs: {}", e2))?;
                // Prefer F32, then I16
                configs
                    .find(|c| c.sample_format() == cpal::SampleFormat::F32)
                    .or_else(|| {
                        device
                            .supported_input_configs()
                            .ok()
                            .and_then(|mut c| c.next())
                    })
                    .map(|c| {
                        // Pick sample rate: prefer 48kHz, else max
                        let rate =
                            if c.min_sample_rate().0 <= 48000 && c.max_sample_rate().0 >= 48000 {
                                cpal::SampleRate(48000)
                            } else {
                                c.max_sample_rate()
                            };
                        c.with_sample_rate(rate)
                    })
                    .ok_or_else(|| format!("No suitable input config found (original: {})", e))
            })
            .map_err(|e| format!("Failed to get default input config: {}", e))?;

        println!(
            "[Mic] Config: rate={}, channels={}, format={:?}",
            default_config.sample_rate().0,
            default_config.channels(),
            default_config.sample_format()
        );

        let source_sample_rate = default_config.sample_rate().0;
        let source_channels = default_config.channels() as usize;

        let (sender, receiver) = mpsc::channel::<Vec<u8>>();
        self.is_capturing.store(true, Ordering::SeqCst);
        self.received_samples.store(0, Ordering::Relaxed);
        self.nonzero_samples.store(0, Ordering::Relaxed);
        self.rms_milli.store(0, Ordering::Relaxed);
        let is_capturing = self.is_capturing.clone();

        // Build the input config targeting our desired format
        let stream_config = cpal::StreamConfig {
            channels: default_config.channels(),
            sample_rate: default_config.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };

        let target_rate = TARGET_SAMPLE_RATE;
        let err_fn = |err| eprintln!("[Mic] Input stream error: {}", err);

        let stream = match default_config.sample_format() {
            cpal::SampleFormat::F32 => {
                let received_samples = self.received_samples.clone();
                let nonzero_samples = self.nonzero_samples.clone();
                let rms_milli = self.rms_milli.clone();
                let mut resampler = StreamingLinearResampler::new(source_sample_rate, target_rate);
                device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if !is_capturing.load(Ordering::SeqCst) {
                            return;
                        }
                        let mono = mix_f32_to_mono(data, source_channels);
                        let pcm = f32_to_pcm_s16le(&resampler.push(&mono));
                        if !pcm.is_empty() {
                            update_pcm_stats(&pcm, &received_samples, &nonzero_samples, &rms_milli);
                            let _ = sender.send(pcm);
                        }
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let is_capturing = self.is_capturing.clone();
                let received_samples = self.received_samples.clone();
                let nonzero_samples = self.nonzero_samples.clone();
                let rms_milli = self.rms_milli.clone();
                let mut resampler = StreamingLinearResampler::new(source_sample_rate, target_rate);
                device.build_input_stream(
                    &stream_config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if !is_capturing.load(Ordering::SeqCst) {
                            return;
                        }
                        let mono = mix_i16_to_mono(data, source_channels);
                        let pcm = f32_to_pcm_s16le(&resampler.push(&mono));
                        if !pcm.is_empty() {
                            update_pcm_stats(&pcm, &received_samples, &nonzero_samples, &rms_milli);
                            let _ = sender.send(pcm);
                        }
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let is_capturing = self.is_capturing.clone();
                let received_samples = self.received_samples.clone();
                let nonzero_samples = self.nonzero_samples.clone();
                let rms_milli = self.rms_milli.clone();
                let mut resampler = StreamingLinearResampler::new(source_sample_rate, target_rate);
                device.build_input_stream(
                    &stream_config,
                    move |data: &[u16], _: &cpal::InputCallbackInfo| {
                        if !is_capturing.load(Ordering::SeqCst) {
                            return;
                        }
                        let mono = mix_u16_to_mono(data, source_channels);
                        let pcm = f32_to_pcm_s16le(&resampler.push(&mono));
                        if !pcm.is_empty() {
                            update_pcm_stats(&pcm, &received_samples, &nonzero_samples, &rms_milli);
                            let _ = sender.send(pcm);
                        }
                    },
                    err_fn,
                    None,
                )
            }
            format => {
                return Err(format!("Unsupported sample format: {:?}", format));
            }
        }
        .map_err(|e| {
            self.is_capturing.store(false, Ordering::SeqCst);
            format!("Failed to build input stream: {}", e)
        })?;

        if let Err(e) = stream.play() {
            self.is_capturing.store(false, Ordering::SeqCst);
            return Err(format!("Failed to start mic stream: {}", e));
        }

        // Store stream to keep it alive
        self._stream = Some(stream);

        Ok(receiver)
    }

    pub fn stop(&mut self) {
        self.is_capturing.store(false, Ordering::SeqCst);
        // Drop the stream to stop capturing
        self._stream = None;
    }

    pub fn is_capturing(&self) -> bool {
        self.is_capturing.load(Ordering::SeqCst)
    }

    pub fn status(&self) -> MicCaptureStats {
        MicCaptureStats {
            received_samples: self.received_samples.load(Ordering::Relaxed),
            nonzero_samples: self.nonzero_samples.load(Ordering::Relaxed),
            rms: self.rms_milli.load(Ordering::Relaxed) as f64 / 1000.0,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct MicCaptureStats {
    pub received_samples: u64,
    pub nonzero_samples: u64,
    pub rms: f64,
}

fn update_pcm_stats(
    pcm: &[u8],
    received_samples: &AtomicU64,
    nonzero_samples: &AtomicU64,
    rms_milli: &AtomicU64,
) {
    let mut sum_squares = 0.0f64;
    let mut samples = 0u64;
    let mut nonzero = 0u64;
    for chunk in pcm.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]) as f64 / 32768.0;
        sum_squares += sample * sample;
        samples += 1;
        if sample.abs() > 0.0005 {
            nonzero += 1;
        }
    }
    if samples > 0 {
        received_samples.fetch_add(samples, Ordering::Relaxed);
        nonzero_samples.fetch_add(nonzero, Ordering::Relaxed);
        rms_milli.store(
            ((sum_squares / samples as f64).sqrt() * 1000.0).round() as u64,
            Ordering::Relaxed,
        );
    }
}

impl Default for MicCapture {
    fn default() -> Self {
        Self::new()
    }
}

fn mix_f32_to_mono(data: &[f32], channels: usize) -> Vec<f32> {
    if channels > 1 {
        data.chunks_exact(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        data.to_vec()
    }
}

fn mix_i16_to_mono(data: &[i16], channels: usize) -> Vec<f32> {
    if channels > 1 {
        data.chunks_exact(channels)
            .map(|frame| {
                let sum: f32 = frame.iter().map(|&s| s as f32).sum();
                sum / (channels as f32 * 32768.0)
            })
            .collect()
    } else {
        data.iter().map(|&s| s as f32 / 32768.0).collect()
    }
}

fn mix_u16_to_mono(data: &[u16], channels: usize) -> Vec<f32> {
    if channels > 1 {
        data.chunks_exact(channels)
            .map(|frame| {
                let sum: f32 = frame.iter().map(|&s| (s as f32 - 32768.0) / 32768.0).sum();
                sum / channels as f32
            })
            .collect()
    } else {
        data.iter()
            .map(|&s| (s as f32 - 32768.0) / 32768.0)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::StreamingLinearResampler;

    #[test]
    fn streaming_resampler_does_not_depend_on_callback_boundaries() {
        let input: Vec<f32> = (0..48_000)
            .map(|index| ((index as f32) * 0.017).sin())
            .collect();
        let mut whole = StreamingLinearResampler::new(48_000, 16_000);
        let expected = whole.push(&input);
        let mut chunked = StreamingLinearResampler::new(48_000, 16_000);
        let mut actual = Vec::new();
        for chunk in input.chunks(512) {
            actual.extend(chunked.push(chunk));
        }
        assert_eq!(actual.len(), expected.len());
        for (actual, expected) in actual.iter().zip(expected.iter()) {
            assert!((actual - expected).abs() < 1e-6);
        }
    }

    #[test]
    fn butterworth_lowpass_attenuates_above_nyquist() {
        let sample_rate = 48_000.0;
        let mut filter = super::Butterworth4thOrderLowPass::new(48_000, 16_000).unwrap();

        // Feed 1 kHz tone (passband)
        let mut rms_1k = 0.0f32;
        for i in 0..4800 {
            let sample =
                (2.0 * std::f32::consts::PI * 1000.0 * (i as f32) / sample_rate as f32).sin();
            let filtered = filter.process(sample);
            if i >= 480 {
                // Skip initial transient
                rms_1k += filtered * filtered;
            }
        }
        rms_1k = (rms_1k / (4800.0 - 480.0)).sqrt();
        // 1 kHz should pass with minimal attenuation (> 0.95 amplitude)
        assert!(
            rms_1k > 0.65,
            "1 kHz tone should pass through: rms={}",
            rms_1k
        );

        // Feed 12 kHz tone (well above 8 kHz Nyquist of 16 kHz)
        let mut filter_12k = super::Butterworth4thOrderLowPass::new(48_000, 16_000).unwrap();
        let mut rms_12k = 0.0f32;
        for i in 0..4800 {
            let sample =
                (2.0 * std::f32::consts::PI * 12000.0 * (i as f32) / sample_rate as f32).sin();
            let filtered = filter_12k.process(sample);
            if i >= 480 {
                rms_12k += filtered * filtered;
            }
        }
        rms_12k = (rms_12k / (4800.0 - 480.0)).sqrt();
        // 12 kHz should be heavily attenuated (> 20 dB suppression, RMS < 0.07)
        assert!(
            rms_12k < 0.07,
            "12 kHz tone should be heavily attenuated: rms={}",
            rms_12k
        );
    }
}
