use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

/// General key-value context pair
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(default)]
pub struct GeneralContextPair {
    pub key: String,
    pub value: String,
}

/// Translation term: source → target mapping for Soniox & Gemini
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(default)]
pub struct TranslationTerm {
    pub source: String,
    pub target: String,
}

/// Custom context for Soniox & Gemini — provides domain-specific hints
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(default)]
pub struct CustomContext {
    pub domain: Option<String>,
    #[serde(default)]
    pub general: Vec<GeneralContextPair>,
    #[serde(default)]
    pub terms: Vec<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub translation_terms: Vec<TranslationTerm>,
}

/// App settings — persisted to JSON
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Settings {
    /// UI language: "vi" | "en" | "ja"
    #[serde(default = "default_app_language")]
    pub app_language: String,
    /// Soniox API key
    pub soniox_api_key: String,
    /// OpenAI API key (for gpt-realtime-translate)
    pub openai_api_key: String,
    /// Google Gemini API key (for Gemini Multimodal Live)
    #[serde(default)]
    pub gemini_api_key: String,
    /// Google Gemini model name
    #[serde(default = "default_gemini_model")]
    pub gemini_model: String,
    /// Alibaba Cloud DashScope API key (for Qwen LiveTranslate Flash)
    #[serde(default)]
    pub qwen_api_key: String,
    /// Source language: "auto" or ISO 639-1 code
    pub source_language: String,
    /// Target language: ISO 639-1 code
    pub target_language: String,
    /// Audio source: "system" | "microphone" | "both"
    pub audio_source: String,
    /// Overlay opacity: 0.0 - 1.0
    #[serde(default = "default_overlay_opacity")]
    pub overlay_opacity: f64,
    /// Font size in px
    pub font_size: u32,
    /// Note editor font size in px
    #[serde(default = "default_note_font_size")]
    pub note_font_size: u32,
    /// Note editor font family identifier
    #[serde(default = "default_note_font_family")]
    pub note_font_family: String,
    /// System menu font family identifier
    #[serde(default = "default_menu_font_family")]
    pub menu_font_family: String,
    /// System menu font size in px
    #[serde(default = "default_menu_font_size")]
    pub menu_font_size: u32,
    /// System menu font weight ("normal" | "medium" | "semibold")
    #[serde(default = "default_menu_font_weight")]
    pub menu_font_weight: String,
    /// Data table and logs content font family identifier
    #[serde(default = "default_table_font_family")]
    pub table_font_family: String,
    /// Data table and logs content font size in px
    #[serde(default = "default_table_font_size")]
    pub table_font_size: u32,
    /// Data table and logs content font weight ("normal" | "medium" | "semibold")
    #[serde(default = "default_table_font_weight")]
    pub table_font_weight: String,
    /// Transcript font color as a CSS color string
    #[serde(default = "default_font_color")]
    pub font_color: String,
    /// Transcript font family identifier
    #[serde(default = "default_font_family")]
    pub font_family: String,
    /// Max transcript lines to display
    pub max_lines: u32,
    /// Whether to show original text alongside translation
    pub show_original: bool,
    /// Translation mode: "soniox" | "local" | "openai"
    pub translation_mode: String,
    /// Translation timing: "on_pause" (whole sentence) | "realtime"
    #[serde(default = "default_translation_timing")]
    pub translation_timing: String,
    /// Endpoint delay in milliseconds for endpoint-based providers
    #[serde(default = "default_endpoint_delay")]
    pub endpoint_delay: u32,
    /// Optional custom context for better transcription
    pub custom_context: Option<CustomContext>,
    /// ElevenLabs API key for TTS narration
    pub elevenlabs_api_key: String,
    /// Whether TTS narration is enabled
    pub tts_enabled: bool,
    /// TTS provider: "edge" | "microsoft" | "google-free" | "tiktok" | "google" | "elevenlabs"
    pub tts_provider: String,
    /// ElevenLabs voice ID
    pub tts_voice_id: String,
    /// TTS speed multiplier (Web Speech)
    pub tts_speed: f64,
    /// Edge TTS voice name
    pub edge_tts_voice: String,
    /// Edge TTS speed percentage
    pub edge_tts_speed: i32,
    /// Auto-read new translations aloud
    pub tts_auto_read: bool,
    /// Google Cloud TTS API key
    pub google_tts_api_key: String,
    /// Google TTS voice name
    pub google_tts_voice: String,
    /// Google TTS speaking rate
    pub google_tts_speed: f64,
    /// Microsoft v2 (Edge endpoint, dynamic voice list) selected voice
    pub microsoft_v2_voice: String,
    /// Microsoft v2 speed percentage (reuses edge synth)
    pub microsoft_v2_speed: i32,
    /// Google Free (android-tts) language token, e.g. "vi-VN" | "en-US"
    pub google_free_voice: String,
    /// Optional user Google API key for Google Free. When set, overrides the build-time
    /// GOOGLE_FREE_TTS_KEY. Empty → fall back to the build-time key (if any).
    #[serde(default)]
    pub google_free_api_key: String,
    /// Google Free client-side playback speed (endpoint has no rate param). 1.0 = normal.
    #[serde(default = "default_local_tts_speed")]
    pub google_free_speed: f32,
    /// TikTok TTS speaker code, e.g. "BV074_streaming"
    pub tiktok_voice: String,
    /// TikTok client-side playback speed (endpoint has no rate param). 1.0 = normal.
    #[serde(default = "default_local_tts_speed")]
    pub tiktok_speed: f32,
    /// TikTok sessionid cookie (user-supplied; required by the endpoint)
    pub tiktok_session_id: String,
    /// Local offline (Piper/sherpa-onnx) selected voice id, e.g. "vi_VN-vais1000-medium"
    #[serde(default)]
    pub local_tts_voice: String,
    /// Local offline TTS speed (1.0 = normal). Piper length-scale is applied inversely.
    #[serde(default = "default_local_tts_speed")]
    pub local_tts_speed: f32,
    /// Folder where local TTS models are stored; empty = default app-data location.
    #[serde(default)]
    pub local_tts_models_dir: String,
    /// OpenAI Realtime: when true server generates translated audio.
    /// Default false — speaker → mic feedback loop on shared devices.
    #[serde(default)]
    pub openai_audio_output: bool,
    /// Auto-pause session when silence/inactivity exceeds N minutes (0 = disabled).
    #[serde(default = "default_inactivity_timeout_min")]
    pub inactivity_timeout_min: u32,
    /// Custom template for Notes (Markdown)
    #[serde(default)]
    pub template_notes: Option<String>,
    /// Whether handwritten notes should be used as source material for Meeting Minutes
    #[serde(default = "default_meeting_minutes_use_notes")]
    pub meeting_minutes_use_notes: bool,
    /// Default language for generated meeting minutes
    #[serde(default = "default_meeting_minutes_lang")]
    pub meeting_minutes_lang: String,
    /// Custom template for Meeting Minutes - Vietnamese (Markdown)
    #[serde(default)]
    pub template_minutes_vi: Option<String>,
    /// Custom template for Meeting Minutes - Japanese (Markdown)
    #[serde(default)]
    pub template_minutes_ja: Option<String>,
    /// Custom template for Meeting Minutes - English (Markdown)
    #[serde(default)]
    pub template_minutes_en: Option<String>,
    /// Custom template for Meeting Minutes - Tech - Vietnamese (Markdown)
    #[serde(default)]
    pub template_minutes_tech_vi: Option<String>,
    /// Custom template for Meeting Minutes - Tech - Japanese (Markdown)
    #[serde(default)]
    pub template_minutes_tech_ja: Option<String>,
    /// Custom template for Meeting Minutes - Tech - English (Markdown)
    #[serde(default)]
    pub template_minutes_tech_en: Option<String>,
    /// Custom template for Meeting Minutes - 1-on-1 - Vietnamese (Markdown)
    #[serde(default)]
    pub template_minutes_1on1_vi: Option<String>,
    /// Custom template for Meeting Minutes - 1-on-1 - Japanese (Markdown)
    #[serde(default)]
    pub template_minutes_1on1_ja: Option<String>,
    /// Custom template for Meeting Minutes - 1-on-1 - English (Markdown)
    #[serde(default)]
    pub template_minutes_1on1_en: Option<String>,
    /// Custom template for Meeting Minutes - Personal - Vietnamese (Markdown)
    #[serde(default)]
    pub template_minutes_personal_vi: Option<String>,
    /// Custom template for Meeting Minutes - Personal - Japanese (Markdown)
    #[serde(default)]
    pub template_minutes_personal_ja: Option<String>,
    /// Custom template for Meeting Minutes - Personal - English (Markdown)
    #[serde(default)]
    pub template_minutes_personal_en: Option<String>,
    /// Default logs scope filter on app open: "work" | "personal" | "all" | "last"
    #[serde(default = "default_logs_scope_setting")]
    pub default_logs_scope: String,
    /// Enable optional Git backup for managed meeting data.
    #[serde(default)]
    pub git_backup_enabled: bool,
    /// Legacy field retained so existing settings files remain compatible.
    /// Git backup now uses the current storage directory automatically.
    #[serde(default)]
    pub git_backup_repo_path: String,
    /// Automatically create local Git commits.
    #[serde(default = "default_git_auto_commit")]
    pub git_backup_auto_commit: bool,
    /// Commit and push immediately after a meeting is saved.
    #[serde(default = "default_git_commit_on_meeting_end")]
    pub git_backup_commit_on_meeting_end: bool,
    /// Commit interval in minutes when automatic commit is enabled.
    #[serde(default = "default_git_commit_interval")]
    pub git_backup_commit_interval_min: u32,
    /// Automatically push commits to the configured Git remote.
    #[serde(default)]
    pub git_backup_auto_push: bool,
    /// Push interval in minutes when automatic push is enabled.
    #[serde(default = "default_git_push_interval")]
    pub git_backup_push_interval_min: u32,
    /// User profile name (e.g. "Terry", "Nguyen Quoc Tuyen")
    #[serde(default)]
    pub user_profile_name: String,
    /// User profile nickname / display name (e.g. "Terry")
    #[serde(default)]
    pub user_profile_nickname: String,
    /// User company/organization name (e.g. "Relipa")
    #[serde(default)]
    pub user_profile_company: String,
    /// Whether project context and glossary should be used for Meeting Minutes
    #[serde(default = "default_meeting_minutes_use_project_context")]
    pub meeting_minutes_use_project_context: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            app_language: default_app_language(),
            soniox_api_key: String::new(),
            openai_api_key: String::new(),
            gemini_api_key: String::new(),
            gemini_model: "models/gemini-3.5-transcribe-live".to_string(),
            qwen_api_key: String::new(),
            source_language: "ja".to_string(),
            target_language: "vi".to_string(),
            audio_source: "system".to_string(),
            overlay_opacity: 0.85,
            font_size: 16,
            note_font_size: default_note_font_size(),
            note_font_family: default_note_font_family(),
            menu_font_family: default_menu_font_family(),
            menu_font_size: default_menu_font_size(),
            menu_font_weight: default_menu_font_weight(),
            table_font_family: default_table_font_family(),
            table_font_size: default_table_font_size(),
            table_font_weight: default_table_font_weight(),
            font_color: default_font_color(),
            font_family: default_font_family(),
            max_lines: 5,
            show_original: true,
            translation_mode: "gemini".to_string(),
            translation_timing: default_translation_timing(),
            endpoint_delay: default_endpoint_delay(),
            custom_context: None,
            elevenlabs_api_key: String::new(),
            tts_enabled: false,
            tts_provider: "edge".to_string(),
            tts_voice_id: "21m00Tcm4TlvDq8ikWAM".to_string(),
            tts_speed: 1.2,
            edge_tts_voice: "vi-VN-HoaiMyNeural".to_string(),
            edge_tts_speed: 50,
            tts_auto_read: true,
            google_tts_api_key: String::new(),
            google_tts_voice: "vi-VN-Chirp3-HD-Aoede".to_string(),
            google_tts_speed: 1.0,
            microsoft_v2_voice: "vi-VN-HoaiMyNeural".to_string(),
            microsoft_v2_speed: 20,
            google_free_voice: "vi-VN".to_string(),
            google_free_api_key: String::new(),
            google_free_speed: 1.0,
            tiktok_voice: "BV074_streaming".to_string(),
            tiktok_speed: 1.0,
            tiktok_session_id: String::new(),
            local_tts_voice: "vi_VN-vais1000-medium".to_string(),
            local_tts_speed: 1.0,
            local_tts_models_dir: String::new(),
            openai_audio_output: false,
            inactivity_timeout_min: 10,
            template_notes: None,
            meeting_minutes_use_notes: true,
            meeting_minutes_lang: default_meeting_minutes_lang(),
            template_minutes_vi: None,
            template_minutes_ja: None,
            template_minutes_en: None,
            template_minutes_tech_vi: None,
            template_minutes_tech_ja: None,
            template_minutes_tech_en: None,
            template_minutes_1on1_vi: None,
            template_minutes_1on1_ja: None,
            template_minutes_1on1_en: None,
            template_minutes_personal_vi: None,
            template_minutes_personal_ja: None,
            template_minutes_personal_en: None,
            default_logs_scope: "work".to_string(),
            git_backup_enabled: false,
            git_backup_repo_path: String::new(),
            git_backup_auto_commit: true,
            git_backup_commit_on_meeting_end: true,
            git_backup_commit_interval_min: 30,
            git_backup_auto_push: false,
            git_backup_push_interval_min: 60,
            user_profile_name: String::new(),
            user_profile_nickname: String::new(),
            user_profile_company: String::new(),
            meeting_minutes_use_project_context: true,
        }
    }
}

