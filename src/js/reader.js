/**
 * Reader engine for Read mode. Turns chunks into near-gapless audio without dropping
 * text: sliding-window prefetch, strict in-order playback, no-silent-loss guards
 * (bounded retry, safe watchdog, decode-error advance, stale-generation token).
 *
 * Pure dependency-injection — no window/Tauri/Web-Audio import here, so it stays
 * simple to reason about and test with fakes.
 *
 *   new Reader({ synthesize, player, lookahead, synthTimeoutMs, interChunkDelayMs })
 *     synthesize: (text) => Promise<base64|null>   (may throw; reader retries then errors)
 *     player: { enqueueOrdered(base64, index, onEnded, onDecodeError, onDecoded),
 *               pause(), resume(), stop() }
 *     lookahead: 2 for Local (prefetch), 1 (sequential) for others
 */

import { splitIntoChunks } from './read-chunker.js';

const RETRIES = 2;                 // attempts after the first = 3 total
const BASE_BACKOFF_MS = 400;
const RATE_LIMIT_BACKOFF_MS = 4000;
const WATCHDOG_MARGIN_MS = 4000;   // added to a chunk's decoded duration
const WATCHDOG_FALLBACK_MS = 20000; // before decode duration is known

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRateLimit = (err) => /429|rate.?limit|too many/i.test(String(err?.message || err || ''));

export class Reader {
    constructor({ synthesize, player, lookahead = 1, synthTimeoutMs = 15000, interChunkDelayMs = 0 }) {
        this._synthesize = synthesize;
        this._player = player;
        this._lookahead = Math.max(1, lookahead | 0);
        this._synthTimeoutMs = synthTimeoutMs;
        this._interChunkDelayMs = interChunkDelayMs;

        this.chunks = [];
        this.total = 0;

        this._reset();

        // Callbacks (assigned by the caller).
        this.onProgress = null;   // (playedCount, total)
        this.onSentence = null;   // (chunkIndex) — highlight granularity = chunk
        this.onChunkError = null; // (chunkIndex)
        this.onState = null;      // ('playing'|'paused'|'stopped'|'done')
        this.onError = null;      // (message)
    }

    _reset() {
        this._cache = new Map();     // index -> base64
        this._durations = new Map(); // index -> decoded seconds
        this._errored = new Set();   // indices that failed synth (never enqueued)
        this._nextToFetch = 0;
        this._nextToEnqueue = 0;
        this._nextToPlay = 0;
        this._inFlight = 0;
        this._state = 'idle';
        this._watchdog = null;
        this._generation = (this._generation | 0) + 1;
    }

    /** Chunk `text` with the provider cap. Call before play(). */
    load(text, maxLen) {
        this.stop();
        this.chunks = splitIntoChunks(text, maxLen);
        this.total = this.chunks.length;
    }

    get state() { return this._state; }

    play() {
        if (this._state === 'playing') return;
        if (this._state === 'paused') {
            this._state = 'playing';
            this._player.resume();
            this._armWatchdog(this._nextToPlay);
            this._setState('playing');
            return;
        }
        if (this.total === 0) { this._setState('done'); return; }
        this._state = 'playing';
        this._setState('playing');
        this.onSentence?.(0); // highlight the first chunk as the current one
        this._pumpFetch();
        this._pumpEnqueue();
        this._drainErrored();
    }

    pause() {
        if (this._state !== 'playing') return;
        this._state = 'paused';
        this._clearWatchdog();   // exclude paused time — a suspended context can't fire onEnded
        this._player.pause();
        this._setState('paused');
    }

    stop() {
        this._clearWatchdog();
        try { this._player.stop(); } catch { /* player may be uninitialised */ }
        this.chunks = this.chunks || [];
        this._reset();           // bumps generation → stale async results are discarded
        this._setState('stopped');
    }

    // --- Fetch (sliding-window prefetch) -----------------------------------

    _pumpFetch() {
        const gen = this._generation;
        while (
            this._inFlight < this._lookahead &&
            this._nextToFetch < this.total &&
            this._nextToFetch <= this._nextToPlay + this._lookahead
        ) {
            const index = this._nextToFetch++;
            this._inFlight++;
            this._fetchChunk(index, gen);
        }
    }

