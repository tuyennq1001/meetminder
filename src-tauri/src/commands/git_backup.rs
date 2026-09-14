//! Optional Git backup for Meet Minder's text and image data.
//!
//! Meet Minder uses the current storage folder as its local Git repository.
//! Managed backup data is committed directly from the shared storage folder
//! and (optionally) pushed using the user's existing Git credentials. Audio and
//! settings are never staged.

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use tauri::{AppHandle, Manager};

const MANAGED_PATHS: &[&str] = &[
    "records",
    "images",
    "projects.json",
    "meet-minder-data.json",
    ".gitignore",
];

#[derive(Debug, Serialize, Clone)]
pub struct GitBackupStatus {
    pub configured: bool,
    pub git_available: bool,
    pub is_repo: bool,
    pub repo_path: String,
    pub branch: Option<String>,
    pub remote: Option<String>,
    pub dirty_files: usize,
    pub last_commit: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitBackupResult {
    pub committed: bool,
    pub pushed: bool,
    pub changed_paths: Vec<String>,
    pub message: String,
    pub warning: Option<String>,
    pub status: GitBackupStatus,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitPushResult {
    pub pushed: bool,
    pub changed_paths: Vec<String>,
    pub message: String,
    pub warning: Option<String>,
    pub status: GitBackupStatus,
}

fn run_git(repo: &Path, args: &[&str]) -> Result<Output, String> {
    Command::new("git")
        .current_dir(repo)
        .args(args)
        .output()
        .map_err(|e| format!("Không thể chạy Git: {}", e))
}

fn output_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn output_error(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        output_text(output)
    } else {
        stderr
    }
}

fn is_git_available() -> bool {
    Command::new("git")
        .args(["--version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn repo_is_valid(repo: &Path) -> bool {
    repo.is_dir()
        && run_git(repo, &["rev-parse", "--is-inside-work-tree"])
            .map(|o| o.status.success() && output_text(&o) == "true")
            .unwrap_or(false)
}

fn managed_status_count(repo: &Path) -> usize {
    let Ok(output) = run_git(
        repo,
        &["status", "--porcelain", "--untracked-files=all", "--"],
    ) else {
        return 0;
    };
    if !output.status.success() {
        return 0;
    }
    output_text(&output)
        .lines()
        .filter(|line| {
            let path = line.get(3..).unwrap_or("");
            MANAGED_PATHS.iter().any(|managed| {
                path == *managed
                    || path.starts_with(&format!("{}/", managed))
                    || (path.starts_with('"') && path.contains(managed))
            })
        })
        .count()
}

fn read_git_value(repo: &Path, args: &[&str]) -> Option<String> {
    run_git(repo, args)
        .ok()
        .filter(|o| o.status.success())
        .map(|o| output_text(&o))
        .filter(|s| !s.is_empty())
}

fn git_name_only(repo: &Path, args: &[&str]) -> Vec<String> {
    run_git(repo, args)
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            output_text(&o)
                .lines()
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn changed_paths_for_push(repo: &Path) -> Vec<String> {
    if let Some(upstream) = read_git_value(
        repo,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{u}",
        ],
    ) {
        let range = format!("{}..HEAD", upstream);
        return git_name_only(repo, &["diff", "--name-only", &range, "--"]);
    }

    git_name_only(
        repo,
        &[
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-only",
            "-r",
            "HEAD",
            "--",
        ],
    )
}

fn status_for(repo_path: &str) -> GitBackupStatus {
    let configured = !repo_path.trim().is_empty();
    let git_available = is_git_available();
    let repo = PathBuf::from(repo_path.trim());
    let is_repo = configured && git_available && repo_is_valid(&repo);

    if !configured {
        return GitBackupStatus {
            configured,
            git_available,
            is_repo,
            repo_path: String::new(),
            branch: None,
            remote: None,
            dirty_files: 0,
            last_commit: None,
            error: Some("Chưa chọn thư mục Git backup".into()),
        };
    }
    if !git_available {
        return GitBackupStatus {
            configured,
            git_available,
            is_repo,
            repo_path: repo_path.to_string(),
            branch: None,
            remote: None,
            dirty_files: 0,
            last_commit: None,
            error: Some("Git chưa được cài đặt hoặc chưa có trong PATH".into()),
        };
    }
    if !is_repo {
        return GitBackupStatus {
            configured,
            git_available,
            is_repo,
            repo_path: repo_path.to_string(),
            branch: None,
            remote: None,
            dirty_files: 0,
            last_commit: None,
            error: Some(
                "Thư mục lưu trữ hiện tại chưa là Git repository. Hãy tự chạy git init trong thư mục này trước."
                    .into(),
            ),
        };
    }

    GitBackupStatus {
        configured,
        git_available,
        is_repo,
        repo_path: repo_path.to_string(),
        branch: read_git_value(&repo, &["branch", "--show-current"]),
        remote: read_git_value(&repo, &["remote", "get-url", "origin"]),
        dirty_files: managed_status_count(&repo),
        last_commit: read_git_value(&repo, &["log", "-1", "--format=%cI%x00%s"]),
        error: None,
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|s| s.to_str()).unwrap_or("file")
    ));
    {
        let mut file =
            fs::File::create(&tmp).map_err(|e| format!("Tạo file tạm thất bại: {}", e))?;
        file.write_all(bytes)
            .map_err(|e| format!("Ghi file thất bại: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Đồng bộ file thất bại: {}", e))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("Hoàn tất file thất bại: {}", e))
}

fn copy_if_exists(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    if source == destination {
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Tạo thư mục backup thất bại: {}", e))?;
    }
    fs::copy(source, destination).map_err(|e| format!("Sao chép dữ liệu thất bại: {}", e))?;
    Ok(())
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    fs::create_dir_all(destination).map_err(|e| format!("Tạo thư mục ảnh thất bại: {}", e))?;
    for entry in fs::read_dir(source).map_err(|e| format!("Đọc thư mục ảnh thất bại: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Đọc file ảnh thất bại: {}", e))?;
        let from = entry.path();
        let to = destination.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            copy_if_exists(&from, &to)?;
        }
    }
    Ok(())
}

