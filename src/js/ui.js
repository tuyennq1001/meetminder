/**
 * Transcript UI — continuous paragraph flow display with speaker diarization
 * 
 * Design: All text flows as one continuous paragraph.
 * - Translated text: white (primary color)
 * - Original text (pending translation): cyan/accent color  
 * - Provisional text (being recognized): dimmed
 * - Speaker labels: shown when speaker changes (e.g. "Speaker 1:")
 * - Language badges: shown when detected language changes (e.g. "🇯🇵 JA")
 * - Confidence: low-confidence segments highlighted
 */

export class TranscriptUI {
    constructor(container) {
        this.container = container;
        this.contentEl = null;
        this.maxChars = 1200;
        this.fontSize = 16;
        this.viewMode = 'single'; // 'single' or 'dual'

        // Segments: each has { original, translation, status, speaker, language, confidence }
        this.segments = [];
        // `segments` is deliberately only the bounded render buffer. Durable
        // session history belongs to SessionStore, which avoids keeping a
        // second copy of every segment in the UI for long meetings.
        this.segmentTimeFormatter = new Intl.DateTimeFormat(undefined, {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        });
        this.provisionalText = '';
        this.provisionalSpeaker = null;
        this.provisionalLanguage = null;
        // Source-side provisional (OpenAI Realtime: source ASR is separate from target).
        // Soniox leaves this empty; its provisionalText carries the source-language ASR.
        this.sourceProvisionalText = '';
        // Provider hint — Soniox puts source-language in provisionalText; OpenAI
        // splits source/target streams; Qwen Live Flash emits target-only.
        // Backing field for the `provider` getter/setter below.
        this._provider = 'soniox';
        this.currentSpeaker = null; // Track current speaker to detect changes
        this.currentLanguage = null; // Track current language to detect changes
        this.lastConfidence = null; // Last confidence score from Soniox
        this.userScrolledUp = false; // When true, user is reviewing history -> do not auto-scroll
        this.isSyncingScroll = false; // Prevent feedback loops when syncing dual panels
        this.isScrollingToSegment = false; // Prevent ratio-sync while smooth-scrolling to clicked segment
        this.isScrollingToBottom = false; // Prevent scroll events from resetting userScrolledUp during smooth scroll to bottom
        this._isRendering = false; // Prevent scroll events from firing during DOM mutations
        this._renderedViewType = null; // 'single' or 'dual'
        this._initJumpBottomButton();
    }

    _initJumpBottomButton() {
        const btn = document.getElementById('live-jump-bottom-btn');
        if (btn && !btn._hasClickListener) {
            btn._hasClickListener = true;
            btn.addEventListener('click', () => {
                this._scrollPanelsToBottom();
            });
        }
    }

    isDualView() {
        return (this.viewMode === 'dual' || this.viewMode === 'both') &&
               this._provider !== 'qwen' &&
               this.targetLanguage !== 'none';
    }

    _syncDualViewClass() {
        const overlay = document.getElementById('overlay-view');
        if (overlay) {
            overlay.classList.toggle('dual-view', this.isDualView());
        }
    }

    get provider() {
        return this._provider;
    }

    set provider(value) {
        this._provider = value;
        this._syncDualViewClass();
        this._render();
    }

    /**
     * Update display settings
     */
    configure({ maxLines, showOriginal, fontSize, fontColor, fontFamily, viewMode, targetLanguage }) {
        if (targetLanguage !== undefined) this.targetLanguage = targetLanguage;
        if (maxLines !== undefined) this.maxChars = maxLines * 160;
        if (fontSize !== undefined) {
            this.fontSize = fontSize;
            this.container.style.setProperty('--transcript-font-size', `${fontSize}px`);
            document.documentElement?.style.setProperty('--transcript-font-size', `${fontSize}px`);
        }
        if (fontColor !== undefined) {
            this.fontColor = fontColor;
            this.container.style.setProperty('--transcript-font-color', fontColor);
            document.documentElement?.style.setProperty('--transcript-font-color', fontColor);
        }
        if (fontFamily !== undefined) {
            this.fontFamily = fontFamily;
            const families = {
                system: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                arial: 'Arial, -apple-system, sans-serif',
                georgia: 'Georgia, serif',
                monospace: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            };
            const fam = families[fontFamily] || families.system;
            this.container.style.setProperty('--transcript-font-family', fam);
            document.documentElement?.style.setProperty('--transcript-font-family', fam);
        }
        if (viewMode !== undefined) {
            this.viewMode = viewMode;
        }
        this._syncDualViewClass();
        this._render();
    }

