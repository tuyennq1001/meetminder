use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use chrono::Local;

/// Get the transcript directory path
fn transcript_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("transcripts");

    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create transcript dir: {}", e))?;
    Ok(dir)
}

/// Save a complete transcript session to a timestamped file
/// Called when user clicks "Clear", stops recording, or closes app
#[tauri::command]
pub fn save_transcript(app: AppHandle, content: String) -> Result<String, String> {
    let dir = transcript_dir(&app)?;
    let now = Local::now();
    let filename = format!("{}.md", now.format("%Y-%m-%d_%H-%M-%S"));
    let filepath = dir.join(&filename);

    fs::write(&filepath, content)
        .map_err(|e| format!("Failed to save transcript: {}", e))?;

    Ok(filepath.to_string_lossy().to_string())
}

/// Open the transcript directory in the system file manager
/// macOS: Finder, Windows: Explorer
#[tauri::command]
pub fn open_transcript_dir(app: AppHandle) -> Result<(), String> {
    let dir = transcript_dir(&app)?;

    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(target_os = "linux")]
    let cmd = "xdg-open";

    std::process::Command::new(cmd)
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("Failed to open transcript dir: {}", e))?;
    Ok(())
}
