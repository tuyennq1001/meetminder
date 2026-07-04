/// Edge TTS — proxy WebSocket through Rust to avoid browser header limitations.
/// Implements the DRM token generation required by Microsoft's TTS service.
use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use sha2::{Digest, Sha256};
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

const BASE_URL: &str =
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION: &str = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION: &str = "143";
const WIN_EPOCH: i64 = 11644473600;

/// Generate the Sec-MS-GEC token value (DRM).
/// Based on: https://github.com/rany2/edge-tts/blob/master/src/edge_tts/drm.py
fn generate_sec_ms_gec() -> String {
    let now = chrono::Utc::now().timestamp();

    // Convert to Windows file time epoch and round down to nearest 5 minutes
    let mut ticks = now + WIN_EPOCH;
    ticks -= ticks % 300;

    // Convert to 100-nanosecond intervals (Windows file time format)
    let ticks_ns = (ticks as f64) * 1e7;

    // Hash: ticks + trusted client token
    let str_to_hash = format!("{:.0}{}", ticks_ns, TRUSTED_CLIENT_TOKEN);
    let mut hasher = Sha256::new();
    hasher.update(str_to_hash.as_bytes());
    let result = hasher.finalize();

    // Return uppercase hex digest
    hex::encode_upper(result)
}

/// Generate a random MUID cookie value.
fn generate_muid() -> String {
    let bytes: [u8; 16] = rand::random();
    hex::encode_upper(bytes)
}

/// Synthesize text using Edge TTS. Returns base64-encoded MP3 audio.
#[tauri::command]
pub async fn edge_tts_speak(text: String, voice: String, rate: i32) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("Empty text".into());
    }

    let request_id = Uuid::new_v4().to_string().replace('-', "");
    let sec_ms_gec = generate_sec_ms_gec();
    let sec_ms_gec_version = format!("1-{}", CHROMIUM_FULL_VERSION);
    let muid = generate_muid();

    let url = format!(
        "{}?TrustedClientToken={}&ConnectionId={}&Sec-MS-GEC={}&Sec-MS-GEC-Version={}",
        BASE_URL, TRUSTED_CLIENT_TOKEN, request_id, sec_ms_gec, sec_ms_gec_version
    );

    // Let tungstenite build base request from URL (handles Host, WS headers),
    // then inject our custom headers.
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("Failed to build request: {}", e))?;

    let headers = request.headers_mut();
    headers.insert(
        "Origin",
        "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
            .parse()
            .unwrap(),
    );
    headers.insert(
        "User-Agent",
        format!(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{}.0.0.0 Safari/537.36 Edg/{}.0.0.0",
            CHROMIUM_MAJOR_VERSION, CHROMIUM_MAJOR_VERSION
        ).parse().unwrap(),
    );
    headers.insert("Pragma", "no-cache".parse().unwrap());
    headers.insert("Cache-Control", "no-cache".parse().unwrap());
    headers.insert(
        "Accept-Encoding",
        "gzip, deflate, br, zstd".parse().unwrap(),
    );
    headers.insert("Accept-Language", "en-US,en;q=0.9".parse().unwrap());
    headers.insert("Cookie", format!("muid={};", muid).parse().unwrap());

    let (ws, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| format!("WebSocket connect failed: {}", e))?;

    let (mut write, mut read) = ws.split();

    // 1. Send speech config
    let timestamp = chrono::Utc::now()
        .format("%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)")
        .to_string();

    let config_msg = format!(
        "X-Timestamp:{}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n\
         {{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataoptions\":\
         {{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"}},\
         \"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}}}}}",
        timestamp
    );
    write
        .send(Message::Text(config_msg.into()))
        .await
        .map_err(|e| format!("Send config failed: {}", e))?;

    // 2. Send SSML
    let escaped_text = text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");

    let rate_str = if rate >= 0 {
        format!("+{}%", rate)
    } else {
        format!("{}%", rate)
    };

    let ssml = format!(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\
         <voice name='{}'>\
         <prosody pitch='+0Hz' rate='{}' volume='+0%'>{}</prosody>\
         </voice></speak>",
        voice, rate_str, escaped_text
    );

    let ssml_msg = format!(
        "X-RequestId:{}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:{}Z\r\nPath:ssml\r\n\r\n{}",
        Uuid::new_v4().to_string().replace('-', ""),
        chrono::Utc::now()
            .format("%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)"),
        ssml
    );
    write
        .send(Message::Text(ssml_msg.into()))
        .await
        .map_err(|e| format!("Send SSML failed: {}", e))?;

    // 3. Collect audio data
    let mut audio_data: Vec<u8> = Vec::new();
    let mut got_turn_end = false;

    while let Some(msg_result) = read.next().await {
        match msg_result {
            Ok(Message::Binary(data)) => {
                // Binary messages: 2 bytes header length (big endian) + header + audio
                if data.len() > 2 {
                    let header_len = u16::from_be_bytes([data[0], data[1]]) as usize;
                    if data.len() > 2 + header_len {
                        audio_data.extend_from_slice(&data[2 + header_len..]);
                    }
                }
            }
            Ok(Message::Text(text)) => {
                let text_str: &str = text.as_ref();
                if text_str.contains("Path:turn.end") {
                    got_turn_end = true;
                    break;
                }
            }
            Ok(Message::Close(_)) => break,
            Err(e) => {
                return Err(format!("WebSocket error: {}", e));
            }
            _ => {}
        }
    }

    // Close
    let _ = write.send(Message::Close(None)).await;

    if !got_turn_end && audio_data.is_empty() {
        return Err("No audio received from Edge TTS".into());
    }

    // Return base64
    let b64 = base64::engine::general_purpose::STANDARD.encode(&audio_data);
    Ok(b64)
}
