mod audio;
mod commands;
mod settings;

use audio::microphone::MicCapture;
use audio::SystemAudioCapture;
use commands::audio::AudioState;
use settings::{Settings, SettingsState};
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load settings from disk (or defaults)
    let initial_settings = Settings::load();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SettingsState(Mutex::new(initial_settings)))
        .manage(AudioState {
            system_audio: Mutex::new(SystemAudioCapture::new()),
            microphone: Mutex::new(MicCapture::new()),
            active_receiver: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::audio::start_capture,
            commands::audio::stop_capture,
            commands::audio::check_permissions,
            commands::transcript::append_transcript,
            commands::transcript::get_transcript_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
