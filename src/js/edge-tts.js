/**
 * Edge TTS — WebSocket streaming client
 * Uses Microsoft Edge's free TTS service (no API key required)
 * Vietnamese voices: vi-VN-HoaiMyNeural (female), vi-VN-NamMinhNeural (male)
 */

class EdgeTTS {
    constructor() {
        this.ws = null;
        this.voice = 'vi-VN-HoaiMyNeural';
        this.rate = '+0%';
        this.pitch = '+0Hz';
        this.volume = '+0%';
        this.isConnected = false;

        // Callbacks (same interface as ElevenLabsTTS)
        this.onAudioChunk = null;   // (base64Audio, isFinal) => void
        this.onError = null;        // (errorMsg) => void
        this.onStatusChange = null; // (status) => void

        this._textQueue = [];
        this._reconnectAttempts = 0;
        this._maxReconnectAttempts = 3;
        this._intentionalClose = false;
        this._audioChunks = [];
        this._currentRequestId = null;

        // Instrumentation
        this._sendTimestamp = null;
        this._stats = { requests: 0, totalTTFB: 0, minTTFB: Infinity, maxTTFB: 0, chunks: 0, totalAudioBytes: 0 };
    }

    /**
     * Configure TTS (call before connect)
     */
    configure({ voice }) {
        if (voice) this.voice = voice;
    }

