// SessionStore — single source of truth for the current translation session.
//
// Lifecycle: app launch → init() → beginChunk() / addSegment() / endChunk()
// (repeatable across many Start/Stop cycles) → endSession() on Stop or app close.
// Persists both .md (human-readable) + .json (structured) via the Rust
// `save_session` Tauri command: on every endChunk, on endSession, and on a
// ~15s autosave cadence while recording so a crash/force-quit loses at most one
// autosave interval instead of the whole live chunk.

import { t } from './i18n.js';

const { invoke } = window.__TAURI__.core;

const AUTOSAVE_MS = 15000;
const NOTE_AUTOSAVE_MS = 1500;

export class SessionStore {
    constructor() {
        this.id = null;
        this.createdAt = null;
        this.endedAt = null;
        this.title = '';
        this.notes = '';
        this.noteImages = [];
        this.meetingMinutes = '';
        this.meetingMinutesLang = 'vi';
        this.tags = [];
        this.customerId = null;
        this.projectId = null;
        this.category = null;
        this.scope = 'work'; // 'work' | 'personal'
        this.engine = null;            // 'openai' | 'soniox' | 'local'
        this.sourceLang = '';
        this.targetLang = '';
        this.chunks = [];
        this.currentChunk = null;
        // Dirty tracking via a monotonic mutation counter: the store is "dirty"
        // whenever _mutations !== _persistedMutations. A segment arriving while a
        // persist is in flight bumps _mutations past the captured generation, so
        // the next persist re-runs instead of dropping the update.
        this._mutations = 0;
        this._persistedMutations = 0;
        // Single-flight: persist() calls chain here so two save_session invokes
        // for this session never overlap the shared deterministic .tmp path.
        this._persistChain = Promise.resolve();
        this._lastPersistAt = 0;
        this._autosaveTimer = null;
        this._noteAutosaveTimer = null;
    }

    init({ engine, sourceLang, targetLang, tags, customerId, projectId, category, scope } = {}) {
        this._cancelAutosave();
        this.id = this._generateId();
        this.createdAt = new Date().toISOString();
        this.endedAt = null;
        this.title = '';
        this.notes = '';
        this.noteImages = [];
        this.meetingMinutes = '';
        this.meetingMinutesLang = 'ja';
        this.meetingMinutesJa = '';
        this.meetingMinutesVi = '';
        this.meetingMinutesEn = '';
        this.tags = Array.isArray(tags) ? tags : [];
        this.customerId = customerId || null;
        this.projectId = projectId || null;
        this.category = category || null;
        this.scope = scope || 'work';
        this.engine = engine || null;
        this.sourceLang = sourceLang || '';
        this.targetLang = targetLang || '';
        this.chunks = [];
        this.currentChunk = null;
        this._mutations = 0;
        this._persistedMutations = 0;
        this._persistChain = Promise.resolve();
        this._lastPersistAt = Date.now();
    }

    beginChunk({ engine, sourceLang, targetLang } = {}) {
        if (engine) this.engine = engine;
        if (sourceLang) this.sourceLang = sourceLang;
        if (targetLang) this.targetLang = targetLang;
        this.currentChunk = {
            started_at: new Date().toISOString(),
            ended_at: null,
            engine: engine || this.engine || 'unknown',
            source_lang: sourceLang || this.sourceLang || '',
            target_lang: targetLang || this.targetLang || '',
            segments: [],
        };
    }

    addSegment(src, tgt, pendingId = null, speaker = null) {
        if (!this.currentChunk) {
            this.beginChunk();
        }
        const segment = {
            ts: this._timeStr(new Date()),
            src: src || '',
            tgt: tgt || '',
        };
        if (pendingId !== null) segment.pendingId = pendingId;
        if (speaker) segment.speaker = speaker;
        this.currentChunk.segments.push(segment);
        this._mutations++;
        this._scheduleAutosave();
    }

