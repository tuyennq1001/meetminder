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

/// Append a line of text to today's transcript file
#[tauri::command]
pub fn append_transcript(app: AppHandle, text: String, speaker: Option<String>) -> Result<(), String> {
    let dir = transcript_dir(&app)?;
    let today = Local::now().format("%Y-%m-%d").to_string();
    let filepath = dir.join(format!("{}.txt", today));

    let timestamp = Local::now().format("%H:%M:%S").to_string();
    let speaker_prefix = speaker.map(|s| format!("[Speaker {}] ", s)).unwrap_or_default();
    let line = format!("[{}] {}{}\n", timestamp, speaker_prefix, text);

    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&filepath)
        .map_err(|e| format!("Failed to open transcript file: {}", e))?;

    file.write_all(line.as_bytes())
        .map_err(|e| format!("Failed to write transcript: {}", e))?;

    Ok(())
}

/// Get the path to today's transcript file (for user reference)
#[tauri::command]
pub fn get_transcript_path(app: AppHandle) -> Result<String, String> {
    let dir = transcript_dir(&app)?;
    let today = Local::now().format("%Y-%m-%d").to_string();
    let filepath = dir.join(format!("{}.txt", today));
    Ok(filepath.to_string_lossy().to_string())
}
