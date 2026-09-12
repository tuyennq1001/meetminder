use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::ipc::Channel;

/// State for the local pipeline sidecar process
pub struct LocalPipelineState {
    pub process: Mutex<Option<Child>>,
}

fn log_to_file(msg: &str) {
    use std::fs::OpenOptions;
    let _ = OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/meet_minder_pipeline.log")
        .and_then(|mut f| writeln!(f, "[{}] {}", chrono_now(), msg));
    eprintln!("[local-pipeline] {}", msg);
}

fn chrono_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", now)
}

/// Start the local translation pipeline (Python sidecar)
#[tauri::command]
pub fn start_local_pipeline(
    source_lang: String,
    target_lang: String,
    channel: Channel<String>,
    state: tauri::State<'_, LocalPipelineState>,
) -> Result<(), String> {
    log_to_file(&format!(
        "start_local_pipeline called: src={}, tgt={}",
        source_lang, target_lang
    ));

    // Send status to frontend
    let _ = channel.send(r#"{"type":"status","message":"Stopping old pipeline..."}"#.to_string());

    // Stop existing pipeline
    stop_local_pipeline_inner(&state);

    // Also kill any orphaned pipeline processes
    let _ = Command::new("pkill")
        .args(["-f", "local_pipeline.py"])
        .output();

    std::thread::sleep(std::time::Duration::from_millis(100));

    let _ = channel.send(r#"{"type":"status","message":"Finding pipeline script..."}"#.to_string());

    // Find the Python script — try multiple locations
    let script_path = {
        let candidates = vec![
            // Dev: project root (when running from src-tauri/)
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../scripts/local_pipeline.py"),
            // Dev: relative to current working directory
            std::path::PathBuf::from("scripts/local_pipeline.py"),
            // Production: relative to executable
            std::env::current_exe()
                .unwrap_or_default()
                .parent()
                .unwrap_or(std::path::Path::new("."))
                .join("../Resources/scripts/local_pipeline.py"),
        ];

        log_to_file(&format!(
            "Checking candidates: {:?}",
            candidates
                .iter()
                .map(|p| format!("{:?} exists={}", p, p.exists()))
                .collect::<Vec<_>>()
        ));

        candidates.into_iter().find(|p| p.exists()).ok_or_else(|| {
            "Pipeline script not found. Ensure scripts/local_pipeline.py exists.".to_string()
        })?
    };

    log_to_file(&format!("Using script: {:?}", script_path));
    let _ = channel.send(format!(
        r#"{{"type":"status","message":"Starting Python pipeline..."}}"#
    ));

    // Use venv python if MLX setup is complete, otherwise fall back to system python
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| "/tmp".to_string());
    let venv_python = format!(
        "{}/Library/Application Support/Meet Minder/mlx-env/bin/python3",
        home
    );

    let python = if std::path::Path::new(&venv_python).exists() {
        log_to_file(&format!("Using venv python: {}", venv_python));
        venv_python.as_str().to_string()
    } else if std::path::Path::new("/opt/homebrew/bin/python3").exists() {
        log_to_file("Using homebrew python");
        "/opt/homebrew/bin/python3".to_string()
    } else {
        "python3".to_string()
    };

    let path_env = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

    let mut child = Command::new(&python)
        .arg(&script_path)
        .arg("--asr-model")
        .arg("whisper")
        .arg("--source-lang")
        .arg(&source_lang)
        .arg("--target-lang")
        .arg(&target_lang)
        .env("PATH", path_env)
        .env("HOME", &home)
        .env("PYTHONUNBUFFERED", "1")
        .env("TOKENIZERS_PARALLELISM", "false")
        .env("HF_HUB_OFFLINE", "1")
        .env("TRANSFORMERS_OFFLINE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            let msg = format!("Failed to start pipeline: {}", e);
            log_to_file(&msg);
            msg
        })?;

    log_to_file(&format!("Python process spawned, PID={}", child.id()));
    let _ = channel.send(format!(
        r#"{{"type":"status","message":"Python started (PID={}), loading models..."}}"#,
        child.id()
    ));

    // Read stdout in a background thread and forward JSON to frontend
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

    // Forward stdout (JSON results) to frontend
    let channel_clone = channel.clone();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) if !line.is_empty() => {
                    log_to_file(&format!("stdout: {}", &line));
                    let _ = channel_clone.send(line);
                }
                Err(e) => {
                    log_to_file(&format!("stdout error: {}", e));
                    break;
                }
                _ => {}
            }
        }
        log_to_file("stdout reader ended");
    });

    // Log stderr for debugging (do not forward raw stderr to frontend)
    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    log_to_file(&format!("stderr: {}", line));
                }
                Err(_) => break,
            }
        }
        log_to_file("stderr reader ended");
    });

    let mut proc = state.process.lock().map_err(|e| e.to_string())?;
    *proc = Some(child);

    log_to_file("Pipeline state saved, returning OK");
    Ok(())
}