fn default_meeting_minutes_use_project_context() -> bool {
    true
}

fn default_logs_scope_setting() -> String {
    "work".to_string()
}

fn default_app_language() -> String {
    "en".to_string()
}

fn default_git_auto_commit() -> bool {
    true
}

fn default_git_commit_on_meeting_end() -> bool {
    true
}

fn default_git_commit_interval() -> u32 {
    30
}

fn default_git_push_interval() -> u32 {
    60
}

fn default_translation_timing() -> String {
    "on_pause".to_string()
}

fn default_endpoint_delay() -> u32 {
    3000
}

fn default_overlay_opacity() -> f64 {
    0.85
}

fn default_inactivity_timeout_min() -> u32 {
    10
}

fn default_meeting_minutes_use_notes() -> bool {
    true
}

fn default_meeting_minutes_lang() -> String {
    "en".to_string()
}

fn default_note_font_size() -> u32 {
    14
}

fn default_note_font_family() -> String {
    "system".to_string()
}

fn default_menu_font_family() -> String {
    "system".to_string()
}

fn default_menu_font_size() -> u32 {
    12
}

fn default_menu_font_weight() -> String {
    "medium".to_string()
}

fn default_table_font_family() -> String {
    "system".to_string()
}

fn default_table_font_size() -> u32 {
    13
}

