use std::sync::mpsc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use super::TARGET_SAMPLE_RATE;

/// System audio capture using WASAPI loopback on Windows.
/// Captures all system audio output and converts to PCM s16le 16kHz mono.
pub struct SystemAudioCapture {
    is_capturing: Arc<AtomicBool>,
}

impl SystemAudioCapture {
    pub fn new() -> Self {
        Self {
            is_capturing: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Start capturing system audio via WASAPI loopback.
    /// Returns a receiver that yields PCM s16le 16kHz mono audio chunks.
    pub fn start(&self) -> Result<mpsc::Receiver<Vec<u8>>, String> {
        use windows::Win32::Media::Audio::*;
        use windows::Win32::System::Com::*;
        use windows::core::*;

        if self.is_capturing.load(Ordering::SeqCst) {
            return Err("Already capturing".to_string());
        }

        let (sender, receiver) = mpsc::channel::<Vec<u8>>();
        let is_capturing = self.is_capturing.clone();
        is_capturing.store(true, Ordering::SeqCst);

        std::thread::spawn(move || {
            unsafe {
                // Initialize COM for this thread
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

                // Get default audio render endpoint (speakers/headphones)
                let enumerator: IMMDeviceEnumerator = CoCreateInstance(
                    &MMDeviceEnumerator,
                    None,
                    CLSCTX_ALL,
                ).expect("Failed to create device enumerator");

                let device = enumerator
                    .GetDefaultAudioEndpoint(eRender, eConsole)
                    .expect("Failed to get default audio endpoint");

                // Activate audio client
                let audio_client: IAudioClient = device
                    .Activate(CLSCTX_ALL, None)
                    .expect("Failed to activate audio client");

                // Get the mix format (native device format)
                let mix_format_ptr = audio_client
                    .GetMixFormat()
                    .expect("Failed to get mix format");
                let mix_format = &*mix_format_ptr;

                let source_rate = mix_format.nSamplesPerSec;
                let source_channels = mix_format.nChannels as u32;
                let bits_per_sample = mix_format.wBitsPerSample;

                // Initialize in loopback mode (captures what's playing)
                audio_client
                    .Initialize(
                        AUDCLNT_SHAREMODE_SHARED,
                        AUDCLNT_STREAMFLAGS_LOOPBACK,
                        10_000_000, // 1 second buffer in 100ns units
                        0,
                        mix_format_ptr,
                        None,
                    )
                    .expect("Failed to initialize audio client in loopback mode");

                // Get capture client
                let capture_client: IAudioCaptureClient = audio_client
                    .GetService()
                    .expect("Failed to get capture client");

                // Start capturing
                audio_client.Start().expect("Failed to start audio client");

                // Capture loop
                while is_capturing.load(Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(10));

                    let packet_size = match capture_client.GetNextPacketSize() {
                        Ok(size) => size,
                        Err(_) => continue,
                    };

                    if packet_size == 0 {
                        continue;
                    }

                    let mut buffer_ptr = std::ptr::null_mut();
                    let mut num_frames = 0u32;
                    let mut flags = 0u32;

                    if capture_client
                        .GetBuffer(&mut buffer_ptr, &mut num_frames, &mut flags, None, None)
                        .is_err()
                    {
                        continue;
                    }

                    if num_frames > 0 && !buffer_ptr.is_null() {
                        let is_silent = (flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)) != 0;

                        if !is_silent {
                            let pcm_data = convert_to_pcm_s16_16k(
                                buffer_ptr,
                                num_frames,
                                source_rate,
                                source_channels,
                                bits_per_sample,
                            );

                            if !pcm_data.is_empty() {
                                if sender.send(pcm_data).is_err() {
                                    break; // Receiver dropped
                                }
                            }
                        }
                    }

                    let _ = capture_client.ReleaseBuffer(num_frames);
                }

                // Cleanup
                let _ = audio_client.Stop();
                CoUninitialize();
            }
        });

        Ok(receiver)
    }

    /// Stop capturing
    pub fn stop(&self) {
        self.is_capturing.store(false, Ordering::SeqCst);
    }

    pub fn is_capturing(&self) -> bool {
        self.is_capturing.load(Ordering::SeqCst)
    }
}

impl Default for SystemAudioCapture {
    fn default() -> Self {
        Self::new()
    }
}

/// Convert raw WASAPI buffer to PCM s16le 16kHz mono
unsafe fn convert_to_pcm_s16_16k(
    buffer_ptr: *mut u8,
    num_frames: u32,
    source_rate: u32,
    source_channels: u32,
    bits_per_sample: u16,
) -> Vec<u8> {
    let frame_count = num_frames as usize;

    // Read samples as f32 (WASAPI typically delivers IEEE float)
    let f32_samples = if bits_per_sample == 32 {
        let ptr = buffer_ptr as *const f32;
        std::slice::from_raw_parts(ptr, frame_count * source_channels as usize)
    } else {
        return Vec::new(); // Unsupported format
    };

    // Take first channel only (mono)
    let mono: Vec<f32> = f32_samples
        .chunks(source_channels as usize)
        .map(|frame| frame[0])
        .collect();

    // Downsample to 16kHz
    let ratio = source_rate as f64 / TARGET_SAMPLE_RATE as f64;
    let output_len = (mono.len() as f64 / ratio) as usize;

    let mut pcm_bytes: Vec<u8> = Vec::with_capacity(output_len * 2);

    for i in 0..output_len {
        let src_idx = (i as f64 * ratio) as usize;
        if src_idx >= mono.len() {
            break;
        }
        let sample = mono[src_idx].clamp(-1.0, 1.0);
        let s16 = (sample * 32767.0) as i16;
        pcm_bytes.extend_from_slice(&s16.to_le_bytes());
    }

    pcm_bytes
}