    async _fetchChunk(index, gen) {
        let base64 = null;
        let lastErr = null;
        for (let attempt = 0; attempt <= RETRIES; attempt++) {
            if (gen !== this._generation) return; // stale run — discard
            try {
                if (this._interChunkDelayMs && index > 0) await sleep(this._interChunkDelayMs);
                base64 = await this._withTimeout(this._synthesize(this.chunks[index]), this._synthTimeoutMs);
                lastErr = null;
                break;
            } catch (err) {
                lastErr = err;
                if (gen !== this._generation) return;
                if (attempt < RETRIES) {
                    // 429/rate-limit: back off hard (protects shared-key / unofficial endpoints).
                    await sleep(isRateLimit(err) ? RATE_LIMIT_BACKOFF_MS : BASE_BACKOFF_MS * (attempt + 1));
                }
            }
        }
        if (gen !== this._generation) return;
        this._inFlight--;

        if (lastErr || !base64) {
            if (lastErr) console.warn(`[Reader] chunk ${index} synth failed:`, lastErr?.message || lastErr);
            this._markErrored(index);
        } else {
            this._cache.set(index, base64);
            this._pumpEnqueue();
        }
        this._pumpFetch();
    }

    _withTimeout(promise, ms) {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('synth timeout')), ms);
            Promise.resolve(promise).then(
                (v) => { clearTimeout(t); resolve(v); },
                (e) => { clearTimeout(t); reject(e); }
            );
        });
    }

    // --- Enqueue (strict order, ahead of playback → gapless) ---------------

    _pumpEnqueue() {
        if (this._state !== 'playing' && this._state !== 'paused') return;
        while (this._nextToEnqueue < this.total) {
            const index = this._nextToEnqueue;
            if (this._errored.has(index)) { this._nextToEnqueue++; continue; }
            if (!this._cache.has(index)) break;
            const base64 = this._cache.get(index);
            this._cache.delete(index);
            this._nextToEnqueue++;
            this._player.enqueueOrdered(
                base64,
                index,
                (i) => this._onEnded(i),
                (i) => this._onDecodeError(i),
                (i, durationSec) => this._onDecoded(i, durationSec)
            );
        }
    }

    // --- Playback resolution (onEnded drives progress ONLY) ----------------

    _onEnded(index) { this._advancePlay(index); }

    _onDecodeError(index) {
        if (this._state === 'stopped' || this._errored.has(index)) return;
        if (index === this._nextToPlay) {
            this._fireChunkError(index);
            this._advancePlay(index);
        } else {
            // Prefetched (non-head) chunk failed to decode — mark it now so it is skipped
            // promptly when the head reaches it, instead of stalling on the watchdog.
            this._markErrored(index);
        }
    }

    _onDecoded(index, durationSec) {
        if (durationSec > 0) this._durations.set(index, durationSec);
        if (index === this._nextToPlay && this._state === 'playing') this._armWatchdog(index);
    }

    /** Advance the play head. Idempotent per index → a late onEnded can't double-skip. */
    _advancePlay(index) {
        if (this._state === 'stopped') return;
        if (index !== this._nextToPlay) return;
        this._clearWatchdog();
        this._nextToPlay++;
        this._durations.delete(index);
        this.onProgress?.(this._nextToPlay, this.total);
        this._drainErrored();
        if (this._nextToPlay >= this.total) { this._setState('done'); return; }
        // Chunks are pre-scheduled gaplessly: when `index` ends, `nextToPlay` is already
        // audible → highlight the new head, not the chunk that just finished.
        this.onSentence?.(this._nextToPlay);
        if (this._state === 'playing') this._armWatchdog(this._nextToPlay);
        this._pumpFetch();
        this._pumpEnqueue();
    }

    /** Consume any leading synth-failed chunks (already reported) so progress stays honest. */
    _drainErrored() {
        while (this._nextToPlay < this.total && this._errored.has(this._nextToPlay)) {
            this._nextToPlay++;
            this.onProgress?.(this._nextToPlay, this.total);
        }
        if (this._nextToPlay >= this.total && (this._state === 'playing' || this._state === 'paused')) {
            this._setState('done');
        }
    }

    _markErrored(index) {
        this._errored.add(index);
        this._fireChunkError(index);
        this._pumpEnqueue();
        // If the failed chunk is at (or just reached) the play head, consume it now.
        if (index === this._nextToPlay) this._drainErrored();
    }

    _fireChunkError(index) { this.onChunkError?.(index); }

    // --- Safe watchdog (duration-based, paused with the reader) ------------

    _armWatchdog(index) {
        this._clearWatchdog();
        if (this._state !== 'playing' || index >= this.total) return;
        const dur = this._durations.get(index);
        const ms = dur > 0 ? dur * 1000 + WATCHDOG_MARGIN_MS : WATCHDOG_FALLBACK_MS;
        const gen = this._generation;
        this._watchdog = setTimeout(() => {
            if (gen !== this._generation || this._state !== 'playing') return;
            if (index !== this._nextToPlay) return;
            console.warn(`[Reader] watchdog fired for chunk ${index} (no onEnded)`);
            this._fireChunkError(index);
            this._advancePlay(index);
        }, ms);
    }

    _clearWatchdog() {
        if (this._watchdog) { clearTimeout(this._watchdog); this._watchdog = null; }
    }

    _setState(state) {
        this._state = state;
        this.onState?.(state);
    }
}
