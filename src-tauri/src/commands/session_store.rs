// Session-aware transcript persistence (.md + .json sidecar pairs).
//
// File pair: session-{YYMMDD-HHMM}.md (human-readable) + .json (structured).
// Writes are atomic: write to {path}.tmp then rename, so a crash mid-write
// never corrupts an existing file.
//
// Legacy `.md`-only files from the old `save_transcript` command are still
// listed (with `has_legacy_only: true`) but not editable.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

// ─── Types ───────────────────────────────────────────────────────────────

pub const SUPPORTED_AUDIO_EXTS: &[&str] = &["wav", "mp3", "m4a", "aac", "ogg", "flac", "webm"];

pub fn audio_mime_type(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "wav" => "audio/wav",
        "mp3" => "audio/mp3",
        "m4a" => "audio/m4a",
        "aac" => "audio/aac",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "webm" => "audio/webm",
        _ => "audio/wav",
    }
}

pub fn find_session_audio(dir: &Path, id: &str) -> Option<(PathBuf, &'static str)> {
    for ext in SUPPORTED_AUDIO_EXTS {
        let p = dir.join(format!("session-{}.{}", id, ext));
        if p.exists() {
            return Some((p, audio_mime_type(ext)));
        }
    }
    None
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AudioFileInfo {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub extension: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Segment {
    pub ts: String, // "HH:MM:SS"
    pub src: String,
    pub tgt: String,
    #[serde(default)]
    pub speaker: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Chunk {
    pub started_at: String,       // ISO8601
    pub ended_at: Option<String>, // None until chunk closes
    pub segments: Vec<Segment>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Customer {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_active_status")]
    pub status: String, // "active" | "archived"
    #[serde(default)]
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub customer_id: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_active_status")]
    pub status: String, // "active" | "archived"
    #[serde(default)]
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

fn default_active_status() -> String {
    "active".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Category {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ProjectRegistry {
    #[serde(default)]
    pub custom_transcripts_dir: Option<String>,
    #[serde(default)]
    pub customers: Vec<Customer>,
    pub projects: Vec<Project>,
    pub categories: Vec<Category>,
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SessionData {
    pub id: String,
    pub created_at: String,
    pub ended_at: Option<String>,
    pub title: String,
    pub engine: String,
    pub source_lang: String,
    pub target_lang: String,
    pub duration_sec: u64,
    pub chunks: Vec<Chunk>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub customer_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub meeting_minutes: Option<String>,
    #[serde(default)]
    pub meeting_minutes_lang: Option<String>,
    #[serde(default)]
    pub meeting_minutes_ja: Option<String>,
    #[serde(default)]
    pub meeting_minutes_vi: Option<String>,
    #[serde(default)]
    pub retranscribed_at: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct SessionListItem {
    pub id: String,
    pub title: String,
    pub engine: String,
    pub source_lang: String,
    pub target_lang: String,
    pub created_at: String,
    pub ended_at: Option<String>,
    pub duration_sec: u64,
    pub chunk_count: usize,
    pub segment_count: usize,
    pub has_legacy_only: bool,
    pub has_meeting_minutes: bool,
    pub tags: Vec<String>,
    pub customer_id: Option<String>,
    pub customer_name: Option<String>,
    pub customer_color: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
    pub project_status: Option<String>,
    pub category: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct SessionReadResult {
    pub md: String,
    pub json: SessionData,
}

#[derive(Serialize, Debug)]
pub struct StorageInfo {
    pub current_path: String,
    pub is_custom: bool,
    pub default_path: String,
    pub session_count: usize,
    pub total_size_bytes: u64,
}

// ─── Path helpers ────────────────────────────────────────────────────────

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {}", e))?;
    Ok(dir.join("projects.json"))
}

pub fn load_project_registry(app: &AppHandle) -> Result<ProjectRegistry, String> {
    let path = registry_path(app)?;
    if !path.exists() {
        let default_reg = ProjectRegistry {
            custom_transcripts_dir: None,
            customers: Vec::new(),
            projects: Vec::new(),
            categories: vec![
                Category {
                    id: "cat_weekly".into(),
                    name: "Weekly".into(),
                    color: "#10b981".into(),
                },
                Category {
                    id: "cat_daily".into(),
                    name: "Daily".into(),
                    color: "#431A46".into(),
                },
                Category {
                    id: "cat_sales".into(),
                    name: "Sales".into(),
                    color: "#f59e0b".into(),
                },
                Category {
                    id: "cat_1on1".into(),
                    name: "1-on-1".into(),
                    color: "#ec4899".into(),
                },
                Category {
                    id: "cat_planning".into(),
                    name: "Planning".into(),
                    color: "#8b5cf6".into(),
                },
                Category {
                    id: "cat_retro".into(),
                    name: "Retro".into(),
                    color: "#14b8a6".into(),
                },
            ],
            tags: Vec::new(),
        };
        let _ = save_project_registry(app, &default_reg);
        return Ok(default_reg);
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Read projects.json failed: {}", e))?;
    let reg: ProjectRegistry =
        serde_json::from_str(&content).map_err(|e| format!("Parse projects.json failed: {}", e))?;
    Ok(reg)
}

pub fn save_project_registry(app: &AppHandle, reg: &ProjectRegistry) -> Result<(), String> {
    let path = registry_path(app)?;
    let bytes = serde_json::to_vec_pretty(reg)
        .map_err(|e| format!("Serialize projects.json failed: {}", e))?;
    write_atomic(&path, &bytes)?;
    Ok(())
}

pub fn default_sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("transcripts");
    Ok(dir)
}

pub fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(reg) = load_project_registry(app) {
        if let Some(custom) = reg.custom_transcripts_dir {
            let trimmed = custom.trim();
            if !trimmed.is_empty() {
                let p = PathBuf::from(trimmed);
                if fs::create_dir_all(&p).is_ok() {
                    return Ok(p);
                }
            }
        }
    }
    let dir = default_sessions_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {}", e))?;
    Ok(dir)
}

fn session_paths(dir: &Path, id: &str) -> (PathBuf, PathBuf) {
    let base = format!("session-{}", id);
    (
        dir.join(format!("{}.md", base)),
        dir.join(format!("{}.json", base)),
    )
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 {
        return Err("Invalid session id length".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid session id characters".into());
    }
    Ok(())
}

fn sanitize_title(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(200)
        .collect()
}

// ─── Atomic write ────────────────────────────────────────────────────────

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|s| s.to_str()).unwrap_or("")
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("Failed to create tmp: {}", e))?;
        f.write_all(bytes)
            .map_err(|e| format!("Write failed: {}", e))?;
        f.sync_all().map_err(|e| format!("fsync failed: {}", e))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("Rename failed: {}", e))?;
    Ok(())
}

// ─── Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_project_registry(app: AppHandle) -> Result<ProjectRegistry, String> {
    load_project_registry(&app)
}

#[tauri::command]
pub fn save_customer(app: AppHandle, mut customer: Customer) -> Result<Customer, String> {
    if customer.name.trim().is_empty() {
        return Err("Tên khách hàng không được để trống".into());
    }
    customer.name = sanitize_title(customer.name.trim());
    customer.code = customer.code.trim().to_uppercase();
    customer.description = customer.description.trim().to_string();
    if customer.color.is_empty() {
        customer.color = "#431A46".to_string();
    }
    if customer.status.is_empty() {
        customer.status = "active".to_string();
    }
    let now = chrono_now_iso();
    customer.updated_at = now.clone();

    let mut reg = load_project_registry(&app)?;
    if customer.id.is_empty() {
        customer.id = format!("cust_{}", chrono_timestamp_id());
        customer.created_at = now;
        reg.customers.push(customer.clone());
    } else {
        if let Some(existing) = reg.customers.iter_mut().find(|c| c.id == customer.id) {
            existing.name = customer.name.clone();
            existing.code = customer.code.clone();
            existing.description = customer.description.clone();
            existing.color = customer.color.clone();
            existing.status = customer.status.clone();
            existing.updated_at = customer.updated_at.clone();
        } else {
            customer.created_at = now;
            reg.customers.push(customer.clone());
        }
    }
    save_project_registry(&app, &reg)?;
    Ok(customer)
}

#[tauri::command]
pub fn toggle_customer_status(app: AppHandle, id: String) -> Result<String, String> {
    let mut reg = load_project_registry(&app)?;
    let Some(cust) = reg.customers.iter_mut().find(|c| c.id == id) else {
        return Err("Customer not found".into());
    };
    let new_status = if cust.status == "active" {
        "archived".to_string()
    } else {
        "active".to_string()
    };
    cust.status = new_status.clone();
    cust.updated_at = chrono_now_iso();
    save_project_registry(&app, &reg)?;
    Ok(new_status)
}

#[tauri::command]
pub fn delete_customer(app: AppHandle, id: String) -> Result<(), String> {
    let mut reg = load_project_registry(&app)?;
    reg.customers.retain(|c| c.id != id);
    // Unlink customer from projects
    for p in &mut reg.projects {
        if p.customer_id.as_deref() == Some(&id) {
            p.customer_id = None;
        }
    }
    save_project_registry(&app, &reg)?;
    Ok(())
}

#[tauri::command]
pub fn save_project(app: AppHandle, mut project: Project) -> Result<Project, String> {
    if project.name.trim().is_empty() {
        return Err("Tên dự án không được để trống".into());
    }
    project.name = sanitize_title(project.name.trim());
    project.description = project.description.trim().to_string();
    if project.color.is_empty() {
        project.color = "#431A46".to_string();
    }
    if project.status.is_empty() {
        project.status = "active".to_string();
    }
    let now = chrono_now_iso();
    project.updated_at = now.clone();

    let mut reg = load_project_registry(&app)?;
    if project.id.is_empty() {
        project.id = format!("proj_{}", chrono_timestamp_id());
        project.created_at = now;
        reg.projects.push(project.clone());
    } else {
        if let Some(existing) = reg.projects.iter_mut().find(|p| p.id == project.id) {
            existing.name = project.name.clone();
            existing.customer_id = project.customer_id.clone();
            existing.description = project.description.clone();
            existing.color = project.color.clone();
            existing.status = project.status.clone();
            existing.updated_at = project.updated_at.clone();
        } else {
            project.created_at = now;
            reg.projects.push(project.clone());
        }
    }
    save_project_registry(&app, &reg)?;
    Ok(project)
}

#[tauri::command]
pub fn toggle_project_status(app: AppHandle, id: String) -> Result<String, String> {
    let mut reg = load_project_registry(&app)?;
    let Some(proj) = reg.projects.iter_mut().find(|p| p.id == id) else {
        return Err("Project not found".into());
    };
    let new_status = if proj.status == "active" {
        "archived".to_string()
    } else {
        "active".to_string()
    };
    proj.status = new_status.clone();
    proj.updated_at = chrono_now_iso();
    save_project_registry(&app, &reg)?;
    Ok(new_status)
}

#[tauri::command]
pub fn delete_project(app: AppHandle, id: String) -> Result<(), String> {
    let mut reg = load_project_registry(&app)?;
    reg.projects.retain(|p| p.id != id);
    save_project_registry(&app, &reg)?;
    Ok(())
}

#[tauri::command]
pub fn save_category(app: AppHandle, mut category: Category) -> Result<Category, String> {
    if category.name.trim().is_empty() {
        return Err("Tên danh mục không được để trống".into());
    }
    category.name = sanitize_title(category.name.trim());
    if category.color.is_empty() {
        category.color = "#431A46".to_string();
    }
    let mut reg = load_project_registry(&app)?;
    if category.id.is_empty() {
        category.id = format!("cat_{}", chrono_timestamp_id());
        reg.categories.push(category.clone());
    } else {
        if let Some(existing) = reg.categories.iter_mut().find(|c| c.id == category.id) {
            existing.name = category.name.clone();
            existing.color = category.color.clone();
        } else {
            reg.categories.push(category.clone());
        }
    }
    save_project_registry(&app, &reg)?;
    Ok(category)
}

#[tauri::command]
pub fn delete_category(app: AppHandle, id: String) -> Result<(), String> {
    let mut reg = load_project_registry(&app)?;
    reg.categories.retain(|c| c.id != id);
    save_project_registry(&app, &reg)?;
    Ok(())
}

#[tauri::command]
pub fn save_tag(app: AppHandle, tag: String) -> Result<String, String> {
    let clean = tag.trim().trim_start_matches('#').to_lowercase();
    if clean.is_empty() {
        return Err("Thẻ không được để trống".into());
    }
    let mut reg = load_project_registry(&app)?;
    if !reg.tags.contains(&clean) {
        reg.tags.push(clean.clone());
        save_project_registry(&app, &reg)?;
    }
    Ok(clean)
}

#[tauri::command]
pub fn delete_tag(app: AppHandle, tag: String) -> Result<(), String> {
    let clean = tag.trim().trim_start_matches('#').to_lowercase();
    let mut reg = load_project_registry(&app)?;
    reg.tags.retain(|t| t != &clean);
    save_project_registry(&app, &reg)?;
    Ok(())
}

fn chrono_now_iso() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Simplified timestamp format
    format!("{}", now)
}

fn chrono_timestamp_id() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{:x}", now)
}

#[tauri::command]
pub fn save_session(
    app: AppHandle,
    id: String,
    md_content: String,
    json_data: SessionData,
) -> Result<(), String> {
    validate_id(&id)?;
    if json_data.id != id {
        return Err("id mismatch between argument and json_data".into());
    }
    let dir = sessions_dir(&app)?;
    let (md_path, json_path) = session_paths(&dir, &id);

    // Auto-register any new tags into registry
    if !json_data.tags.is_empty() {
        if let Ok(mut reg) = load_project_registry(&app) {
            let mut changed = false;
            for t in &json_data.tags {
                let clean = t.trim().trim_start_matches('#').to_lowercase();
                if !clean.is_empty() && !reg.tags.contains(&clean) {
                    reg.tags.push(clean);
                    changed = true;
                }
            }
            if changed {
                let _ = save_project_registry(&app, &reg);
            }
        }
    }

    // Write JSON first (source of truth) then MD. If MD fails, JSON is still good.
    let json_bytes = serde_json::to_vec_pretty(&json_data)
        .map_err(|e| format!("JSON serialize failed: {}", e))?;
    write_atomic(&json_path, &json_bytes)?;
    write_atomic(&md_path, md_content.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub fn list_sessions(app: AppHandle) -> Result<Vec<SessionListItem>, String> {
    let dir = sessions_dir(&app)?;
    let mut items: Vec<SessionListItem> = Vec::new();
    let mut seen_new_ids: std::collections::HashSet<String> = Default::default();

    let registry = load_project_registry(&app).unwrap_or_default();
    let customer_map: std::collections::HashMap<String, (String, String, String)> = registry
        .customers
        .into_iter()
        .map(|c| (c.id, (c.name, c.color, c.status)))
        .collect();
    let project_map: std::collections::HashMap<String, (String, String, String, Option<String>)> =
        registry
            .projects
            .into_iter()
            .map(|p| (p.id, (p.name, p.color, p.status, p.customer_id)))
            .collect();

    let entries = fs::read_dir(&dir).map_err(|e| format!("Read dir failed: {}", e))?;
    let entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();

    // Pass 1: parse all .json sidecars
    for entry in &entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(stem) = name.strip_suffix(".json") else {
            continue;
        };
        let Some(id) = stem.strip_prefix("session-") else {
            continue;
        };
        let path = entry.path();
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(data) = serde_json::from_str::<SessionData>(&content) else {
            continue;
        };
        let segment_count: usize = data.chunks.iter().map(|c| c.segments.len()).sum();
        seen_new_ids.insert(id.to_string());

        let (project_name, project_color, project_status, proj_cust_id) =
            if let Some(ref pid) = data.project_id {
                if let Some((pname, pcol, pstat, cid)) = project_map.get(pid) {
                    (
                        Some(pname.clone()),
                        Some(pcol.clone()),
                        Some(pstat.clone()),
                        cid.clone(),
                    )
                } else {
                    (None, None, None, None)
                }
            } else {
                (None, None, None, None)
            };

        let effective_cust_id = data.customer_id.clone().or(proj_cust_id);
        let (customer_name, customer_color) = if let Some(ref cid) = effective_cust_id {
            if let Some((cname, ccol, _)) = customer_map.get(cid) {
                (Some(cname.clone()), Some(ccol.clone()))
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };

        let has_meeting_minutes = data
            .meeting_minutes_ja
            .as_ref()
            .map(|m| !m.trim().is_empty())
            .unwrap_or(false)
            || data
                .meeting_minutes_vi
                .as_ref()
                .map(|m| !m.trim().is_empty())
                .unwrap_or(false)
            || data
                .meeting_minutes
                .as_ref()
                .map(|m| !m.trim().is_empty())
                .unwrap_or(false);

        items.push(SessionListItem {
            id: data.id,
            title: data.title,
            engine: data.engine,
            source_lang: data.source_lang,
            target_lang: data.target_lang,
            created_at: data.created_at,
            ended_at: data.ended_at,
            duration_sec: data.duration_sec,
            chunk_count: data.chunks.len(),
            segment_count,
            has_legacy_only: false,
            has_meeting_minutes,
            tags: data.tags,
            customer_id: effective_cust_id,
            customer_name,
            customer_color,
            project_id: data.project_id,
            project_name,
            project_color,
            project_status,
            category: data.category,
        });
    }

    // Pass 2: legacy .md-only files (old save_transcript output, no sidecar)
    for entry in &entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(stem) = name.strip_suffix(".md") else {
            continue;
        };
        // Skip new format files we already counted in pass 1
        if let Some(id) = stem.strip_prefix("session-") {
            if seen_new_ids.contains(id) {
                continue;
            }
        }
        // Legacy filename pattern: 2026-03-27_10-21-05.md
        let created_at = stem.replace('_', " ");
        items.push(SessionListItem {
            id: stem.to_string(),
            title: stem.to_string(),
            engine: "legacy".into(),
            source_lang: String::new(),
            target_lang: String::new(),
            created_at,
            ended_at: None,
            duration_sec: 0,
            chunk_count: 0,
            segment_count: 0,
            has_legacy_only: true,
            has_meeting_minutes: false,
            tags: Vec::new(),
            customer_id: None,
            customer_name: None,
            customer_color: None,
            project_id: None,
            project_name: None,
            project_color: None,
            project_status: None,
            category: None,
        });
    }

    // Newest first
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(items)
}

#[tauri::command]
pub fn read_session(app: AppHandle, id: String) -> Result<SessionReadResult, String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    let (md_path, json_path) = session_paths(&dir, &id);
    let md = fs::read_to_string(&md_path).map_err(|e| format!("Read md failed: {}", e))?;
    let json_str =
        fs::read_to_string(&json_path).map_err(|e| format!("Read json failed: {}", e))?;
    let json: SessionData =
        serde_json::from_str(&json_str).map_err(|e| format!("Parse json failed: {}", e))?;
    Ok(SessionReadResult { md, json })
}

#[tauri::command]
pub fn read_legacy_session(app: AppHandle, id: String) -> Result<String, String> {
    // Legacy files: id is the filename stem (e.g. "2026-03-27_10-21-05").
    // Allow ':' and '.' since old filenames may include them (none should, but be safe).
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("Invalid id".into());
    }
    let dir = sessions_dir(&app)?;
    let path = dir.join(format!("{}.md", id));
    fs::read_to_string(&path).map_err(|e| format!("Read failed: {}", e))
}

#[tauri::command]
pub fn delete_session(app: AppHandle, id: String) -> Result<(), String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    // New format: session-{id}.{md,json,wav,mp3,...}
    let (md_path, json_path) = session_paths(&dir, &id);
    let _ = fs::remove_file(&json_path);
    let _ = fs::remove_file(&md_path);
    for ext in SUPPORTED_AUDIO_EXTS {
        let _ = fs::remove_file(dir.join(format!("session-{}.{}", id, ext)));
    }
    // Legacy format: {id}.md (no session- prefix, no sidecar)
    let _ = fs::remove_file(dir.join(format!("{}.md", id)));
    Ok(())
}

