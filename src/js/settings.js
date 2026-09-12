/**
 * Settings Manager — handles loading/saving settings via Tauri IPC
 */

const { invoke } = window.__TAURI__.core;

// Default settings shape
const DEFAULT_SETTINGS = {
  app_language: 'en',
  soniox_api_key: '',
  openai_api_key: '',
  gemini_api_key: '',
  gemini_model: 'models/gemini-3.5-transcribe-live',
  qwen_api_key: '',
  source_language: 'ja',
  target_language: 'vi',
  audio_source: 'system',
  overlay_opacity: 0.85,
  font_size: 16,
  note_font_size: 14,
  note_font_family: 'system',
  menu_font_family: 'system',
  menu_font_size: 12,
  menu_font_weight: 'medium',
  table_font_family: 'system',
  table_font_size: 13,
  table_font_weight: 'medium',
  font_color: '#ffffff',
  font_family: 'system',
  max_lines: 5,
  show_original: true,
  translation_mode: 'gemini',
  translation_timing: 'on_pause',
  endpoint_delay: 3000,
  inactivity_timeout_min: 10,
  template_notes: '',
  user_profile_name: '',
  user_profile_company: '',
  meeting_minutes_use_notes: true,
  meeting_minutes_use_project_context: true,
  meeting_minutes_lang: 'en',
  template_minutes_vi: '',
  template_minutes_ja: '',
  template_minutes_en: '',
  template_minutes_tech_vi: '',
  template_minutes_tech_ja: '',
  template_minutes_tech_en: '',
  template_minutes_1on1_vi: '',
  template_minutes_1on1_ja: '',
  template_minutes_1on1_en: '',
  template_minutes_personal_vi: '',
  template_minutes_personal_ja: '',
  template_minutes_personal_en: '',
  default_logs_scope: 'work',
  git_backup_enabled: false,
  // Legacy setting retained for compatibility; Git backup follows storage path now.
  git_backup_repo_path: '',
  git_backup_auto_commit: true,
  git_backup_commit_on_meeting_end: true,
  git_backup_commit_interval_min: 30,
  git_backup_auto_push: false,
  git_backup_push_interval_min: 60,
};

class SettingsManager {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this._listeners = [];
  }

  /**
   * Load settings from Rust backend
   */
  async load() {
    try {
      const settings = await invoke('get_settings');
      this.settings = { ...DEFAULT_SETTINGS, ...settings };
    } catch (err) {
      console.error('Failed to load settings:', err);
      this.settings = { ...DEFAULT_SETTINGS };
    }
    this._notify();
    return this.settings;
  }

  /**
   * Save settings to Rust backend
   */
  async save(newSettings) {
    try {
      const merged = { ...this.settings, ...newSettings };
      await invoke('save_settings', { newSettings: merged });
      this.settings = merged;
      this._notify();
      return true;
    } catch (err) {
      console.error('Failed to save settings:', err);
      throw err;
    }
  }

  /**
   * Get current settings (cached)
   */
  get() {
    return { ...this.settings };
  }

  /**
   * Subscribe to settings changes
   */
  onChange(callback) {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter(l => l !== callback);
    };
  }

  _notify() {
    const settings = this.get();
    this._listeners.forEach(cb => cb(settings));
  }
}

// Singleton
export const settingsManager = new SettingsManager();