    // Complete the oldest source-only segment. Gemini writes source text as
    // soon as ASR finalizes and fills this field when REST translation returns.
    // Keeping the source-only record makes a stop during translation lossless.
    completeFirstPendingTranslation(tgt, pendingId = null) {
        if (!this.currentChunk) return false;
        for (let i = 0; i < this.currentChunk.segments.length; i++) {
            const segment = this.currentChunk.segments[i];
            if (!segment.tgt && segment.src && (pendingId === null || segment.pendingId === pendingId)) {
                segment.tgt = tgt || '';
                delete segment.pendingId;
                this._mutations++;
                this._scheduleAutosave();
                return true;
            }
        }
        return false;
    }

    bindPendingSegmentId(src, pendingId) {
        if (!this.currentChunk || pendingId === null) return false;
        const segment = this.currentChunk.segments.find(
            item => !item.tgt && item.src === src && item.pendingId === undefined,
        );
        if (!segment) return false;
        segment.pendingId = pendingId;
        return true;
    }

    endChunk() {
        this._cancelAutosave();
        if (!this.currentChunk) return;
        this.currentChunk.ended_at = new Date().toISOString();
        if (this.currentChunk.segments.length > 0) {
            this.chunks.push(this.currentChunk);
            // Closing a non-empty chunk sets its ended_at — a real state change
            // that must reach disk even if autosave already flushed the segments.
            this._mutations++;
        }
        this.currentChunk = null;
    }

    // Public persist entry point. Serializes concurrent calls through a chain so
    // two save_session invokes never overlap. Returns 'saved' | 'skipped' | 'failed'.
    persist() {
        const link = this._persistChain.then(() => this._persistNow());
        this._persistChain = link.catch(() => {});
        return link;
    }

    async _persistNow() {
        const hasContent = this.totalSegmentCount() > 0 || Boolean(this.notes && this.notes.trim());
        if (this._mutations === this._persistedMutations || !hasContent) {
            return 'skipped';
        }
        const gen = this._mutations;
        if (!this.title) this.title = this._autoTitle();
        const json = this._toJson();
        const md = this._toMarkdown();
        try {
            await invoke('save_session', {
                id: this.id,
                mdContent: md,
                jsonData: json,
            });
            this._persistedMutations = gen;
            this._lastPersistAt = Date.now();
            return 'saved';
        } catch (err) {
            console.error('[SessionStore] persist failed:', err);
            return 'failed';
        }
    }

    async endSession() {
        this.endChunk();
        this.endedAt = new Date().toISOString();
        this._mutations++;
        return await this.persist();
    }