#[tauri::command]
pub fn delete_sessions(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    for id in ids {
        let _ = delete_session(app.clone(), id);
    }
    Ok(())
}

#[tauri::command]
pub fn update_session_title(app: AppHandle, id: String, title: String) -> Result<(), String> {
    update_session_metadata(app, id, Some(title), None, None, None, None)
}

#[tauri::command]
pub fn update_session_metadata(
    app: AppHandle,
    id: String,
    title: Option<String>,
    customer_id: Option<String>,
    project_id: Option<String>,
    category: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    let (md_path, json_path) = session_paths(&dir, &id);
    let json_str = fs::read_to_string(&json_path).map_err(|e| format!("Read failed: {}", e))?;
    let mut data: SessionData =
        serde_json::from_str(&json_str).map_err(|e| format!("Parse failed: {}", e))?;

    if let Some(t) = title {
        data.title = sanitize_title(&t);
    }
    if let Some(cid) = customer_id {
        data.customer_id = if cid.trim().is_empty() {
            None
        } else {
            Some(cid.trim().to_string())
        };
    }
    if let Some(pid) = project_id {
        data.project_id = if pid.trim().is_empty() {
            None
        } else {
            Some(pid.trim().to_string())
        };
    }
    if let Some(cat) = category {
        data.category = if cat.trim().is_empty() {
            None
        } else {
            Some(cat.trim().to_string())
        };
    }
    if let Some(t_list) = tags {
        let clean_tags: Vec<String> = t_list
            .into_iter()
            .map(|t| t.trim().trim_start_matches('#').to_lowercase())
            .filter(|t| !t.is_empty() && t.len() <= 50)
            .collect();
        data.tags = clean_tags;
    }

    let json_bytes =
        serde_json::to_vec_pretty(&data).map_err(|e| format!("Serialize failed: {}", e))?;
    write_atomic(&json_path, &json_bytes)?;

    // Update MD header with new title
    let md = fs::read_to_string(&md_path).unwrap_or_default();
    let new_md = if let Some(eol) = md.find('\n') {
        format!("# {}\n{}", data.title, &md[eol + 1..])
    } else {
        format!("# {}\n", data.title)
    };
    write_atomic(&md_path, new_md.as_bytes())?;

    Ok(())
}

