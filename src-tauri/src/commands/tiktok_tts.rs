/// TikTok TTS — unofficial reverse-engineered endpoint. Requires a user-supplied TikTok
/// `sessionid` cookie (a real account session). Request quirks (verified live):
///   - POST to `.../media/api/text/speech/invoke/` — TRAILING SLASH is mandatory (else 404)
///   - empty body / Content-Length: 0 (else 411)
///   - params in query; response JSON: status_code 0 => data.v_str (base64 MP3), else status_msg.
///
/// SECURITY: the sessionid is an account bearer credential — sent only to the host currently
/// being tried, never logged.
use super::http_client;
use std::time::Duration;

/// Hosts confirmed reachable for this route (others in the mirror pool return 404).
const HOSTS: &[&str] = &[
    "api16-normal-useast5.us.tiktokv.com",
    "api16-normal-c-useast2a.tiktokv.com",
    "api19-normal-c-useast1a.tiktokv.com",
];

const USER_AGENT: &str =
    "com.zhiliaoapp.musically/2022600030 (Linux; U; Android 13; en; Pixel 7; Build/TQ2A.230505.002)";

/// Synthesize `text` with TikTok `voice` (e.g. "BV074_streaming"). Returns base64 MP3.
#[tauri::command]
pub async fn tiktok_tts_speak(
    text: String,
    voice: String,
    session_id: String,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("Empty text".into());
    }
    if session_id.trim().is_empty() {
        return Err("TikTok TTS requires a sessionid (Settings → TTS → TikTok)".into());
    }
    // TikTok caps req_text length; keep it well under the ~300 char limit.
    let req_text: String = text.chars().take(280).collect();

    let mut last_err = String::from("all TikTok hosts failed");
    for host in HOSTS {
        let url = format!("https://{host}/media/api/text/speech/invoke/");
        let resp = http_client::shared()
            .post(&url)
            .timeout(Duration::from_secs(3)) // tight per-host bound for failover
            .header(reqwest::header::USER_AGENT, USER_AGENT)
            .header(reqwest::header::COOKIE, format!("sessionid={session_id}"))
            .header(reqwest::header::CONTENT_LENGTH, "0")
            .query(&[
                ("text_speaker", voice.as_str()),
                ("req_text", req_text.as_str()),
                ("speaker_map_type", "0"),
                ("aid", "1233"),
            ])
            .body("")
            .send()
            .await;

        let resp = match resp {
            Ok(r) => r,
            Err(_) => {
                // connect/timeout → try next host
                last_err = "TikTok host unreachable".into();
                continue;
            }
        };
        // 4xx/5xx from a reachable host: terminal for that host, try next.
        if !resp.status().is_success() {
            last_err = format!("TikTok HTTP {}", resp.status().as_u16());
            continue;
        }
        let body = match resp.text().await {
            Ok(b) => b,
            Err(_) => {
                last_err = "TikTok read failed".into();
                continue;
            }
        };
        let json: serde_json::Value = match serde_json::from_str(&body) {
            Ok(j) => j,
            Err(_) => {
                last_err = "TikTok returned invalid JSON".into();
                continue;
            }
        };
        let status_code = json.get("status_code").and_then(|v| v.as_i64()).unwrap_or(-1);
        if status_code != 0 {
            // Auth/quota/bad-param — terminal, do NOT walk more hosts (same result).
            let msg = json
                .get("status_msg")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Err(format!("TikTok: {msg}"));
        }
        if let Some(v_str) = json.get("data").and_then(|d| d.get("v_str")).and_then(|v| v.as_str())
        {
            if !v_str.is_empty() {
                return Ok(v_str.to_string()); // already base64 MP3
            }
        }
        last_err = "TikTok response missing audio".into();
    }
    Err(last_err)
}
