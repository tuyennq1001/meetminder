// Plays a continuous stream of 24kHz s16le mono PCM chunks via Web Audio API.
// Each chunk plays as soon as it arrives, scheduled tight via AudioBufferSourceNode.

const SAMPLE_RATE = 24000;
const MAX_BUFFER_AHEAD_SEC = 2.0;

export class OpenAiAudioOutputQueue {
    constructor() {
        this.ctx = null;
        this.gainNode = null;
        this.nextStartTime = 0;
        this.muted = false;
    }

    _ensureContext() {
        if (!this.ctx) {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            this.ctx = new Ctor({ sampleRate: SAMPLE_RATE });
            this.gainNode = this.ctx.createGain();
            this.gainNode.connect(this.ctx.destination);
            this.nextStartTime = this.ctx.currentTime;
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    push(base64Pcm) {
        if (this.muted) return;
        this._ensureContext();

        const binStr = atob(base64Pcm);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

        const buf = this.ctx.createBuffer(1, float32.length, SAMPLE_RATE);
        buf.copyToChannel(float32, 0);

        const now = this.ctx.currentTime;
        // Drop chunk if backend is sending faster than playback can drain
        if (this.nextStartTime - now > MAX_BUFFER_AHEAD_SEC) {
            console.warn('[OpenAI audio] dropping chunk — buffer too far ahead');
            return;
        }

        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.gainNode);
        const startAt = Math.max(now, this.nextStartTime);
        src.start(startAt);
        this.nextStartTime = startAt + buf.duration;
    }

    setMuted(m) {
        this.muted = m;
        if (this.gainNode) this.gainNode.gain.value = m ? 0 : 1;
    }

    flush() {
        if (this.ctx) this.nextStartTime = this.ctx.currentTime;
    }

    close() {
        if (this.ctx) {
            this.ctx.close().catch(() => {});
            this.ctx = null;
            this.gainNode = null;
        }
    }
}