#[tauri::command]
pub fn update_session_tags(app: AppHandle, id: String, tags: Vec<String>) -> Result<(), String> {
    update_session_metadata(app, id, None, None, None, None, Some(tags))
}

#[tauri::command]
pub fn update_session_content(
    app: AppHandle,
    id: String,
    title: Option<String>,
    md_content: String,
) -> Result<(), String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    let (md_path, json_path) = session_paths(&dir, &id);

    if json_path.exists() {
        let json_str =
            fs::read_to_string(&json_path).map_err(|e| format!("Read json failed: {}", e))?;
        let mut data: SessionData =
            serde_json::from_str(&json_str).map_err(|e| format!("Parse json failed: {}", e))?;
        if let Some(ref t) = title {
            data.title = sanitize_title(t);
        }
        let json_bytes =
            serde_json::to_vec_pretty(&data).map_err(|e| format!("Serialize failed: {}", e))?;
        write_atomic(&json_path, &json_bytes)?;
        write_atomic(&md_path, md_content.as_bytes())?;
    } else {
        let legacy_path = dir.join(format!("{}.md", id));
        if legacy_path.exists() {
            write_atomic(&legacy_path, md_content.as_bytes())?;
        } else {
            write_atomic(&md_path, md_content.as_bytes())?;
        }
    }
    Ok(())
}

fn format_duration_str(sec: u64) -> String {
    let h = sec / 3600;
    let m = (sec % 3600) / 60;
    let s = sec % 60;
    if h > 0 {
        format!("{}h {}m", h, m)
    } else if m > 0 {
        format!("{}m {}s", m, s)
    } else {
        format!("{}s", s)
    }
}

pub fn rebuild_session_markdown(data: &SessionData) -> String {
    let mut lines = Vec::new();
    let title = if data.title.is_empty() {
        &data.id
    } else {
        &data.title
    };
    let lang_pair = format!("{} → {}", data.source_lang, data.target_lang);
    let mut meta_extras = Vec::new();
    if let Some(ref cat) = data.category {
        meta_extras.push(format!("📅 Phân loại: {}", cat));
    }
    if !data.tags.is_empty() {
        meta_extras.push(
            data.tags
                .iter()
                .map(|t| format!("#{}", t))
                .collect::<Vec<_>>()
                .join(" "),
        );
    }
    let extra_str = if meta_extras.is_empty() {
        String::new()
    } else {
        format!(" · {}", meta_extras.join(" · "))
    };

    let dur_str = format_duration_str(data.duration_sec);
    lines.push(format!("# {}", title));
    lines.push(String::new());
    lines.push(format!(
        "**Thông tin**: Engine {} · {} · {} · {}{}",
        data.engine, lang_pair, data.created_at, dur_str, extra_str
    ));
    lines.push(String::new());
    lines.push("---".to_string());
    lines.push(String::new());

    let has_ja = data
        .meeting_minutes_ja
        .as_ref()
        .map(|m| !m.trim().is_empty())
        .unwrap_or(false);
    let has_vi = data
        .meeting_minutes_vi
        .as_ref()
        .map(|m| !m.trim().is_empty())
        .unwrap_or(false);

    if has_ja {
        if let Some(ref mm_ja) = data.meeting_minutes_ja {
            lines.push("## 📋 Biên bản cuộc họp (Tiếng Nhật)".to_string());
            lines.push(String::new());
            lines.push(mm_ja.trim().to_string());
            lines.push(String::new());
            lines.push("---".to_string());
            lines.push(String::new());
        }
    } else if let Some(ref mm) = data.meeting_minutes {
        if !mm.trim().is_empty() && data.meeting_minutes_lang.as_deref() == Some("ja") {
            lines.push("## 📋 Biên bản cuộc họp (Tiếng Nhật)".to_string());
            lines.push(String::new());
            lines.push(mm.trim().to_string());
            lines.push(String::new());
            lines.push("---".to_string());
            lines.push(String::new());
        }
    }

    if has_vi {
        if let Some(ref mm_vi) = data.meeting_minutes_vi {
            lines.push("## 📋 Biên bản cuộc họp (Tiếng Việt)".to_string());
            lines.push(String::new());
            lines.push(mm_vi.trim().to_string());
            lines.push(String::new());
            lines.push("---".to_string());
            lines.push(String::new());
        }
    } else if let Some(ref mm) = data.meeting_minutes {
        if !mm.trim().is_empty() && data.meeting_minutes_lang.as_deref() != Some("ja") {
            lines.push("## 📋 Biên bản cuộc họp (Tiếng Việt)".to_string());
            lines.push(String::new());
            lines.push(mm.trim().to_string());
            lines.push(String::new());
            lines.push("---".to_string());
            lines.push(String::new());
        }
    }

    let mut src_lines = Vec::new();
    let mut tgt_lines = Vec::new();

    for chunk in &data.chunks {
        for seg in &chunk.segments {
            let ts_tag = if !seg.ts.is_empty() {
                format!("[{}] ", seg.ts)
            } else {
                String::new()
            };
            let spk_tag = if let Some(ref spk) = seg.speaker {
                if !spk.is_empty() {
                    format!("(Speaker {}) ", spk)
                } else {
                    String::new()
                }
            } else {
                String::new()
            };
            let src = seg.src.trim();
            let tgt = seg.tgt.trim();
            if !src.is_empty() {
                src_lines.push(format!("{}{}{}", ts_tag, spk_tag, src));
            }
            if !tgt.is_empty() {
                tgt_lines.push(format!("{}{}{}", ts_tag, spk_tag, tgt));
            }
        }
    }

    lines.push("## 🗣️ Bản gốc (Original)".to_string());
    lines.push(String::new());
    if !src_lines.is_empty() {
        lines.push(src_lines.join("\n"));
    } else {
        lines.push("*(Không có nội dung bản gốc)*".to_string());
    }
    lines.push(String::new());
    lines.push("---".to_string());
    lines.push(String::new());

    lines.push("## 🌐 Bản dịch (Translation)".to_string());
    lines.push(String::new());
    if !tgt_lines.is_empty() {
        lines.push(tgt_lines.join("\n"));
    } else {
        lines.push("*(Không có nội dung bản dịch)*".to_string());
    }

    lines.join("\n")
}

#[tauri::command]
pub fn update_session_meeting_minutes(
    app: AppHandle,
    id: String,
    minutes: String,
    lang: Option<String>,
) -> Result<SessionReadResult, String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    let (md_path, json_path) = session_paths(&dir, &id);

    if !json_path.exists() {
        return Err("Session json does not exist".into());
    }

    let json_str =
        fs::read_to_string(&json_path).map_err(|e| format!("Read json failed: {}", e))?;
    let mut data: SessionData =
        serde_json::from_str(&json_str).map_err(|e| format!("Parse json failed: {}", e))?;

    let chosen_lang = lang.as_deref().unwrap_or("ja");
    if chosen_lang == "ja" {
        data.meeting_minutes_ja = Some(minutes.clone());
    } else if chosen_lang == "vi" {
        data.meeting_minutes_vi = Some(minutes.clone());
    }
    data.meeting_minutes = Some(minutes);
    data.meeting_minutes_lang = Some(chosen_lang.to_string());

    let json_bytes =
        serde_json::to_vec_pretty(&data).map_err(|e| format!("Serialize failed: {}", e))?;
    write_atomic(&json_path, &json_bytes)?;

    let md_content = rebuild_session_markdown(&data);
    write_atomic(&md_path, md_content.as_bytes())?;

    Ok(SessionReadResult {
        md: md_content,
        json: data,
    })
}

#[tauri::command]
pub fn update_session_notes(
    app: AppHandle,
    id: String,
    notes: String,
) -> Result<SessionReadResult, String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    let (md_path, json_path) = session_paths(&dir, &id);

    if !json_path.exists() {
        return Err("Session json does not exist".into());
    }

    let json_str =
        fs::read_to_string(&json_path).map_err(|e| format!("Read json failed: {}", e))?;
    let mut data: SessionData =
        serde_json::from_str(&json_str).map_err(|e| format!("Parse json failed: {}", e))?;

    data.notes = Some(notes);

    let json_bytes =
        serde_json::to_vec_pretty(&data).map_err(|e| format!("Serialize failed: {}", e))?;
    write_atomic(&json_path, &json_bytes)?;

    let md_content = rebuild_session_markdown(&data);
    write_atomic(&md_path, md_content.as_bytes())?;

    Ok(SessionReadResult {
        md: md_content,
        json: data,
    })
}

pub fn build_session_srt(data: &SessionData) -> String {
    let mut out = String::new();
    let mut idx: u32 = 1;
    let mut flat: Vec<&Segment> = data.chunks.iter().flat_map(|c| c.segments.iter()).collect();
    flat.sort_by(|a, b| a.ts.cmp(&b.ts));
    for (i, seg) in flat.iter().enumerate() {
        let start = seg.ts.clone();
        // End = next segment's ts, or +3s if last
        let end = if i + 1 < flat.len() {
            flat[i + 1].ts.clone()
        } else {
            add_seconds_hms(&seg.ts, 3)
        };
        out.push_str(&format!(
            "{}\n{},000 --> {},000\n{}\n\n",
            idx, start, end, seg.tgt
        ));
        idx += 1;
    }
    out
}

pub fn build_session_txt(data: &SessionData) -> String {
    let lines: Vec<String> = data
        .chunks
        .iter()
        .flat_map(|c| c.segments.iter())
        .map(|s| s.tgt.clone())
        .collect();
    lines.join("\n")
}

pub fn session_item_matches_metadata(item: &SessionListItem, q: &str, tag_match: &str) -> bool {
    item.title.to_lowercase().contains(q)
        || item
            .customer_name
            .as_ref()
            .map_or(false, |c| c.to_lowercase().contains(q))
        || item
            .project_name
            .as_ref()
            .map_or(false, |p| p.to_lowercase().contains(q))
        || item
            .category
            .as_ref()
            .map_or(false, |c| c.to_lowercase().contains(q))
        || item.tags.iter().any(|t| {
            t.to_lowercase().contains(tag_match) || format!("#{}", t.to_lowercase()).contains(q)
        })
}

