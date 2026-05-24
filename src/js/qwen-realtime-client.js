// Qwen-Omni Realtime translate WebSocket client (via Tauri Rust backend).
// Mirrors openai-realtime-client.js so app.js wiring is symmetric.
// Rust side handles WS + client-side RMS-VAD turn control (variant K).

const { invoke, Channel } = window.__TAURI__.core;

export class QwenRealtimeClient {
    constructor() {
        this.sessionId = null;
        this.channel = null;
        this.outputQueue = null;
        this.isConnected = false;

        this.onStatusChange = () => {};
        this.onSegment = () => {};
        this.onProvisional = () => {};
        this.onSourceProvisional = () => {};
        this.onError = () => {};
        this.onClosed = () => {};

        this._provisionalBuffer = '';
        this._sourceBuffer = '';
        // Queue of finalized source-language transcripts waiting to be paired
        // with the next translated target final (independent cadences).
        this._pendingSourceFinals = [];
        this._muted = false;
        // Tracks the most recent finalized target text so flushPending (on
        // disconnect) doesn't re-emit it from a stale provisional buffer.
        this._lastFinalTarget = '';
        this._lastFinalSource = '';
    }

    setMuted(muted) {
        this._muted = !!muted;
        if (this._muted) this.outputQueue?.flush();
    }

    async connect(cfg, outputQueue) {
        this.outputQueue = outputQueue;
        this._muted = cfg.audioOutput === false;
        this.channel = new Channel();
        this.channel.onmessage = (evt) => this._handleEvent(evt);

        try {
            this.sessionId = await invoke('qwen_realtime_start', {
                config: {
                    api_key: cfg.apiKey,
                    target_language: cfg.targetLanguage,
                    target_language_name: cfg.targetLanguageName,
                    audio_output: cfg.audioOutput !== false,
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
        try {
            while (this._pendingSourceFinals.length > 1) {
                this.onSegment(this._pendingSourceFinals.shift(), '');
            }
            const tgt = this._provisionalBuffer;
            const src = this._pendingSourceFinals.shift() || this._sourceBuffer;
            this._provisionalBuffer = '';
            this._sourceBuffer = '';
            // Suppress flush if the buffered target/source is just a tail-end
            // delta of the last finalized segment (Qwen keeps streaming
            // audio_transcript deltas a tick after response.text.done).
            const tgtIsDuplicate = tgt && this._lastFinalTarget &&
                (tgt === this._lastFinalTarget || this._lastFinalTarget.endsWith(tgt));
            const srcIsDuplicate = src && this._lastFinalSource &&
                (src === this._lastFinalSource || this._lastFinalSource.endsWith(src));
            if (tgtIsDuplicate && (srcIsDuplicate || !src)) return;
            if (tgt || src) this.onSegment(src, tgt);
        } catch (e) {
            console.error('[Qwen flush]', e);
        }
    }

    async disconnect() {
        if (!this.isConnected) return;
        this.isConnected = false;
        this.flushPending();
        try {
            await invoke('qwen_realtime_stop', { sessionId: this.sessionId });
        } catch {}
        this.outputQueue?.flush();
    }

    _handleEvent(evt) {
        switch (evt.type) {
            case 'status':
                this.onStatusChange(evt.state, evt.message);
                break;
            case 'transcript':
                if (evt.is_final) {
                    const sourceText =
                        this._pendingSourceFinals.shift() || this._sourceBuffer;
                    this._provisionalBuffer = '';
                    this._sourceBuffer = '';
                    this._lastFinalTarget = evt.text || '';
                    this._lastFinalSource = sourceText || '';
                    this.onSegment(sourceText, evt.text);
                } else {
                    this._provisionalBuffer += evt.text;
                    this.onProvisional(this._provisionalBuffer);
                }
                break;
            case 'source_transcript':
                if (evt.is_final) {
                    this._pendingSourceFinals.push(evt.text);
                    this._sourceBuffer = '';
                    this.onSourceProvisional(evt.text);
                } else {
                    this._sourceBuffer += evt.text;
                    this.onSourceProvisional(this._sourceBuffer);
                }
                break;
            case 'audio_chunk':
                if (!this._muted) this.outputQueue?.push(evt.pcm_base64);
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