/// Send audio data to the local pipeline stdin
#[tauri::command]
pub fn send_audio_to_pipeline(
    data: Vec<u8>,
    state: tauri::State<'_, LocalPipelineState>,
) -> Result<(), String> {
    if let Ok(mut proc) = state.process.try_lock() {
        if let Some(ref mut child) = *proc {
            if let Some(ref mut stdin) = child.stdin {
                let _ = stdin.write_all(&data);
                let _ = stdin.flush();
            }
        }
    }
    Ok(())
}

/// Stop the local pipeline
#[tauri::command]
pub fn stop_local_pipeline(state: tauri::State<'_, LocalPipelineState>) -> Result<(), String> {
    log_to_file("stop_local_pipeline called");
    stop_local_pipeline_inner(&state);
    Ok(())
}

fn stop_local_pipeline_inner(state: &LocalPipelineState) {
    if let Ok(mut proc) = state.process.lock() {
        if let Some(mut child) = proc.take() {
            log_to_file(&format!("Killing pipeline PID={}", child.id()));
            // Close stdin to signal the pipeline to stop
            drop(child.stdin.take());
            // Give it a moment, then kill if needed
            std::thread::sleep(std::time::Duration::from_millis(100));
            let _ = child.kill();
            let _ = child.wait();
            log_to_file("Pipeline killed");
        }
    }
}

/// Check if MLX setup is complete
#[tauri::command]
pub fn check_mlx_setup() -> Result<String, String> {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| "/tmp".to_string());
    let marker = format!(
        "{}/Library/Application Support/Meet Minder/mlx-env/.setup_complete",
        home
    );
    let venv_python = format!(
        "{}/Library/Application Support/Meet Minder/mlx-env/bin/python3",
        home
    );

    if std::path::Path::new(&marker).exists() && std::path::Path::new(&venv_python).exists() {
        // Read marker to get details
        let content = std::fs::read_to_string(&marker).unwrap_or_default();
        Ok(format!(
            r#"{{"ready":true,"python":"{}","details":{}}}"#,
            venv_python, content
        ))
    } else {
        Ok(r#"{"ready":false}"#.to_string())
    }
}