#[tauri::command]
pub fn export_session_srt(app: AppHandle, id: String) -> Result<String, String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    let (_, json_path) = session_paths(&dir, &id);
    let json_str = fs::read_to_string(&json_path).map_err(|e| format!("Read failed: {}", e))?;
    let data: SessionData =
        serde_json::from_str(&json_str).map_err(|e| format!("Parse failed: {}", e))?;

    Ok(build_session_srt(&data))
}

#[tauri::command]
pub fn export_session_txt(app: AppHandle, id: String) -> Result<String, String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    let (_, json_path) = session_paths(&dir, &id);
    let json_str = fs::read_to_string(&json_path).map_err(|e| format!("Read failed: {}", e))?;
    let data: SessionData =
        serde_json::from_str(&json_str).map_err(|e| format!("Parse failed: {}", e))?;

    Ok(build_session_txt(&data))
}

#[tauri::command]
pub fn search_sessions(app: AppHandle, query: String) -> Result<Vec<SessionListItem>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return list_sessions(app);
    }
    let tag_match = q.strip_prefix('#').unwrap_or(&q);
    let all = list_sessions(app.clone())?;
    let dir = sessions_dir(&app)?;
    let mut hits: Vec<SessionListItem> = Vec::new();
    for item in all {
        if item.has_legacy_only {
            // Match against title + raw md content
            let path = dir.join(format!("{}.md", item.id));
            if let Ok(body) = fs::read_to_string(&path) {
                if body.to_lowercase().contains(&q) || item.title.to_lowercase().contains(&q) {
                    hits.push(item);
                }
            }
            continue;
        }
        if session_item_matches_metadata(&item, &q, tag_match) {
            hits.push(item);
            continue;
        }
        let (_, json_path) = session_paths(&dir, &item.id);
        let Ok(json_str) = fs::read_to_string(&json_path) else {
            continue;
        };
        if json_str.to_lowercase().contains(&q) {
            hits.push(item);
        }
    }
    Ok(hits)
}

// "HH:MM:SS" + N seconds → new "HH:MM:SS" (saturating at 99:59:59)
fn add_seconds_hms(ts: &str, add: u64) -> String {
    let parts: Vec<u64> = ts.split(':').filter_map(|p| p.parse().ok()).collect();
    if parts.len() != 3 {
        return ts.to_string();
    }
    let total = parts[0] * 3600 + parts[1] * 60 + parts[2] + add;
    let h = (total / 3600).min(99);
    let m = (total % 3600) / 60;
    let s = total % 60;
    format!("{:02}:{:02}:{:02}", h, m, s)
}

#[tauri::command]
pub async fn select_audio_file(app: AppHandle) -> Result<Option<AudioFileInfo>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Chọn file ghi âm cuộc họp")
        .add_filter("Audio Files", SUPPORTED_AUDIO_EXTS)
        .pick_file(move |file| {
            let _ = tx.send(file);
        });

    let file = rx.await.map_err(|e| e.to_string())?;
    if let Some(file_path) = file {
        let path_str = file_path.to_string();
        let p = PathBuf::from(&path_str);
        let file_name = p
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let extension = p
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        let file_size = p.metadata().map(|m| m.len()).unwrap_or(0);
        Ok(Some(AudioFileInfo {
            file_path: path_str,
            file_name,
            file_size,
            extension,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn get_session_record_path(app: AppHandle, id: String) -> Result<String, String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    if let Some((p, _)) = find_session_audio(&dir, &id) {
        Ok(p.to_string_lossy().to_string())
    } else {
        let wav_path = dir.join(format!("session-{}.wav", id));
        Ok(wav_path.to_string_lossy().to_string())
    }
}

#[tauri::command]
pub fn read_session_audio(app: AppHandle, id: String) -> Result<Option<String>, String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    if let Some((p, mime)) = find_session_audio(&dir, &id) {
        let bytes = fs::read(&p).map_err(|e| e.to_string())?;
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(Some(format!("data:{};base64,{}", mime, b64)))
    } else {
        Ok(None)
    }
}

#[derive(Deserialize)]
struct GeminiTranscriptSegment {
    #[serde(default)]
    start_sec: Option<f64>,
    #[serde(default)]
    text: String,
    #[serde(default)]
    translation: String,
    #[serde(default)]
    src: String,
    #[serde(default)]
    tgt: String,
}

#[derive(Deserialize)]
struct GeminiTranscriptPayload {
    segments: Vec<GeminiTranscriptSegment>,
}

fn gemini_error(status: reqwest::StatusCode, body: String) -> String {
    let detail = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .get("error")?
                .get("message")?
                .as_str()
                .map(str::to_string)
        })
        .unwrap_or(body);
    format!(
        "Gemini API error ({}): {}",
        status,
        detail.chars().take(500).collect::<String>()
    )
}

fn transcript_timestamp(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    format!(
        "{:02}:{:02}:{:02}",
        total / 3600,
        (total % 3600) / 60,
        total % 60
    )
}

fn try_repair_truncated_json(text: &str) -> Option<String> {
    let mut in_str = false;
    let mut escape = false;
    let mut last_valid_brace_end = None;

    for (idx, ch) in text.char_indices() {
        if escape {
            escape = false;
            continue;
        }
        if ch == '\\' && in_str {
            escape = true;
            continue;
        }
        if ch == '"' {
            in_str = !in_str;
            continue;
        }
        if !in_str && ch == '}' {
            last_valid_brace_end = Some(idx + ch.len_utf8());
        }
    }

    let end_idx = last_valid_brace_end?;
    let candidate = &text[..end_idx];

    let mut open_curlies = 0i32;
    let mut open_squares = 0i32;
    in_str = false;
    escape = false;

    for ch in candidate.chars() {
        if escape {
            escape = false;
            continue;
        }
        if ch == '\\' && in_str {
            escape = true;
            continue;
        }
        if ch == '"' {
            in_str = !in_str;
            continue;
        }
        if !in_str {
            match ch {
                '{' => open_curlies += 1,
                '}' => open_curlies -= 1,
                '[' => open_squares += 1,
                ']' => open_squares -= 1,
                _ => {}
            }
        }
    }

    if open_curlies < 0 || open_squares < 0 {
        return None;
    }

    let mut repaired = candidate.to_string();
    for _ in 0..open_squares {
        repaired.push(']');
    }
    for _ in 0..open_curlies {
        repaired.push('}');
    }
    Some(repaired)
}

fn clean_gemini_json(text: &str) -> &str {
    let mut s = text.trim();
    if let Some(rest) = s.strip_prefix("```json") {
        s = rest.trim();
    } else if let Some(rest) = s.strip_prefix("```") {
        s = rest.trim();
    }
    if let Some(rest) = s.strip_suffix("```") {
        s = rest.trim();
    }
    s
}

fn extract_json_f64_field(chunk: &str, field: &str) -> Option<f64> {
    let key = format!("\"{}\"", field);
    let pos = chunk.find(&key)?;
    let after_key = chunk[pos + key.len()..].trim_start();
    let after_colon = after_key.strip_prefix(':')?.trim_start();
    let end_idx = after_colon
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(after_colon.len());
    after_colon[..end_idx].parse::<f64>().ok()
}

fn extract_json_string_field(chunk: &str, fields: &[&str]) -> String {
    for f in fields {
        let key = format!("\"{}\"", f);
        if let Some(pos) = chunk.find(&key) {
            let after_key = chunk[pos + key.len()..].trim_start();
            if let Some(after_colon) = after_key.strip_prefix(':') {
                let after_colon = after_colon.trim_start();
                if let Some(content) = after_colon.strip_prefix('"') {
                    // Search for `",` followed by optional whitespace and `"` (next field)
                    let mut end_idx = None;
                    let mut search_from = 0;
                    while let Some(comma_pos) = content[search_from..].find("\",") {
                        let actual_pos = search_from + comma_pos;
                        let after_comma = content[actual_pos + 2..].trim_start();
                        if after_comma.starts_with('"') {
                            end_idx = Some(actual_pos);
                            break;
                        }
                        search_from = actual_pos + 1;
                    }

                    // If not found, it is the last field before `}`
                    if end_idx.is_none() {
                        end_idx = content.rfind('"');
                    }

                    if let Some(idx) = end_idx {
                        let raw = &content[..idx];
                        return raw
                            .replace("\\\"", "\"")
                            .replace("\\\\", "\\")
                            .trim()
                            .to_string();
                    }
                }
            }
        }
    }
    String::new()
}

fn extract_segments_fallback(text: &str) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut i = 0;
    let n = text.len();

    while i < n {
        let end = match text[i..].find('}') {
            Some(pos) => i + pos,
            None => break,
        };

        let start = match text[i..end].rfind('{') {
            Some(pos) => i + pos,
            None => {
                i = end + 1;
                continue;
            }
        };

        let chunk = &text[start..=end];
        let has_text = chunk.contains("\"text\"") || chunk.contains("\"src\"");
        let has_meta = chunk.contains("\"start_sec\"") || chunk.contains("\"translation\"") || chunk.contains("\"tgt\"");

        if has_text && has_meta {
            if let Ok(item) = serde_json::from_str::<GeminiTranscriptSegment>(chunk) {
                let src = if item.text.trim().is_empty() {
                    item.src.trim().to_string()
                } else {
                    item.text.trim().to_string()
                };
                let tgt = if item.translation.trim().is_empty() {
                    item.tgt.trim().to_string()
                } else {
                    item.translation.trim().to_string()
                };
                if !src.is_empty() {
                    let sec = item.start_sec.unwrap_or(segments.len() as f64 * 5.0);
                    segments.push(Segment {
                        ts: transcript_timestamp(sec),
                        src,
                        tgt,
                        speaker: None,
                    });
                }
            } else {
                let sec = extract_json_f64_field(chunk, "start_sec")
                    .unwrap_or(segments.len() as f64 * 5.0);
                let src = extract_json_string_field(chunk, &["text", "src"]);
                let tgt = extract_json_string_field(chunk, &["translation", "tgt"]);
                if !src.is_empty() {
                    segments.push(Segment {
                        ts: transcript_timestamp(sec),
                        src,
                        tgt,
                        speaker: None,
                    });
                }
            }
        }

        i = end + 1;
    }

    segments
}

fn extract_detected_language(text: &str) -> Option<String> {
    let key = "\"detected_language\"";
    let pos = text.find(key)?;
    let after_key = text[pos + key.len()..].trim_start();
    let after_colon = after_key.strip_prefix(':')?.trim_start();
    let content = after_colon.strip_prefix('"')?;
    let end_quote = content.find('"')?;
    Some(content[..end_quote].trim().to_string())
}