fn decode_note_images(repo: &Path, session_id: &str, json: &mut Value) -> Result<(), String> {
    let Some(images) = json.get_mut("note_images").and_then(Value::as_array_mut) else {
        return Ok(());
    };
    let image_dir = repo.join("images").join(session_id);
    for image in images.iter_mut() {
        let Some(obj) = image.as_object_mut() else {
            continue;
        };
        let Some(data_url) = obj.get("data_url").and_then(Value::as_str) else {
            continue;
        };
        let Some((header, encoded)) = data_url.split_once(",") else {
            continue;
        };
        let mime = header
            .strip_prefix("data:")
            .and_then(|s| s.split(';').next())
            .unwrap_or("image/png");
        let ext = match mime {
            "image/jpeg" | "image/jpg" => "jpg",
            "image/webp" => "webp",
            "image/gif" => "gif",
            "image/svg+xml" => "svg",
            _ => "png",
        };
        let image_id = obj.get("id").and_then(Value::as_str).unwrap_or("image");
        let safe_id: String = image_id
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        let safe_id = if safe_id.is_empty() {
            "image"
        } else {
            &safe_id
        };
        let file_name = format!("{}.{}", safe_id, ext);
        let image_path = image_dir.join(&file_name);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|e| format!("Giải mã ảnh {} thất bại: {}", image_id, e))?;
        if let Some(parent) = image_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Tạo thư mục ảnh thất bại: {}", e))?;
        }
        atomic_write(&image_path, &bytes)?;
        obj.insert(
            "path".into(),
            Value::String(format!("images/{}/{}", session_id, file_name)),
        );
        obj.remove("data_url");
    }
    Ok(())
}

