/**
 * Settings Manager — handles loading/saving settings via Tauri IPC
 */

const { invoke } = window.__TAURI__.core;

// Default settings shape
const DEFAULT_SETTINGS = {
  soniox_api_key: '',
  openai_api_key: '',
  gemini_api_key: '',
  gemini_model: 'models/gemini-3.5-transcribe-live',
  gemini_diarization: false,
  qwen_api_key: '',
  source_language: 'ja',
  target_language: 'vi',
  audio_source: 'system',
  overlay_opacity: 0.85,
  font_size: 16,
  note_font_size: 14,
  font_color: '#ffffff',
  font_family: 'system',
  max_lines: 5,
  show_original: true,
  translation_mode: 'gemini',
  inactivity_timeout_min: 10,
  custom_context: null,
  template_notes: '',
  template_minutes_vi: '',
  template_minutes_ja: '',
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