fn build_segments_from_raw(raw_items: Vec<GeminiTranscriptSegment>) -> Vec<Segment> {
    raw_items
        .into_iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let src = if item.text.trim().is_empty() {
                item.src.trim().to_string()
            } else {
                item.text.trim().to_string()
            };
            let tgt = if item.translation.trim().is_empty() {
                item.tgt.trim().to_string()
            } else {
                item.translation.trim().to_string()
            };
            if src.is_empty() {
                return None;
            }
            Some(Segment {
                ts: transcript_timestamp(item.start_sec.unwrap_or(index as f64 * 5.0)),
                src,
                tgt,
                speaker: None,
            })
        })
        .collect()
}

fn parse_gemini_transcript(text: &str) -> Result<Vec<Segment>, String> {
    let trimmed = clean_gemini_json(text);

    // Tier 1: Direct serde parsing
    if let Ok(payload) = serde_json::from_str::<GeminiTranscriptPayload>(trimmed) {
        let segs = build_segments_from_raw(payload.segments);
        if !segs.is_empty() {
            return Ok(segs);
        }
    }

    // Tier 2: Repaired JSON parsing
    if let Some(repaired) = try_repair_truncated_json(trimmed) {
        if let Ok(payload) = serde_json::from_str::<GeminiTranscriptPayload>(&repaired) {
            let segs = build_segments_from_raw(payload.segments);
            if !segs.is_empty() {
                eprintln!("[session_store] Warning: salvaged {} segments from repaired Gemini transcript", segs.len());
                return Ok(segs);
            }
        }
    }

    // Tier 3: Chunk-by-chunk fallback extraction (handles unescaped quotes & broken tokens)
    let segs = extract_segments_fallback(trimmed);
    if !segs.is_empty() {
        eprintln!("[session_store] Warning: extracted {} segments via fallback scanner", segs.len());
        return Ok(segs);
    }

    Err("Gemini returned an invalid transcript".into())
}

static RETRANSCRIBE_CANCEL_MAP: std::sync::LazyLock<
    std::sync::Mutex<
        std::collections::HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>,
    >,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

struct RetranscribeGuard(String);
impl Drop for RetranscribeGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = RETRANSCRIBE_CANCEL_MAP.lock() {
            map.remove(&self.0);
        }
    }
}

/// Signal cancellation for an ongoing re-transcription process.
#[tauri::command]
pub fn cancel_retranscribe_session(id: String) -> Result<bool, String> {
    validate_id(&id)?;
    let map = RETRANSCRIBE_CANCEL_MAP.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = map.get(&id) {
        flag.store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Rebuild a saved meeting's transcript from its local WAV recording. The audio
/// is uploaded directly to Gemini Files API; the API key is used only for this
/// request and is never written to the session files.
#[tauri::command]
pub async fn retranscribe_session_with_gemini(
    app: AppHandle,
    id: String,
    api_key: String,
) -> Result<SessionReadResult, String> {
    validate_id(&id)?;
    if api_key.trim().is_empty() {
        return Err("Gemini API key is empty".into());
    }
    let dir = sessions_dir(&app)?;
    let (md_path, json_path) = session_paths(&dir, &id);
    let (audio_path, mime_type) = find_session_audio(&dir, &id)
        .ok_or_else(|| "This meeting does not have an audio recording".to_string())?;
    let wav = fs::read(&audio_path).map_err(|e| format!("Read audio recording failed: {}", e))?;
    if wav.len() <= 44 {
        return Err("The audio recording is empty".into());
    }
    let json_str =
        fs::read_to_string(&json_path).map_err(|e| format!("Read session failed: {}", e))?;
    let mut data: SessionData =
        serde_json::from_str(&json_str).map_err(|e| format!("Parse session failed: {}", e))?;

    let cancel_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut map = RETRANSCRIBE_CANCEL_MAP.lock().map_err(|e| e.to_string())?;
        map.insert(id.clone(), cancel_flag.clone());
    }
    let _guard = RetranscribeGuard(id.clone());

    if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Quá trình Re-transcript đã bị hủy".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let upload_start = client
        .post(format!(
            "https://generativelanguage.googleapis.com/upload/v1beta/files?key={}",
            api_key.trim()
        ))
        .header("X-Goog-Upload-Protocol", "resumable")
        .header("X-Goog-Upload-Command", "start")
        .header("X-Goog-Upload-Header-Content-Length", wav.len().to_string())
        .header("X-Goog-Upload-Header-Content-Type", mime_type)
        .header("Content-Type", "application/json")
        .body(r#"{"file":{"display_name":"Meet Minder recording"}}"#)
        .send()
        .await
        .map_err(|e| format!("Start Gemini audio upload failed: {}", e))?;
    if !upload_start.status().is_success() {
        let status = upload_start.status();
        return Err(gemini_error(
            status,
            upload_start.text().await.unwrap_or_default(),
        ));
    }
    let upload_url = upload_start
        .headers()
        .get("x-goog-upload-url")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
        .ok_or("Gemini did not provide an upload URL")?;

    if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Quá trình Re-transcript đã bị hủy".into());
    }

    let upload_finish = client
        .post(&upload_url)
        .header("X-Goog-Upload-Offset", "0")
        .header("X-Goog-Upload-Command", "upload, finalize")
        .header("Content-Type", mime_type)
        .body(wav)
        .send()
        .await
        .map_err(|e| format!("Upload audio to Gemini failed: {}", e))?;
    if !upload_finish.status().is_success() {
        let status = upload_finish.status();
        return Err(gemini_error(
            status,
            upload_finish.text().await.unwrap_or_default(),
        ));
    }
    let mut file: Value = upload_finish
        .json()
        .await
        .map_err(|e| format!("Read Gemini upload response failed: {}", e))?;
    let file_name = file
        .get("file")
        .and_then(|f| f.get("name"))
        .and_then(Value::as_str)
        .ok_or("Gemini upload response has no file name")?
        .to_string();

    // Audio files may need a short processing period before they can be sent to
    // a model. Poll at most two minutes so a stuck remote job never hangs the UI.
    for _ in 0..120 {
        if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
            let _ = client
                .delete(format!(
                    "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
                    file_name,
                    api_key.trim()
                ))
                .send()
                .await;
            return Err("Quá trình Re-transcript đã bị hủy".into());
        }
        let state = file
            .get("file")
            .and_then(|f| f.get("state"))
            .and_then(Value::as_str)
            .unwrap_or("ACTIVE");
        if state == "ACTIVE" {
            break;
        }
        if state == "FAILED" {
            return Err("Gemini could not process this audio recording".into());
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        let poll = client
            .get(format!(
                "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
                file_name,
                api_key.trim()
            ))
            .send()
            .await
            .map_err(|e| format!("Check Gemini audio upload failed: {}", e))?;
        if !poll.status().is_success() {
            let status = poll.status();
            return Err(gemini_error(status, poll.text().await.unwrap_or_default()));
        }
        file = poll
            .json()
            .await
            .map_err(|e| format!("Read Gemini file status failed: {}", e))?;
        if file.get("state").is_some() {
            file = serde_json::json!({ "file": file });
        }
    }
    let file_uri = file
        .get("file")
        .and_then(|f| f.get("uri"))
        .and_then(Value::as_str)
        .ok_or("Gemini upload response has no file URI")?
        .to_string();
    let has_translation = !data.target_lang.trim().is_empty()
        && data.target_lang != "none"
        && data.target_lang != "off"
        && data.target_lang != data.source_lang;
    let translation_instruction = if has_translation {
        format!(
            " Also translate every segment into {} and set its translation field.",
            data.target_lang
        )
    } else {
        " Do not translate; set every translation field to an empty string.".to_string()
    };
    let prompt = format!(
        "Transcribe this meeting recording accurately. The spoken/source language is {}. Split the transcript into short chronological segments, keeping all meaningful speech. Return JSON only, with this exact schema: {{\"segments\":[{{\"start_sec\":0,\"text\":\"original speech\",\"translation\":\"\"}}]}}. start_sec must be the approximate offset in seconds.{}",
        data.source_lang, translation_instruction
    );

    let mut generated = None;
    let mut last_error = None;
    for model in [
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-3.1-flash-lite-preview",
        "gemini-flash-latest",
    ] {
        if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
            let _ = client
                .delete(format!(
                    "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
                    file_name,
                    api_key.trim()
                ))
                .send()
                .await;
            return Err("Quá trình Re-transcript đã bị hủy".into());
        }
        let response = client.post(format!("https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}", model, api_key.trim()))
            .json(&serde_json::json!({
                "contents": [{ "parts": [
                    { "text": prompt },
                    { "fileData": { "mimeType": mime_type, "fileUri": file_uri } }
                ] }],
                "generationConfig": {
                    "temperature": 0.1,
                    "maxOutputTokens": 65536,
                    "responseMimeType": "application/json"
                }
            }))
            .send().await;
        match response {
            Ok(response) if response.status().is_success() => {
                let body: Value = response
                    .json()
                    .await
                    .map_err(|e| format!("Read Gemini transcript failed: {}", e))?;
                let text = body
                    .get("candidates")
                    .and_then(Value::as_array)
                    .and_then(|candidates| candidates.first())
                    .and_then(|candidate| candidate.get("content"))
                    .and_then(|content| content.get("parts"))
                    .and_then(Value::as_array)
                    .map(|parts| {
                        parts
                            .iter()
                            .filter_map(|part| part.get("text").and_then(Value::as_str))
                            .collect::<String>()
                    });
                if let Some(text) = text.filter(|value| !value.trim().is_empty()) {
                    generated = Some(text);
                    break;
                }
                last_error = Some("Gemini returned an empty transcript".to_string());
            }
            Ok(response) => {
                let status = response.status();
                last_error = Some(gemini_error(
                    status,
                    response.text().await.unwrap_or_default(),
                ));
            }
            Err(error) => last_error = Some(format!("Call Gemini transcription failed: {}", error)),
        }
    }
    // Best-effort cleanup of the temporary file stored by Gemini.
    let _ = client
        .delete(format!(
            "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
            file_name,
            api_key.trim()
        ))
        .send()
        .await;

    if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Quá trình Re-transcript đã bị hủy".into());
    }

    let segments = parse_gemini_transcript(
        &generated
            .ok_or_else(|| last_error.unwrap_or_else(|| "Gemini transcription failed".into()))?,
    )?;
    data.chunks = vec![Chunk {
        started_at: data.created_at.clone(),
        ended_at: data.ended_at.clone(),
        segments,
    }];
    data.engine = "gemini".to_string();
    data.retranscribed_at = Some(chrono::Local::now().to_rfc3339());
    let md = rebuild_session_markdown(&data);
    let json_bytes = serde_json::to_vec_pretty(&data)
        .map_err(|e| format!("Serialize transcript failed: {}", e))?;
    write_atomic(&json_path, &json_bytes)?;
    write_atomic(&md_path, md.as_bytes())?;
    Ok(SessionReadResult { md, json: data })
}

#[derive(Deserialize)]
struct GeminiImportPayload {
    #[serde(default)]
    detected_language: Option<String>,
    #[serde(default)]
    segments: Vec<GeminiTranscriptSegment>,
}

