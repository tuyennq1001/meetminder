/// Microsoft v2 (Edge) TTS — dynamic voice list.
/// Synthesis reuses `edge_tts::edge_tts_speak` (same readaloud/edge/v1 endpoint). This module
/// only adds the "fetch all voices" capability that Trudio's Microsoft tab provides.
/// The list endpoint returns 200 with just the trusted client token (no Sec-MS-GEC needed —
/// verified live; DRM is only required for synthesis, which edge_tts.rs already handles).
use super::http_client;
use serde::{Deserialize, Serialize};

const VOICES_LIST_URL: &str = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";

/// Raw item from Microsoft's voices/list (only the fields we use).
#[derive(Deserialize)]
struct MsVoice {
    #[serde(rename = "ShortName")]
    short_name: String,
    #[serde(rename = "Gender")]
    gender: String,
    #[serde(rename = "Locale")]
    locale: String,
    #[serde(rename = "FriendlyName")]
    friendly_name: String,
}

/// Slim shape returned to the frontend.
#[derive(Serialize)]
struct VoiceOption {
    short_name: String,
    friendly_name: String,
    gender: String,
    locale: String,
}

/// Fetch Microsoft voices filtered to Vietnamese + English. Returns JSON array (stringified).
/// On network error returns Err so the frontend falls back to its static vi+en list.
#[tauri::command]
pub async fn microsoft_list_voices() -> Result<String, String> {
    let build_req = || http_client::shared().get(VOICES_LIST_URL).send();

    let resp = match build_req().await {
        Ok(r) => r,
        Err(_) => build_req()
            .await
            .map_err(|e| format!("Microsoft voices/list failed: {e}"))?,
    };
    if !resp.status().is_success() {
        return Err(format!("Microsoft voices/list HTTP {}", resp.status().as_u16()));
    }

    let body = resp
        .bytes()
        .await
        .map_err(|e| format!("Microsoft voices/list read failed: {e}"))?;
    let voices: Vec<MsVoice> = serde_json::from_slice(&body)
        .map_err(|e| format!("Microsoft voices/list parse failed: {e}"))?;

    let filtered: Vec<VoiceOption> = voices
        .into_iter()
        .filter(|v| v.locale.starts_with("vi") || v.locale.starts_with("en"))
        .map(|v| VoiceOption {
            short_name: v.short_name,
            friendly_name: v.friendly_name,
            gender: v.gender,
            locale: v.locale,
        })
        .collect();

    serde_json::to_string(&filtered).map_err(|e| format!("serialize failed: {e}"))
}
