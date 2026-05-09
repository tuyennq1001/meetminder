# Phase 3 — Frontend JS Client + Audio Output Queue

**Status:** ☑ Done
**Estimate:** 3h
**Owner:** Frontend
**Depends on:** phase 2

## Overview

Create a JS wrapper module that mirrors the Soniox client's callback shape (so `app.js` can swap between providers with minimal branching). Add a Web Audio API output queue that plays incoming 24kHz PCM chunks as they stream in.

## Related code files

- CREATE: `src/js/openai-realtime-client.js` — main wrapper, mirrors [src/js/soniox.js](../../src/js/soniox.js) interface
- CREATE: `src/js/openai-audio-output-queue.js` — Web Audio API PCM player for stream
- REFERENCE: [src/js/soniox.js](../../src/js/soniox.js) — callback names to mirror
- REFERENCE: [src/js/audio-player.js](../../src/js/audio-player.js) — existing TTS player; do NOT reuse, OpenAI stream needs lower-latency continuous playback

## Architecture

```
app.js                openai-realtime-client.js          Rust backend
──────                ──────────────────────────         ────────────
client.connect(cfg)
                     invoke('openai_realtime_start')   →
                     ← session_id (number)
                     register Channel.onmessage
                       ↓ events arrive
                     onTranscript(delta) ─→ ui.addTranslation
                     onAudioChunk(b64)  ─→ outputQueue.push(b64)
                     onError ─→ ui.error
                     onClosed ─→ schedule reconnect

client.sendAudio(buf) → invoke('openai_realtime_send_audio', { pcm })

client.disconnect()   → invoke('openai_realtime_stop')
```

## Implementation

### 1. `openai-realtime-client.js`

```js
// OpenAI Realtime Translate WebSocket client (via Tauri Rust backend).
// Public callback API mirrors src/js/soniox.js so app.js can branch on provider.

const { invoke, Channel } = window.__TAURI__.core;

export class OpenAiRealtimeClient {
    constructor() {
        this.sessionId = null;
        this.channel = null;
        this.outputQueue = null;  // injected from outside (audio queue)
        this.isConnected = false;

        // Callbacks (set by app.js)
        this.onStatusChange = (state, msg) => {};
        this.onOriginal = (text, speaker, lang) => {};
        this.onTranslation = (text) => {};
        this.onProvisional = (text) => {};
        this.onError = (code, msg) => {};
        this.onClosed = (reason) => {};
    }

    /**
     * @param {Object} cfg
     * @param {string} cfg.apiKey
     * @param {string} cfg.sourceLanguage  ISO 639-1, "auto" allowed
     * @param {string} cfg.targetLanguage  ISO 639-1, must be in 13 supported
     * @param {string} [cfg.voice]         e.g. "alloy"
     * @param {Object} outputQueue         OpenAiAudioOutputQueue instance
     */
    async connect(cfg, outputQueue) {
        this.outputQueue = outputQueue;
        this.channel = new Channel();
        this.channel.onmessage = (evt) => this._handleEvent(evt);

        try {
            this.sessionId = await invoke('openai_realtime_start', {
                config: {
                    api_key: cfg.apiKey,
                    source_language: cfg.sourceLanguage || 'auto',
                    target_language: cfg.targetLanguage,
                    voice: cfg.voice || null,
                },
                onEvent: this.channel,
            });
            this.isConnected = true;
            this.onStatusChange('connected');
        } catch (err) {
            this.onError('connect_failed', String(err));
            throw err;
        }
    }

    async sendAudio(arrayBuffer) {
        if (!this.isConnected) return;
        const bytes = Array.from(new Uint8Array(arrayBuffer));
        try {
            await invoke('openai_realtime_send_audio', {
                sessionId: this.sessionId,
                pcm: bytes,
            });
        } catch (err) {
            console.warn('[OpenAI Realtime] send audio failed:', err);
        }
    }

    async disconnect() {
        if (!this.isConnected) return;
        this.isConnected = false;
        try {
            await invoke('openai_realtime_stop', { sessionId: this.sessionId });
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
                    this.onTranslation(evt.text);
                } else {
                    this.onProvisional(evt.text);
                }
                break;
            case 'audio_chunk':
                this.outputQueue?.push(evt.pcm_base64);
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
```