fn default_table_font_weight() -> String {
    "medium".to_string()
}

/// Serde default for `local_tts_speed` (field-level default would give 0.0).
fn default_local_tts_speed() -> f32 {
    1.0
}

fn default_font_color() -> String {
    "#ffffff".to_string()
}

fn default_font_family() -> String {
    "system".to_string()
}

fn default_gemini_model() -> String {
    "models/gemini-3.5-transcribe-live".to_string()
}

/// Get the settings file path
/// ~/Library/Application Support/com.meetminder.desktop/settings.json
fn settings_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("com.meetminder.desktop");
    path.push("settings.json");
    path
}

impl Settings {
    /// Load settings from disk, or return defaults
    pub fn load() -> Self {
        let path = settings_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
                Err(_) => Self::default(),
            }
        } else {
            Self::default()
        }
    }

    /// Save settings to disk
    pub fn save(&self) -> Result<(), String> {
        let path = settings_path();

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config dir: {}", e))?;
        }

        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize: {}", e))?;

        fs::write(&path, json).map_err(|e| format!("Failed to write settings: {}", e))?;

        Ok(())
    }
}

/// Thread-safe settings state managed by Tauri
pub struct SettingsState(pub Mutex<Settings>);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let s = Settings::default();
        assert_eq!(s.app_language, "en");
        assert_eq!(s.gemini_model, "models/gemini-3.5-transcribe-live");
        assert_eq!(s.source_language, "ja");
        assert_eq!(s.target_language, "vi");
        assert_eq!(s.audio_source, "system");
        assert_eq!(s.font_size, 16);
        assert_eq!(s.note_font_size, 14);
        assert_eq!(s.note_font_family, "system");
        assert_eq!(s.menu_font_family, "system");
        assert_eq!(s.menu_font_size, 12);
        assert_eq!(s.menu_font_weight, "medium");
        assert_eq!(s.table_font_family, "system");
        assert_eq!(s.table_font_size, 13);
        assert_eq!(s.table_font_weight, "medium");
        assert_eq!(s.font_color, "#ffffff");
        assert_eq!(s.font_family, "system");
        assert!((s.overlay_opacity - 0.85).abs() < f64::EPSILON);
        assert_eq!(s.tts_provider, "edge");
        assert_eq!(s.inactivity_timeout_min, 10);
        assert_eq!(s.translation_timing, "on_pause");
        assert_eq!(s.endpoint_delay, 3000);
        assert!(s.show_original);
        assert!(s.tts_auto_read);
        assert!(!s.tts_enabled);
        assert!(s.meeting_minutes_use_notes);
        assert_eq!(s.meeting_minutes_lang, "en");
    }

    #[test]
    fn test_deserialize_empty_json() {
        let json_str = "{}";
        let s: Result<Settings, _> = serde_json::from_str(json_str);
        assert!(s.is_ok());
        let s = s.unwrap();
        assert_eq!(s.gemini_model, "models/gemini-3.5-transcribe-live");
        assert_eq!(s.font_size, 16);
        assert_eq!(s.menu_font_family, "system");
        assert_eq!(s.menu_font_size, 12);
        assert_eq!(s.menu_font_weight, "medium");
        assert_eq!(s.table_font_family, "system");
        assert_eq!(s.table_font_size, 13);
        assert_eq!(s.table_font_weight, "medium");
        assert_eq!(s.inactivity_timeout_min, 10);
        assert_eq!(s.translation_timing, "on_pause");
        assert_eq!(s.endpoint_delay, 3000);
        assert_eq!(s.font_color, "#ffffff");
        assert!(s.meeting_minutes_use_notes);
        assert_eq!(s.meeting_minutes_lang, "en");
    }

    #[test]
    fn test_deserialize_partial_json_preserves_defaults() {
        let json_str = r#"{
            "gemini_api_key": "test-key",
            "source_language": "en",
            "target_language": "ja"
        }"#;
        let s: Settings = serde_json::from_str(json_str).expect("should parse partial settings");
        assert_eq!(s.gemini_api_key, "test-key");
        assert_eq!(s.source_language, "en");
        assert_eq!(s.target_language, "ja");
        assert_eq!(s.gemini_model, "models/gemini-3.5-transcribe-live");
        assert!((s.overlay_opacity - 0.85).abs() < f64::EPSILON);
        assert_eq!(s.font_size, 16);
        assert!((s.tts_speed - 1.2).abs() < f64::EPSILON);
    }

    #[test]
    fn test_serialize_deserialize_roundtrip() {
        let mut s = Settings::default();
        s.gemini_api_key = "AIzaSy123456".to_string();
        s.font_size = 20;
        s.note_font_size = 18;
        s.note_font_family = "inter".to_string();
        s.menu_font_family = "roboto".to_string();
        s.menu_font_size = 13;
        s.menu_font_weight = "semibold".to_string();
        s.table_font_family = "inter".to_string();
        s.table_font_size = 14;
        s.table_font_weight = "semibold".to_string();
        s.font_color = "#33ccff".to_string();
        s.meeting_minutes_use_notes = false;
        s.template_notes = Some("# Notes template".to_string());

        let json = serde_json::to_string(&s).expect("should serialize");
        let restored: Settings = serde_json::from_str(&json).expect("should deserialize");

        assert_eq!(restored.gemini_api_key, "AIzaSy123456");
        assert_eq!(restored.font_size, 20);
        assert_eq!(restored.note_font_size, 18);
        assert_eq!(restored.note_font_family, "inter");
        assert_eq!(restored.menu_font_family, "roboto");
        assert_eq!(restored.menu_font_size, 13);
        assert_eq!(restored.menu_font_weight, "semibold");
        assert_eq!(restored.table_font_family, "inter");
        assert_eq!(restored.table_font_size, 14);
        assert_eq!(restored.table_font_weight, "semibold");
        assert_eq!(restored.font_color, "#33ccff");
        assert!(!restored.meeting_minutes_use_notes);
        assert_eq!(
            restored.template_notes,
            Some("# Notes template".to_string())
        );
    }

    #[test]
    fn test_custom_context_deserialization() {
        let json_str = r#"{
            "user_profile_name": "Nguyen Quoc Tuyen",
            "user_profile_nickname": "Terry",
            "user_profile_company": "Relipa",
            "meeting_minutes_use_project_context": true,
            "custom_context": {
                "domain": "medical",
                "general": [
                    { "key": "project", "value": "AI Translator" }
                ],
                "terms": ["Kubernetes", "gRPC"],
                "text": "Meeting about infrastructure",
                "translation_terms": [
                    { "source": "CT", "target": "chụp cắt lớp" }
                ]
            }
        }"#;
        let s: Settings = serde_json::from_str(json_str).expect("should parse custom context");
        assert_eq!(s.user_profile_name, "Nguyen Quoc Tuyen");
        assert_eq!(s.user_profile_nickname, "Terry");
        assert_eq!(s.user_profile_company, "Relipa");
        assert!(s.meeting_minutes_use_project_context);
        assert!(s.custom_context.is_some());
        let ctx = s.custom_context.unwrap();
        assert_eq!(ctx.domain.as_deref(), Some("medical"));
        assert_eq!(ctx.general.len(), 1);
        assert_eq!(ctx.general[0].key, "project");
        assert_eq!(ctx.general[0].value, "AI Translator");
        assert_eq!(ctx.terms, vec!["Kubernetes", "gRPC"]);
        assert_eq!(ctx.text.as_deref(), Some("Meeting about infrastructure"));
        assert_eq!(ctx.translation_terms.len(), 1);
        assert_eq!(ctx.translation_terms[0].source, "CT");
        assert_eq!(ctx.translation_terms[0].target, "chụp cắt lớp");
    }
}