    /**
     * Add finalized original text (pending translation)
     */
    addOriginal(text, speaker, language, pendingId = null) {
        this._removeListening();
        const seg = {
            original: text,
            translation: null,
            status: 'original',
            speaker: speaker || null,
            language: language || null,
            confidence: this.lastConfidence,
            createdAt: Date.now(),
            pendingId,
        };
        this.segments.push(seg);
        if (speaker) this.currentSpeaker = speaker;
        if (language) this.currentLanguage = language;
        this._render();
        if (text && text.trim()) this.onActivity?.();
    }

    /**
     * Apply translation to the oldest untranslated segment
     */
    addTranslation(text, pendingId = null) {
        const seg = pendingId !== null
            ? this.segments.find(s => s.status === 'original' && s.pendingId === pendingId)
            : this.segments.find(s => s.status === 'original');
        if (seg) {
            seg.translation = text;
            seg.status = 'translated';
        } else {
            const newSeg = {
                original: '',
                translation: text,
                status: 'translated',
                speaker: null,
                createdAt: Date.now(),
                pendingId,
            };
            this.segments.push(newSeg);
        }
        this._render();
        if (text && text.trim()) this.onActivity?.();
    }

    /** Mark a source segment whose translation exhausted its retries. */
    markTranslationFailed(pendingId) {
        const seg = this.segments.find(
            s => s.status === 'original' && s.pendingId === pendingId,
        );
        if (!seg) return;
        seg.translation = '';
        seg.status = 'translation_failed';
        this._render();
    }

    /** Add a finalized source/translation pair emitted by realtime providers. */
    addSegment(original, translation, speaker = null, language = null) {
        this._removeListening();
        const createdAt = Date.now();
        const seg = {
            original: original || '',
            translation: translation || '',
            status: 'translated',
            speaker,
            language,
            confidence: this.lastConfidence,
            createdAt,
        };
        this.segments.push(seg);
        if (speaker) this.currentSpeaker = speaker;
        if (language) this.currentLanguage = language;
        this._render();
        if (seg.original.trim() || seg.translation.trim()) this.onActivity?.();
    }

    /**
     * Update provisional (in-progress) text
     */
    setProvisional(text, speaker, language) {
        this._removeListening();
        this.provisionalText = text;
        this.provisionalSpeaker = speaker || null;
        this.provisionalLanguage = language || null;
        this._render();
        if (text && text.trim()) this.onActivity?.();
    }

    /**
     * Clear provisional text
     */
    clearProvisional() {
        this.provisionalText = '';
        this.provisionalSpeaker = null;
        this.provisionalLanguage = null;
        this._render();
    }

    /**
     * Set source-side provisional (OpenAI Realtime only). Renders on the source
     * panel in dual view; ignored in single view (which shows target only).
     */
    setSourceProvisional(text) {
        this._removeListening();
        this.sourceProvisionalText = text || '';
        this._render();
        if (text && text.trim()) this.onActivity?.();
    }

    clearSourceProvisional() {
        this.sourceProvisionalText = '';
        this._render();
    }

    /**
     * Check if there is any content to display
     */
    hasContent() {
        return this.segments.length > 0 || !!this.provisionalText || !!this.sourceProvisionalText;
    }

    /**
     * Show placeholder state
     */
    showPlaceholder() {
        this.container.innerHTML = `
      <div class="transcript-placeholder">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </svg>
        <p>Press ▶ to start translating</p>
        <p class="shortcut-hint">⌘S</p>
      </div>
    `;
        this.segments = [];
        this.provisionalText = '';
        this.sourceProvisionalText = '';
        this.provisionalSpeaker = null;
        this.provisionalLanguage = null;
        this.currentSpeaker = null;
        this.currentLanguage = null;
        this.lastConfidence = null;
        this.contentEl = null;
        this.userScrolledUp = false;
        this._renderedViewType = null;
    }

    /**
     * Show listening state (clears placeholder and renders clean empty transcript panel)
     */
    showListening() {
        this.userScrolledUp = false;
        this.container.querySelectorAll('.listening-indicator').forEach(el => el.remove());

        const placeholder = this.container.querySelector('.transcript-placeholder');
        if (placeholder) placeholder.remove();

        this._ensureContent();
        this._render();
        if (this.container) this.container.scrollTop = 0;
    }

