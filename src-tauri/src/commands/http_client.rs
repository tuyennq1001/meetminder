/// Shared reqwest client for the online TTS providers (Google Free, TikTok, Microsoft list).
/// One pooled client (keep-alive) with a 10s default timeout so a hung socket can never
/// block the TTS queue forever. TikTok overrides to a tighter per-request timeout for
/// bounded host-mirror failover.
use std::sync::OnceLock;
use std::time::Duration;

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// Returns the process-wide shared HTTP client (built on first use).
pub fn shared() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("failed to build shared reqwest client")
    })
}
