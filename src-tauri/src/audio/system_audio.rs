use screencapturekit::prelude::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;

use super::microphone::{f32_to_pcm_s16le, StreamingLinearResampler};
use super::TARGET_SAMPLE_RATE;

/// Audio handler that receives CMSampleBuffer callbacks from ScreenCaptureKit
/// and sends PCM data through a channel.
struct AudioHandler {
    sender: mpsc::Sender<Vec<u8>>,
    resampler: std::sync::Mutex<StreamingLinearResampler>,
}

impl SCStreamOutputTrait for AudioHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, output_type: SCStreamOutputType) {
        match output_type {
            SCStreamOutputType::Audio => {
                if let Some(audio_buffer_list) = sample.audio_buffer_list() {
                    // ScreenCaptureKit with stereo config may deliver audio as:
                    // - 2 separate mono buffers (deinterleaved L/R), OR
                    // - 1 interleaved stereo buffer
                    // We only need ONE channel for speech, so take just the first buffer
                    let mut iter = audio_buffer_list.into_iter();
                    if let Some(audio_buffer) = iter.next() {
                        let raw_data = audio_buffer.data();

                        if raw_data.is_empty() {
                            return;
                        }

                        // Interpret raw bytes as f32 samples (mono — first channel only)
                        let f32_samples: &[f32] = unsafe {
                            std::slice::from_raw_parts(
                                raw_data.as_ptr() as *const f32,
                                raw_data.len() / 4,
                            )
                        };

                        let Ok(mut resampler) = self.resampler.lock() else {
                            return;
                        };
                        let pcm_s16 = f32_to_pcm_s16le(&resampler.push(f32_samples));

                        if !pcm_s16.is_empty() {
                            let _ = self.sender.send(pcm_s16);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

/// Dummy video handler to silently absorb minimal video frames required by ScreenCaptureKit.
/// Without this handler, ScreenCaptureKit logs "stream output NOT found. Dropping frame" at 60Hz and leaks memory.
struct DummyVideoHandler;

impl SCStreamOutputTrait for DummyVideoHandler {
    fn did_output_sample_buffer(&self, _sample: CMSampleBuffer, _output_type: SCStreamOutputType) {
        // Drop video frame cleanly
    }
}

/// System audio capture using ScreenCaptureKit
/// Captures all system audio output and converts to PCM s16le 16kHz mono.
pub struct SystemAudioCapture {
    is_capturing: Arc<AtomicBool>,
    _stream: Option<SCStream>,
}

unsafe impl Send for SystemAudioCapture {}

impl SystemAudioCapture {
    pub fn new() -> Self {
        Self {
            is_capturing: Arc::new(AtomicBool::new(false)),
            _stream: None,
        }
    }

    /// Start capturing system audio.
    /// Returns a receiver that yields PCM s16le 16kHz mono audio chunks.
    pub fn start(&mut self) -> Result<mpsc::Receiver<Vec<u8>>, String> {
        if self.is_capturing.load(Ordering::SeqCst) {
            return Err("Already capturing".to_string());
        }

        // Get available displays
        let content = SCShareableContent::get().map_err(|e| {
            format!(
                "Failed to get shareable content (Screen Recording permission needed): {}",
                e
            )
        })?;

        let display = content
            .displays()
            .into_iter()
            .next()
            .ok_or("No displays found".to_string())?;

        // Create content filter for the main display
        let filter = SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .build();

        // Configure: audio only, 48kHz mono
        // Downsampling to 16kHz mono happens in AudioHandler.
        // Set minimal frame rate (1 frame per 60s) and queue depth 1 so replayd doesn't flood video frames at 60-120fps.
        let min_frame_interval = screencapturekit::cm::CMTime::new(60, 1);
        let config = SCStreamConfiguration::new()
            .with_width(2) // minimal video (required by API)
            .with_height(2)
            .with_minimum_frame_interval(&min_frame_interval)
            .with_queue_depth(1)
            .with_captures_audio(true)
            .with_excludes_current_process_audio(true) // Prevent TTS audio feedback loop
            .with_sample_rate(48000)
            .with_channel_count(1);

        // Create channel for audio data
        let (sender, receiver) = mpsc::channel::<Vec<u8>>();

        let handler = AudioHandler {
            sender,
            resampler: std::sync::Mutex::new(StreamingLinearResampler::new(
                48000,
                TARGET_SAMPLE_RATE,
            )),
        };

        // Create and start the stream
        let mut stream = SCStream::new(&filter, &config);
        stream.add_output_handler(handler, SCStreamOutputType::Audio);
        // Register a dummy video output handler so ScreenCaptureKit does not flood
        // "_SCStream_RemoteVideoQueueOperationHandlerWithError: stream output NOT found" errors and leak memory.
        stream.add_output_handler(DummyVideoHandler, SCStreamOutputType::Screen);

        stream
            .start_capture()
            .map_err(|e| format!("Failed to start system audio capture: {}", e))?;

        self.is_capturing.store(true, Ordering::SeqCst);
        self._stream = Some(stream);

        Ok(receiver)
    }

    /// Stop capturing
    pub fn stop(&mut self) {
        self.is_capturing.store(false, Ordering::SeqCst);
        if let Some(stream) = self._stream.take() {
            let _ = stream.stop_capture();
        }
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
