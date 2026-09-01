// Google Gemini Multimodal Live realtime client (via Tauri Rust backend).
// Uses WebSocket streaming to generativelanguage.googleapis.com with Gemini 2.0 Flash.

const { invoke, Channel } = window.__TAURI__.core;

export class GeminiRealtimeClient {
    constructor() {
        this.sessionId = null;
        this.channel = null;
        this.isConnected = false;

        this.onStatusChange = () => {};
        this.onSegment = () => {};
        this.onProvisional = () => {};
        this.onError = () => {};
        this.onClosed = () => {};

        this._provisionalBuffer = '';
    }

    async connect(cfg) {
        this.channel = new Channel();
        this.channel.onmessage = (evt) => this._handleEvent(evt);

        try {
            this.sessionId = await invoke('gemini_realtime_start', {
                config: {
                    api_key: cfg.apiKey,
                    source_language: cfg.sourceLanguage || 'auto',
                    target_language: cfg.targetLanguage || 'vi',
                    model: cfg.model || null,
                },
                onEvent: this.channel,
            });
            this.isConnected = true;
        } catch (err) {
            this.onError('connect_failed', String(err));
            throw err;
        }
    }

    async sendAudio(arrayBuffer) {
        if (!this.isConnected || this.sessionId == null) return;
        const bytes = Array.from(new Uint8Array(arrayBuffer));
        try {
            await invoke('gemini_realtime_send_audio', {
                sessionId: this.sessionId,
                pcm: bytes,
            });
        } catch (err) {
            console.warn('[Gemini Realtime] send audio failed:', err);
        }
    }

    async setTargetLanguage(targetLang) {
        if (!this.isConnected || this.sessionId == null) return;
        try {
            await invoke('gemini_realtime_set_target_lang', {
                sessionId: this.sessionId,
                targetLang,
            });
            console.log('[Gemini Realtime] Switched target language to:', targetLang);
        } catch (e) {
            console.warn('[Gemini Realtime] failed to set target language:', e);
        }
    }

    flushPending() {
        const tgt = this._provisionalBuffer;
        this._provisionalBuffer = '';
        if (tgt) this.onSegment('', tgt);
    }

    async disconnect() {
        if (!this.isConnected) return;
        this.isConnected = false;
        this.flushPending();
        try {
            await invoke('gemini_realtime_stop', { sessionId: this.sessionId });
        } catch {}
    }

    _handleEvent(evt) {
        switch (evt.type) {
            case 'status':
                this.onStatusChange(evt.state, evt.message);
                break;
            case 'segment':
                this._provisionalBuffer = '';
                this.onSegment(evt.original, evt.translation);
                break;
            case 'transcript':
                if (evt.is_final) {
                    this._provisionalBuffer = '';
                    this.onSegment('', evt.text);
                } else {
                    this._provisionalBuffer = evt.text;
                    this.onProvisional(this._provisionalBuffer);
                }
                break;
            case 'error':
                this.onError(evt.code, evt.message);
                break;
            case 'closed':
                this.isConnected = false;
                this.onClosed(evt.reason);
                break;
        }
    }
}