fn sync_managed_data(app: &AppHandle, repo: &Path) -> Result<(), String> {
    let records_dir = repo.join("records");
    fs::create_dir_all(&records_dir).map_err(|e| format!("Tạo thư mục records thất bại: {}", e))?;
    fs::create_dir_all(repo.join("images"))
        .map_err(|e| format!("Tạo thư mục images thất bại: {}", e))?;

    let source_dir = crate::commands::session_store::sessions_dir(app)?;
    let source_records_dir = crate::commands::session_store::records_dir(&source_dir);
    for path in crate::commands::session_store::record_files(&source_dir)? {
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        let is_canonical_record = path.parent() == Some(source_records_dir.as_path());
        if !is_canonical_record && !name.starts_with("session-") && !name.ends_with(".md") {
            continue;
        }
        match path.extension().and_then(|e| e.to_str()) {
            Some("md") => copy_if_exists(&path, &records_dir.join(&name))?,
            Some("json") => {
                let content = fs::read_to_string(&path)
                    .map_err(|e| format!("Đọc {} thất bại: {}", name, e))?;
                let mut value: Value = serde_json::from_str(&content)
                    .map_err(|e| format!("Đọc metadata {} thất bại: {}", name, e))?;
                let id = name
                    .strip_prefix("session-")
                    .and_then(|s| s.strip_suffix(".json"))
                    .unwrap_or("unknown");
                decode_note_images(repo, id, &mut value)?;
                let bytes = serde_json::to_vec_pretty(&value)
                    .map_err(|e| format!("Đóng gói metadata {} thất bại: {}", name, e))?;
                atomic_write(&records_dir.join(&name), &bytes)?;
            }
            _ => {}
        }
    }

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Không lấy được thư mục app data: {}", e))?;
    copy_if_exists(
        &app_data.join("projects.json"),
        &repo.join("projects.json"),
    )?;

    // Preserve any future externally-stored image assets without touching audio.
    if source_dir != repo {
        copy_dir_recursive(&source_dir.join("images"), &repo.join("images"))?;
    }

    let manifest = br#"{
  "format": "meet-minder-git-backup",
  "version": 1,
  "managed": ["records", "images", "projects.json"]
}
"#;
    atomic_write(&repo.join("meet-minder-data.json"), manifest)?;

    let gitignore = repo.join(".gitignore");
    if !gitignore.exists() {
        atomic_write(
            &gitignore,
            b"# Meet Minder data safety\naudio/\n*.wav\n*.mp3\n*.m4a\n*.aac\n*.ogg\n*.flac\n*.webm\nsettings.json\n.DS_Store\n",
        )?;
    }
    Ok(())
}

fn stage_managed_data(repo: &Path) -> Result<(), String> {
    let paths: Vec<&str> = MANAGED_PATHS
        .iter()
        .copied()
        .filter(|path| repo.join(path).exists())
        .collect();
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec!["add", "-f", "--"];
    args.extend(paths);
    let output = run_git(repo, &args)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!("Git stage thất bại: {}", output_error(&output)))
    }
}