/// Run MLX setup (install venv + packages + download models)
#[tauri::command]
pub fn run_mlx_setup(channel: Channel<String>) -> Result<(), String> {
    log_to_file("run_mlx_setup called");

    // Find setup script
    let script_path = {
        let candidates = vec![
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/setup_mlx.py"),
            std::path::PathBuf::from("scripts/setup_mlx.py"),
            std::env::current_exe()
                .unwrap_or_default()
                .parent()
                .unwrap_or(std::path::Path::new("."))
                .join("../Resources/scripts/setup_mlx.py"),
        ];

        candidates
            .into_iter()
            .find(|p| p.exists())
            .ok_or_else(|| "Setup script not found.".to_string())?
    };

    // Use system python to run setup (which creates the venv)
    let python = if std::path::Path::new("/opt/homebrew/bin/python3").exists() {
        "/opt/homebrew/bin/python3"
    } else {
        "python3"
    };

    let mut child = Command::new(python)
        .arg(&script_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start setup: {}", e))?;

    log_to_file(&format!("Setup process spawned, PID={}", child.id()));

    // Forward stdout (JSON progress) to frontend
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let channel_clone = channel.clone();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) if !line.is_empty() => {
                    log_to_file(&format!("setup stdout: {}", &line));
                    let _ = channel_clone.send(line);
                }
                Err(e) => {
                    log_to_file(&format!("setup stdout error: {}", e));
                    break;
                }
                _ => {}
            }
        }
    });

    // Forward stderr to log + frontend
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;
    let channel_clone2 = channel.clone();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    log_to_file(&format!("setup stderr: {}", line));
                    let escaped = line.replace('"', r#"\""#);
                    let _ =
                        channel_clone2.send(format!(r#"{{"type":"log","message":"{}"}}"#, escaped));
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
}

fn dir_size(path: &std::path::Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

fn format_size(bytes: u64) -> String {
    const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MIB: f64 = 1024.0 * 1024.0;
    if bytes >= (GIB as u64) {
        format!("{:.1} GB", bytes as f64 / GIB)
    } else if bytes >= (MIB as u64) {
        format!("{:.0} MB", bytes as f64 / MIB)
    } else if bytes >= 1024 {
        format!("{} KB", bytes / 1024)
    } else {
        format!("{} B", bytes)
    }
}

/// Query disk usage and installation status of Local MLX models
#[tauri::command]
pub fn get_local_models_info() -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "".to_string());
    if home.is_empty() {
        return Ok(r#"{"ready":false,"size_bytes":0,"size_formatted":"0 B","has_env":false,"has_models":false}"#.to_string());
    }

    let env_path = std::path::PathBuf::from(&home).join("Library/Application Support/Meet Minder/mlx-env");
    let marker = env_path.join(".setup_complete");
    let venv_python = env_path.join("bin/python3");
    let ready = marker.exists() && venv_python.exists();

    let mut total_bytes = 0u64;
    let has_env = env_path.exists();
    if has_env {
        total_bytes += dir_size(&env_path);
    }

    let mut has_models = false;
    let hf_hub = std::path::PathBuf::from(&home).join(".cache/huggingface/hub");
    if hf_hub.exists() {
        if let Ok(entries) = std::fs::read_dir(&hf_hub) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("models--mlx-community--") {
                    has_models = true;
                    total_bytes += dir_size(&entry.path());
                }
            }
        }
    }

    let size_formatted = format_size(total_bytes);

    Ok(format!(
        r#"{{"ready":{},"size_bytes":{},"size_formatted":"{}","has_env":{},"has_models":{}}}"#,
        ready, total_bytes, size_formatted, has_env, has_models
    ))
}

/// Delete local MLX environment and downloaded models to reclaim disk space
#[tauri::command]
pub fn delete_local_models(state: tauri::State<'_, LocalPipelineState>) -> Result<String, String> {
    log_to_file("delete_local_models called");

    // 1. Stop local pipeline if running
    let _ = stop_local_pipeline(state);

    let home = std::env::var("HOME").unwrap_or_else(|_| "".to_string());
    if home.is_empty() {
        return Err("HOME directory not found".to_string());
    }

    // 2. Calculate total bytes to free
    let env_path = std::path::PathBuf::from(&home).join("Library/Application Support/Meet Minder/mlx-env");
    let mut total_bytes = 0u64;
    if env_path.exists() {
        total_bytes += dir_size(&env_path);
    }

    let hf_hub = std::path::PathBuf::from(&home).join(".cache/huggingface/hub");
    let mut model_paths = Vec::new();
    if hf_hub.exists() {
        if let Ok(entries) = std::fs::read_dir(&hf_hub) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("models--mlx-community--") {
                    total_bytes += dir_size(&entry.path());
                    model_paths.push(entry.path());
                }
            }
        }
    }

    let freed_formatted = format_size(total_bytes);

    // 3. Delete mlx-env
    if env_path.exists() {
        if let Err(e) = std::fs::remove_dir_all(&env_path) {
            log_to_file(&format!("Failed to delete mlx-env: {}", e));
            return Err(format!("Failed to delete mlx-env: {}", e));
        }
        log_to_file("Deleted mlx-env successfully");
    }

    // 4. Delete huggingface models
    for p in model_paths {
        if p.exists() {
            if let Err(e) = std::fs::remove_dir_all(&p) {
                log_to_file(&format!("Failed to delete model {:?}: {}", p, e));
            } else {
                log_to_file(&format!("Deleted model {:?} successfully", p));
            }
        }
    }

    // 5. Clean locks if any
    let locks_dir = hf_hub.join(".locks");
    if locks_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&locks_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.contains("models--mlx-community--") {
                    let p = entry.path();
                    if p.is_dir() {
                        let _ = std::fs::remove_dir_all(&p);
                    } else {
                        let _ = std::fs::remove_file(&p);
                    }
                }
            }
        }
    }

    Ok(format!(
        r#"{{"success":true,"freed_bytes":{},"freed_formatted":"{}"}}"#,
        total_bytes, freed_formatted
    ))
}

