// Session-aware transcript persistence (.md + .json sidecar pairs).
//
// File pair: session-{YYMMDD-HHMM}.md (human-readable) + .json (structured).
// Writes are atomic: write to {path}.tmp then rename, so a crash mid-write
// never corrupts an existing file.
//
// Legacy `.md`-only files from the old `save_transcript` command are still
// listed (with `has_legacy_only: true`) but not editable.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

// ─── Types ───────────────────────────────────────────────────────────────

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
                Category { id: "cat_weekly".into(), name: "Weekly".into(), color: "#10b981".into() },
                Category { id: "cat_daily".into(), name: "Daily".into(), color: "#431A46".into() },
                Category { id: "cat_sales".into(), name: "Sales".into(), color: "#f59e0b".into() },
                Category { id: "cat_1on1".into(), name: "1-on-1".into(), color: "#ec4899".into() },
                Category { id: "cat_planning".into(), name: "Planning".into(), color: "#8b5cf6".into() },
                Category { id: "cat_retro".into(), name: "Retro".into(), color: "#14b8a6".into() },
            ],
            tags: Vec::new(),
        };
        let _ = save_project_registry(app, &default_reg);
        return Ok(default_reg);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("Read projects.json failed: {}", e))?;
    let reg: ProjectRegistry = serde_json::from_str(&content).map_err(|e| format!("Parse projects.json failed: {}", e))?;
    Ok(reg)
}