fn git_backup_status_inner(app: &AppHandle) -> GitBackupStatus {
    match crate::commands::session_store::sessions_dir(app) {
        Ok(repo) => {
            let repo_path = repo.to_string_lossy().to_string();
            status_for(&repo_path)
        }
        Err(error) => GitBackupStatus {
            configured: false,
            git_available: is_git_available(),
            is_repo: false,
            repo_path: String::new(),
            branch: None,
            remote: None,
            dirty_files: 0,
            last_commit: None,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub async fn git_backup_status(app: AppHandle) -> GitBackupStatus {
    tokio::task::spawn_blocking(move || git_backup_status_inner(&app))
        .await
        .unwrap_or_else(|e| GitBackupStatus {
            configured: false,
            git_available: is_git_available(),
            is_repo: false,
            repo_path: String::new(),
            branch: None,
            remote: None,
            dirty_files: 0,
            last_commit: None,
            error: Some(format!("Task join error: {}", e)),
        })
}

fn git_backup_now_inner(app: &AppHandle, push: bool) -> Result<GitBackupResult, String> {
    let repo = crate::commands::session_store::sessions_dir(app)?;
    if !is_git_available() {
        return Err("Git chưa được cài đặt hoặc chưa có trong PATH".into());
    }
    if !repo_is_valid(&repo) {
        return Err(
            "Thư mục lưu trữ hiện tại chưa là Git repository. Hãy tự chạy git init trong thư mục này trước."
                .into(),
        );
    }
    if run_git(&repo, &["diff", "--name-only", "--diff-filter=U", "--"])
        .map(|o| !output_text(&o).is_empty())
        .unwrap_or(false)
    {
        return Err("Repository đang có conflict; hãy xử lý bằng Git client trước".into());
    }

    sync_managed_data(app, &repo)?;
    stage_managed_data(&repo)?;
    let staged_paths = git_name_only(&repo, &["diff", "--cached", "--name-only", "--"]);
    let diff = run_git(&repo, &["diff", "--cached", "--quiet"])?;
    let mut committed = false;
    if !diff.status.success() {
        let commit = run_git(&repo, &["commit", "-m", "meet-minder: backup managed data"])?;
        if !commit.status.success() {
            return Err(format!("Git commit thất bại: {}", output_error(&commit)));
        }
        committed = true;
    }

    let mut pushed = false;
    let mut changed_paths = Vec::new();
    let mut warning = None;
    if push {
        changed_paths = if committed {
            staged_paths
        } else {
            changed_paths_for_push(&repo)
        };
        let push_output = run_git(&repo, &["push"])?;
        if !push_output.status.success() {
            warning = Some(format!("Git push thất bại: {}", output_error(&push_output)));
        } else {
            pushed = true;
        }
    }

    let repo_path = repo.to_string_lossy().to_string();
    let status = status_for(&repo_path);
    Ok(GitBackupResult {
        committed,
        pushed,
        changed_paths,
        message: if let Some(ref push_warning) = warning {
            if committed {
                format!(
                    "Đã commit backup, nhưng push chưa thành công: {}",
                    push_warning
                )
            } else {
                push_warning.clone()
            }
        } else if committed {
            if pushed {
                "Đã commit và push backup ✓".into()
            } else {
                "Đã commit backup ✓".into()
            }
        } else if pushed {
            "Không có thay đổi mới; đã push ✓".into()
        } else {
            "Dữ liệu đã up-to-date ✓".into()
        },
        warning,
        status,
    })
}

#[tauri::command]
pub async fn git_backup_now(app: AppHandle, push: bool) -> Result<GitBackupResult, String> {
    tokio::task::spawn_blocking(move || git_backup_now_inner(&app, push))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

fn git_backup_push_inner(app: &AppHandle) -> Result<GitPushResult, String> {
    let repo = crate::commands::session_store::sessions_dir(app)?;
    let repo_path = repo.to_string_lossy().to_string();
    if !repo_is_valid(&repo) {
        return Err(
            "Thư mục lưu trữ hiện tại chưa là Git repository. Hãy tự chạy git init trong thư mục này trước."
                .into(),
        );
    }
    let changed_paths = changed_paths_for_push(&repo);
    let output = run_git(&repo, &["push"])?;
    if !output.status.success() {
        let warning = format!("Git push thất bại: {}", output_error(&output));
        return Ok(GitPushResult {
            pushed: false,
            changed_paths,
            message: warning.clone(),
            warning: Some(warning),
            status: status_for(&repo_path),
        });
    }
    let message = if changed_paths.is_empty() {
        "Không có commit mới; remote đã up-to-date ✓".into()
    } else {
        "Đã push backup lên remote ✓".into()
    };
    Ok(GitPushResult {
        pushed: true,
        changed_paths,
        message,
        warning: None,
        status: status_for(&repo_path),
    })
}

#[tauri::command]
pub async fn git_backup_push(app: AppHandle) -> Result<GitPushResult, String> {
    tokio::task::spawn_blocking(move || git_backup_push_inner(&app))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_git_backup_stages_only_internal_backup_data() {
        let root = std::env::temp_dir().join(format!(
            "meet-minder-git-backup-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(root.join("records")).unwrap();
        fs::create_dir_all(root.join("audio")).unwrap();
        fs::write(root.join("records/session-test.md"), b"meeting log").unwrap();
        fs::write(root.join("audio/session-test.wav"), b"audio").unwrap();
        fs::write(root.join("settings.json"), b"secret settings").unwrap();
        fs::write(root.join(".gitignore"), b"*.wav\nsettings.json\n").unwrap();

        let init = run_git(&root, &["init"]).unwrap();
        assert!(init.status.success());
        stage_managed_data(&root).unwrap();
        let staged = output_text(&run_git(&root, &["diff", "--cached", "--name-only"]).unwrap());

        assert!(staged.contains("records/session-test.md"));
        assert!(!staged.contains("session-test.wav"));
        assert!(!staged.contains("settings.json"));

        let _ = fs::remove_dir_all(root);
    }
}
