use crate::audio::microphone::MicCapture;
use crate::audio::SystemAudioCapture;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use tauri::{ipc::Channel, AppHandle, Manager, State};

const RECORDING_LOG_MAX_BYTES: u64 = 2 * 1024 * 1024;
const RECORDING_LOG_ROTATIONS: usize = 3;
static RECORDING_LOG_LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();

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
    recording_error: std::sync::Arc<Mutex<Option<String>>>,
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

fn recording_log_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    match app.path().app_data_dir() {
        Ok(dir) => {
            if let Err(err) = std::fs::create_dir_all(&dir) {
                eprintln!("[audio-recording] persistent log directory failed: {}", err);
                return None;
            }
            Some(dir.join("recording.log"))
        }
        Err(err) => {
            eprintln!(
                "[audio-recording] app data path unavailable for logging: {}",
                err
            );
            None
        }
    }
}

fn rotated_recording_log_path(path: &std::path::Path, index: usize) -> std::path::PathBuf {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "recording.log".to_string());
    path.with_file_name(format!("{}.{}", file_name, index))
}

fn rotate_recording_log(path: &std::path::Path) {
    let oldest = rotated_recording_log_path(path, RECORDING_LOG_ROTATIONS);
    let _ = std::fs::remove_file(&oldest);
    for index in (1..=RECORDING_LOG_ROTATIONS).rev() {
        let source = if index == 1 {
            path.to_path_buf()
        } else {
            rotated_recording_log_path(path, index - 1)
        };
        let destination = rotated_recording_log_path(path, index);
        if source.exists() {
            let _ = std::fs::remove_file(&destination);
            if let Err(err) = std::fs::rename(&source, &destination) {
                eprintln!(
                    "[audio-recording] log rotation failed source={} destination={} error={}",
                    source.display(),
                    destination.display(),
                    err
                );
            }
        }
    }
}

fn append_recording_log(log_path: Option<&std::path::Path>, message: &str) {
    let timestamp = chrono::Local::now().to_rfc3339();
    let line = format!("[{}] [audio-recording] {}", timestamp, message);
    if let Some(path) = log_path {
        let lock = RECORDING_LOG_LOCK.get_or_init(|| Mutex::new(()));
        if let Ok(_guard) = lock.lock() {
            let current_size = std::fs::metadata(path)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            let line_size = line.len() as u64 + 1;
            if current_size > 0 && current_size.saturating_add(line_size) > RECORDING_LOG_MAX_BYTES
            {
                rotate_recording_log(path);
            }
            if let Err(err) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .and_then(|mut file| {
                    use std::io::Write;
                    writeln!(file, "{}", line)
                })
            {
                eprintln!("[audio-recording] persistent log write failed: {}", err);
            }
        } else {
            eprintln!("[audio-recording] persistent log lock failed");
        }
    }
    eprintln!("{}", line);
}

const WAV_HEADER_LEN: u64 = 44;

fn wav_header(data_bytes: u32) -> [u8; WAV_HEADER_LEN as usize] {
    let mut header = [0u8; WAV_HEADER_LEN as usize];
    header[0..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&data_bytes.saturating_add(36).to_le_bytes());
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
    header[40..44].copy_from_slice(&data_bytes.to_le_bytes());
    header
}