fn build_import_result(
    raw_lang: Option<String>,
    mut segments: Vec<Segment>,
) -> Result<(String, String, Vec<Segment>), String> {
    if segments.is_empty() {
        return Err("Gemini did not return any transcript segments".into());
    }

    let lang_str = raw_lang.unwrap_or_default().trim().to_lowercase();
    let (source_lang, target_lang) = if lang_str.contains("vi") || lang_str.contains("viet") {
        for s in &mut segments {
            if s.tgt == s.src {
                s.tgt.clear();
            }
        }
        ("vi".to_string(), "".to_string())
    } else if lang_str.contains("ja") || lang_str.contains("japan") || lang_str.contains("nihon") {
        ("ja".to_string(), "vi".to_string())
    } else if lang_str.contains("en") || lang_str.contains("eng") {
        ("en".to_string(), "vi".to_string())
    } else if lang_str.contains("zh") || lang_str.contains("chin") {
        ("zh".to_string(), "vi".to_string())
    } else if lang_str.contains("ko") || lang_str.contains("korean") {
        ("ko".to_string(), "vi".to_string())
    } else if !lang_str.is_empty() {
        (lang_str, "vi".to_string())
    } else {
        let has_translation = segments.iter().any(|s| !s.tgt.is_empty() && s.tgt != s.src);
        if has_translation {
            ("auto".to_string(), "vi".to_string())
        } else {
            ("vi".to_string(), "".to_string())
        }
    };

    Ok((source_lang, target_lang, segments))
}

fn parse_gemini_import(text: &str) -> Result<(String, String, Vec<Segment>), String> {
    let trimmed = clean_gemini_json(text);

    // Tier 1: Direct serde parsing
    if let Ok(payload) = serde_json::from_str::<GeminiImportPayload>(trimmed) {
        let segs = build_segments_from_raw(payload.segments);
        if let Ok(res) = build_import_result(payload.detected_language, segs) {
            return Ok(res);
        }
    }

    // Tier 2: Repaired JSON parsing
    if let Some(repaired) = try_repair_truncated_json(trimmed) {
        if let Ok(payload) = serde_json::from_str::<GeminiImportPayload>(&repaired) {
            let segs = build_segments_from_raw(payload.segments);
            if let Ok(res) = build_import_result(payload.detected_language, segs) {
                eprintln!("[session_store] Warning: salvaged segments from repaired Gemini import");
                return Ok(res);
            }
        }
    }

    // Tier 3: Chunk-by-chunk fallback extraction (handles unescaped quotes & broken tokens)
    let segs = extract_segments_fallback(trimmed);
    if !segs.is_empty() {
        let detected = extract_detected_language(trimmed);
        if let Ok(res) = build_import_result(detected, segs) {
            eprintln!("[session_store] Warning: extracted segments via fallback scanner for import");
            return Ok(res);
        }
    }

    Err("Gemini did not return any transcript segments".into())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn import_audio_session(
    app: AppHandle,
    id: String,
    file_path: String,
    title: String,
    customer_id: Option<String>,
    project_id: Option<String>,
    category: Option<String>,
    tags: Vec<String>,
    api_key: String,
) -> Result<SessionReadResult, String> {
    validate_id(&id)?;
    if api_key.trim().is_empty() {
        return Err("Gemini API key is empty".into());
    }
    let src_path = PathBuf::from(file_path.trim());
    if !src_path.exists() {
        return Err("File ghi âm không tồn tại".into());
    }
    let ext = src_path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let mime_type = audio_mime_type(&ext);

    let audio_bytes = fs::read(&src_path)
        .map_err(|e| format!("Không thể đọc file ghi âm: {}", e))?;
    if audio_bytes.len() <= 44 {
        return Err("File ghi âm trống hoặc không hợp lệ".into());
    }

    let dir = sessions_dir(&app)?;
    let (md_path, json_path) = session_paths(&dir, &id);
    let dest_audio_path = dir.join(format!("session-{}.{}", id, ext));

    let cancel_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut map = RETRANSCRIBE_CANCEL_MAP.lock().map_err(|e| e.to_string())?;
        map.insert(id.clone(), cancel_flag.clone());
    }
    let _guard = RetranscribeGuard(id.clone());

    if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Quá trình Import đã bị hủy".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let upload_start = client
        .post(format!(
            "https://generativelanguage.googleapis.com/upload/v1beta/files?key={}",
            api_key.trim()
        ))
        .header("X-Goog-Upload-Protocol", "resumable")
        .header("X-Goog-Upload-Command", "start")
        .header("X-Goog-Upload-Header-Content-Length", audio_bytes.len().to_string())
        .header("X-Goog-Upload-Header-Content-Type", mime_type)
        .header("Content-Type", "application/json")
        .body(r#"{"file":{"display_name":"Meet Minder imported recording"}}"#)
        .send()
        .await
        .map_err(|e| format!("Start Gemini audio upload failed: {}", e))?;

    if !upload_start.status().is_success() {
        let status = upload_start.status();
        return Err(gemini_error(
            status,
            upload_start.text().await.unwrap_or_default(),
        ));
    }

    let upload_url = upload_start
        .headers()
        .get("x-goog-upload-url")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
        .ok_or("Gemini did not provide an upload URL")?;

    if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Quá trình Import đã bị hủy".into());
    }

    let upload_finish = client
        .post(&upload_url)
        .header("X-Goog-Upload-Offset", "0")
        .header("X-Goog-Upload-Command", "upload, finalize")
        .header("Content-Type", mime_type)
        .body(audio_bytes.clone())
        .send()
        .await
        .map_err(|e| format!("Upload audio to Gemini failed: {}", e))?;

    if !upload_finish.status().is_success() {
        let status = upload_finish.status();
        return Err(gemini_error(
            status,
            upload_finish.text().await.unwrap_or_default(),
        ));
    }

    let mut file: Value = upload_finish
        .json()
        .await
        .map_err(|e| format!("Read Gemini upload response failed: {}", e))?;
    let file_name = file
        .get("file")
        .and_then(|f| f.get("name"))
        .and_then(Value::as_str)
        .ok_or("Gemini upload response has no file name")?
        .to_string();

    // Poll Gemini file processing
    for _ in 0..120 {
        if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
            let _ = client
                .delete(format!(
                    "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
                    file_name,
                    api_key.trim()
                ))
                .send()
                .await;
            return Err("Quá trình Import đã bị hủy".into());
        }
        let state = file
            .get("file")
            .and_then(|f| f.get("state"))
            .and_then(Value::as_str)
            .unwrap_or("ACTIVE");
        if state == "ACTIVE" {
            break;
        }
        if state == "FAILED" {
            return Err("Gemini could not process this audio recording".into());
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        let poll = client
            .get(format!(
                "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
                file_name,
                api_key.trim()
            ))
            .send()
            .await
            .map_err(|e| format!("Check Gemini audio upload failed: {}", e))?;
        if !poll.status().is_success() {
            let status = poll.status();
            return Err(gemini_error(status, poll.text().await.unwrap_or_default()));
        }
        file = poll
            .json()
            .await
            .map_err(|e| format!("Read Gemini file status failed: {}", e))?;
        if file.get("state").is_some() {
            file = serde_json::json!({ "file": file });
        }
    }

    let file_uri = file
        .get("file")
        .and_then(|f| f.get("uri"))
        .and_then(Value::as_str)
        .ok_or("Gemini upload response has no file URI")?
        .to_string();

    let prompt = "Transcribe this meeting audio recording accurately.
First, automatically detect the primary spoken language of the audio recording (e.g. 'vi', 'ja', 'en', 'zh', 'ko', etc.).
Split the transcript into short chronological segments, keeping all meaningful speech.
If the primary detected language is Vietnamese ('vi'):
- Set \"detected_language\" to \"vi\".
- Put the original spoken speech into \"text\".
- Set \"translation\" to \"\".
If the primary detected language is NOT Vietnamese (e.g. 'ja', 'en', 'zh', 'ko', etc.):
- Set \"detected_language\" to the language code (e.g. 'ja', 'en', 'zh', 'ko').
- Put the original spoken speech in that language into \"text\".
- Translate every segment accurately and naturally into Vietnamese and put it into \"translation\".
Return JSON only, with this exact schema:
{
  \"detected_language\": \"vi|ja|en|...\",
  \"segments\": [
    {\"start_sec\": 0, \"text\": \"original speech\", \"translation\": \"Vietnamese translation\"}
  ]
}
start_sec must be the approximate offset in seconds.";

    let mut generated = None;
    let mut last_error = None;
    for model in [
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-3.1-flash-lite-preview",
        "gemini-flash-latest",
    ] {
        if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
            let _ = client
                .delete(format!(
                    "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
                    file_name,
                    api_key.trim()
                ))
                .send()
                .await;
            return Err("Quá trình Import đã bị hủy".into());
        }
        let response = client
            .post(format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model,
                api_key.trim()
            ))
            .json(&serde_json::json!({
                "contents": [{ "parts": [
                    { "text": prompt },
                    { "fileData": { "mimeType": mime_type, "fileUri": file_uri } }
                ] }],
                "generationConfig": {
                    "temperature": 0.1,
                    "maxOutputTokens": 65536,
                    "responseMimeType": "application/json"
                }
            }))
            .send()
            .await;

        match response {
            Ok(response) if response.status().is_success() => {
                let body: Value = response
                    .json()
                    .await
                    .map_err(|e| format!("Read Gemini transcript failed: {}", e))?;
                let text = body
                    .get("candidates")
                    .and_then(Value::as_array)
                    .and_then(|candidates| candidates.first())
                    .and_then(|candidate| candidate.get("content"))
                    .and_then(|content| content.get("parts"))
                    .and_then(Value::as_array)
                    .map(|parts| {
                        parts
                            .iter()
                            .filter_map(|part| part.get("text").and_then(Value::as_str))
                            .collect::<String>()
                    });
                if let Some(text) = text.filter(|value| !value.trim().is_empty()) {
                    generated = Some(text);
                    break;
                }
                last_error = Some("Gemini returned an empty transcript".to_string());
            }
            Ok(response) => {
                let status = response.status();
                last_error = Some(gemini_error(
                    status,
                    response.text().await.unwrap_or_default(),
                ));
            }
            Err(error) => last_error = Some(format!("Call Gemini transcription failed: {}", error)),
        }
    }

    // Best-effort cleanup of remote file
    let _ = client
        .delete(format!(
            "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
            file_name,
            api_key.trim()
        ))
        .send()
        .await;

    if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Quá trình Import đã bị hủy".into());
    }

    let generated_text = generated
        .ok_or_else(|| last_error.unwrap_or_else(|| "Gemini transcription failed".into()))?;

    let (source_lang, target_lang, segments) = parse_gemini_import(&generated_text)?;

    // Copy the local audio file into sessions directory
    if let Err(e) = fs::write(&dest_audio_path, &audio_bytes) {
        return Err(format!("Lưu file ghi âm thất bại: {}", e));
    }

    let now = chrono::Local::now().to_rfc3339();
    let max_start_sec = segments
        .last()
        .and_then(|s| {
            let parts: Vec<&str> = s.ts.split(':').collect();
            if parts.len() == 3 {
                let h: u64 = parts[0].parse().unwrap_or(0);
                let m: u64 = parts[1].parse().unwrap_or(0);
                let sec: u64 = parts[2].parse().unwrap_or(0);
                Some(h * 3600 + m * 60 + sec)
            } else {
                None
            }
        })
        .unwrap_or(0);
    let duration_sec = max_start_sec + 5;

    let final_title = if title.trim().is_empty() {
        src_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Cuộc họp import".to_string())
    } else {
        title
    };

    let data = SessionData {
        id: id.clone(),
        created_at: now.clone(),
        ended_at: Some(now.clone()),
        title: sanitize_title(&final_title),
        engine: "gemini".to_string(),
        source_lang,
        target_lang,
        duration_sec,
        chunks: vec![Chunk {
            started_at: now.clone(),
            ended_at: Some(now.clone()),
            segments,
        }],
        notes: None,
        tags,
        customer_id,
        project_id,
        category,
        meeting_minutes: None,
        meeting_minutes_lang: None,
        meeting_minutes_ja: None,
        meeting_minutes_vi: None,
        retranscribed_at: Some(now),
    };

    let md = rebuild_session_markdown(&data);
    let json_bytes = serde_json::to_vec_pretty(&data)
        .map_err(|e| format!("Serialize transcript failed: {}", e))?;
    write_atomic(&json_path, &json_bytes)?;
    write_atomic(&md_path, md.as_bytes())?;
    Ok(SessionReadResult { md, json: data })
}

