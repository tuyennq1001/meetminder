pub mod audio;
pub mod commands;
pub mod settings;

use audio::microphone::MicCapture;
use audio::SystemAudioCapture;
use commands::audio::AudioState;
use commands::gemini_realtime::GeminiState;
use commands::local_pipeline::LocalPipelineState;
use commands::local_tts::LocalTtsState;
use commands::openai_realtime::OpenAiState;
use commands::qwen_realtime::QwenState;
use settings::{Settings, SettingsState};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

// Set once the frontend has flushed the session (or the exit deadline elapsed),
// so the ExitRequested handler stops preventing exit and the app can quit.
static EXIT_ALLOWED: AtomicBool = AtomicBool::new(false);
static LAST_QUIT_REQUEST_MS: AtomicU64 = AtomicU64::new(0);
const QUIT_CONFIRM_WINDOW_MS: u64 = 2_000;

fn current_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
fn get_platform_info() -> String {
    // `std::env::consts::ARCH` is the arch of THIS binary, not the CPU. On an
    // Apple Silicon Mac running the x64 build under Rosetta it reports
    // "x86_64", which wrongly blocked the Local MLX engine (MLX runs as a
    // separate native-ARM Python subprocess, so it works fine there).
    // Ask the hardware directly so detection is Rosetta-proof.
    let is_arm_hardware = is_apple_silicon_hardware();
    format!(
        r#"{{"os":"{}","arch":"{}","is_arm_hardware":{},"version":"0.3.0"}}"#,
        std::env::consts::OS,
        std::env::consts::ARCH,
        is_arm_hardware
    )
}

