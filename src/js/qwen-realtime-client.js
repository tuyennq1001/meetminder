// Qwen LiveTranslate Flash realtime client (via Tauri Rust backend).
// Mirrors my-translator-mobile's QwenRealtimeClient (text-only, server-VAD).
//
// IMPORTANT: provisional events carry the full text snapshot (committed +
// stash) — assign, do NOT concatenate. Live Flash does not emit deltas.

const { invoke, Channel } = window.__TAURI__.core;

export class QwenRealtimeClient {
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
            this.sessionId = await invoke('qwen_realtime_start', {
                config: {
                    api_key: cfg.apiKey,
                    source_language: cfg.sourceLanguage || 'en',
                    target_language: cfg.targetLanguage,
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
            await invoke('qwen_realtime_send_audio', {
                sessionId: this.sessionId,
                pcm: bytes,
            });
        } catch (err) {
            console.warn('[Qwen Realtime] send audio failed:', err);
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
            await invoke('qwen_realtime_stop', { sessionId: this.sessionId });
        } catch {}
    }

    _handleEvent(evt) {
        switch (evt.type) {
            case 'status':
                this.onStatusChange(evt.state, evt.message);
                break;
            case 'transcript':
                if (evt.is_final) {
                    this._provisionalBuffer = '';
                    // Live Flash exposes only translation — no source side.
                    this.onSegment('', evt.text);
                } else {
                    // Full snapshot (committed + stash). Assign, don't concat.
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