/// Open a recording before starting the capture worker so setup failures are
/// returned to the caller instead of silently disabling recording.
fn prepare_wav_recording(
    path_str: &str,
) -> Result<(std::io::BufWriter<std::fs::File>, u32), String> {
    use std::io::{Read, Seek, SeekFrom, Write};

    if path_str.trim().is_empty() {
        return Err("recording path is empty".to_string());
    }

    let path = std::path::Path::new(path_str);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("create recording directory failed: {}", err))?;
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|err| format!("open recording file failed: {}", err))?;

    let file_len = file
        .metadata()
        .map_err(|err| format!("read recording file metadata failed: {}", err))?
        .len();

    let total_pcm_bytes = if file_len == 0 {
        file.write_all(&wav_header(0))
            .map_err(|err| format!("write WAV header failed: {}", err))?;
        0
    } else {
        if file_len < WAV_HEADER_LEN {
            return Err("existing recording file is not a supported WAV recording".to_string());
        }
        if file_len - WAV_HEADER_LEN > u32::MAX as u64 {
            return Err("recording file is too large to continue".to_string());
        }

        let mut header = [0u8; WAV_HEADER_LEN as usize];
        file.seek(SeekFrom::Start(0))
            .and_then(|_| file.read_exact(&mut header))
            .map_err(|_| "existing recording file is not a supported WAV recording".to_string())?;
        if &header[0..4] != b"RIFF"
            || &header[8..12] != b"WAVE"
            || &header[12..16] != b"fmt "
            || &header[36..40] != b"data"
        {
            return Err("existing recording file is not a supported WAV recording".to_string());
        }

        (file_len - WAV_HEADER_LEN) as u32
    };

    file.seek(SeekFrom::End(0))
        .map_err(|err| format!("seek recording file failed: {}", err))?;
    Ok((
        std::io::BufWriter::with_capacity(64 * 1024, file),
        total_pcm_bytes,
    ))
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
    pub recording_error: Option<String>,
}

/// Mixes two i16 audio samples with a transparent soft-clipping limiter.
/// - When the combined amplitude is within normal speech levels (|sum| <= 24576, approx -2.5 dBFS),
///   the sum is passed through with 100% unity gain (1.0x) to preserve full SNR for STT.
/// - When the combined amplitude exceeds 24576, a smooth hyperbolic tangent (tanh) soft-knee
///   compresses the peak smoothly toward +/- 32767, preventing harsh square-wave clipping.
pub(crate) fn mix_and_soft_clip(s1: i16, s2: i16) -> i16 {
    let sum = s1 as f64 + s2 as f64;
    const THRESHOLD: f64 = 24576.0; // 0.75 of 32768.0 (-2.5 dBFS)
    const MAX_VAL: f64 = 32767.0;

    let abs_sum = sum.abs();
    if abs_sum <= THRESHOLD {
        sum as i16
    } else {
        let headroom = MAX_VAL - THRESHOLD;
        let excess = (abs_sum - THRESHOLD) / headroom;
        let saturated = THRESHOLD + headroom * excess.tanh();
        let result = if sum > 0.0 { saturated } else { -saturated };
        result.clamp(-32768.0, 32767.0) as i16
    }
}