/// True only on Apple Silicon hardware (macOS), even when the current process
/// is x86_64 under Rosetta. Uses `sysctl hw.optional.arm64`, which reads the
/// real CPU, not the process translation state. Non-macOS → false.
#[cfg(target_os = "macos")]
fn is_apple_silicon_hardware() -> bool {
    std::process::Command::new("sysctl")
        .args(["-n", "hw.optional.arm64"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim() == "1")
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn is_apple_silicon_hardware() -> bool {
    false
}

// Called by the frontend after it has flushed the session on exit. Force-exits
// the process; the flag keeps a subsequent ExitRequested from being prevented.
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    EXIT_ALLOWED.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load settings from disk (or defaults)
    let initial_settings = Settings::load();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            // Dev builds keep the WebView inspector available (F12), but do not
            // open it automatically because it takes over most of the window.
            Ok(())
        })
        .manage(SettingsState(Mutex::new(initial_settings)))
        .manage(AudioState {
            system_audio: Mutex::new(SystemAudioCapture::new()),
            microphone: Mutex::new(MicCapture::new()),
            active_receiver: Mutex::new(None),
        })
        .manage(LocalPipelineState {
            process: Mutex::new(None),
        })
        .manage(LocalTtsState::default())
        .manage(OpenAiState::default())
        .manage(GeminiState::default())
        .manage(QwenState::default())
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::audio::start_capture,
            commands::audio::stop_capture,
            commands::audio::get_capture_status,
            commands::audio::check_permissions,
            commands::audio::request_microphone_permission,
            commands::audio::request_screen_capture_permission,
            commands::transcript::save_transcript,
            commands::transcript::open_transcript_dir,
            commands::transcript::list_transcripts,
            commands::transcript::read_transcript,
            commands::session_store::save_session,
            commands::session_store::list_sessions,
            commands::session_store::read_session,
            commands::session_store::read_legacy_session,
            commands::session_store::delete_session,
            commands::session_store::delete_sessions,
            commands::session_store::update_session_title,
            commands::session_store::update_session_tags,
            commands::session_store::update_session_metadata,
            commands::session_store::update_session_content,
            commands::session_store::update_session_meeting_minutes,
            commands::session_store::update_session_langs,
            commands::session_store::update_session_notes,
            commands::session_store::get_project_registry,
            commands::session_store::save_customer,
            commands::session_store::toggle_customer_status,
            commands::session_store::delete_customer,
            commands::session_store::save_project,
            commands::session_store::toggle_project_status,
            commands::session_store::delete_project,
            commands::session_store::save_category,
            commands::session_store::delete_category,
            commands::session_store::save_tag,
            commands::session_store::delete_tag,
            commands::session_store::export_session_srt,
            commands::session_store::export_session_txt,
            commands::session_store::search_sessions,
            commands::session_store::get_session_record_path,
            commands::session_store::read_session_audio,
            commands::session_store::get_session_audio_info,
            commands::session_store::select_audio_file,
            commands::session_store::inspect_audio_file,
            commands::session_store::import_audio_session,
            commands::session_store::retranscribe_session_with_gemini,
            commands::session_store::cancel_retranscribe_session,
            commands::session_store::get_storage_info,
            commands::session_store::select_custom_transcripts_dir,
            commands::session_store::preview_storage_dir_change,
            commands::session_store::set_custom_transcripts_dir,
            commands::git_backup::git_backup_status,
            commands::git_backup::git_backup_now,
            commands::git_backup::git_backup_push,
            commands::local_pipeline::start_local_pipeline,
            commands::local_pipeline::send_audio_to_pipeline,
            commands::local_pipeline::stop_local_pipeline,
            commands::local_pipeline::check_mlx_setup,
            commands::local_pipeline::run_mlx_setup,
            commands::local_pipeline::get_local_models_info,
            commands::local_pipeline::delete_local_models,
            commands::edge_tts::edge_tts_speak,
            commands::microsoft_tts::microsoft_list_voices,
            commands::google_free_tts::google_free_tts_speak,
            commands::tiktok_tts::tiktok_tts_speak,
            commands::local_tts::local_tts_speak,
            commands::local_tts::local_tts_list_models,
            commands::local_tts::local_tts_models_dir_path,
            commands::local_tts::local_tts_download_model,
            commands::local_tts::local_tts_delete_model,
            commands::openai_realtime::openai_realtime_start,
            commands::openai_realtime::openai_realtime_send_audio,
            commands::openai_realtime::openai_realtime_stop,
            commands::gemini_realtime::gemini_realtime_start,
            commands::gemini_realtime::gemini_realtime_send_audio,
            commands::gemini_realtime::gemini_realtime_set_target_lang,
            commands::gemini_realtime::gemini_realtime_stop,
            commands::qwen_realtime::qwen_realtime_start,
            commands::qwen_realtime::qwen_realtime_send_audio,
            commands::qwen_realtime::qwen_realtime_stop,
            get_platform_info,
            exit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Cmd+Q and Dock → Quit fire app-level ExitRequested (not the
            // window's onCloseRequested). Prevent the first exit, ask the
            // frontend to flush the session, and force-exit after a deadline so
            // a hung flush can never make the app unquittable.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !EXIT_ALLOWED.load(Ordering::SeqCst) {
                    use tauri::{Emitter, Manager};
                    api.prevent_exit();
                    let now = current_time_ms();
                    let previous = LAST_QUIT_REQUEST_MS.swap(now, Ordering::SeqCst);
                    let confirmed = previous > 0 && now.saturating_sub(previous) <= QUIT_CONFIRM_WINDOW_MS;

                    if let Some(win) = app_handle.get_webview_window("main") {
                        if confirmed {
                            let _ = win.emit("app-exit-requested", ());
                            let handle = app_handle.clone();
                            std::thread::spawn(move || {
                                std::thread::sleep(std::time::Duration::from_secs(3));
                                EXIT_ALLOWED.store(true, Ordering::SeqCst);
                                handle.exit(0);
                            });
                        } else {
                            let _ = win.emit("app-quit-confirmation-needed", ());
                        }
                    }
                }
            }
        });
}
