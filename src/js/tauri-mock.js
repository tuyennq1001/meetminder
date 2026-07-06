/**
 * Mock Tauri APIs for browser-only UI testing (dev server on :3111).
 * Loaded before app.js. Dev-only: activates ONLY when the real Tauri runtime is
 * absent AND we are on the dev port — so it can never shadow window.__TAURI__ in the
 * packaged app (production origin is tauri://localhost or http://tauri.localhost, no :3111).
 */

if (!window.__TAURI__ && location.port === '3111') {
    console.warn('[tauri-mock] Browser dev mode — Tauri APIs are mocked');

    const mockSettings = {
        translation_mode: 'soniox',
        source_language: 'auto',
        target_language: 'vi',
        soniox_api_key: '',
        elevenlabs_api_key: '',
        google_tts_api_key: '',
        openai_api_key: '',
        qwen_api_key: '',
        tts_provider: 'edge',
        edge_tts_voice: 'vi-VN-HoaiMyNeural',
        edge_tts_speed: 50,
        google_tts_voice: 'vi-VN-Chirp3-HD-Aoede',
        google_tts_speed: 1.0,
        // New free online providers (Trudio-style)
        microsoft_v2_voice: 'vi-VN-HoaiMyNeural',
        microsoft_v2_speed: 20,
        google_free_voice: 'vi-VN',
        tiktok_voice: 'BV074_streaming',
        tiktok_session_id: '',
        font_size: 16,
    };

    // Sample voices so the Microsoft v2 dynamic-populate path can be exercised in-browser.
    const mockMsVoices = JSON.stringify([
        { short_name: 'vi-VN-HoaiMyNeural', friendly_name: 'HoaiMy', gender: 'Female', locale: 'vi-VN' },
        { short_name: 'vi-VN-NamMinhNeural', friendly_name: 'NamMinh', gender: 'Male', locale: 'vi-VN' },
        { short_name: 'en-US-JennyNeural', friendly_name: 'Jenny', gender: 'Female', locale: 'en-US' },
        { short_name: 'en-US-GuyNeural', friendly_name: 'Guy', gender: 'Male', locale: 'en-US' },
        { short_name: 'en-GB-SoniaNeural', friendly_name: 'Sonia', gender: 'Female', locale: 'en-GB' },
    ]);

    window.__TAURI__ = {
        core: {
            invoke: async (cmd, args) => {
                console.log('[tauri-mock] invoke:', cmd, args);
                switch (cmd) {
                    case 'get_settings':
                        return mockSettings;
                    case 'save_settings':
                        Object.assign(mockSettings, args?.newSettings || {});
                        return null;
                    case 'get_platform_info':
                        return { os: 'macos', arch: 'aarch64' };
                    case 'microsoft_list_voices':
                        return mockMsVoices;
                    // TTS synth commands: no audio in browser mode, return empty base64.
                    case 'edge_tts_speak':
                    case 'google_free_tts_speak':
                    case 'tiktok_tts_speak':
                        return '';
                    case 'start_capture':
                    case 'stop_capture':
                    case 'start_mic_capture':
                    case 'stop_mic_capture':
                        return null;
                    case 'list_transcripts':
                        return [];
                    case 'check_update':
                        return null;
                    default:
                        console.warn('[tauri-mock] unhandled command:', cmd);
                        return null;
                }
            },
            Channel: class {
                constructor() { this.onmessage = null; }
            },
        },
        window: {
            getCurrentWindow: () => ({
                setAlwaysOnTop: async () => {},
                outerPosition: async () => ({ x: 100, y: 100 }),
                innerSize: async () => ({ width: 800, height: 600 }),
                setPosition: async () => {},
                setSize: async () => {},
                close: async () => { window.close(); },
                minimize: async () => {},
                toggleMaximize: async () => {},
            }),
        },
    };
}