    // Discard the current session and remove any autosaved files. Wait for
    // queued writes first so an in-flight autosave cannot recreate the file
    // after it has been deleted.
    async discard() {
        this._cancelAutosave();
        this.endChunk();
        await this._persistChain.catch(() => {});
        if (this.id) {
            try {
                await invoke('delete_session', { id: this.id });
            } catch (err) {
                console.error('[SessionStore] discard delete failed:', err);
                throw err;
            }
        }
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

    async setTags(newTags) {
        const clean = (Array.isArray(newTags) ? newTags : [])
            .map(t => String(t || '').trim().replace(/^#/, '').toLowerCase())
            .filter(t => t.length > 0 && t.length <= 50);
        this.tags = clean;
        this._mutations++;
        if (this.id) {
            try {
                await invoke('update_session_tags', { id: this.id, tags: clean });
            } catch (err) {
                console.error('[SessionStore] update_session_tags failed:', err);
            }
        }
    }

    async setMeetingMinutes(minutes, lang = 'ja') {
        const chosenLang = lang || 'ja';
        this.meetingMinutes = minutes || '';
        this.meetingMinutesLang = chosenLang;
        if (chosenLang === 'ja') this.meetingMinutesJa = minutes || '';
        if (chosenLang === 'vi') this.meetingMinutesVi = minutes || '';
        if (chosenLang === 'en') this.meetingMinutesEn = minutes || '';
        this._mutations++;
        if (this.id) {
            try {
                await invoke('update_session_meeting_minutes', {
                    id: this.id,
                    minutes: this.meetingMinutes,
                    lang: this.meetingMinutesLang,
                });
            } catch (err) {
                console.error('[SessionStore] update_session_meeting_minutes failed:', err);
            }
        }
    }

    async setNotes(notes) {
        this.notes = notes || '';
        this._mutations++;
        if (this.id) {
            try {
                await invoke('update_session_notes', {
                    id: this.id,
                    notes: this.notes,
                });
            } catch (err) {
                console.error('[SessionStore] update_session_notes failed:', err);
            }
        }
    }

    // Update the live note draft without invoking a backend write for every
    // keystroke. The short debounce makes note-only meetings recoverable even
    // when no transcript segment has arrived yet.
    updateNotesDraft(notes) {
        this.notes = notes || '';
        this._mutations++;
        this._scheduleNotesAutosave();
    }

    updateTitleDraft(title) {
        const clean = (title || '').trim().slice(0, 200);
        if (clean === this.title) return;
        this.title = clean;
        this._mutations++;
        this._scheduleNotesAutosave();
    }

    isEmpty() {
        const chunkSegs = this.chunks.reduce((n, c) => n + c.segments.length, 0);
        const liveSegs = this.currentChunk?.segments.length || 0;
        const hasNotes = Boolean(this.notes && this.notes.trim());
        return chunkSegs + liveSegs === 0 && !hasNotes;
    }

    totalSegmentCount() {
        const finished = this.chunks.reduce((n, c) => n + c.segments.length, 0);
        const live = this.currentChunk?.segments.length || 0;
        return finished + live;
    }

    // ─── Internals ─────────────────────────────────────────────────

    // All chunks that should be serialized, including the still-open live chunk
    // (kept ended_at: null) when it has segments. Never mutates this.chunks.
    _allChunks() {
        if (this.currentChunk && this.currentChunk.segments.length > 0) {
            return [...this.chunks, this.currentChunk];
        }
        return this.chunks;
    }

    _scheduleAutosave() {
        const elapsed = Date.now() - this._lastPersistAt;
        if (elapsed >= AUTOSAVE_MS) {
            // Fire-and-forget: don't await inside the transcription callback path.
            this.persist();
        } else if (!this._autosaveTimer) {
            // Elapsed-time trigger (not a fixed interval) stays bounded even when
            // WKWebView throttles timers on a minimized window, as long as
            // segments keep arriving to re-evaluate the elapsed check.
            this._autosaveTimer = setTimeout(() => {
                this._autosaveTimer = null;
                this.persist();
            }, AUTOSAVE_MS - elapsed);
        }
    }

    _cancelAutosave() {
        if (this._autosaveTimer) {
            clearTimeout(this._autosaveTimer);
            this._autosaveTimer = null;
        }
        if (this._noteAutosaveTimer) {
            clearTimeout(this._noteAutosaveTimer);
            this._noteAutosaveTimer = null;
        }
    }

    _scheduleNotesAutosave() {
        if (this._noteAutosaveTimer) clearTimeout(this._noteAutosaveTimer);
        this._noteAutosaveTimer = setTimeout(() => {
            this._noteAutosaveTimer = null;
            this.persist();
        }, NOTE_AUTOSAVE_MS);
    }

    _generateId() {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    }

    _timeStr(d) {
        const p = n => String(n).padStart(2, '0');
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }

    _autoTitle() {
        // Use the first chunk's start time so autosave and the final Stop
        // dialog produce the same deterministic meeting title.
        const firstChunk = this._allChunks()[0];
        const d = new Date(firstChunk?.started_at || this.createdAt || Date.now());
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `MM_${y}${m}${day}_${hh}:${mm}`;
    }

    // End time of an open (ended_at: null) chunk, derived from its last segment's
    // HH:MM:SS stamp anchored to the chunk's start date. Lets a crashed file list
    // a sane duration instead of 0.
    _lastSegmentEndTime(c) {
        const seg = c.segments[c.segments.length - 1];
        if (!seg || !seg.ts) return 0;
        const [h, m, s] = seg.ts.split(':').map(Number);
        const end = new Date(c.started_at);
        end.setHours(h, m, s, 0);
        return end.getTime();
    }

    _totalDurationSec() {
        let total = 0;
        for (const c of this._allChunks()) {
            if (!c.started_at) continue;
            const start = new Date(c.started_at).getTime();
            let end;
            if (c.ended_at) {
                end = new Date(c.ended_at).getTime();
            } else {
                if (!c.segments || c.segments.length === 0) continue;
                end = this._lastSegmentEndTime(c);
            }
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
            notes: this.notes || '',
            note_images: this.noteImages || [],
            meeting_minutes: this.meetingMinutes || null,
            meeting_minutes_lang: this.meetingMinutesLang || null,
            meeting_minutes_ja: this.meetingMinutesJa || null,
            meeting_minutes_vi: this.meetingMinutesVi || null,
            meeting_minutes_en: this.meetingMinutesEn || null,
            tags: this.tags || [],
            customer_id: this.customerId || null,
            project_id: this.projectId || null,
            category: this.category || null,
            scope: this.scope || 'work',
            engine: this.engine || 'unknown',
            source_lang: this.sourceLang || '',
            target_lang: this.targetLang || '',
            duration_sec: this._totalDurationSec(),
            chunks: this._allChunks(),
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
        const metaExtras = [];
        if (this.scope === 'personal') metaExtras.push(t('export.personal'));
        if (this.category) metaExtras.push(`🗂️ Category: ${this.category}`);
        if (this.tags && this.tags.length > 0) metaExtras.push(this.tags.map(tag => `#${tag}`).join(' '));
        const extraStr = metaExtras.length > 0 ? ' · ' + metaExtras.join(' · ') : '';

        lines.push(`# ${title}`);
        lines.push('');
        lines.push(`**${t('export.info')}**: Engine ${this.engine || 'unknown'} · ${langPair} · ${this._formatDateTime(this.createdAt)} · ${dur}${extraStr}`);
        lines.push('');
        lines.push('---');
        lines.push('');

        if (this.meetingMinutesJa && this.meetingMinutesJa.trim()) {
            lines.push(`## 📋 ${t('export.minutesJa')}`);
            lines.push('');
            lines.push(this.meetingMinutesJa.trim());
            lines.push('');
            lines.push('---');
            lines.push('');
        }
        if (this.meetingMinutesVi && this.meetingMinutesVi.trim()) {
            lines.push(`## 📋 ${t('export.minutesVi')}`);
            lines.push('');
            lines.push(this.meetingMinutesVi.trim());
            lines.push('');
            lines.push('---');
            lines.push('');
        }

        // Extract segments from all chunks
        const all = this._allChunks();
        const srcLines = [];
        const tgtLines = [];

        for (const chunk of all) {
            for (const seg of (chunk.segments || [])) {
                const tsTag = seg.ts ? `[${seg.ts}] ` : '';
                const spkTag = seg.speaker ? `(Speaker ${seg.speaker}) ` : '';
                const src = (seg.src || '').trim();
                const tgt = (seg.tgt || '').trim();

                if (src) {
                    srcLines.push(`${tsTag}${spkTag}${src}`);
                }
                if (tgt) {
                    tgtLines.push(`${tsTag}${spkTag}${tgt}`);
                }
            }
        }

        // Section 2: Original Transcript
        lines.push(`## 🗣️ ${t('export.original')}`);
        lines.push('');
        if (srcLines.length > 0) {
            lines.push(srcLines.join('\n'));
        } else {
            lines.push(`*(${t('export.noOriginal')})*`);
        }
        lines.push('');
        lines.push('---');
        lines.push('');

        // Section 3: Translation
        lines.push(`## 🌐 ${t('export.translation')}`);
        lines.push('');
        if (tgtLines.length > 0) {
            lines.push(tgtLines.join('\n'));
        } else {
            lines.push(`*(${t('export.noTranslation')})*`);
        }

        return lines.join('\n');
    }
}

export const sessionStore = new SessionStore();
