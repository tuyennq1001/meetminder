/// Google Free TTS — the internal android-tts network endpoint (speech-api/v2/synthesize).
/// Free because it reuses a public android-tts API key supplied at build time via `.env`
/// (GOOGLE_FREE_TTS_KEY). The endpoint returns MP3 (audio/mpeg) and accepts only `lang`
/// (no per-voice selection) — so one voice per language (vi-VN / en-US).
///
/// SECURITY: the key is embedded at compile time, never logged. `.env` keeps it out of
/// source/git; it is still present in the shipped binary (accepted trade-off).
use base64::Engine as _;

use super::http_client;

/// Build-time key from `.env` via build.rs (`cargo:rustc-env`). None if not configured.
const API_KEY: Option<&str> = option_env!("GOOGLE_FREE_TTS_KEY");

const ENDPOINT: &str = "https://www.google.com/speech-api/v2/synthesize";

/// Synthesize `text` in `lang` (e.g. "vi-VN" / "en-US"). Returns base64 MP3.
#[tauri::command]
pub async fn google_free_tts_speak(text: String, lang: String) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("Empty text".into());
    }
    let key = API_KEY.ok_or(
        "Google Free TTS not configured (GOOGLE_FREE_TTS_KEY missing at build time)",
    )?;

    // .query() percent-encodes every value — never format! untrusted text into the URL.
    let build_req = || {
        http_client::shared()
            .get(ENDPOINT)
            .query(&[
                ("enc", "mpeg"),
                ("client", "android-tts"),
                ("lang", lang.as_str()),
                ("text", text.as_str()),
                ("key", key),
            ])
            .send()
    };

    // 1x retry on transport error only; a non-success status is terminal.
    let resp = match build_req().await {
        Ok(r) => r,
        Err(_) => build_req()
            .await
            .map_err(|e| format!("Google Free request failed: {}", redact(&e.to_string())))?,
    };

    if !resp.status().is_success() {
        return Err(format!("Google Free HTTP {}", resp.status().as_u16()));
    }
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if !ct.starts_with("audio/") {
        return Err(format!("Google Free returned non-audio response ({ct})"));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Google Free read failed: {}", redact(&e.to_string())))?;
    if bytes.is_empty() {
        return Err("Google Free returned empty audio".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Strip the API key from any error string before it reaches logs/UI.
fn redact(s: &str) -> String {
    match API_KEY {
        Some(k) if !k.is_empty() => s.replace(k, "***"),
        _ => s.to_string(),
    }
}