#[tauri::command]
pub fn get_storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    let current = sessions_dir(&app)?;
    let default_p = default_sessions_dir(&app)?;
    let reg = load_project_registry(&app).unwrap_or_default();
    let is_custom =
        reg.custom_transcripts_dir.is_some() && reg.custom_transcripts_dir.as_deref() != Some("");

    let mut session_count = 0;
    let mut total_size_bytes = 0;

    if let Ok(entries) = fs::read_dir(&current) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.ends_with(".json") && name.starts_with("session-") {
                        session_count += 1;
                    }
                    total_size_bytes += meta.len();
                }
            }
        }
    }

    Ok(StorageInfo {
        current_path: current.to_string_lossy().to_string(),
        is_custom,
        default_path: default_p.to_string_lossy().to_string(),
        session_count,
        total_size_bytes,
    })
}

#[tauri::command]
pub async fn select_custom_transcripts_dir(app: AppHandle) -> Result<Option<StorageInfo>, String> {
    use tauri_plugin_dialog::DialogExt;
    let current = sessions_dir(&app)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Chọn thư mục lưu trữ dữ liệu cuộc họp")
        .set_directory(&current)
        .pick_folder(move |folder| {
            let _ = tx.send(folder);
        });

    let folder = rx.await.map_err(|e| e.to_string())?;
    if let Some(folder_path) = folder {
        let path_str = folder_path.to_string();
        set_custom_transcripts_dir(app.clone(), Some(path_str))?;
        let info = get_storage_info(app)?;
        Ok(Some(info))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn set_custom_transcripts_dir(
    app: AppHandle,
    path: Option<String>,
) -> Result<StorageInfo, String> {
    let mut reg = load_project_registry(&app).unwrap_or_default();
    if let Some(ref p) = path {
        let p_trimmed = p.trim();
        if !p_trimmed.is_empty() {
            let pb = PathBuf::from(p_trimmed);
            fs::create_dir_all(&pb)
                .map_err(|e| format!("Không thể tạo hoặc truy cập thư mục: {}", e))?;
            reg.custom_transcripts_dir = Some(p_trimmed.to_string());
        } else {
            reg.custom_transcripts_dir = None;
        }
    } else {
        reg.custom_transcripts_dir = None;
    }
    save_project_registry(&app, &reg)?;
    get_storage_info(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_id_valid() {
        assert!(validate_id("session-260904-1610").is_ok());
        assert!(validate_id("session_123_abc").is_ok());
        assert!(validate_id("abcXYZ-123").is_ok());
    }

    #[test]
    fn test_validate_id_invalid() {
        assert!(validate_id("").is_err());
        assert!(validate_id("../path-traversal").is_err());
        assert!(validate_id("session/123").is_err());
        assert!(validate_id("session\\123").is_err());
        assert!(validate_id("session with spaces").is_err());
        let long_id = "a".repeat(65);
        assert!(validate_id(&long_id).is_err());
    }

    #[test]
    fn test_sanitize_title() {
        assert_eq!(sanitize_title("Cuộc họp dự án"), "Cuộc họp dự án");
        assert_eq!(sanitize_title("Line 1\nLine 2"), "Line 1\nLine 2");
        assert_eq!(sanitize_title("Bad\x00Title\x07"), "BadTitle");
    }

    #[test]
    fn test_format_duration_str() {
        assert_eq!(format_duration_str(0), "0s");
        assert_eq!(format_duration_str(45), "45s");
        assert_eq!(format_duration_str(60), "1m 0s");
        assert_eq!(format_duration_str(125), "2m 5s");
        assert_eq!(format_duration_str(3600), "1h 0m");
        assert_eq!(format_duration_str(3665), "1h 1m");
    }

    #[test]
    fn test_add_seconds_hms() {
        assert_eq!(add_seconds_hms("00:00:00", 10), "00:00:10");
        assert_eq!(add_seconds_hms("00:01:50", 15), "00:02:05");
        assert_eq!(add_seconds_hms("00:59:30", 60), "01:00:30");
        assert_eq!(add_seconds_hms("invalid", 10), "invalid");
    }

    #[test]
    fn test_transcript_timestamp() {
        assert_eq!(transcript_timestamp(0.0), "00:00:00");
        assert_eq!(transcript_timestamp(65.4), "00:01:05");
        assert_eq!(transcript_timestamp(3661.0), "01:01:01");
        assert_eq!(transcript_timestamp(-10.0), "00:00:00");
    }

    #[test]
    fn test_parse_gemini_transcript_raw_json() {
        let json_data = r#"{
            "segments": [
                {
                    "start_sec": 1.5,
                    "text": "Hello world",
                    "translation": "Xin chào thế giới"
                },
                {
                    "start_sec": 5.0,
                    "src": "How are you?",
                    "tgt": "Bạn khỏe không?"
                }
            ]
        }"#;
        let result = parse_gemini_transcript(json_data);
        assert!(result.is_ok());
        let segments = result.unwrap();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].ts, "00:00:02");
        assert_eq!(segments[0].src, "Hello world");
        assert_eq!(segments[0].tgt, "Xin chào thế giới");
        assert_eq!(segments[1].ts, "00:00:05");
        assert_eq!(segments[1].src, "How are you?");
        assert_eq!(segments[1].tgt, "Bạn khỏe không?");
    }

    #[test]
    fn test_parse_gemini_transcript_markdown_fenced() {
        let json_data = "```json\n{\"segments\": [{\"start_sec\": 0.0, \"text\": \"Test\", \"translation\": \"Kiểm tra\"}]}\n```";
        let result = parse_gemini_transcript(json_data);
        assert!(result.is_ok());
        let segments = result.unwrap();
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].src, "Test");
        assert_eq!(segments[0].tgt, "Kiểm tra");
    }

    #[test]
    fn test_parse_gemini_transcript_empty_fails() {
        let json_data = r#"{"segments": []}"#;
        let result = parse_gemini_transcript(json_data);
        assert!(result.is_err());
    }

    #[test]
    fn test_gemini_error_extraction() {
        let err = gemini_error(
            reqwest::StatusCode::BAD_REQUEST,
            r#"{"error": {"message": "API key not valid"}}"#.to_string(),
        );
        assert!(err.contains("Gemini API error (400 Bad Request): API key not valid"));

        let plain_err = gemini_error(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            "Internal server failure".to_string(),
        );
        assert!(plain_err
            .contains("Gemini API error (500 Internal Server Error): Internal server failure"));
    }

    #[test]
    fn test_rebuild_session_markdown() {
        let data = SessionData {
            id: "session-260904-1200".to_string(),
            created_at: "2026-09-04T12:00:00Z".to_string(),
            ended_at: Some("2026-09-04T12:05:00Z".to_string()),
            title: "Họp kế hoạch tuần".to_string(),
            engine: "gemini".to_string(),
            source_lang: "ja".to_string(),
            target_lang: "vi".to_string(),
            duration_sec: 300,
            chunks: vec![Chunk {
                started_at: "2026-09-04T12:00:00Z".to_string(),
                ended_at: Some("2026-09-04T12:05:00Z".to_string()),
                segments: vec![Segment {
                    ts: "00:00:05".to_string(),
                    src: "はじめましょう".to_string(),
                    tgt: "Hãy bắt đầu thôi".to_string(),
                    speaker: Some("1".to_string()),
                }],
            }],
            notes: Some("Ghi chú nội bộ".to_string()),
            tags: vec!["sprint".to_string(), "planning".to_string()],
            customer_id: None,
            project_id: None,
            category: Some("Weekly".to_string()),
            meeting_minutes: None,
            meeting_minutes_lang: Some("vi".to_string()),
            meeting_minutes_ja: None,
            meeting_minutes_vi: Some("1. Báo cáo tiến độ\n2. Phân công task".to_string()),
            retranscribed_at: None,
        };

        let md = rebuild_session_markdown(&data);
        assert!(md.contains("# Họp kế hoạch tuần"));
        assert!(md.contains("ja → vi"));
        assert!(md.contains("📅 Phân loại: Weekly"));
        assert!(md.contains("#sprint #planning"));
        assert!(md.contains("(Speaker 1) はじめましょう"));
        assert!(md.contains("(Speaker 1) Hãy bắt đầu thôi"));
        assert!(md.contains("## 📋 Biên bản cuộc họp (Tiếng Việt)"));
        assert!(md.contains("1. Báo cáo tiến độ"));
    }

    #[test]
    fn test_session_data_retranscribed_at_serde() {
        let json_without = r#"{"id":"s1","created_at":"2026-09-04T10:00:00Z","title":"Test","engine":"gemini","source_lang":"ja","target_lang":"vi","duration_sec":60,"chunks":[]}"#;
        let data: SessionData = serde_json::from_str(json_without).unwrap();
        assert_eq!(data.retranscribed_at, None);

        let json_with = r#"{"id":"s1","created_at":"2026-09-04T10:00:00Z","title":"Test","engine":"gemini","source_lang":"ja","target_lang":"vi","duration_sec":60,"chunks":[],"retranscribed_at":"2026-09-04T12:00:00Z"}"#;
        let data2: SessionData = serde_json::from_str(json_with).unwrap();
        assert_eq!(
            data2.retranscribed_at,
            Some("2026-09-04T12:00:00Z".to_string())
        );
    }

    #[test]
    fn test_cancel_retranscribe_session() {
        let id = "test-session-cancel-123";
        assert_eq!(cancel_retranscribe_session(id.to_string()).unwrap(), false);

        let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        {
            let mut map = RETRANSCRIBE_CANCEL_MAP.lock().unwrap();
            map.insert(id.to_string(), flag.clone());
        }

        assert_eq!(cancel_retranscribe_session(id.to_string()).unwrap(), true);
        assert_eq!(flag.load(std::sync::atomic::Ordering::SeqCst), true);

        // Cleanup guard
        {
            let _guard = RetranscribeGuard(id.to_string());
        }
        assert_eq!(cancel_retranscribe_session(id.to_string()).unwrap(), false);
    }

    #[test]
    fn test_build_session_srt() {
        let data = SessionData {
            id: "session-test-srt".to_string(),
            created_at: "2026-09-05T00:00:00Z".to_string(),
            ended_at: None,
            title: "SRT Test".to_string(),
            engine: "gemini".to_string(),
            source_lang: "ja".to_string(),
            target_lang: "vi".to_string(),
            duration_sec: 10,
            chunks: vec![Chunk {
                started_at: "2026-09-05T00:00:00Z".to_string(),
                ended_at: None,
                segments: vec![
                    Segment {
                        ts: "00:00:01".to_string(),
                        src: "おはよう".to_string(),
                        tgt: "Chào buổi sáng".to_string(),
                        speaker: None,
                    },
                    Segment {
                        ts: "00:00:05".to_string(),
                        src: "はじめましょう".to_string(),
                        tgt: "Bắt đầu thôi".to_string(),
                        speaker: None,
                    },
                ],
            }],
            notes: None,
            tags: vec![],
            customer_id: None,
            project_id: None,
            category: None,
            meeting_minutes: None,
            meeting_minutes_lang: None,
            meeting_minutes_ja: None,
            meeting_minutes_vi: None,
            retranscribed_at: None,
        };

        let srt = build_session_srt(&data);
        assert!(srt.contains("1\n00:00:01,000 --> 00:00:05,000\nChào buổi sáng\n\n"));
        // Segment cuối tự động cộng 3 giây
        assert!(srt.contains("2\n00:00:05,000 --> 00:00:08,000\nBắt đầu thôi\n\n"));
    }

    #[test]
    fn test_build_session_txt() {
        let data = SessionData {
            id: "session-test-txt".to_string(),
            created_at: "2026-09-05T00:00:00Z".to_string(),
            ended_at: None,
            title: "TXT Test".to_string(),
            engine: "gemini".to_string(),
            source_lang: "ja".to_string(),
            target_lang: "vi".to_string(),
            duration_sec: 10,
            chunks: vec![Chunk {
                started_at: "2026-09-05T00:00:00Z".to_string(),
                ended_at: None,
                segments: vec![
                    Segment {
                        ts: "00:00:01".to_string(),
                        src: "Line 1".to_string(),
                        tgt: "Dòng 1".to_string(),
                        speaker: None,
                    },
                    Segment {
                        ts: "00:00:04".to_string(),
                        src: "Line 2".to_string(),
                        tgt: "Dòng 2".to_string(),
                        speaker: None,
                    },
                ],
            }],
            notes: None,
            tags: vec![],
            customer_id: None,
            project_id: None,
            category: None,
            meeting_minutes: None,
            meeting_minutes_lang: None,
            meeting_minutes_ja: None,
            meeting_minutes_vi: None,
            retranscribed_at: None,
        };

        let txt = build_session_txt(&data);
        assert_eq!(txt, "Dòng 1\nDòng 2");
    }

    #[test]
    fn test_session_item_matches_metadata() {
        let item = SessionListItem {
            id: "s1".to_string(),
            title: "Họp Sprint Review Q3".to_string(),
            engine: "gemini".to_string(),
            source_lang: "ja".to_string(),
            target_lang: "vi".to_string(),
            created_at: "2026-09-05T10:00:00Z".to_string(),
            ended_at: None,
            duration_sec: 120,
            chunk_count: 1,
            segment_count: 5,
            has_legacy_only: false,
            has_meeting_minutes: false,
            tags: vec!["sprint".to_string(), "Relipa".to_string()],
            customer_id: None,
            customer_name: Some("Toyota Corp".to_string()),
            customer_color: None,
            project_id: None,
            project_name: Some("AutoPilot".to_string()),
            project_color: None,
            project_status: None,
            category: Some("Review".to_string()),
        };

        // Match title (case-insensitive)
        assert!(session_item_matches_metadata(
            &item,
            "sprint review",
            "sprint review"
        ));
        // Match customer
        assert!(session_item_matches_metadata(&item, "toyota", "toyota"));
        // Match project
        assert!(session_item_matches_metadata(
            &item,
            "autopilot",
            "autopilot"
        ));
        // Match category
        assert!(session_item_matches_metadata(&item, "review", "review"));
        // Match tag without #
        assert!(session_item_matches_metadata(&item, "relipa", "relipa"));
        // Match tag with #
        assert!(session_item_matches_metadata(&item, "#relipa", "relipa"));

        // Không khớp
        assert!(!session_item_matches_metadata(&item, "honda", "honda"));
    }

    #[test]
    fn test_audio_mime_types() {
        assert_eq!(audio_mime_type("wav"), "audio/wav");
        assert_eq!(audio_mime_type("WAV"), "audio/wav");
        assert_eq!(audio_mime_type("mp3"), "audio/mp3");
        assert_eq!(audio_mime_type("m4a"), "audio/m4a");
        assert_eq!(audio_mime_type("aac"), "audio/aac");
        assert_eq!(audio_mime_type("ogg"), "audio/ogg");
        assert_eq!(audio_mime_type("flac"), "audio/flac");
        assert_eq!(audio_mime_type("webm"), "audio/webm");
    }

    #[test]
    fn test_parse_gemini_import_japanese() {
        let json_str = r#"{
            "detected_language": "ja",
            "segments": [
                {"start_sec": 1.5, "text": "お疲れ様です。", "translation": "Chào mọi người / Vất vả rồi."},
                {"start_sec": 6.2, "text": "本日の議題について説明します。", "translation": "Tôi xin giải thích về chương trình nghị sự hôm nay."}
            ]
        }"#;

        let (src_lang, tgt_lang, segs) = parse_gemini_import(json_str).expect("Parse should succeed");
        assert_eq!(src_lang, "ja");
        assert_eq!(tgt_lang, "vi");
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].src, "お疲れ様です。");
        assert_eq!(segs[0].tgt, "Chào mọi người / Vất vả rồi.");
        assert_eq!(segs[0].ts, "00:00:02");
    }

    #[test]
    fn test_parse_gemini_import_vietnamese() {
        let json_str = r#"{
            "detected_language": "vi",
            "segments": [
                {"start_sec": 0.0, "text": "Chào các bạn, hôm nay chúng ta họp dự án.", "translation": ""}
            ]
        }"#;

        let (src_lang, tgt_lang, segs) = parse_gemini_import(json_str).expect("Parse should succeed");
        assert_eq!(src_lang, "vi");
        assert_eq!(tgt_lang, "");
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].src, "Chào các bạn, hôm nay chúng ta họp dự án.");
        assert_eq!(segs[0].tgt, "");
    }

    #[test]
    fn test_try_repair_truncated_json() {
        // Truncated mid-string inside second segment
        let broken = r#"{"segments":[{"start_sec":0,"text":"Line 1","translation":"Dòng 1"},{"start_sec":5,"text":"Line 2 cut off here"#;
        let repaired = try_repair_truncated_json(broken).expect("Should repair truncated json");
        assert!(repaired.ends_with("]}"));
        let parsed: GeminiTranscriptPayload = serde_json::from_str(&repaired).expect("Repaired JSON must be valid");
        assert_eq!(parsed.segments.len(), 1);
        assert_eq!(parsed.segments[0].text, "Line 1");
        assert_eq!(parsed.segments[0].translation, "Dòng 1");

        // Truncated with detected_language
        let broken_import = r#"{"detected_language":"ja","segments":[{"start_sec":0,"text":"こんにちは","translation":"Xin chào"},{"start_sec":4,"text":"今日の議"#;
        let (src, tgt, segs) = parse_gemini_import(broken_import).expect("Should salvage segments");
        assert_eq!(src, "ja");
        assert_eq!(tgt, "vi");
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].src, "こんにちは");
        assert_eq!(segs[0].tgt, "Xin chào");
    }

    #[test]
    fn test_parse_gemini_transcript_truncated() {
        let broken_transcript = "```json\n{\"segments\":[{\"start_sec\":0,\"text\":\"Hello world\",\"translation\":\"Xin chào thế giới\"},{\"start_sec\":10,\"text\":\"Cut";
        let segs = parse_gemini_transcript(broken_transcript).expect("Should parse truncated transcript");
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].src, "Hello world");
        assert_eq!(segs[0].tgt, "Xin chào thế giới");
    }

    #[test]
    fn test_parse_gemini_transcript_unescaped_quotes() {
        let text = r#"{"segments":[
            {"start_sec":0,"text":"He said "Hello" to me","translation":"Ông ấy nói "Xin chào" với tôi"},
            {"start_sec":5.5,"text":"Screen is 24" wide","translation":"Màn hình 24 inch"}
        ]}"#;
        let segs = parse_gemini_transcript(text).expect("Should parse segments with unescaped quotes");
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].src, "He said \"Hello\" to me");
        assert_eq!(segs[0].tgt, "Ông ấy nói \"Xin chào\" với tôi");
        assert_eq!(segs[1].src, "Screen is 24\" wide");
    }

    #[test]
    fn test_parse_gemini_transcript_cut_at_key_colon() {
        // Truncated right at a key before the colon, exactly like "expected `:` at line 1 column 162365"
        let text = r#"{"segments":[{"start_sec":0,"text":"Line 1","translation":"Dòng 1"},{"start_sec":10,"text":"Cut off","trans"#;
        let segs = parse_gemini_transcript(text).expect("Should salvage segments even if cut at key");
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].src, "Line 1");
        assert_eq!(segs[0].tgt, "Dòng 1");
    }

    #[test]
    fn test_parse_gemini_import_unescaped_quotes() {
        let text = r#"{"detected_language":"ja","segments":[
            {"start_sec":1.0,"text":"先生は「"Hello"」と言いました","translation":"Thầy giáo nói "Hello""},
            {"start_sec":10.0,"text":"Incomplete cut off"#;
        let (src_lang, tgt_lang, segs) = parse_gemini_import(text).expect("Should parse import with unescaped quotes");
        assert_eq!(src_lang, "ja");
        assert_eq!(tgt_lang, "vi");
        assert_eq!(segs.len(), 1);
    }
}