### 2. `openai-audio-output-queue.js`

```js
// Plays a continuous stream of 24kHz s16le mono PCM chunks via Web Audio API.
// Designed for low-latency speech: each chunk plays as soon as it arrives;
// chunks chained tightly via AudioBufferSourceNode scheduling.

const SAMPLE_RATE = 24000;

export class OpenAiAudioOutputQueue {
    constructor() {
        this.ctx = null;
        this.nextStartTime = 0;
        this.gainNode = null;
        this.muted = false;
    }

    _ensureContext() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: SAMPLE_RATE,
            });
            this.gainNode = this.ctx.createGain();
            this.gainNode.connect(this.ctx.destination);
            this.nextStartTime = this.ctx.currentTime;
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    /**
     * @param {string} base64Pcm  base64-encoded s16le 24kHz mono
     */
    push(base64Pcm) {
        if (this.muted) return;
        this._ensureContext();

        // Decode base64 → Uint8Array → Int16Array → Float32Array
        const binStr = atob(base64Pcm);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

        const buf = this.ctx.createBuffer(1, float32.length, SAMPLE_RATE);
        buf.copyToChannel(float32, 0);

        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.gainNode);

        // Schedule tightly: if we're behind, restart from now (avoid drift).
        const now = this.ctx.currentTime;
        const startAt = Math.max(now, this.nextStartTime);
        src.start(startAt);
        this.nextStartTime = startAt + buf.duration;
    }

    setMuted(m) {
        this.muted = m;
        if (this.gainNode) this.gainNode.gain.value = m ? 0 : 1;
    }

    flush() {
        // Reset schedule cursor so next push plays immediately.
        this.nextStartTime = this.ctx ? this.ctx.currentTime : 0;
    }

    close() {
        if (this.ctx) {
            this.ctx.close().catch(() => {});
            this.ctx = null;
        }
    }
}
```

### 3. Notes on integration

- **AudioContext gating**: browsers (and Tauri WebView) require user gesture before audio can play. The Start button in the app counts as a gesture, so calling `_ensureContext` after click works.
- **Drift handling**: if backend pauses (e.g. VAD silence), `nextStartTime` may diverge from `ctx.currentTime`. The `Math.max(now, nextStartTime)` clamp keeps it sane. If the gap is > 1s, just restart timeline.
- **No audioPlayer reuse**: existing [audio-player.js](../../src/js/audio-player.js) is built for full-utterance TTS playback (queue of base64 MP3/Opus). OpenAI gives raw PCM streamed at 24kHz; needs different scheduler.

## Todo list

- [ ] Create `src/js/openai-realtime-client.js`
- [ ] Create `src/js/openai-audio-output-queue.js`
- [ ] Add `<script type="module">` import or normal script tag in `index.html` (match how soniox.js is loaded)
- [ ] Manual smoke test: open browser dev tools, instantiate client, hit `connect()` with placeholder cfg → expect "not implemented" error from phase 1 stub or working response after phase 2

## Success criteria

- Module loads without errors in Tauri WebView console.
- Client `connect()` triggers `invoke('openai_realtime_start')` with correct args.
- Audio queue plays a known test PCM (24kHz sine wave Base64) audibly via speakers.
- Callbacks fire when backend events arrive (verify via console.log shim).

## Risks

- **WebView AudioContext sample rate**: some platforms may not honor `sampleRate: 24000` and resample silently. Acceptable — slight quality loss, no crash.
- **Backpressure**: if backend sends faster than playback can consume, `nextStartTime` grows unbounded. Add a cap: if `(nextStartTime - now) > 2.0`, drop incoming chunks (log warning). Acceptable v1; defer hard backpressure.

## Next steps

→ Phase 4 wires this into Settings UI + app.js start() flow + provider dropdown.
