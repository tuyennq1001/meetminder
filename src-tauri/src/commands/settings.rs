use crate::settings::{Settings, SettingsState};
use tauri::State;

/// Get current settings
#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> Result<Settings, String> {
    let settings = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(settings.clone())
}

/// Save settings
#[tauri::command]
pub fn save_settings(
    new_settings: Settings,
    state: State<'_, SettingsState>,
) -> Result<(), String> {
    let mut settings = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;

    // Save to disk
    new_settings.save()?;

    // Update in-memory state
    *settings = new_settings;

    Ok(())
}
