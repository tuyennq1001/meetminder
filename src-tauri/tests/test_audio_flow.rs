#[test]
fn test_settings_load() {
    let settings = meet_minder_lib::settings::Settings::load();
    println!("API key present: {}", !settings.gemini_api_key.is_empty());
    println!("Selected model: {}", settings.gemini_model);
    assert!(!settings.gemini_api_key.is_empty());
}

#[test]
#[ignore = "requires a real microphone and macOS microphone permission"]
fn test_mic_capture_init() {
    let mut mic = meet_minder_lib::audio::microphone::MicCapture::new();
    let rx = mic
        .start()
        .expect("microphone stream must open when this hardware test is explicitly run");
    println!("Mic started successfully!");
    // Wait up to 500ms for samples
    let start = std::time::Instant::now();
    let mut got_data = false;
    while start.elapsed() < std::time::Duration::from_millis(500) {
        if let Ok(data) = rx.recv_timeout(std::time::Duration::from_millis(50)) {
            println!("Received {} bytes from mic!", data.len());
            got_data = !data.is_empty();
            if got_data {
                break;
            }
        }
    }
    mic.stop();
    assert!(got_data, "microphone stream opened but produced no samples");
}

#[test]
#[ignore = "requires ScreenCaptureKit and Screen Recording permission"]
fn test_system_audio_capture() {
    let mut sys = meet_minder_lib::audio::system_audio::SystemAudioCapture::new();
    let rx = sys
        .start()
        .expect("system audio stream must open when this hardware test is explicitly run");
    println!("System audio started successfully!");
    let start = std::time::Instant::now();
    let mut got_data = false;
    while start.elapsed() < std::time::Duration::from_millis(800) {
        if let Ok(data) = rx.recv_timeout(std::time::Duration::from_millis(100)) {
            println!("Received {} bytes from system audio!", data.len());
            got_data = !data.is_empty();
            if got_data {
                break;
            }
        }
    }
    sys.stop();
    assert!(got_data, "system audio stream opened but produced no samples");
}
