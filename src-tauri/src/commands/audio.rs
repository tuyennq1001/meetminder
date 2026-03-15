use crate::audio::microphone::MicCapture;
use crate::audio::SystemAudioCapture;
use serde::Serialize;
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
}

impl AudioForwarder {
    fn stop(&self) {
        self.stop_flag.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

#[derive(Serialize, Clone)]
pub struct PermissionStatus {
    pub screen_recording: String,
    pub microphone: String,
}

/// Start audio capture and forward data to the frontend via IPC channel
#[tauri::command]
pub fn start_capture(
    source: String,
    channel: Channel<Vec<u8>>,
    state: State<'_, AudioState>,
) -> Result<(), String> {
    // Stop any existing capture first
    stop_capture_inner(&state);

    let receiver: mpsc::Receiver<Vec<u8>> = match source.as_str() {
        "system" => {
            let sys = state.system_audio.lock().map_err(|e| e.to_string())?;
            sys.start()?
        }
        "microphone" => {
            let mut mic = state.microphone.lock().map_err(|e| e.to_string())?;
            mic.start()?
        }
        _ => return Err(format!("Unknown source: {}", source)),
    };

    // Spawn a thread to forward audio data from receiver to IPC channel
    let stop_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_flag_clone = stop_flag.clone();

    std::thread::spawn(move || {
        let mut buffer: Vec<u8> = Vec::with_capacity(32000); // ~1 sec at 16kHz s16le
        let batch_interval = std::time::Duration::from_millis(200);
        let mut last_flush = std::time::Instant::now();

        loop {
            if stop_flag_clone.load(std::sync::atomic::Ordering::SeqCst) {
                // Flush remaining buffer before exit
                if !buffer.is_empty() {
                    let _ = channel.send(buffer.clone());
                }
                break;
            }

            match receiver.recv_timeout(std::time::Duration::from_millis(10)) {
                Ok(data) => {
                    buffer.extend_from_slice(&data);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if !buffer.is_empty() {
                        let _ = channel.send(buffer.clone());
                    }
                    break;
                }
            }

            // Flush buffer every 200ms
            if last_flush.elapsed() >= batch_interval && !buffer.is_empty() {
                if let Err(_e) = channel.send(buffer.clone()) {
                    break; // Channel closed
                }
                buffer.clear();
                last_flush = std::time::Instant::now();
            }
        }
    });

    // Store the forwarder so we can stop it later
    let forwarder = AudioForwarder { stop_flag };
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
    if let Ok(sys) = state.system_audio.lock() {
        sys.stop();
    }

    // Stop microphone
    if let Ok(mut mic) = state.microphone.lock() {
        mic.stop();
    }
}

/// Check audio capture permissions
#[tauri::command]
pub fn check_permissions() -> PermissionStatus {
    // Note: Actual permission checking on macOS requires Objective-C interop
    // For now, we return "unknown" and permissions will be prompted on first use
    PermissionStatus {
        screen_recording: "unknown".to_string(),
        microphone: "unknown".to_string(),
    }
}
