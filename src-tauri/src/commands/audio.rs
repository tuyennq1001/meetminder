use crate::audio::microphone::MicCapture;
use crate::audio::SystemAudioCapture;
use serde::Serialize;
use std::collections::VecDeque;
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

/// Start audio capture and forward data to the frontend via IPC channel.
/// If `record_path` is specified, also streams PCM audio to a valid .wav file.
#[tauri::command]
pub fn start_capture(
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
                let mut sys_buf: VecDeque<i16> = VecDeque::with_capacity(16000);
                let mut mic_buf: VecDeque<i16> = VecDeque::with_capacity(16000);

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

                    let available = std::cmp::min(sys_buf.len(), mic_buf.len());
                    if available >= 800 { // 50ms chunks at 16kHz
                        let mut mixed_bytes = Vec::with_capacity(available * 2);
                        for i in 0..available {
                            let s1 = sys_buf[i] as i32;
                            let s2 = mic_buf[i] as i32;
                            let mixed = (s1 + s2).clamp(-32768, 32767) as i16;
                            mixed_bytes.extend_from_slice(&mixed.to_le_bytes());
                        }
                        if merged_tx.send(mixed_bytes).is_err() {
                            break;
                        }
                        sys_buf.drain(..available);
                        mic_buf.drain(..available);
                    } else if sys_buf.len() >= 1600 && mic_buf.is_empty() {
                        // System only active
                        let len = sys_buf.len();
                        let mut bytes = Vec::with_capacity(len * 2);
                        for &s in &sys_buf {
                            bytes.extend_from_slice(&s.to_le_bytes());
                        }
                        if merged_tx.send(bytes).is_err() {
                            break;
                        }
                        sys_buf.clear();
                    } else if mic_buf.len() >= 1600 && sys_buf.is_empty() {
                        // Mic only active
                        let len = mic_buf.len();
                        let mut bytes = Vec::with_capacity(len * 2);
                        for &s in &mic_buf {
                            bytes.extend_from_slice(&s.to_le_bytes());
                        }
                        if merged_tx.send(bytes).is_err() {
                            break;
                        }
                        mic_buf.clear();
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
    let record_path_clone = record_path;

    let worker = std::thread::spawn(move || {
        use std::io::{Read, Seek, Write};
        let mut buffer: Vec<u8> = Vec::with_capacity(32000); // ~1 sec at 16kHz s16le
        let batch_interval = std::time::Duration::from_millis(200);
        let mut last_flush = std::time::Instant::now();

        // Optional WAV file recording
        let mut total_pcm_bytes: u32 = 0;
        let mut wav_file: Option<std::fs::File> = if let Some(ref path_str) = record_path_clone {
            let path = std::path::Path::new(path_str);
            if path.exists() {
                // Resume existing session audio file
                match std::fs::OpenOptions::new().read(true).write(true).open(path) {
                    Ok(mut f) => {
                        let mut len_bytes = [0u8; 4];
                        if f.seek(std::io::SeekFrom::Start(40)).is_ok() && f.read_exact(&mut len_bytes).is_ok() {
                            total_pcm_bytes = u32::from_le_bytes(len_bytes);
                        }
                        let _ = f.seek(std::io::SeekFrom::End(0));
                        Some(f)
                    }
                    Err(_) => None,
                }
            } else {
                // New session audio file
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match std::fs::OpenOptions::new().create(true).write(true).truncate(true).open(path) {
                    Ok(mut f) => {
                        let mut header = [0u8; 44];
                        header[0..4].copy_from_slice(b"RIFF");
                        header[8..12].copy_from_slice(b"WAVE");
                        header[12..16].copy_from_slice(b"fmt ");
                        header[16..20].copy_from_slice(&16u32.to_le_bytes());
                        header[20..22].copy_from_slice(&1u16.to_le_bytes());  // PCM
                        header[22..24].copy_from_slice(&1u16.to_le_bytes());  // 1 channel (mono)
                        header[24..28].copy_from_slice(&16000u32.to_le_bytes()); // 16kHz
                        header[28..32].copy_from_slice(&32000u32.to_le_bytes()); // Byte rate
                        header[32..34].copy_from_slice(&2u16.to_le_bytes());  // Block align
                        header[34..36].copy_from_slice(&16u16.to_le_bytes()); // 16 bits
                        header[36..40].copy_from_slice(b"data");
                        let _ = f.write_all(&header);
                        Some(f)
                    }
                    Err(_) => None,
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
                    if let Some(ref mut f) = wav_file {
                        let _ = f.write_all(&data);
                        total_pcm_bytes = total_pcm_bytes.saturating_add(data.len() as u32);
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
        }

        // Finalize WAV file header
        if let Some(mut f) = wav_file {
            if f.seek(std::io::SeekFrom::Start(4)).is_ok() {
                let _ = f.write_all(&(total_pcm_bytes.saturating_add(36)).to_le_bytes());
            }
            if f.seek(std::io::SeekFrom::Start(40)).is_ok() {
                let _ = f.write_all(&total_pcm_bytes.to_le_bytes());
            }
            let _ = f.flush();
        }
    });

    // Store the forwarder so we can stop it later
    let forwarder = AudioForwarder {
        stop_flag,
        worker: Some(worker),
    };
    let mut active = state.active_receiver.lock().map_err(|e| e.to_string())?;
    *active = Some(forwarder);

    Ok(())
}

/// Stop audio capture
#[tauri::command]
pub fn stop_capture(state: State<'_, AudioState>) -> Result<(), String> {
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

    PermissionStatus {
        screen_recording: screen,
        microphone: "granted".to_string(),
    }
}