    /**
     * Generate a unique request ID (mimics Edge browser)
     */
    _generateRequestId() {
        return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, () =>
            Math.floor(Math.random() * 16).toString(16)
        );
    }

    /**
     * Get current date string in Edge format
     */
    _getEdgeDate() {
        return new Date().toUTCString();
    }

    /**
     * Build SSML for the text
     */
    _buildSSML(text, requestId) {
        // Escape XML special characters
        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

        return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='vi-VN'>` +
            `<voice name='${this.voice}'>` +
            `<prosody pitch='${this.pitch}' rate='${this.rate}' volume='${this.volume}'>` +
            `${escaped}` +
            `</prosody></voice></speak>`;
    }

    /**
     * Open WebSocket connection to Edge TTS
     */
    connect() {
        if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
            return;
        }

        this._intentionalClose = false;
        this._setStatus('connecting');

        const connectionId = this._generateRequestId();
        const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`
            + `?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4`
            + `&ConnectionId=${connectionId}`;

        console.log('[EdgeTTS] Connecting...');

        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log('[EdgeTTS] WebSocket connected');
            this.isConnected = true;
            this._reconnectAttempts = 0;

            // Send config message
            const configMsg = `Content-Type:application/json; charset=utf-8\r\n`
                + `Path:speech.config\r\n\r\n`
                + JSON.stringify({
                    context: {
                        synthesis: {
                            audio: {
                                metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                                outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
                            }
                        }
                    }
                });
            this.ws.send(configMsg);

            this._setStatus('connected');
            this._flushQueue();
        };

        this.ws.onmessage = (event) => {
            try {
                if (typeof event.data === 'string') {
                    // Text message — look for turn.start / turn.end
                    if (event.data.includes('Path:turn.start')) {
                        this._audioChunks = [];
                    } else if (event.data.includes('Path:turn.end')) {
                        // All audio received — combine and emit
                        if (this._audioChunks.length > 0 && this.onAudioChunk) {
                            const combined = this._combineAudioChunks();
                            const base64 = this._arrayBufferToBase64(combined);

                            // TTFB for the complete request
                            if (this._sendTimestamp) {
                                const ttfb = performance.now() - this._sendTimestamp;
                                this._stats.requests++;
                                this._stats.totalTTFB += ttfb;
                                this._stats.minTTFB = Math.min(this._stats.minTTFB, ttfb);
                                this._stats.maxTTFB = Math.max(this._stats.maxTTFB, ttfb);
                                console.log(`[EdgeTTS] Complete audio in ${ttfb.toFixed(0)}ms, ${combined.byteLength} bytes`);
                                this._sendTimestamp = null;
                            }

                            this.onAudioChunk(base64, true);
                        }
                        this._audioChunks = [];
                    }
                } else if (event.data instanceof Blob) {
                    // Binary message — audio data
                    event.data.arrayBuffer().then(buffer => {
                        // Edge TTS binary format: 2 bytes header length (big-endian) + header + audio
                        const view = new DataView(buffer);
                        const headerLen = view.getUint16(0);
                        const audioData = buffer.slice(2 + headerLen);

                        if (audioData.byteLength > 0) {
                            this._audioChunks.push(audioData);
                            this._stats.chunks++;
                            this._stats.totalAudioBytes += audioData.byteLength;

                            // Emit first chunk immediately for faster playback start
                            if (this._audioChunks.length === 1 && this.onAudioChunk) {
                                if (this._sendTimestamp) {
                                    const ttfb = performance.now() - this._sendTimestamp;
                                    console.log(`[EdgeTTS] TTFB: ${ttfb.toFixed(0)}ms`);
                                }
                            }
                        }
                    });
                }
            } catch (e) {
                console.warn('[EdgeTTS] Failed to process message:', e);
            }
        };

        this.ws.onerror = (err) => {
            console.error('[EdgeTTS] WebSocket error:', err);
            this.onError?.('Edge TTS connection error');
            this._setStatus('error');
        };

        this.ws.onclose = (event) => {
            console.log(`[EdgeTTS] WebSocket closed: code=${event.code}`);
            this.isConnected = false;

            if (this._intentionalClose) {
                this._setStatus('disconnected');
                return;
            }

            if (this._reconnectAttempts < this._maxReconnectAttempts) {
                this._reconnectAttempts++;
                const delay = this._reconnectAttempts * 2000;
                console.log(`[EdgeTTS] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);
                setTimeout(() => this.connect(), delay);
            } else {
                this._setStatus('disconnected');
                this.onError?.('Edge TTS disconnected after max retries');
            }
        };
    }

    /**
     * Send text to be spoken
     */
    speak(text) {
        if (!text?.trim()) return;

        if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
            this._sendText(text);
        } else {
            this._textQueue.push(text);
            if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
                this.connect();
            }
        }
    }

    /**
     * Send SSML synthesis request
     */
    _sendText(text) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const requestId = this._generateRequestId();
        this._currentRequestId = requestId;
        this._sendTimestamp = performance.now();

        const ssml = this._buildSSML(text, requestId);

        const msg = `X-RequestId:${requestId}\r\n`
            + `Content-Type:application/ssml+xml\r\n`
            + `Path:ssml\r\n\r\n`
            + ssml;

        this.ws.send(msg);
    }

    _flushQueue() {
        while (this._textQueue.length > 0) {
            const text = this._textQueue.shift();
            this._sendText(text);
        }
    }

    /**
     * Combine audio chunks into single ArrayBuffer
     */
    _combineAudioChunks() {
        const totalLen = this._audioChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const combined = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of this._audioChunks) {
            combined.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }
        return combined.buffer;
    }

    /**
     * Convert ArrayBuffer to base64 string
     */
    _arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Gracefully disconnect
     */
    disconnect() {
        this._intentionalClose = true;
        this._textQueue = [];

        if (this._stats.requests > 0) {
            const avgTTFB = this._stats.totalTTFB / this._stats.requests;
            console.log(`[EdgeTTS] Session stats:`);
            console.log(`  Requests: ${this._stats.requests}`);
            console.log(`  TTFB avg: ${avgTTFB.toFixed(0)}ms, min: ${this._stats.minTTFB.toFixed(0)}ms, max: ${this._stats.maxTTFB.toFixed(0)}ms`);
            console.log(`  Audio chunks: ${this._stats.chunks}`);
            console.log(`  Audio data: ${(this._stats.totalAudioBytes / 1024).toFixed(1)}KB`);
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.isConnected = false;
        this._reconnectAttempts = 0;
        this._audioChunks = [];
        this._setStatus('disconnected');
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}

export const edgeTTS = new EdgeTTS();
