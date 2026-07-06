/**
 * Google Free TTS — android-tts endpoint via Rust (`google_free_tts_speak`).
 * Free, no user API key (key embedded at build time). Endpoint accepts only a language,
 * so one voice per language: vi-VN / en-US. Returns base64 MP3.
 *
 * Same provider contract as edge-tts.js. Bounded queue with drop-oldest.
 */

const { invoke } = window.__TAURI__.core;

const MAX_QUEUE = 10;

class GoogleFreeTTS {
    constructor() {
        this.lang = 'vi-VN'; // "voice" here IS the language token
        this.isConnected = false;
        this._queue = [];
        this._isSpeaking = false;

        this.onAudioChunk = null;
        this.onError = null;
        this.onStatusChange = null;
    }

    configure({ voice }) {
        if (voice) this.lang = voice;
    }

    connect() {
        this.isConnected = true;
        this._setStatus('connected');
    }

    speak(text) {
        if (!text?.trim()) return;
        this._queue.push(text.trim());
        while (this._queue.length > MAX_QUEUE) this._queue.shift();
        if (!this._isSpeaking) this._processQueue();
    }

    async _processQueue() {
        if (this._queue.length === 0) {
            this._isSpeaking = false;
            return;
        }
        this._isSpeaking = true;
        const text = this._queue.shift();
        try {
            const base64Audio = await invoke('google_free_tts_speak', {
                text,
                lang: this.lang || 'vi-VN',
            });
            if (this.onAudioChunk) this.onAudioChunk(base64Audio, true);
        } catch (err) {
            console.error('[Google Free TTS] Error:', err);
            this.onError?.(`Google Free TTS: ${err}`);
        }
        this._processQueue();
    }

    disconnect() {
        this._queue = [];
        this._isSpeaking = false;
        this.isConnected = false;
        this._setStatus('disconnected');
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}

export const googleFreeTTS = new GoogleFreeTTS();