    /**
     * Show status message in transcript area (e.g. loading model)
     */
    showStatusMessage(message) {
        this._ensureContent();
        let statusEl = this.contentEl.querySelector('.pipeline-status');
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.className = 'pipeline-status';
            statusEl.style.cssText = 'text-align:center; padding:8px; color:rgba(255,255,255,0.5); font-size:13px;';
            this.contentEl.appendChild(statusEl);
        }
        statusEl.textContent = message;
    }

    /**
     * Remove status message
     */
    removeStatusMessage() {
        if (this.contentEl) {
            const statusEl = this.contentEl.querySelector('.pipeline-status');
            if (statusEl) statusEl.remove();
        }
    }

    /**
     * Get transcript as plain text for copying
     */
    getPlainText() {
        let lines = [];
        for (const seg of this.segments) {
            if (seg.original) lines.push(seg.original);
            if (seg.translation) lines.push(seg.translation);
            if (seg.original || seg.translation) lines.push('');
        }
        if (this.provisionalText) lines.push(this.provisionalText);
        return lines.join('\n').trim();
    }

    /**
     * Get all original/source text as plain text
     */
    getSourcePlainText() {
        const lines = [];
        for (const seg of this.segments) {
            if (seg.original && seg.original.trim()) {
                lines.push(seg.original.trim());
            }
        }
        if (this.sourceProvisionalText && this.sourceProvisionalText.trim()) {
            lines.push(this.sourceProvisionalText.trim());
        }
        return lines.join('\n').trim();
    }

    /**
     * Get all translated/target text as plain text
     */
    getTranslationPlainText() {
        const lines = [];
        for (const seg of this.segments) {
            if (seg.translation && seg.translation.trim()) {
                lines.push(seg.translation.trim());
            }
        }
        if (this.provisionalText && this.provisionalText.trim()) {
            lines.push(this.provisionalText.trim());
        }
        return lines.join('\n').trim();
    }

    /**
     * Get formatted content for saving to file (markdown with metadata)
     */
    getFormattedContent(metadata = {}) {
        if (this.segments.length === 0) return null;

        const lines = [];

        // Metadata header
        lines.push('---');
        lines.push(`date: ${new Date().toISOString()}`);
        if (metadata.model) lines.push(`model: ${metadata.model}`);
        if (metadata.sourceLang) lines.push(`source_language: ${metadata.sourceLang}`);
        if (metadata.targetLang) lines.push(`target_language: ${metadata.targetLang}`);
        if (metadata.duration) lines.push(`recording_duration: ${metadata.duration}`);
        if (metadata.audioSource) lines.push(`audio_source: ${metadata.audioSource}`);
        lines.push(`segments: ${this.segments.length}`);
        lines.push('---');
        lines.push('');

        // Transcript entries
        for (const seg of this.segments) {
            if (seg.original) lines.push(`> ${seg.original}`);
            if (seg.translation) lines.push(seg.translation);
            lines.push('');
        }

        return lines.join('\n').trim();
    }

    /**
     * Check if there are segments to save
     */
    hasSegments() {
        return this.segments.length > 0;
    }

    /**
     * Check whether the current render buffer has content. Durable session
     * history is owned by SessionStore.
     */
    hasSessionContent() {
        return this.segments.length > 0;
    }

    /**
     * Returns formatted markdown for the visible buffer. Full-session export
     * is handled by SessionStore, the single durable source of truth.
     */
    getFullSessionText(metadata = {}) {
        if (this.segments.length === 0) return null;

        const lines = [];

        // YAML frontmatter
        lines.push('---');
        const now = new Date();
        lines.push(`date: ${now.toISOString().slice(0, 10)}`);
        lines.push(`time: ${now.toTimeString().slice(0, 8)}`);
        if (metadata.duration) lines.push(`duration: ${metadata.duration}`);
        if (metadata.sourceLang) lines.push(`source_lang: ${metadata.sourceLang}`);
        if (metadata.targetLang) lines.push(`target_lang: ${metadata.targetLang}`);
        if (metadata.mode) lines.push(`mode: ${metadata.mode}`);
        if (metadata.audioSource) lines.push(`audio_source: ${metadata.audioSource}`);
        if (metadata.model) lines.push(`model: ${metadata.model}`);
        lines.push(`segments: ${this.segments.length}`);
        lines.push('---');
        lines.push('');

        // Transcript entries
        for (const seg of this.segments) {
            if (seg.original) lines.push(`> ${seg.original}`);
            if (seg.translation) lines.push(seg.translation);
            lines.push('');
        }

        return lines.join('\n').trim();
    }

    /**
     * Kept for compatibility. SessionStore owns durable history.
     */
    clearSession() {
        // no-op
    }

    /**
     * Clear the display buffer only. SessionStore is unaffected.
     */
    clear() {
        this.container.innerHTML = '';
        this.segments = [];
        this.provisionalText = '';
        this.provisionalSpeaker = null;
        this.provisionalLanguage = null;
        this.currentSpeaker = null;
        this.currentLanguage = null;
        this.lastConfidence = null;
        this.contentEl = null;
        this.userScrolledUp = false;
        this._renderedViewType = null;
        this._updateJumpButtons();
    }

    /**
     * Update confidence score
     */
    setConfidence(confidence) {
        this.lastConfidence = confidence;
    }

    // ─── Internal ──────────────────────────────────────────

    _ensureContent() {
        if (!this.contentEl) {
            this.container.innerHTML = '';
            this.contentEl = document.createElement('div');
            this.contentEl.className = 'transcript-flow';

            // Detect mouse wheel / trackpad scroll up to pause auto-scroll immediately
            this.container.addEventListener('wheel', (e) => {
                if (this.isScrollingToBottom) return;
                if (e.deltaY < 0) {
                    let canScroll = false;
                    if (this.isDualView()) {
                        const srcPanel = this.contentEl?.querySelector('.panel-source');
                        if (srcPanel && (srcPanel.scrollHeight - srcPanel.clientHeight) > 10) {
                            canScroll = true;
                        }
                    } else if (this.container && (this.container.scrollHeight - this.container.clientHeight) > 10) {
                        canScroll = true;
                    }
                    if (canScroll) {
                        this.userScrolledUp = true;
                        this._updateJumpButtons();
                    }
                }
            }, { passive: true });

            // Event delegation for copy buttons on headers
            this.contentEl.addEventListener('click', async (e) => {
                const copySrc = e.target.closest('.btn-copy-source');
                if (copySrc) {
                    e.stopPropagation();
                    const text = this.getSourcePlainText();
                    if (text) {
                        try {
                            await navigator.clipboard.writeText(text);
                            this.onToast?.('Đã copy bản gốc ✓', 'success');
                            this._flashCopyButton(copySrc);
                        } catch (err) {
                            console.error('Copy source failed:', err);
                        }
                    } else {
                        this.onToast?.('Chưa có nội dung bản gốc để copy', 'info');
                    }
                    return;
                }

                const copyTgt = e.target.closest('.btn-copy-translation');
                if (copyTgt) {
                    e.stopPropagation();
                    const text = this.getTranslationPlainText();
                    if (text) {
                        try {
                            await navigator.clipboard.writeText(text);
                            this.onToast?.('Đã copy bản dịch ✓', 'success');
                            this._flashCopyButton(copyTgt);
                        } catch (err) {
                            console.error('Copy translation failed:', err);
                        }
                    } else {
                        this.onToast?.('Chưa có nội dung bản dịch để copy', 'info');
                    }
                    return;
                }
            });

            this.container.appendChild(this.contentEl);
        }
    }

    _flashCopyButton(btn) {
        if (!btn) return;
        const originalSvg = btn.innerHTML;
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#85e0a3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => {
            if (btn) btn.innerHTML = originalSvg;
        }, 1500);
    }

    _removeListening() {
        const indicator = this.container.querySelector('.listening-indicator');
        if (indicator) indicator.remove();
    }

    _render() {
        this._syncDualViewClass();
        this._ensureContent();
        this._trimSegments();

        const isDual = this.isDualView();
        const viewType = isDual ? 'dual' : 'single';
        if (this._renderedViewType !== viewType) {
            if (this.contentEl) this.contentEl.innerHTML = '';
            this._renderedViewType = viewType;
            this.userScrolledUp = false;
        }

        if (isDual) {
            this._renderDual();
        } else {
            this._renderSingle();
        }
    }

    _renderSingle() {
        let html = '';
        let lastRenderedLang = null;

        const showOnlyOriginal = this.viewMode === 'original' || this.targetLanguage === 'none';

        // Header for single mode with copy button
        const headerTitle = showOnlyOriginal ? '📝 Bản gốc' : '🌐 Bản dịch';
        const copyClass = showOnlyOriginal ? 'btn-copy-source' : 'btn-copy-translation';
        const copyTitle = showOnlyOriginal ? 'Copy toàn bộ bản gốc' : 'Copy toàn bộ bản dịch';
        const headerHtml = `
            <div class="panel-column-header">
                <span class="panel-header-title">${headerTitle}</span>
                <button type="button" class="panel-copy-btn ${copyClass}" title="${copyTitle}">
                    <svg class="icon-copy-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                </button>
            </div>
        `;

        for (const seg of this.segments) {
            // Language badge
            if (seg.language && seg.language !== lastRenderedLang) {
                html += `<span class="lang-badge">${this._langEmoji(seg.language)}</span> `;
                lastRenderedLang = seg.language;
            }

            if (showOnlyOriginal) {
                if (seg.original) {
                    html += `<div class="seg-block">`;
                    html += `<div class="seg-translated">${this._esc(seg.original)}</div>`;
                    html += `</div>`;
                }
            } else {
                if (seg.status === 'translated' && seg.translation) {
                    const confidenceClass = (seg.confidence !== null && seg.confidence < 0.7) ? ' low-confidence' : '';
                    html += `<div class="seg-block">`;
                    html += `<div class="seg-translated${confidenceClass}">${this._esc(seg.translation)}</div>`;
                    html += `</div>`;
                } else if (seg.status === 'translation_failed' && seg.original) {
                    html += `<div class="seg-block">`;
                    html += `<div class="seg-translation-failed" title="Không thể dịch câu này sau nhiều lần thử">⚠️ Không thể dịch câu này</div>`;
                    html += `</div>`;
                }
            }
        }

        if (this.provisionalText || (showOnlyOriginal && this.sourceProvisionalText)) {
            if (this.provisionalLanguage && this.provisionalLanguage !== lastRenderedLang) {
                html += `<span class="lang-badge">${this._langEmoji(this.provisionalLanguage)}</span> `;
            }

            let textToRender = this.provisionalText;
            if (showOnlyOriginal && this.sourceProvisionalText) {
                textToRender = this.sourceProvisionalText;
            }
            const isTargetStream = !showOnlyOriginal && (this.sourceProvisionalText || this.provider === 'qwen');
            const cls = isTargetStream ? 'seg-translated' : 'seg-provisional';
            if (textToRender) {
                html += `<div class="seg-block"><div class="${cls}">${this._esc(textToRender)}</div></div>`;
            }
        }

        this._isRendering = true;
        let singleBody = this.contentEl.querySelector('.panel-single-body');
        if (!singleBody) {
            this.contentEl.innerHTML = `
                ${headerHtml}
                <div class="panel-single-body">${html}</div>
            `;
            this._bindSingleScrollEvents();
            if (!this.userScrolledUp && this.container) {
                this.container.scrollTop = this.container.scrollHeight;
            }
        } else {
            const titleEl = this.contentEl.querySelector('.panel-header-title');
            if (titleEl && titleEl.textContent !== headerTitle) {
                titleEl.textContent = headerTitle;
            }
            const copyBtn = this.contentEl.querySelector('.panel-copy-btn');
            if (copyBtn) {
                copyBtn.className = `panel-copy-btn ${copyClass}`;
                copyBtn.title = copyTitle;
            }

            const savedTop = this.container ? this.container.scrollTop : 0;
            singleBody.innerHTML = html;

            if (this.segments.length === 0 && !this.provisionalText && !this.sourceProvisionalText) {
                if (this.container) this.container.scrollTop = 0;
                this.userScrolledUp = false;
            } else if (this.userScrolledUp) {
                if (this.container) this.container.scrollTop = savedTop;
            } else {
                if (this.container) this.container.scrollTop = this.container.scrollHeight;
            }
        }
        this._isRendering = false;
        this._updateJumpButtons();
    }

    _renderDual() {
        let srcHtml = '';
        let timeHtml = '';
        let tgtHtml = '';
        let lastLang = null;

        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];

            let langHtml = '';
            if (seg.language && seg.language !== lastLang) {
                langHtml = `<span class="lang-badge">${this._langEmoji(seg.language)}</span> `;
                lastLang = seg.language;
            }

            if (seg.status === 'translated' && seg.translation) {
                const confidenceClass = (seg.confidence !== null && seg.confidence < 0.7) ? ' low-confidence' : '';
                srcHtml += `${langHtml}<div class="seg-text" data-seg-idx="${i}">${this._esc(seg.original || '')}</div>`;
                timeHtml += `<div class="segment-time clickable-time" data-seg-idx="${i}" title="Nhấp để cuộn cả 2 khung tới đoạn này">${this._formatSegmentTime(seg.createdAt)}</div>`;
                tgtHtml += `<div class="seg-text${confidenceClass}" data-seg-idx="${i}">${this._esc(seg.translation)}</div>`;
            } else if (seg.status === 'original' && seg.original) {
                srcHtml += `${langHtml}<div class="seg-text" data-seg-idx="${i}">${this._esc(seg.original)}</div>`;
                timeHtml += `<div class="segment-time clickable-time" data-seg-idx="${i}" title="Nhấp để cuộn cả 2 khung tới đoạn này">${this._formatSegmentTime(seg.createdAt)}</div>`;
                tgtHtml += `<div class="seg-text pending" data-seg-idx="${i}" title="Đang chờ Gemini hoàn tất bản dịch">...</div>`;
            } else if (seg.status === 'translation_failed' && seg.original) {
                srcHtml += `${langHtml}<div class="seg-text" data-seg-idx="${i}">${this._esc(seg.original)}</div>`;
                timeHtml += `<div class="segment-time clickable-time" data-seg-idx="${i}" title="Nhấp để cuộn cả 2 khung tới đoạn này">${this._formatSegmentTime(seg.createdAt)}</div>`;
                tgtHtml += `<div class="seg-text translation-failed" data-seg-idx="${i}" title="Không thể dịch câu này sau nhiều lần thử">⚠️ Không thể dịch</div>`;
            }
        }

        if (this.sourceProvisionalText || this.provisionalText) {
            const usingOpenAi = this.provider === 'openai';
            const srcText = usingOpenAi ? this.sourceProvisionalText : this.provisionalText;
            const tgtText = usingOpenAi ? this.provisionalText : '';

            if (srcText) {
                const pLang = this.provisionalLanguage || '';
                const langBadge = pLang ? `<span class="lang-badge">${this._langEmoji(pLang)}</span> ` : '';
                srcHtml += `${langBadge}<div class="seg-text seg-provisional">${this._esc(srcText)}</div>`;
                timeHtml += `<div class="segment-time">...</div>`;
                if (!usingOpenAi) {
                    tgtHtml += `<div class="seg-text pending">...</div>`;
                }
            }

            if (usingOpenAi && tgtText) {
                tgtHtml += `<div class="seg-text seg-provisional">${this._esc(tgtText)}</div>`;
            }
        }

        this._isRendering = true;
        let srcPanel = this.contentEl.querySelector('.panel-source');
        let timePanel = this.contentEl.querySelector('.panel-timestamps');
        let tgtPanel = this.contentEl.querySelector('.panel-translation');

        if (!srcPanel || !timePanel || !tgtPanel) {
            this.contentEl.innerHTML = `
                <div class="panel-source">
                    <div class="panel-source-header panel-column-header">
                        <span class="panel-header-title">📝 Bản gốc</span>
                        <button type="button" class="panel-copy-btn btn-copy-source" title="Copy toàn bộ bản gốc">
                            <svg class="icon-copy-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="panel-source-body">${srcHtml}</div>
                </div>
                <div class="panel-timestamps-wrap">
                    <div class="panel-timestamps-header panel-column-header panel-time-header">
                        <span class="timeline-header-label">Timeline</span>
                    </div>
                    <div class="panel-timestamps">
                        <div class="panel-time-body">${timeHtml}</div>
                    </div>
                </div>
                <div class="panel-translation">
                    <div class="panel-translation-header panel-column-header">
                        <span class="panel-header-title">🌐 Bản dịch</span>
                        <button type="button" class="panel-copy-btn btn-copy-translation" title="Copy toàn bộ bản dịch">
                            <svg class="icon-copy-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="panel-translation-body">${tgtHtml}</div>
                </div>
            `;
            srcPanel = this.contentEl.querySelector('.panel-source');
            timePanel = this.contentEl.querySelector('.panel-timestamps');
            tgtPanel = this.contentEl.querySelector('.panel-translation');
            this._bindDualScrollEvents(srcPanel, timePanel, tgtPanel);
            if (!this.userScrolledUp) {
                if (srcPanel) srcPanel.scrollTop = srcPanel.scrollHeight;
                if (timePanel) timePanel.scrollTop = timePanel.scrollHeight;
                if (tgtPanel) tgtPanel.scrollTop = tgtPanel.scrollHeight;
            }
        } else {
            const savedSrcTop = srcPanel.scrollTop;
            const savedTimeTop = timePanel.scrollTop;
            const savedTgtTop = tgtPanel.scrollTop;

            const srcBody = srcPanel.querySelector('.panel-source-body');
            const timeBody = timePanel.querySelector('.panel-time-body');
            const tgtBody = tgtPanel.querySelector('.panel-translation-body');

            if (srcBody) srcBody.innerHTML = srcHtml;
            if (timeBody) timeBody.innerHTML = timeHtml;
            if (tgtBody) tgtBody.innerHTML = tgtHtml;

            if (this.segments.length === 0 && !this.provisionalText && !this.sourceProvisionalText) {
                srcPanel.scrollTop = 0;
                timePanel.scrollTop = 0;
                tgtPanel.scrollTop = 0;
                this.userScrolledUp = false;
            } else if (this.userScrolledUp) {
                srcPanel.scrollTop = savedSrcTop;
                timePanel.scrollTop = savedTimeTop;
                tgtPanel.scrollTop = savedTgtTop;
            } else {
                srcPanel.scrollTop = srcPanel.scrollHeight;
                timePanel.scrollTop = timePanel.scrollHeight;
                tgtPanel.scrollTop = tgtPanel.scrollHeight;
            }
        }
        this._isRendering = false;
        this._updateJumpButtons();
    }

    _bindSingleScrollEvents() {
        if (!this.container || this._singleScrollBound) return;
        this._singleScrollBound = true;

        this.container.addEventListener('scroll', () => {
            if (this.isDualView() || this.isScrollingToBottom || this._isRendering) return;
            const canScroll = (this.container.scrollHeight - this.container.clientHeight) > 10;
            if (!canScroll) {
                this.userScrolledUp = false;
                this._updateJumpButtons();
                return;
            }
            const nearBottom = this._isNearBottom(this.container, 36);
            this.userScrolledUp = !nearBottom;
            this._updateJumpButtons();
        }, { passive: true });
    }

    _bindDualScrollEvents(srcPanel, timePanel, tgtPanel) {
        if (!srcPanel || !timePanel || !tgtPanel) return;

        const onPanelScroll = (sourcePanel) => {
            if (this.isSyncingScroll || this.isScrollingToSegment || this.isScrollingToBottom || this._isRendering) return;

            const canScroll = (sourcePanel.scrollHeight - sourcePanel.clientHeight) > 10;
            if (!canScroll) {
                this.userScrolledUp = false;
                this._updateJumpButtons();
                return;
            }

            const nearBottom = this._isNearBottom(sourcePanel, 36);
            this.userScrolledUp = !nearBottom;
            this._updateJumpButtons();

            // Proportionally sync other panels
            this.isSyncingScroll = true;
            const maxSource = sourcePanel.scrollHeight - sourcePanel.clientHeight;
            const ratio = maxSource > 0 ? sourcePanel.scrollTop / maxSource : 0;

            const targets = [srcPanel, timePanel, tgtPanel].filter(p => p !== sourcePanel);
            for (const target of targets) {
                if (target) {
                    const maxTarget = target.scrollHeight - target.clientHeight;
                    const newTop = Math.round(ratio * maxTarget);
                    if (Math.abs(target.scrollTop - newTop) > 1) {
                        target.scrollTop = newTop;
                    }
                }
            }
            this.isSyncingScroll = false;
        };

        srcPanel.addEventListener('scroll', () => onPanelScroll(srcPanel), { passive: true });
        tgtPanel.addEventListener('scroll', () => onPanelScroll(tgtPanel), { passive: true });
        timePanel.addEventListener('scroll', () => onPanelScroll(timePanel), { passive: true });

        timePanel.addEventListener('click', (e) => {
            const timeEl = e.target.closest('.segment-time.clickable-time');
            if (!timeEl || timeEl.dataset.segIdx === undefined) return;
            this._scrollToSegmentIndex(timeEl.dataset.segIdx);
        });
    }

    _updateJumpButtons() {
        const liveJumpBtn = document.getElementById('live-jump-bottom-btn');
        if (liveJumpBtn) {
            liveJumpBtn.classList.toggle('is-visible', Boolean(this.userScrolledUp));
            liveJumpBtn.setAttribute('aria-hidden', String(!this.userScrolledUp));
            if (!liveJumpBtn._hasClickListener) {
                liveJumpBtn._hasClickListener = true;
                liveJumpBtn.addEventListener('click', () => {
                    this._scrollPanelsToBottom();
                });
            }
        }
    }

    _scrollToSegmentIndex(idx) {
        const srcPanel = this.contentEl?.querySelector('.panel-source');
        const tgtPanel = this.contentEl?.querySelector('.panel-translation');
        const timePanel = this.contentEl?.querySelector('.panel-timestamps');
        if (!srcPanel || !tgtPanel) return;

        // User explicitly scrolled/clicked to review earlier segment
        if (Number(idx) < this.segments.length - 1) {
            this.userScrolledUp = true;
            this._updateJumpButtons();
        } else {
            this.userScrolledUp = false;
            this._updateJumpButtons();
        }

        this.isScrollingToSegment = true;
        setTimeout(() => {
            this.isScrollingToSegment = false;
        }, 600);

        const srcEl = srcPanel.querySelector(`.seg-text[data-seg-idx="${idx}"]`);
        const tgtEl = tgtPanel.querySelector(`.seg-text[data-seg-idx="${idx}"]`);
        const timeEl = timePanel?.querySelector(`.segment-time[data-seg-idx="${idx}"]`);

        // Clear existing highlights
        this.contentEl.querySelectorAll('.seg-text-active, .segment-time-active').forEach(el => {
            el.classList.remove('seg-text-active', 'segment-time-active');
        });

        if (srcEl) {
            srcEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            srcEl.classList.add('seg-text-active');
        }
        if (tgtEl) {
            tgtEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            tgtEl.classList.add('seg-text-active');
        }
        if (timeEl) {
            timeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            timeEl.classList.add('segment-time-active');
        }

        setTimeout(() => {
            srcEl?.classList.remove('seg-text-active');
            tgtEl?.classList.remove('seg-text-active');
            timeEl?.classList.remove('segment-time-active');
        }, 2500);
    }

    _scrollPanelsToBottom() {
        this.userScrolledUp = false;
        this.isScrollingToBottom = true;
        const panels = [
            this.contentEl?.querySelector('.panel-source'),
            this.contentEl?.querySelector('.panel-timestamps'),
            this.contentEl?.querySelector('.panel-translation'),
            this.container,
        ];
        panels.forEach((panel) => {
            panel?.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' });
        });
        this._updateJumpButtons();

        setTimeout(() => {
            this.isScrollingToBottom = false;
            if (this.isDualView()) {
                const srcPanel = this.contentEl?.querySelector('.panel-source');
                if (srcPanel) this.userScrolledUp = !this._isNearBottom(srcPanel, 36);
            } else if (this.container) {
                this.userScrolledUp = !this._isNearBottom(this.container, 36);
            }
            this._updateJumpButtons();
        }, 600);
    }

    _formatSegmentTime(timestamp) {
        if (!timestamp) return '--:--:--';
        return this.segmentTimeFormatter.format(new Date(timestamp));
    }

    _getScrollState(el) {
        return {
            nearBottom: this._isNearBottom(el, 36),
            scrollTop: el.scrollTop
        };
    }

    _isNearBottom(el, threshold = 36) {
        if (!el) return true;
        const remaining = Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
        return remaining <= threshold;
    }

    _smartScroll(el) {
        if (!this.userScrolledUp && el) {
            el.scrollTop = el.scrollHeight;
        }
    }

    _trimSegments() {
        // If user is scrolled up reading history, don't trim from the top unless buffer is very large
        const limit = this.userScrolledUp ? 2000 : 500;
        if (this.segments.length <= limit) return;
        while (this.segments.length > limit) {
            const completedIndex = this.segments.findIndex(seg => seg.status !== 'original');
            if (completedIndex === -1) {
                // Prevent unbounded growth if all segments are original
                this.segments.shift();
            } else {
                this.segments.splice(completedIndex, 1);
            }
        }
    }

    _esc(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Get language flag emoji + code
     */
    _langEmoji(langCode) {
        const flags = {
            'en': '🇬🇧', 'ja': '🇯🇵', 'ko': '🇰🇷', 'zh': '🇨🇳',
            'vi': '🇻🇳', 'fr': '🇫🇷', 'de': '🇩🇪', 'es': '🇪🇸',
            'th': '🇹🇭', 'id': '🇮🇩', 'pt': '🇵🇹', 'ru': '🇷🇺',
            'ar': '🇸🇦', 'hi': '🇮🇳', 'it': '🇮🇹', 'nl': '🇳🇱',
            'pl': '🇵🇱', 'tr': '🇹🇷', 'sv': '🇸🇪', 'da': '🇩🇰',
            'no': '🇳🇴', 'fi': '🇫🇮', 'el': '🇬🇷', 'cs': '🇨🇿',
            'ro': '🇷🇴', 'hu': '🇭🇺', 'uk': '🇺🇦', 'he': '🇮🇱',
            'ms': '🇲🇾', 'tl': '🇵🇭', 'bn': '🇧🇩', 'ta': '🇱🇰',
        };
        const flag = flags[langCode] || '🌐';
        return `${flag} ${langCode.toUpperCase()}`;
    }
}