pub(crate) fn run_mixer_loop(
    sys_rx: mpsc::Receiver<Vec<u8>>,
    mic_rx: mpsc::Receiver<Vec<u8>>,
    merged_tx: mpsc::Sender<Vec<u8>>,
    stop_flag: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
) {
    const FRAME_SAMPLES: usize = 320; // 20 ms at 16 kHz
    const PREBUFFER_SAMPLES: usize = FRAME_SAMPLES * 2; // 40 ms initial cushion
    const MAX_WAIT_BUFFER_SAMPLES: usize = FRAME_SAMPLES * 5; // 100 ms wait cushion
    const MAX_BUFFER_SAMPLES: usize = 16_000; // 1 second max buffer to prevent bloat without dropping bursts
    const ACTIVITY_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(150);
    const MAX_WAIT_FOR_LATE_STREAM: std::time::Duration = std::time::Duration::from_millis(15);

    let mut sys_buf: VecDeque<i16> = VecDeque::with_capacity(MAX_BUFFER_SAMPLES);
    let mut mic_buf: VecDeque<i16> = VecDeque::with_capacity(MAX_BUFFER_SAMPLES);
    let mut last_sys_recv: Option<std::time::Instant> = None;
    let mut last_mic_recv: Option<std::time::Instant> = None;
    let mut next_frame: Option<std::time::Instant> = None;
    let mut wait_since: Option<std::time::Instant> = None;

    loop {
        if let Some(ref stop) = stop_flag {
            if stop.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
        }

        // Drain sys_rx
        let mut sys_disconnected = false;
        match sys_rx.try_recv() {
            Ok(data) => {
                last_sys_recv = Some(std::time::Instant::now());
                for chunk in data.chunks_exact(2) {
                    sys_buf.push_back(i16::from_le_bytes([chunk[0], chunk[1]]));
                }
            }
            Err(mpsc::TryRecvError::Empty) => {}
            Err(mpsc::TryRecvError::Disconnected) => sys_disconnected = true,
        }
        while let Ok(data) = sys_rx.try_recv() {
            last_sys_recv = Some(std::time::Instant::now());
            for chunk in data.chunks_exact(2) {
                sys_buf.push_back(i16::from_le_bytes([chunk[0], chunk[1]]));
            }
        }

        // Drain mic_rx
        let mut mic_disconnected = false;
        match mic_rx.try_recv() {
            Ok(data) => {
                last_mic_recv = Some(std::time::Instant::now());
                for chunk in data.chunks_exact(2) {
                    mic_buf.push_back(i16::from_le_bytes([chunk[0], chunk[1]]));
                }
            }
            Err(mpsc::TryRecvError::Empty) => {}
            Err(mpsc::TryRecvError::Disconnected) => mic_disconnected = true,
        }
        while let Ok(data) = mic_rx.try_recv() {
            last_mic_recv = Some(std::time::Instant::now());
            for chunk in data.chunks_exact(2) {
                mic_buf.push_back(i16::from_le_bytes([chunk[0], chunk[1]]));
            }
        }

        // Clean exit if both inputs are disconnected and emptied
        if sys_disconnected && mic_disconnected && sys_buf.is_empty() && mic_buf.is_empty() {
            break;
        }

        // Keep latency bounded when the two hardware clocks drift.
        if sys_buf.len() > MAX_BUFFER_SAMPLES {
            let excess = sys_buf.len() - MAX_BUFFER_SAMPLES;
            sys_buf.drain(..excess);
        }
        if mic_buf.len() > MAX_BUFFER_SAMPLES {
            let excess = mic_buf.len() - MAX_BUFFER_SAMPLES;
            mic_buf.drain(..excess);
        }

        let now = std::time::Instant::now();

        // Start timing once either buffer has accumulated enough initial samples
        if next_frame.is_none()
            && (sys_buf.len() >= PREBUFFER_SAMPLES || mic_buf.len() >= PREBUFFER_SAMPLES)
        {
            next_frame = Some(now);
        }

        if let Some(target_time) = next_frame {
            if now >= target_time {
                let sys_active = last_sys_recv
                    .map(|t| now.duration_since(t) < ACTIVITY_TIMEOUT)
                    .unwrap_or(false);
                let mic_active = last_mic_recv
                    .map(|t| now.duration_since(t) < ACTIVITY_TIMEOUT)
                    .unwrap_or(false);

                // If both streams are currently active, but one is momentarily short on samples,
                // give the late stream a brief grace window (up to 15 ms) before proceeding.
                // However, if the other buffer is already at max wait cushion, do NOT wait.
                let sys_short = sys_active && sys_buf.len() < FRAME_SAMPLES;
                let mic_short = mic_active && mic_buf.len() < FRAME_SAMPLES;
                let either_short = sys_short || mic_short;

                let can_wait = either_short
                    && sys_buf.len() < MAX_WAIT_BUFFER_SAMPLES
                    && mic_buf.len() < MAX_WAIT_BUFFER_SAMPLES;

                if can_wait {
                    let wait_start = *wait_since.get_or_insert(now);
                    if now.duration_since(wait_start) < MAX_WAIT_FOR_LATE_STREAM {
                        std::thread::sleep(std::time::Duration::from_millis(2));
                        continue;
                    }
                }
                wait_since = None;

                // If both are inactive and both buffers are empty, idle sleep
                if sys_buf.is_empty() && mic_buf.is_empty() {
                    std::thread::sleep(std::time::Duration::from_millis(2));
                    continue;
                }

                let mut mixed_bytes = Vec::with_capacity(FRAME_SAMPLES * 2);
                for _ in 0..FRAME_SAMPLES {
                    let s1 = sys_buf.pop_front().unwrap_or(0);
                    let s2 = mic_buf.pop_front().unwrap_or(0);
                    let mixed = mix_and_soft_clip(s1, s2);
                    mixed_bytes.extend_from_slice(&mixed.to_le_bytes());
                }

                if merged_tx.send(mixed_bytes).is_err() {
                    break;
                }

                let mut next = target_time + std::time::Duration::from_millis(20);
                if next + std::time::Duration::from_millis(60) < now {
                    next = now + std::time::Duration::from_millis(20);
                }
                next_frame = Some(next);
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}

/// Start audio capture and forward data to the frontend via IPC channel.
/// If `record_path` is specified, also streams PCM audio to a valid .wav file.
#[tauri::command]
pub async fn start_capture(
    app: AppHandle,
    source: String,
    channel: Channel<Vec<u8>>,
    record_path: Option<String>,
    state: State<'_, AudioState>,
) -> Result<(), String> {
    let recording_log = recording_log_path(&app);
    if let Some(path) = recording_log.as_deref() {
        append_recording_log(
            Some(path),
            &format!("persistent_log_path={}", path.display()),
        );
    }
    append_recording_log(
        recording_log.as_deref(),
        &format!(
            "start requested source={} record_path={}",
            source,
            record_path.as_deref().unwrap_or("<none>")
        ),
    );

    // Stop any existing capture first
    stop_capture_inner(&state);

    // Prepare the recording before opening any audio source. If this fails,
    // return the error to the frontend instead of running a transcript without
    // audio.
    let prepared_recording = match record_path.as_deref() {
        Some(path) => match prepare_wav_recording(path) {
            Ok((writer, total_pcm_bytes)) => {
                append_recording_log(
                    recording_log.as_deref(),
                    &format!(
                        "wav prepared path={} existing_pcm_bytes={}",
                        path, total_pcm_bytes
                    ),
                );
                Some((writer, total_pcm_bytes))
            }
            Err(err) => {
                append_recording_log(
                    recording_log.as_deref(),
                    &format!("wav prepare failed path={} error={}", path, err),
                );
                return Err(err);
            }
        },
        None => {
            append_recording_log(
                recording_log.as_deref(),
                "wav prepare skipped because no record_path was provided",
            );
            None
        }
    };

    let receiver: mpsc::Receiver<Vec<u8>> = match source.as_str() {
        "system" => {
            let mut sys = state.system_audio.lock().map_err(|e| {
                let error = e.to_string();
                append_recording_log(
                    recording_log.as_deref(),
                    &format!("system source lock failed error={}", error),
                );
                error
            })?;
            sys.start().map_err(|error| {
                append_recording_log(
                    recording_log.as_deref(),
                    &format!("system source start failed error={}", error),
                );
                error
            })?
        }
        "microphone" => {
            let mut mic = state.microphone.lock().map_err(|e| {
                let error = e.to_string();
                append_recording_log(
                    recording_log.as_deref(),
                    &format!("microphone source lock failed error={}", error),
                );
                error
            })?;
            mic.start().map_err(|error| {
                append_recording_log(
                    recording_log.as_deref(),
                    &format!("microphone source start failed error={}", error),
                );
                error
            })?
        }
        "both" => {
            // Start both sources and digitally mix into a single 16kHz mono receiver
            let mut sys = state.system_audio.lock().map_err(|e| {
                let error = e.to_string();
                append_recording_log(
                    recording_log.as_deref(),
                    &format!("system source lock failed error={}", error),
                );
                error
            })?;
            let sys_rx = sys.start().map_err(|error| {
                append_recording_log(
                    recording_log.as_deref(),
                    &format!("system source start failed error={}", error),
                );
                error
            })?;
            let mut mic = state.microphone.lock().map_err(|e| {
                let error = e.to_string();
                append_recording_log(
                    recording_log.as_deref(),
                    &format!("microphone source lock failed error={}", error),
                );
                error
            })?;
            let mic_rx = mic.start().map_err(|error| {
                append_recording_log(
                    recording_log.as_deref(),
                    &format!("microphone source start failed error={}", error),
                );
                error
            })?;

            let (merged_tx, merged_rx) = mpsc::channel::<Vec<u8>>();

            std::thread::spawn(move || {
                run_mixer_loop(sys_rx, mic_rx, merged_tx, None);
            });

            merged_rx
        }
        _ => {
            let error = format!("Unknown source: {}", source);
            append_recording_log(recording_log.as_deref(), &error);
            return Err(error);
        }
    };

    append_recording_log(
        recording_log.as_deref(),
        &format!("audio source started source={}", source),
    );

    // Spawn a thread to forward audio data from receiver to IPC channel
    let stop_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_flag_clone = stop_flag.clone();
    let received_samples = std::sync::Arc::new(AtomicU64::new(0));
    let nonzero_samples = std::sync::Arc::new(AtomicU64::new(0));
    let rms_milli = std::sync::Arc::new(AtomicU64::new(0));
    let recording_error = std::sync::Arc::new(Mutex::new(None));
    let received_samples_clone = received_samples.clone();
    let nonzero_samples_clone = nonzero_samples.clone();
    let rms_milli_clone = rms_milli.clone();
    let recording_error_clone = recording_error.clone();
    let record_path_clone = record_path.clone();
    let recording_log_clone = recording_log.clone();

    let source_clone = source.clone();
    let worker = std::thread::spawn(move || {
        use std::io::{Seek, Write};
        let mut buffer: Vec<u8> = Vec::with_capacity(32000); // ~1 sec at 16kHz s16le
        let batch_interval = std::time::Duration::from_millis(200);
        let mut last_flush = std::time::Instant::now();
        let start_time = std::time::Instant::now();
        let mut last_heartbeat = std::time::Instant::now();
        let heartbeat_interval = std::time::Duration::from_secs(30);

        // The WAV file is opened before this worker starts so setup failures
        // cannot be mistaken for a successful audio capture.
        let mut wav_error: Option<String> = None;
        let (mut wav_writer, mut total_pcm_bytes) = match prepared_recording {
            Some((writer, total_pcm_bytes)) => (Some(writer), total_pcm_bytes),
            None => (None, 0),
        };
        let set_recording_error = |error: String| {
            if let Ok(mut current) = recording_error_clone.lock() {
                if current.is_none() {
                    *current = Some(error);
                }
            }
        };
        let log_recording = |message: &str| {
            append_recording_log(recording_log_clone.as_deref(), message);
        };

        log_recording(&format!(
            "worker started source={} path={}",
            source_clone,
            record_path_clone.as_deref().unwrap_or("<none>")
        ));

        'capture: loop {
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
                                let error = format!("write PCM data failed: {}", err);
                                if wav_error.is_none() {
                                    wav_error = Some(error.clone());
                                }
                                set_recording_error(error.clone());
                                log_recording(&format!(
                                    "pcm write failed path={} error={}",
                                    record_path_clone.as_deref().unwrap_or("<none>"),
                                    error
                                ));
                                break 'capture;
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
                log_recording(&format!(
                    "heartbeat source={} elapsed={}s pcm_bytes={} received_samples={} nonzero_samples={} rms={:.3}",
                    source_clone, elapsed, total_pcm_bytes, rec, nonz, rms
                ));
                last_heartbeat = std::time::Instant::now();
            }
        }

        // Finalize WAV file header
        log_recording(&format!(
            "finalize started path={} pcm_bytes={}",
            record_path_clone.as_deref().unwrap_or("<none>"),
            total_pcm_bytes
        ));
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
                        } else {
                            log_recording(&format!(
                                "finalize verified path={} file_bytes={} pcm_bytes={}",
                                path_str,
                                metadata.len(),
                                total_pcm_bytes
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
            set_recording_error(err.clone());
            let path = record_path_clone.as_deref().unwrap_or("<none>");
            log_recording(&format!("finalize failed path={} error={}", path, err));
            eprintln!("[audio-recording] failed to finalize {}: {}", path, err);
        }

        let rec = received_samples_clone.load(Ordering::Relaxed);
        let elapsed = start_time.elapsed().as_secs_f64();
        eprintln!(
            "[audio-heartbeat] capture ended: source={} elapsed={:.1}s total_pcm_bytes={} total_samples={}",
            source_clone, elapsed, total_pcm_bytes, rec
        );
        log_recording(&format!(
            "capture ended source={} elapsed={:.1}s pcm_bytes={} total_samples={} status={}",
            source_clone,
            elapsed,
            total_pcm_bytes,
            rec,
            if recording_error_clone
                .lock()
                .ok()
                .and_then(|error| error.clone())
                .is_some()
            {
                "error"
            } else {
                "ok"
            }
        ));
    });

    // Store the forwarder so we can stop it later
    let forwarder = AudioForwarder {
        stop_flag,
        worker: Some(worker),
        received_samples,
        nonzero_samples,
        rms_milli,
        recording_error,
    };
    let mut active = state.active_receiver.lock().map_err(|e| e.to_string())?;
    *active = Some(forwarder);
    append_recording_log(
        recording_log.as_deref(),
        &format!("capture active source={}", source),
    );

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
        let recording_error = forwarder
            .recording_error
            .lock()
            .ok()
            .and_then(|error| error.clone());
        Ok(CaptureStatus {
            received_samples: forwarder.received_samples.load(Ordering::Relaxed),
            nonzero_samples: forwarder.nonzero_samples.load(Ordering::Relaxed),
            rms: forwarder.rms_milli.load(Ordering::Relaxed) as f64 / 1000.0,
            microphone_received_samples: microphone.received_samples,
            microphone_nonzero_samples: microphone.nonzero_samples,
            microphone_rms: microphone.rms,
            recording_error,
        })
    } else {
        Ok(CaptureStatus {
            received_samples: 0,
            nonzero_samples: 0,
            rms: 0.0,
            microphone_received_samples: microphone.received_samples,
            microphone_nonzero_samples: microphone.nonzero_samples,
            microphone_rms: microphone.rms,
            recording_error: None,
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

#[cfg(test)]
mod tests {
    use super::{append_recording_log, prepare_wav_recording, RECORDING_LOG_MAX_BYTES};
    use std::fs;
    use std::io::Write;

    fn test_recording_path(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "meet-minder-audio-{}-{}",
            name,
            uuid::Uuid::new_v4()
        ));
        let path = dir.join("nested/session.wav");
        (dir, path)
    }

    #[test]
    fn prepare_wav_recording_creates_valid_header() {
        let (dir, path) = test_recording_path("create");
        let (writer, total_pcm_bytes) = prepare_wav_recording(path.to_str().unwrap()).unwrap();
        assert_eq!(total_pcm_bytes, 0);
        drop(writer);

        let bytes = fs::read(&path).unwrap();
        assert_eq!(bytes.len(), 44);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[36..40], b"data");
        assert_eq!(&bytes[40..44], &0u32.to_le_bytes());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn prepare_wav_recording_resumes_existing_pcm() {
        let (dir, path) = test_recording_path("resume");
        let (mut writer, total_pcm_bytes) = prepare_wav_recording(path.to_str().unwrap()).unwrap();
        assert_eq!(total_pcm_bytes, 0);
        writer.write_all(&[1, 2, 3, 4]).unwrap();
        writer.flush().unwrap();
        drop(writer);

        let (writer, total_pcm_bytes) = prepare_wav_recording(path.to_str().unwrap()).unwrap();
        assert_eq!(total_pcm_bytes, 4);
        drop(writer);

        let bytes = fs::read(&path).unwrap();
        assert_eq!(&bytes[44..], &[1, 2, 3, 4]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn prepare_wav_recording_rejects_invalid_existing_file() {
        let (dir, path) = test_recording_path("invalid");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"not a wav").unwrap();

        let result = prepare_wav_recording(path.to_str().unwrap());
        assert!(result.is_err());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn recording_log_rotates_before_exceeding_limit() {
        let dir = std::env::temp_dir().join(format!(
            "meet-minder-recording-log-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("recording.log");
        fs::write(&path, vec![b'x'; RECORDING_LOG_MAX_BYTES as usize]).unwrap();

        append_recording_log(Some(&path), "rotation test");

        let rotated = dir.join("recording.log.1");
        assert_eq!(
            fs::metadata(rotated).unwrap().len(),
            RECORDING_LOG_MAX_BYTES
        );
        assert!(fs::metadata(&path).unwrap().len() < RECORDING_LOG_MAX_BYTES);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn mix_and_soft_clip_linear_in_speech_band() {
        use super::mix_and_soft_clip;
        // Below 24576 threshold, sum is strictly linear (1.0x gain)
        assert_eq!(mix_and_soft_clip(1000, 0), 1000);
        assert_eq!(mix_and_soft_clip(0, 15000), 15000);
        assert_eq!(mix_and_soft_clip(10000, 12000), 22000);
        assert_eq!(mix_and_soft_clip(-10000, -12000), -22000);
        assert_eq!(mix_and_soft_clip(24576, 0), 24576);
        assert_eq!(mix_and_soft_clip(-24576, 0), -24576);
    }

    #[test]
    fn mix_and_soft_clip_prevents_overflow_and_harsh_clipping() {
        use super::mix_and_soft_clip;
        // Peak sum above threshold is smoothly compressed
        let loud_sum = mix_and_soft_clip(25000, 10000); // sum = 35000
        assert!(loud_sum > 24576);

        // Maximum possible input sum stays below 32767 with smooth saturation
        let max_pos = mix_and_soft_clip(32767, 32767);
        assert!(max_pos >= 32000, "max_pos = {}", max_pos);

        // Minimum possible input sum stays above -32768 with smooth saturation
        let max_neg = mix_and_soft_clip(-32768, -32768);
        assert!(max_neg <= -32000, "max_neg = {}", max_neg);
    }

    #[test]
    fn mixer_loop_handles_silent_system_audio_without_blocking_microphone() {
        use super::run_mixer_loop;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{mpsc, Arc};

        let (sys_tx, sys_rx) = mpsc::channel::<Vec<u8>>();
        let (mic_tx, mic_rx) = mpsc::channel::<Vec<u8>>();
        let (merged_tx, merged_rx) = mpsc::channel::<Vec<u8>>();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();

        let handle = std::thread::spawn(move || {
            run_mixer_loop(sys_rx, mic_rx, merged_tx, Some(stop_clone));
        });

        // Send 10 frames (320 samples each = 640 bytes) of mic data
        // System audio sends NOTHING (completely silent/inactive)
        let num_frames = 10;
        let pcm_chunk: Vec<u8> = (0..320i16)
            .flat_map(|i| ((i % 1000) * 10).to_le_bytes())
            .collect();

        for _ in 0..num_frames {
            mic_tx.send(pcm_chunk.clone()).unwrap();
        }

        // Collect merged audio
        let mut received_bytes = Vec::new();
        let start = std::time::Instant::now();
        while received_bytes.len() < num_frames * 640 && start.elapsed() < std::time::Duration::from_secs(2) {
            if let Ok(chunk) = merged_rx.recv_timeout(std::time::Duration::from_millis(50)) {
                received_bytes.extend(chunk);
            }
        }

        stop.store(true, Ordering::Relaxed);
        drop(sys_tx);
        drop(mic_tx);
        let _ = handle.join();

        assert_eq!(
            received_bytes.len(),
            num_frames * 640,
            "All mic audio must be emitted even when system audio is completely silent"
        );
    }

    #[test]
    fn mixer_loop_handles_silent_microphone_without_blocking_system() {
        use super::run_mixer_loop;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{mpsc, Arc};

        let (sys_tx, sys_rx) = mpsc::channel::<Vec<u8>>();
        let (mic_tx, mic_rx) = mpsc::channel::<Vec<u8>>();
        let (merged_tx, merged_rx) = mpsc::channel::<Vec<u8>>();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();

        let handle = std::thread::spawn(move || {
            run_mixer_loop(sys_rx, mic_rx, merged_tx, Some(stop_clone));
        });

        // Send 10 frames of system audio; mic sends NOTHING
        let num_frames = 10;
        let pcm_chunk: Vec<u8> = (0..320i16)
            .flat_map(|i| ((i % 1000) * 10).to_le_bytes())
            .collect();

        for _ in 0..num_frames {
            sys_tx.send(pcm_chunk.clone()).unwrap();
        }

        let mut received_bytes = Vec::new();
        let start = std::time::Instant::now();
        while received_bytes.len() < num_frames * 640 && start.elapsed() < std::time::Duration::from_secs(2) {
            if let Ok(chunk) = merged_rx.recv_timeout(std::time::Duration::from_millis(50)) {
                received_bytes.extend(chunk);
            }
        }

        stop.store(true, Ordering::Relaxed);
        drop(sys_tx);
        drop(mic_tx);
        let _ = handle.join();

        assert_eq!(
            received_bytes.len(),
            num_frames * 640,
            "All system audio must be emitted even when microphone is completely silent"
        );
    }
}

