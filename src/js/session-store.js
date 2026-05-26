// SessionStore — single source of truth for the current translation session.
//
// Lifecycle: app launch → init() → beginChunk() / addSegment() / endChunk()
// (repeatable across many Start/Stop cycles) → endSession() on app close.
// Persists both .md (human-readable) + .json (structured) on every endChunk
// via the Rust `save_session` Tauri command.

const { invoke } = window.__TAURI__.core;

export class SessionStore {
    constructor() {
        this.id = null;
        this.createdAt = null;
        this.endedAt = null;
        this.title = '';
        this.engine = null;            // 'openai' | 'soniox' | 'local'
        this.sourceLang = '';
        this.targetLang = '';
        this.chunks = [];
        this.currentChunk = null;
        this._dirty = false;
    }

    init({ engine, sourceLang, targetLang } = {}) {
        this.id = this._generateId();
        this.createdAt = new Date().toISOString();
        this.endedAt = null;
        this.title = '';
        this.engine = engine || null;
        this.sourceLang = sourceLang || '';
        this.targetLang = targetLang || '';
        this.chunks = [];
        this.currentChunk = null;
        this._dirty = false;
    }

    static async resume(id) {
        const result = await invoke('read_session', { id });
        const s = new SessionStore();
        const j = result.json;
        s.id = j.id;
        s.createdAt = j.created_at;
        s.endedAt = j.ended_at;
        s.title = j.title || '';
        s.engine = j.engine || null;
        s.sourceLang = j.source_lang || '';
        s.targetLang = j.target_lang || '';
        s.chunks = j.chunks || [];
        s.currentChunk = null;
        s._dirty = false;
        return s;
    }

    beginChunk({ engine, sourceLang, targetLang } = {}) {
        if (engine) this.engine = engine;
        if (sourceLang) this.sourceLang = sourceLang;
        if (targetLang) this.targetLang = targetLang;
        this.currentChunk = {
            started_at: new Date().toISOString(),
            ended_at: null,
            segments: [],
        };
    }

    addSegment(src, tgt) {
        if (!this.currentChunk) {
            this.beginChunk();
        }
        this.currentChunk.segments.push({
            ts: this._timeStr(new Date()),
            src: src || '',
            tgt: tgt || '',
        });
        this._dirty = true;
    }

    endChunk() {
        if (!this.currentChunk) return;
        this.currentChunk.ended_at = new Date().toISOString();
        if (this.currentChunk.segments.length > 0) {
            this.chunks.push(this.currentChunk);
        }
        this.currentChunk = null;
    }

    async persist() {
        if (!this._dirty || this.chunks.length === 0) return;
        if (!this.title) this.title = this._autoTitle();
        const json = this._toJson();
        const md = this._toMarkdown();
        try {
            await invoke('save_session', {
                id: this.id,
                mdContent: md,
                jsonData: json,
            });
            this._dirty = false;
        } catch (err) {
            console.error('[SessionStore] persist failed:', err);
        }
    }

    async endSession() {
        this.endChunk();
        this.endedAt = new Date().toISOString();
        this._dirty = true;
        await this.persist();
    }

    async setTitle(newTitle) {
        const t = (newTitle || '').trim().slice(0, 200);
        this.title = t;
        try {
            await invoke('update_session_title', { id: this.id, title: t });
        } catch (err) {
            console.error('[SessionStore] update_session_title failed:', err);
        }
    }

    isEmpty() {
        const chunkSegs = this.chunks.reduce((n, c) => n + c.segments.length, 0);
        const liveSegs = this.currentChunk?.segments.length || 0;
        return chunkSegs + liveSegs === 0;
    }

    totalSegmentCount() {
        const finished = this.chunks.reduce((n, c) => n + c.segments.length, 0);
        const live = this.currentChunk?.segments.length || 0;
        return finished + live;
    }

    // ─── Internals ─────────────────────────────────────────────────

    _generateId() {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    }

    _timeStr(d) {
        const p = n => String(n).padStart(2, '0');
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }

    _autoTitle() {
        for (const chunk of this.chunks) {
            for (const seg of chunk.segments) {
                if (seg.tgt && seg.tgt.trim()) {
                    return seg.tgt.trim().split(/\s+/).slice(0, 7).join(' ').slice(0, 80);
                }
            }
        }
        return 'Untitled session';
    }

    _totalDurationSec() {
        let total = 0;
        for (const c of this.chunks) {
            if (!c.started_at || !c.ended_at) continue;
            const start = new Date(c.started_at).getTime();
            const end = new Date(c.ended_at).getTime();
            if (end > start) total += Math.floor((end - start) / 1000);
        }
        return total;
    }

    _toJson() {
        return {
            id: this.id,
            created_at: this.createdAt,
            ended_at: this.endedAt,
            title: this.title || this._autoTitle(),
            engine: this.engine || 'unknown',
            source_lang: this.sourceLang || '',
            target_lang: this.targetLang || '',
            duration_sec: this._totalDurationSec(),
            chunks: this.chunks,
        };
    }

    _formatDateTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    _formatDuration(sec) {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    _toMarkdown() {
        const lines = [];
        const title = this.title || this._autoTitle();
        const dur = this._formatDuration(this._totalDurationSec());
        const langPair = (this.sourceLang || '?') + ' → ' + (this.targetLang || '?');

        lines.push(`# ${title}`);
        lines.push('');
        lines.push(`**Engine**: ${this.engine || 'unknown'} · ${langPair} · ${this._formatDateTime(this.createdAt)} · ${dur}`);
        lines.push('');

        for (let i = 0; i < this.chunks.length; i++) {
            const chunk = this.chunks[i];
            if (i > 0) {
                const prevEnd = new Date(this.chunks[i - 1].ended_at).getTime();
                const curStart = new Date(chunk.started_at).getTime();
                const gapMin = Math.max(0, Math.round((curStart - prevEnd) / 60000));
                const startStr = this._formatDateTime(chunk.started_at).slice(11);
                lines.push('');
                lines.push(`──── resumed at ${startStr} (after ${gapMin}m) ────`);
                lines.push('');
            }
            const startStr = this._formatDateTime(chunk.started_at).slice(11);
            const endStr = chunk.ended_at ? this._formatDateTime(chunk.ended_at).slice(11) : '...';
            lines.push(`## Chunk ${i + 1} — ${startStr} – ${endStr}`);
            lines.push('');
            for (const seg of chunk.segments) {
                if (seg.src) {
                    lines.push(`[${seg.ts}] ${seg.src}`);
                    lines.push(`→ ${seg.tgt}`);
                } else {
                    lines.push(`[${seg.ts}] ${seg.tgt}`);
                }
                lines.push('');
            }
        }
        return lines.join('\n');
    }
}

export const sessionStore = new SessionStore();
