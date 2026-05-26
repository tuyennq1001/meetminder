// Session-aware transcript persistence (.md + .json sidecar pairs).
//
// File pair: session-{YYMMDD-HHMM}.md (human-readable) + .json (structured).
// Writes are atomic: write to {path}.tmp then rename, so a crash mid-write
// never corrupts an existing file.
//
// Legacy `.md`-only files from the old `save_transcript` command are still
// listed (with `has_legacy_only: true`) but not editable.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

// ─── Types ───────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Segment {
    pub ts: String,        // "HH:MM:SS"
    pub src: String,
    pub tgt: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Chunk {
    pub started_at: String,             // ISO8601
    pub ended_at: Option<String>,       // None until chunk closes
    pub segments: Vec<Segment>,
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
}

#[derive(Serialize, Debug)]
pub struct SessionReadResult {
    pub md: String,
    pub json: SessionData,
}

// ─── Path helpers ────────────────────────────────────────────────────────

fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("transcripts");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {}", e))?;
    Ok(dir)
}

fn session_paths(dir: &Path, id: &str) -> (PathBuf, PathBuf) {
    let base = format!("session-{}", id);
    (dir.join(format!("{}.md", base)), dir.join(format!("{}.json", base)))
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 {
        return Err("Invalid session id length".into());
    }
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Invalid session id characters".into());
    }
    Ok(())
}

fn sanitize_title(s: &str) -> String {
    s.chars().filter(|c| !c.is_control() || *c == '\n').take(200).collect()
}

// ─── Atomic write ────────────────────────────────────────────────────────

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|s| s.to_str()).unwrap_or("")
    ));
    {
        let mut f = fs::File::create(&tmp)
            .map_err(|e| format!("Failed to create tmp: {}", e))?;
        f.write_all(bytes).map_err(|e| format!("Write failed: {}", e))?;
        f.sync_all().map_err(|e| format!("fsync failed: {}", e))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("Rename failed: {}", e))?;
    Ok(())
}

// ─── Commands ────────────────────────────────────────────────────────────

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

    let entries = fs::read_dir(&dir).map_err(|e| format!("Read dir failed: {}", e))?;
    let entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();

    // Pass 1: parse all .json sidecars
    for entry in &entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(stem) = name.strip_suffix(".json") else { continue };
        let Some(id) = stem.strip_prefix("session-") else { continue };
        let path = entry.path();
        let Ok(content) = fs::read_to_string(&path) else { continue };
        let Ok(data) = serde_json::from_str::<SessionData>(&content) else { continue };
        let segment_count: usize = data.chunks.iter().map(|c| c.segments.len()).sum();
        seen_new_ids.insert(id.to_string());
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
        });
    }

    // Pass 2: legacy .md-only files (old save_transcript output, no sidecar)
    for entry in &entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(stem) = name.strip_suffix(".md") else { continue };
        // Skip new format files we already counted in pass 1
        if let Some(id) = stem.strip_prefix("session-") {
            if seen_new_ids.contains(id) { continue; }
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
    let json_str = fs::read_to_string(&json_path).map_err(|e| format!("Read json failed: {}", e))?;
    let json: SessionData = serde_json::from_str(&json_str)
        .map_err(|e| format!("Parse json failed: {}", e))?;
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
    // New format: session-{id}.{md,json}
    let (md_path, json_path) = session_paths(&dir, &id);
    let _ = fs::remove_file(&json_path);
    let _ = fs::remove_file(&md_path);
    // Legacy format: {id}.md (no session- prefix, no sidecar)
    let _ = fs::remove_file(dir.join(format!("{}.md", id)));
    Ok(())
}

#[tauri::command]
pub fn update_session_title(
    app: AppHandle,
    id: String,
    title: String,
) -> Result<(), String> {
    validate_id(&id)?;
    let title = sanitize_title(&title);
    let dir = sessions_dir(&app)?;
    let (md_path, json_path) = session_paths(&dir, &id);
    let json_str = fs::read_to_string(&json_path).map_err(|e| format!("Read failed: {}", e))?;
    let mut data: SessionData = serde_json::from_str(&json_str)
        .map_err(|e| format!("Parse failed: {}", e))?;
    data.title = title.clone();
    let json_bytes = serde_json::to_vec_pretty(&data)
        .map_err(|e| format!("Serialize failed: {}", e))?;
    write_atomic(&json_path, &json_bytes)?;

    // Re-render markdown header: replace first "# ..." line, leave body alone
    let md = fs::read_to_string(&md_path).unwrap_or_default();
    let new_md = if let Some(eol) = md.find('\n') {
        format!("# {}\n{}", title, &md[eol + 1..])
    } else {
        format!("# {}\n", title)
    };
    write_atomic(&md_path, new_md.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub fn export_session_srt(app: AppHandle, id: String) -> Result<String, String> {
    validate_id(&id)?;
    let dir = sessions_dir(&app)?;
    let (_, json_path) = session_paths(&dir, &id);
    let json_str = fs::read_to_string(&json_path).map_err(|e| format!("Read failed: {}", e))?;
    let data: SessionData = serde_json::from_str(&json_str)
        .map_err(|e| format!("Parse failed: {}", e))?;

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
    let data: SessionData = serde_json::from_str(&json_str)
        .map_err(|e| format!("Parse failed: {}", e))?;
    let lines: Vec<String> = data.chunks.iter()
        .flat_map(|c| c.segments.iter())
        .map(|s| s.tgt.clone())
        .collect();
    Ok(lines.join("\n"))
}

#[tauri::command]
pub fn search_sessions(
    app: AppHandle,
    query: String,
) -> Result<Vec<SessionListItem>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return list_sessions(app);
    }
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
        if item.title.to_lowercase().contains(&q) {
            hits.push(item);
            continue;
        }
        let (_, json_path) = session_paths(&dir, &item.id);
        let Ok(json_str) = fs::read_to_string(&json_path) else { continue };
        if json_str.to_lowercase().contains(&q) {
            hits.push(item);
        }
    }
    Ok(hits)
}

// "HH:MM:SS" + N seconds → new "HH:MM:SS" (saturating at 99:59:59)
fn add_seconds_hms(ts: &str, add: u64) -> String {
    let parts: Vec<u64> = ts.split(':').filter_map(|p| p.parse().ok()).collect();
    if parts.len() != 3 { return ts.to_string(); }
    let total = parts[0] * 3600 + parts[1] * 60 + parts[2] + add;
    let h = (total / 3600).min(99);
    let m = (total % 3600) / 60;
    let s = total % 60;
    format!("{:02}:{:02}:{:02}", h, m, s)
}
