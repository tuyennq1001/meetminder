#[test]
fn test_settings_load() {
    let settings = my_translator_lib::settings::Settings::load();
    println!("API key present: {}", !settings.gemini_api_key.is_empty());
    println!("Selected model: {}", settings.gemini_model);
    assert!(!settings.gemini_api_key.is_empty());
}

#[test]
fn test_mic_capture_init() {
    let mut mic = my_translator_lib::audio::microphone::MicCapture::new();
    match mic.start() {
        Ok(rx) => {
            println!("Mic started successfully!");
            // Wait up to 500ms for samples
            let start = std::time::Instant::now();
            let mut got_data = false;
            while start.elapsed() < std::time::Duration::from_millis(500) {
                if let Ok(data) = rx.recv_timeout(std::time::Duration::from_millis(50)) {
                    println!("Received {} bytes from mic!", data.len());
                    got_data = true;
                    break;
                }
            }
            mic.stop();
            println!("Mic test completed, got data: {}", got_data);
        }
        Err(e) => {
            println!("Mic start err (expected in CI/headless without input device): {}", e);
        }
    }
}

#[test]
fn test_system_audio_capture() {
    let mut sys = my_translator_lib::audio::system_audio::SystemAudioCapture::new();
    match sys.start() {
        Ok(rx) => {
            println!("System audio started successfully!");
            let start = std::time::Instant::now();
            let mut got_data = false;
            while start.elapsed() < std::time::Duration::from_millis(800) {
                if let Ok(data) = rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    println!("Received {} bytes from system audio!", data.len());
                    got_data = true;
                    break;
                }
            }
            sys.stop();
            println!("System audio test completed, got data: {}", got_data);
        }
        Err(e) => {
            println!("System audio start err (e.g. Screen Recording permission needed in CLI): {}", e);
        }
    }
}
