use crate::audio::microphone::MicCapture;
use crate::audio::SystemAudioCapture;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use tauri::{ipc::Channel, State};

/// State for tracking active audio captures
pub struct AudioState {
    pub system_audio: Mutex<SystemAudioCapture>,
    pub microphone: Mutex<MicCapture>,
    pub active_receiver: Mutex<Option<AudioForwarder>>,
}

/// Forwards audio from a receiver to a Tauri IPC channel
pub struct AudioForwarder {
    /// Handle to signal stop
    stop_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// The recorder must finish writing the WAV header before a caller can
    /// safely start another capture or play the completed recording.
    worker: Option<std::thread::JoinHandle<()>>,
    received_samples: std::sync::Arc<AtomicU64>,
    nonzero_samples: std::sync::Arc<AtomicU64>,
    rms_milli: std::sync::Arc<AtomicU64>,
}

impl AudioForwarder {
    fn stop(mut self) {
        self.stop_flag
            .store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[derive(Serialize, Clone)]
pub struct PermissionStatus {
    pub screen_recording: String,
    pub microphone: String,
}

#[derive(Serialize, Clone)]
pub struct CaptureStatus {
    pub received_samples: u64,
    pub nonzero_samples: u64,
    pub rms: f64,
    pub microphone_received_samples: u64,
    pub microphone_nonzero_samples: u64,
    pub microphone_rms: f64,
}

/// Start audio capture and forward data to the frontend via IPC channel.
/// If `record_path` is specified, also streams PCM audio to a valid .wav file.
#[tauri::command]
pub async fn start_capture(
    source: String,
    channel: Channel<Vec<u8>>,
    record_path: Option<String>,
    state: State<'_, AudioState>,
) -> Result<(), String> {
    // Stop any existing capture first
    stop_capture_inner(&state);

    let receiver: mpsc::Receiver<Vec<u8>> = match source.as_str() {
        "system" => {
            let mut sys = state.system_audio.lock().map_err(|e| e.to_string())?;
            sys.start()?
        }
        "microphone" => {
            let mut mic = state.microphone.lock().map_err(|e| e.to_string())?;
            mic.start()?
        }
        "both" => {
            // Start both sources and digitally mix into a single 16kHz mono receiver
            let mut sys = state.system_audio.lock().map_err(|e| e.to_string())?;
            let sys_rx = sys.start()?;
            let mut mic = state.microphone.lock().map_err(|e| e.to_string())?;
            let mic_rx = mic.start()?;

            let (merged_tx, merged_rx) = mpsc::channel::<Vec<u8>>();

            std::thread::spawn(move || {
                let mut sys_buf: VecDeque<i16> = VecDeque::with_capacity(8000);
                let mut mic_buf: VecDeque<i16> = VecDeque::with_capacity(8000);

                loop {
                    // Drain sys_rx
                    while let Ok(data) = sys_rx.try_recv() {
                        for chunk in data.chunks_exact(2) {
                            sys_buf.push_back(i16::from_le_bytes([chunk[0], chunk[1]]));
                        }
                    }
                    // Drain mic_rx
                    while let Ok(data) = mic_rx.try_recv() {
                        for chunk in data.chunks_exact(2) {
                            mic_buf.push_back(i16::from_le_bytes([chunk[0], chunk[1]]));
                        }
                    }

                    // Prevent buffer bloat if one side produces more samples (> 1 sec = 16000 samples)
                    if sys_buf.len() > 16000 {
                        let excess = sys_buf.len() - 16000;
                        sys_buf.drain(..excess);
                    }
                    if mic_buf.len() > 16000 {
                        let excess = mic_buf.len() - 16000;
                        mic_buf.drain(..excess);
                    }

                    let available = std::cmp::max(sys_buf.len(), mic_buf.len());
                    if available >= 800 {
                        // at least 50ms (800 samples at 16kHz)
                        let chunk_len = available.min(1600); // up to 100ms
                        let mut mixed_bytes = Vec::with_capacity(chunk_len * 2);
                        for _ in 0..chunk_len {
                            let s1 = sys_buf.pop_front().unwrap_or(0) as i32;
                            let s2 = mic_buf.pop_front().unwrap_or(0) as i32;
                            let mixed = (s1 + s2).clamp(-32768, 32767) as i16;
                            mixed_bytes.extend_from_slice(&mixed.to_le_bytes());
                        }
                        if merged_tx.send(mixed_bytes).is_err() {
                            break;
                        }
                    }

                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
            });

            merged_rx
        }
        _ => return Err(format!("Unknown source: {}", source)),
    };

    // Spawn a thread to forward audio data from receiver to IPC channel
    let stop_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_flag_clone = stop_flag.clone();
    let received_samples = std::sync::Arc::new(AtomicU64::new(0));
    let nonzero_samples = std::sync::Arc::new(AtomicU64::new(0));
    let rms_milli = std::sync::Arc::new(AtomicU64::new(0));
    let received_samples_clone = received_samples.clone();
    let nonzero_samples_clone = nonzero_samples.clone();
    let rms_milli_clone = rms_milli.clone();
    let record_path_clone = record_path;

    let source_clone = source.clone();
    let worker = std::thread::spawn(move || {
        use std::io::{BufWriter, Read, Seek, Write};
        let mut buffer: Vec<u8> = Vec::with_capacity(32000); // ~1 sec at 16kHz s16le
        let batch_interval = std::time::Duration::from_millis(200);
        let mut last_flush = std::time::Instant::now();
        let start_time = std::time::Instant::now();
        let mut last_heartbeat = std::time::Instant::now();
        let heartbeat_interval = std::time::Duration::from_secs(30);

        // Optional WAV file recording with 64KB buffer
        let mut total_pcm_bytes: u32 = 0;
        let mut wav_error: Option<String> = None;
        let mut wav_writer: Option<BufWriter<std::fs::File>> =
            if let Some(ref path_str) = record_path_clone {
                let path = std::path::Path::new(path_str);
                if path.exists() {
                    // Resume existing session audio file
                    match std::fs::OpenOptions::new()
                        .read(true)
                        .write(true)
                        .open(path)
                    {
                        Ok(mut f) => {
                            let mut len_bytes = [0u8; 4];
                            if f.seek(std::io::SeekFrom::Start(40)).is_ok()
                                && f.read_exact(&mut len_bytes).is_ok()
                            {
                                total_pcm_bytes = u32::from_le_bytes(len_bytes);
                            }
                            let _ = f.seek(std::io::SeekFrom::End(0));
                            Some(BufWriter::with_capacity(64 * 1024, f))
                        }
                        Err(err) => {
                            wav_error = Some(format!("open existing recording failed: {}", err));
                            None
                        }
                    }
                } else {
                    // New session audio file
                    if let Some(parent) = path.parent() {
                        if let Err(err) = std::fs::create_dir_all(parent) {
                            wav_error = Some(format!("create recording directory failed: {}", err));
                        }
                    }
                    match std::fs::OpenOptions::new()
                        .create(true)
                        .write(true)
                        .truncate(true)
                        .open(path)
                    {
                        Ok(mut f) => {
                            let mut header = [0u8; 44];
                            header[0..4].copy_from_slice(b"RIFF");
                            header[8..12].copy_from_slice(b"WAVE");
                            header[12..16].copy_from_slice(b"fmt ");
                            header[16..20].copy_from_slice(&16u32.to_le_bytes());
                            header[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
                            header[22..24].copy_from_slice(&1u16.to_le_bytes()); // 1 channel (mono)
                            header[24..28].copy_from_slice(&16000u32.to_le_bytes()); // 16kHz
                            header[28..32].copy_from_slice(&32000u32.to_le_bytes()); // Byte rate
                            header[32..34].copy_from_slice(&2u16.to_le_bytes()); // Block align
                            header[34..36].copy_from_slice(&16u16.to_le_bytes()); // 16 bits
                            header[36..40].copy_from_slice(b"data");
                            match f.write_all(&header) {
                                Ok(()) => Some(BufWriter::with_capacity(64 * 1024, f)),
                                Err(err) => {
                                    wav_error = Some(format!("write WAV header failed: {}", err));
                                    None
                                }
                            }
                        }
                        Err(err) => {
                            wav_error = Some(format!("create recording file failed: {}", err));
                            None
                        }
                    }
                }
            } else {
                None
            };

        loop {
            if stop_flag_clone.load(std::sync::atomic::Ordering::SeqCst) {
                // Flush remaining buffer before exit
                if !buffer.is_empty() {
                    let _ = channel.send(std::mem::take(&mut buffer));
                }
                break;
            }

            match receiver.recv_timeout(std::time::Duration::from_millis(10)) {
                Ok(data) => {
                    let mut sum_squares = 0.0f64;
                    let mut samples = 0u64;
                    let mut nonzero = 0u64;
                    for chunk in data.chunks_exact(2) {
                        let sample = i16::from_le_bytes([chunk[0], chunk[1]]) as f64 / 32768.0;
                        sum_squares += sample * sample;
                        samples += 1;
                        if sample.abs() > 0.0005 {
                            nonzero += 1;
                        }
                    }
                    if samples > 0 {
                        received_samples_clone.fetch_add(samples, Ordering::Relaxed);
                        nonzero_samples_clone.fetch_add(nonzero, Ordering::Relaxed);
                        let rms = (sum_squares / samples as f64).sqrt();
                        rms_milli_clone.store((rms * 1000.0).round() as u64, Ordering::Relaxed);
                    }
                    if let Some(ref mut writer) = wav_writer {
                        match writer.write_all(&data) {
                            Ok(()) => {
                                total_pcm_bytes = total_pcm_bytes.saturating_add(data.len() as u32);
                            }
                            Err(err) => {
                                if wav_error.is_none() {
                                    wav_error = Some(format!("write PCM data failed: {}", err));
                                }
                            }
                        }
                    }
                    buffer.extend_from_slice(&data);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if !buffer.is_empty() {
                        let _ = channel.send(std::mem::take(&mut buffer));
                    }
                    break;
                }
            }

            // Flush buffer every 200ms
            if last_flush.elapsed() >= batch_interval && !buffer.is_empty() {
                if let Err(_e) = channel.send(std::mem::take(&mut buffer)) {
                    break; // Channel closed
                }
                last_flush = std::time::Instant::now();
            }

            // Periodic heartbeat log (every 30s)
            if last_heartbeat.elapsed() >= heartbeat_interval {
                let rec = received_samples_clone.load(Ordering::Relaxed);
                let nonz = nonzero_samples_clone.load(Ordering::Relaxed);
                let rms = rms_milli_clone.load(Ordering::Relaxed) as f64 / 1000.0;
                let elapsed = start_time.elapsed().as_secs();
                eprintln!(
                    "[audio-heartbeat] source={} elapsed={}s total_pcm_bytes={} received_samples={} nonzero_samples={} current_rms={:.3}",
                    source_clone, elapsed, total_pcm_bytes, rec, nonz, rms
                );
                last_heartbeat = std::time::Instant::now();
            }
        }

        // Finalize WAV file header
        if let Some(mut writer) = wav_writer {
            if let Err(err) = writer.flush() {
                if wav_error.is_none() {
                    wav_error = Some(format!("flush recording failed: {}", err));
                }
            }
            match writer.into_inner() {
                Ok(mut f) => {
                    match f.seek(std::io::SeekFrom::Start(4)) {
                        Ok(_) => {
                            if let Err(err) =
                                f.write_all(&(total_pcm_bytes.saturating_add(36)).to_le_bytes())
                            {
                                if wav_error.is_none() {
                                    wav_error = Some(format!("write RIFF size failed: {}", err));
                                }
                            }
                        }
                        Err(err) => {
                            if wav_error.is_none() {
                                wav_error = Some(format!("seek RIFF size failed: {}", err));
                            }
                        }
                    }
                    match f.seek(std::io::SeekFrom::Start(40)) {
                        Ok(_) => {
                            if let Err(err) = f.write_all(&total_pcm_bytes.to_le_bytes()) {
                                if wav_error.is_none() {
                                    wav_error =
                                        Some(format!("write WAV data size failed: {}", err));
                                }
                            }
                        }
                        Err(err) => {
                            if wav_error.is_none() {
                                wav_error = Some(format!("seek WAV data size failed: {}", err));
                            }
                        }
                    }
                    if let Err(err) = f.flush() {
                        if wav_error.is_none() {
                            wav_error = Some(format!("flush finalized recording failed: {}", err));
                        }
                    }
                }
                Err(err) => {
                    if wav_error.is_none() {
                        wav_error = Some(format!("finalize recording writer failed: {}", err));
                    }
                }
            }
        }

        if wav_error.is_none() {
            if let Some(path_str) = record_path_clone.as_deref() {
                match std::fs::metadata(path_str) {
                    Ok(metadata) => {
                        let expected_size = 44u64 + u64::from(total_pcm_bytes);
                        if metadata.len() != expected_size {
                            wav_error = Some(format!(
                                "recording size mismatch: actual={} expected={}",
                                metadata.len(),
                                expected_size
                            ));
                        }
                    }
                    Err(err) => {
                        wav_error =
                            Some(format!("read finalized recording metadata failed: {}", err));
                    }
                }
            }
        }

        if let Some(err) = wav_error {
            let path = record_path_clone.as_deref().unwrap_or("<none>");
            eprintln!("[audio-recording] failed to finalize {}: {}", path, err);
        }

        let rec = received_samples_clone.load(Ordering::Relaxed);
        let elapsed = start_time.elapsed().as_secs_f64();
        eprintln!(
            "[audio-heartbeat] capture ended: source={} elapsed={:.1}s total_pcm_bytes={} total_samples={}",
            source_clone, elapsed, total_pcm_bytes, rec
        );
    });

    // Store the forwarder so we can stop it later
    let forwarder = AudioForwarder {
        stop_flag,
        worker: Some(worker),
        received_samples,
        nonzero_samples,
        rms_milli,
    };
    let mut active = state.active_receiver.lock().map_err(|e| e.to_string())?;
    *active = Some(forwarder);

    Ok(())
}

/// Inspect whether the active stream is producing samples. This is separate
/// from permission status because a granted microphone can still be silent or
/// fail after the stream is opened.
#[tauri::command]
pub fn get_capture_status(state: State<'_, AudioState>) -> Result<CaptureStatus, String> {
    let active = state.active_receiver.lock().map_err(|e| e.to_string())?;
    let microphone = state.microphone.lock().map_err(|e| e.to_string())?.status();
    if let Some(forwarder) = active.as_ref() {
        Ok(CaptureStatus {
            received_samples: forwarder.received_samples.load(Ordering::Relaxed),
            nonzero_samples: forwarder.nonzero_samples.load(Ordering::Relaxed),
            rms: forwarder.rms_milli.load(Ordering::Relaxed) as f64 / 1000.0,
            microphone_received_samples: microphone.received_samples,
            microphone_nonzero_samples: microphone.nonzero_samples,
            microphone_rms: microphone.rms,
        })
    } else {
        Ok(CaptureStatus {
            received_samples: 0,
            nonzero_samples: 0,
            rms: 0.0,
            microphone_received_samples: microphone.received_samples,
            microphone_nonzero_samples: microphone.nonzero_samples,
            microphone_rms: microphone.rms,
        })
    }
}

/// Stop audio capture
#[tauri::command]
pub async fn stop_capture(state: State<'_, AudioState>) -> Result<(), String> {
    stop_capture_inner(&state);
    Ok(())
}

fn stop_capture_inner(state: &AudioState) {
    // Stop the forwarder
    if let Ok(mut active) = state.active_receiver.lock() {
        if let Some(forwarder) = active.take() {
            forwarder.stop();
        }
    }

    // Stop system audio
    if let Ok(mut sys) = state.system_audio.lock() {
        sys.stop();
    }

    // Stop microphone
    if let Ok(mut mic) = state.microphone.lock() {
        mic.stop();
    }
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGRequestScreenCaptureAccess() -> bool;
    fn CGPreflightScreenCaptureAccess() -> bool;
}

/// Request screen and system audio recording permission from macOS
#[tauri::command]
pub fn request_screen_capture_permission() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        CGRequestScreenCaptureAccess()
    }
    #[cfg(not(target_os = "macos"))]
    true
}

/// Check audio capture permissions
#[tauri::command]
pub fn check_permissions() -> PermissionStatus {
    #[cfg(target_os = "macos")]
    let screen = unsafe {
        if CGPreflightScreenCaptureAccess() {
            "granted".to_string()
        } else {
            "not_determined".to_string()
        }
    };
    #[cfg(not(target_os = "macos"))]
    let screen = "granted".to_string();

    #[cfg(target_os = "macos")]
    let microphone = macos_microphone_permission::status();
    #[cfg(not(target_os = "macos"))]
    let microphone = "granted".to_string();

    PermissionStatus {
        screen_recording: screen,
        microphone,
    }
}

/// Ask macOS for microphone access. The first call displays the system prompt;
/// subsequent calls resolve immediately with the existing TCC decision.
#[tauri::command]
pub fn request_microphone_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_microphone_permission::request()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[cfg(target_os = "macos")]
mod macos_microphone_permission {
    use block2::RcBlock;
    use std::ffi::CString;
    use std::os::raw::{c_char, c_void};
    use std::sync::{Arc, Condvar, Mutex};

    type ObjcId = *mut c_void;

    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {}

    #[link(name = "objc", kind = "dylib")]
    extern "C" {
        fn objc_getClass(name: *const c_char) -> ObjcId;
        fn sel_registerName(name: *const c_char) -> ObjcId;
        fn objc_msgSend();
    }

    unsafe fn send_with_arg<T>(receiver: ObjcId, selector: ObjcId, arg: *const c_void) -> T {
        let send: unsafe extern "C" fn(ObjcId, ObjcId, *const c_void) -> T =
            std::mem::transmute(objc_msgSend as *const ());
        send(receiver, selector, arg)
    }

    unsafe fn send_with_two_args<T>(
        receiver: ObjcId,
        selector: ObjcId,
        first: *const c_void,
        second: *const c_void,
    ) -> T {
        let send: unsafe extern "C" fn(ObjcId, ObjcId, *const c_void, *const c_void) -> T =
            std::mem::transmute(objc_msgSend as *const ());
        send(receiver, selector, first, second)
    }

    unsafe fn class(name: &str) -> ObjcId {
        let name = CString::new(name).expect("Objective-C class name cannot contain NUL");
        objc_getClass(name.as_ptr())
    }

    unsafe fn selector(name: &str) -> ObjcId {
        let name = CString::new(name).expect("Objective-C selector cannot contain NUL");
        sel_registerName(name.as_ptr())
    }

    unsafe fn audio_media_type() -> ObjcId {
        let ns_string = class("NSString");
        let selector = selector("stringWithUTF8String:");
        let value = CString::new("soun").expect("audio media type");
        send_with_arg(ns_string, selector, value.as_ptr().cast())
    }

    pub fn status() -> String {
        unsafe {
            let device = class("AVCaptureDevice");
            let selector = selector("authorizationStatusForMediaType:");
            let status: isize = send_with_arg(device, selector, audio_media_type().cast());
            match status {
                0 => "not_determined",
                1 => "restricted",
                2 => "denied",
                3 => "granted",
                _ => "unknown",
            }
            .to_string()
        }
    }

    pub fn request() -> bool {
        let result = Arc::new((Mutex::new(None), Condvar::new()));
        let result_for_block = result.clone();
        // Objective-C BOOL is a one-byte value on macOS. `i8` is used here
        // because block2 intentionally does not encode Rust's `bool`.
        let completion: RcBlock<dyn Fn(i8)> = RcBlock::new(move |granted| {
            let (lock, condvar) = &*result_for_block;
            if let Ok(mut value) = lock.lock() {
                *value = Some(granted != 0);
                condvar.notify_one();
            }
        });

        unsafe {
            let device = class("AVCaptureDevice");
            let selector = selector("requestAccessForMediaType:completionHandler:");
            let _ = send_with_two_args::<()>(
                device,
                selector,
                audio_media_type().cast(),
                RcBlock::as_ptr(&completion).cast(),
            );
        }

        let (lock, condvar) = &*result;
        let guard = match lock.lock() {
            Ok(guard) => guard,
            Err(_) => return false,
        };
        let guard = condvar
            .wait_timeout_while(guard, std::time::Duration::from_secs(10), |value| {
                value.is_none()
            })
            .ok();
        guard.and_then(|(value, _)| *value).unwrap_or(false)
    }
}
