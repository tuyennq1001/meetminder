use crate::settings::SettingsState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

static EXPORT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ExportRecord {
    path: String,
    content_hash: String,
    #[serde(default)]
    user_edited: bool,
}

#[derive(Debug, Serialize)]
pub struct ObsidianSaveResult {
    status: String,
    path: String,
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| format!("Cannot create app config directory: {e}"))?;
    path.push("obsidian-export-index.json");
    Ok(path)
}

fn load_records(path: &Path) -> Result<HashMap<String, ExportRecord>, String> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let bytes = fs::read(path).map_err(|e| format!("Cannot read Obsidian export index: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Cannot parse Obsidian export index: {e}"))
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid Obsidian note path")?;
    fs::create_dir_all(parent).map_err(|e| format!("Cannot create vault folder: {e}"))?;
    let temp = path.with_extension("md.meet-minder-tmp");
    fs::write(&temp, content).map_err(|e| format!("Cannot write temporary Obsidian note: {e}"))?;
    fs::rename(&temp, path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("Cannot save Obsidian note: {e}")
    })
}

fn hash(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}

fn safe_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_control() || "/\\:*?\"<>|".contains(c) {
                '-'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    let compact = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        "Meeting Minutes".to_string()
    } else {
        compact.chars().take(100).collect()
    }
}

#[tauri::command]
pub async fn select_obsidian_vault(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Select Obsidian vault")
        .pick_folder(move |folder| {
            let _ = tx.send(folder);
        });
    let folder = rx.await.map_err(|e| e.to_string())?;
    Ok(folder.map(|path| path.to_string()))
}

#[tauri::command]
pub fn save_note_to_obsidian(
    app: AppHandle,
    settings: State<'_, SettingsState>,
    session_id: String,
    title: String,
    note_type: String,
    lang: String,
    content: String,
    user_confirmed: bool,
) -> Result<ObsidianSaveResult, String> {
    let id = session_id.trim();
    if id.is_empty() || id.contains('/') || id.contains('\\') {
        return Err("Invalid meeting ID".into());
    }
    if !matches!(note_type.as_str(), "minutes" | "notes") {
        return Err("Unsupported note type".into());
    }
    if note_type == "minutes" && !matches!(lang.as_str(), "vi" | "ja" | "en") {
        return Err("Unsupported Meeting Minutes language".into());
    }
    if content.trim().is_empty() {
        return Err("Note is empty".into());
    }

    let config = settings
        .0
        .lock()
        .map_err(|e| format!("Settings lock error: {e}"))?;
    if !config.obsidian_export_enabled {
        return Err("Obsidian export is disabled".into());
    }
    let vault = PathBuf::from(config.obsidian_vault_path.trim());
    drop(config);
    let vault = vault
        .canonicalize()
        .map_err(|e| format!("Obsidian vault is unavailable: {e}"))?;
    if !vault.is_dir() {
        return Err("Selected Obsidian vault is not a folder".into());
    }
    let _export_guard = EXPORT_LOCK
        .lock()
        .map_err(|e| format!("Obsidian export lock error: {e}"))?;

    let index_path = state_path(&app)?;
    let mut records = load_records(&index_path)?;
    // Keep one managed Meeting Minutes note per meeting, independent of the
    // language tab that was edited or saved most recently.
    let key = if note_type == "minutes" {
        format!("{}::{id}::minutes", vault.display())
    } else {
        format!("{}::{id}::{note_type}::{lang}", vault.display())
    };
    let legacy_key = format!("{}::{id}::{lang}", vault.display());
    let prior = records.get(&key).cloned().or_else(|| {
        if note_type == "minutes" {
            [lang.as_str(), "ja", "vi", "en"]
                .iter()
                .find_map(|legacy_lang| {
                    records
                        .get(&format!(
                            "{}::{id}::minutes::{legacy_lang}",
                            vault.display()
                        ))
                        .cloned()
                })
                .or_else(|| records.get(&legacy_key).cloned())
        } else {
            None
        }
    });
    let folder = vault.join("Meet Minder");
    fs::create_dir_all(&folder)
        .map_err(|e| format!("Cannot create Meet Minder folder in vault: {e}"))?;
    let folder = folder
        .canonicalize()
        .map_err(|e| format!("Cannot resolve Meet Minder vault folder: {e}"))?;
    if !folder.starts_with(&vault) {
        return Err("Meet Minder folder resolves outside the selected vault".into());
    }

    let target = if let Some(record) = &prior {
        let recorded = PathBuf::from(&record.path);
        if !recorded.starts_with(&folder) {
            return Err("Stored Obsidian note path is outside the selected vault".into());
        }
        recorded
    } else {
        let suffix = if note_type == "minutes" {
            "meeting-minutes".to_string()
        } else {
            "manual-notes".to_string()
        };
        let stem = format!("{}--{}--{}", safe_name(&title), safe_name(id), suffix);
        let mut candidate = folder.join(format!("{stem}.md"));
        let mut suffix = 2;
        while candidate.exists() {
            candidate = folder.join(format!("{stem} ({suffix}).md"));
            suffix += 1;
        }
        candidate
    };

    if let Some(record) = &prior {
        if target.exists() {
            let canonical_target = target
                .canonicalize()
                .map_err(|e| format!("Cannot resolve Obsidian note path: {e}"))?;
            if !canonical_target.starts_with(&folder) {
                return Err("Obsidian note points outside the selected vault".into());
            }
            let existing = fs::read(&target)
                .map_err(|e| format!("Cannot read existing Obsidian note: {e}"))?;
            if hash(&existing) != record.content_hash {
                return Ok(ObsidianSaveResult {
                    status: "conflict".into(),
                    path: target.display().to_string(),
                });
            }
        }
        if !user_confirmed && record.user_edited {
            return Ok(ObsidianSaveResult {
                status: "review_required".into(),
                path: target.display().to_string(),
            });
        }
    }

    atomic_write(&target, content.as_bytes())?;
    records.insert(
        key,
        ExportRecord {
            path: target.display().to_string(),
            content_hash: hash(content.as_bytes()),
            user_edited: user_confirmed || prior.map(|record| record.user_edited).unwrap_or(false),
        },
    );
    if note_type == "minutes" {
        for old_lang in ["ja", "vi", "en"] {
            records.remove(&format!("{}::{id}::minutes::{old_lang}", vault.display()));
            records.remove(&format!("{}::{id}::{old_lang}", vault.display()));
        }
    }
    let index_bytes = serde_json::to_vec_pretty(&records).map_err(|e| e.to_string())?;
    atomic_write(&index_path, &index_bytes)?;

    Ok(ObsidianSaveResult {
        status: "saved".into(),
        path: target.display().to_string(),
    })
}

fn encode_uri_path(path: &str) -> String {
    let mut out = String::new();
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[tauri::command]
pub fn open_obsidian_note(app: AppHandle, path: String) -> Result<(), String> {
    let url = format!("obsidian://open?path={}", encode_uri_path(&path));
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Cannot open note in Obsidian: {e}"))
}