pub fn save_project_registry(app: &AppHandle, reg: &ProjectRegistry) -> Result<(), String> {
    let path = registry_path(app)?;
    let bytes = serde_json::to_vec_pretty(reg).map_err(|e| format!("Serialize projects.json failed: {}", e))?;
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
    let project_map: std::collections::HashMap<String, (String, String, String, Option<String>)> = registry
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

        let (project_name, project_color, project_status, proj_cust_id) = if let Some(ref pid) = data.project_id {
            if let Some((pname, pcol, pstat, cid)) = project_map.get(pid) {
                (Some(pname.clone()), Some(pcol.clone()), Some(pstat.clone()), cid.clone())
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
    // New format: session-{id}.{md,json,wav}
    let (md_path, json_path) = session_paths(&dir, &id);
    let _ = fs::remove_file(&json_path);
    let _ = fs::remove_file(&md_path);
    let _ = fs::remove_file(dir.join(format!("session-{}.wav", id)));
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
        data.customer_id = if cid.trim().is_empty() { None } else { Some(cid.trim().to_string()) };
    }
    if let Some(pid) = project_id {
        data.project_id = if pid.trim().is_empty() { None } else { Some(pid.trim().to_string()) };
    }
    if let Some(cat) = category {
        data.category = if cat.trim().is_empty() { None } else { Some(cat.trim().to_string()) };
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
pub fn update_session_tags(
    app: AppHandle,
    id: String,
    tags: Vec<String>,
) -> Result<(), String> {
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
        let json_str = fs::read_to_string(&json_path).map_err(|e| format!("Read json failed: {}", e))?;
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
    let title = if data.title.is_empty() { &data.id } else { &data.title };
    let lang_pair = format!("{} → {}", data.source_lang, data.target_lang);
    let mut meta_extras = Vec::new();
    if let Some(ref cat) = data.category {
        meta_extras.push(format!("📅 Phân loại: {}", cat));
    }
    if !data.tags.is_empty() {
        meta_extras.push(data.tags.iter().map(|t| format!("#{}", t)).collect::<Vec<_>>().join(" "));
    }
    let extra_str = if meta_extras.is_empty() {
        String::new()
    } else {
        format!(" · {}", meta_extras.join(" · "))
    };

    let dur_str = format_duration_str(data.duration_sec);
    lines.push(format!("# {}", title));
    lines.push(String::new());
    lines.push(format!("**Thông tin**: Engine {} · {} · {} · {}{}", data.engine, lang_pair, data.created_at, dur_str, extra_str));
    lines.push(String::new());
    lines.push("---".to_string());
    lines.push(String::new());

    let has_ja = data.meeting_minutes_ja.as_ref().map(|m| !m.trim().is_empty()).unwrap_or(false);
    let has_vi = data.meeting_minutes_vi.as_ref().map(|m| !m.trim().is_empty()).unwrap_or(false);

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
            let ts_tag = if !seg.ts.is_empty() { format!("[{}] ", seg.ts) } else { String::new() };
            let spk_tag = if let Some(ref spk) = seg.speaker {
                if !spk.is_empty() { format!("(Speaker {}) ", spk) } else { String::new() }
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

    let json_str = fs::read_to_string(&json_path).map_err(|e| format!("Read json failed: {}", e))?;
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

    let json_str = fs::read_to_string(&json_path).map_err(|e| format!("Read json failed: {}", e))?;
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

#[tauri::command]
pub fn export_session_srt(app: AppHandle, id: String) -> Result<String, String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    let (_, json_path) = session_paths(&dir, &id);
    let json_str = fs::read_to_string(&json_path).map_err(|e| format!("Read failed: {}", e))?;
    let data: SessionData =
        serde_json::from_str(&json_str).map_err(|e| format!("Parse failed: {}", e))?;

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
    Ok(out)
}

#[tauri::command]
pub fn export_session_txt(app: AppHandle, id: String) -> Result<String, String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    let (_, json_path) = session_paths(&dir, &id);
    let json_str = fs::read_to_string(&json_path).map_err(|e| format!("Read failed: {}", e))?;
    let data: SessionData =
        serde_json::from_str(&json_str).map_err(|e| format!("Parse failed: {}", e))?;
    let lines: Vec<String> = data
        .chunks
        .iter()
        .flat_map(|c| c.segments.iter())
        .map(|s| s.tgt.clone())
        .collect();
    Ok(lines.join("\n"))
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
        if item.title.to_lowercase().contains(&q)
            || item.customer_name.as_ref().map_or(false, |c| c.to_lowercase().contains(&q))
            || item.project_name.as_ref().map_or(false, |p| p.to_lowercase().contains(&q))
            || item.category.as_ref().map_or(false, |c| c.to_lowercase().contains(&q))
            || item.tags.iter().any(|t| t.contains(tag_match) || format!("#{}", t).contains(&q))
        {
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
pub fn get_session_record_path(app: AppHandle, id: String) -> Result<String, String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    let wav_path = dir.join(format!("session-{}.wav", id));
    Ok(wav_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_session_audio(app: AppHandle, id: String) -> Result<Option<String>, String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    let wav_path = dir.join(format!("session-{}.wav", id));
    if wav_path.exists() {
        let bytes = fs::read(&wav_path).map_err(|e| e.to_string())?;
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(Some(format!("data:audio/wav;base64,{}", b64)))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn get_storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    let current = sessions_dir(&app)?;
    let default_p = default_sessions_dir(&app)?;
    let reg = load_project_registry(&app).unwrap_or_default();
    let is_custom = reg.custom_transcripts_dir.is_some() && reg.custom_transcripts_dir.as_deref() != Some("");

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
pub fn select_custom_transcripts_dir(app: AppHandle) -> Result<Option<StorageInfo>, String> {
    use tauri_plugin_dialog::DialogExt;
    let current = sessions_dir(&app)?;
    let folder = app.dialog().file()
        .set_title("Chọn thư mục lưu trữ dữ liệu cuộc họp")
        .set_directory(&current)
        .blocking_pick_folder();

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
pub fn set_custom_transcripts_dir(app: AppHandle, path: Option<String>) -> Result<StorageInfo, String> {
    let mut reg = load_project_registry(&app).unwrap_or_default();
    if let Some(ref p) = path {
        let p_trimmed = p.trim();
        if !p_trimmed.is_empty() {
            let pb = PathBuf::from(p_trimmed);
            fs::create_dir_all(&pb).map_err(|e| format!("Không thể tạo hoặc truy cập thư mục: {}", e))?;
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
