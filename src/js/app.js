/**
 * App — main application controller
 * Wires together: settings, UI, Soniox client, and audio capture
 */

import { settingsManager } from './settings.js';
import { TranscriptUI } from './ui.js';
import { sonioxClient } from './soniox.js';
import { updater } from './updater.js';
import { sessionStore, SessionStore } from './session-store.js';
import { QWEN_LANGS } from './qwen-langs.js';
import { NotesEditor } from './notes-editor.js';
import {
    initShell, setActivity, getActivity, setLiveBadge, bindMenu, initWindowModes,
} from './ui-shell.js';

const { invoke, Channel } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const LANGUAGE_DISPLAY = {
    auto: ['🌐', 'Tự động'], en: ['🇬🇧', 'English'], ja: ['🇯🇵', '日本語'],
    ko: ['🇰🇷', '한국어'], zh: ['🇨🇳', '中文'], vi: ['🇻🇳', 'Tiếng Việt'],
    fr: ['🇫🇷', 'Français'], de: ['🇩🇪', 'Deutsch'], es: ['🇪🇸', 'Español'],
    th: ['🇹🇭', 'ไทย'], id: ['🇮🇩', 'Bahasa Indonesia'], pt: ['🇵🇹', 'Português'],
    ru: ['🇷🇺', 'Русский'], ar: ['🇸🇦', 'العربية'], hi: ['🇮🇳', 'हिन्दी'],
    it: ['🇮🇹', 'Italiano'], nl: ['🇳🇱', 'Nederlands'], pl: ['🇵🇱', 'Polski'],
    tr: ['🇹🇷', 'Türkçe'], sv: ['🇸🇪', 'Svenska'], da: ['🇩🇰', 'Dansk'],
    no: ['🇳🇴', 'Norsk'], fi: ['🇫🇮', 'Suomi'], el: ['🇬🇷', 'Ελληνικά'],
    cs: ['🇨🇿', 'Čeština'], ro: ['🇷🇴', 'Română'], hu: ['🇭🇺', 'Magyar'],
    uk: ['🇺🇦', 'Українська'], he: ['🇮🇱', 'עברית'], ms: ['🇲🇾', 'Bahasa Melayu'],
    tl: ['🇵🇭', 'Filipino'], bn: ['🇧🇩', 'বাংলা'], ta: ['🇱🇰', 'தமிழ்'],
};

const PENCIL_YELLOW_ICON = `<svg class="icon-pencil-yellow" viewBox="0 0 20 20" width="13" height="13" style="display:inline-block;vertical-align:-2px;margin-right:3px;" aria-hidden="true"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>`;

const DEFAULT_TEMPLATE_NOTES = `# MTG Title
## Thông tin cuộc họp
- Người tham gia: 
- Ngày tháng: {{date}}

## Nội dung cuộc họp 


## TODO
- [ ] 
`;

const DEFAULT_TEMPLATE_MINUTES_JA = `# 📋 会議議事録 (Meeting Minutes)

### 📌 基本情報
- **会議名**: {{title}}
- **日時**: {{date}} (所要時間: 約 {{duration}} 分)
- **参加者**: {{participants}}

---

### 🎯 1. 背景と目的 (Background & Objectives)
(なぜこの会議が行われたのか、今回の主な討議の狙い・背景)

---

### 📝 2. 主な協議内容と決定事項 (Key Discussion & Decisions)
- **協議内容の要約**:
  - (要点をトピックごとに整理して箇条書きで記載)
- **決定事項 (Key Decisions)**:
  - (合意された決定内容)

---

### ✅ 3. 今後のアクションプラン (Action Items / Next Steps)
| No | タスク (Task) | 担当者 (Assignee) | 期日 (Deadline) | 備考 |
|:---|:---|:---|:---|:---|
| 1 | ... | ... | ... | ... |
`;

const DEFAULT_TEMPLATE_MINUTES_VI = `# 📋 BIÊN BẢN CUỘC HỌP (MEETING MINUTES)

### 📌 THÔNG TIN CHUNG
- **Tiêu đề cuộc họp**: {{title}}
- **Thời gian**: {{date}} (Thời lượng: ~{{duration}} phút)
- **Người tham gia**: {{participants}}

---

### 🎯 1. BỐI CẢNH & MỤC ĐÍCH (CONTEXT & OBJECTIVES)
(Bối cảnh diễn ra cuộc họp, các vấn đề cần thảo luận và mục tiêu cần đạt được)

---

### 📝 2. NỘI DUNG TÓM TẮT & CÁC ĐIỂM THỐNG NHẤT (SUMMARY & DECISIONS)
- **Tóm tắt nội dung trao đổi chính**:
  - (Các luận điểm chính được trình bày mạch lạc, dễ hiểu)
- **Các quyết định đã chốt (Key Decisions)**:
  - (Các điểm hai bên đã thống nhất)

---

### ✅ 3. VIỆC CẦN LÀM & KẾ HOẠCH TIẾP THEO (ACTION ITEMS / NEXT STEPS)
| STT | Công việc (Task) | Người phụ trách (Assignee) | Hạn chót (Deadline) | Ghi chú |
|:---|:---|:---|:---|:---|
| 1 | ... | ... | ... | ... |
`;

class App {
    constructor() {
        this.isRunning = false;
        this.isStarting = false; // Guard against re-entry
        this.currentSource = 'system'; // 'system' | 'microphone' | 'both'
        this.currentViewMode = 'dual'; // 'dual' | 'original' | 'translation'
        this._viewModeBeforeNoTranslation = null;
        this._forcedOriginalForNoTranslation = false;
        this.translationMode = 'gemini'; // 'gemini' | 'soniox' | 'openai' | 'qwen' | 'local'
        this.appWindow = getCurrentWindow();
        this.sessionStartTime = null;
        this.recordingStartTime = null;
        this.liveDurationInterval = null;
        this.sessionMode = 'one_way';
        this.isPinned = false;    // Always-on-top state (default false)
        this._closing = false;    // Guard so the exit flush runs exactly once
        this._selectedSessionIds = new Set();
        this.isPaused = false;
        this._liveNotesEditor = null;
        this._sessionViewerEditor = null;
        this._sessionMinutesEditor = null;
        this._sessionNotesEditor = null;
        this._sessionLogsEditor = null;
        this._activeSessionTab = 'minutes';
        this._activeMinutesLang = 'ja';
        this._loadedMinutes = { ja: '', vi: '' };
        this._isMinutesEditing = false;
        this._isNotesEditing = false;
        this._hasUnsavedMeetingData = false;
        this._inactivityTimer = null;
        this._captureHealthTimer = null;
        this._isStopConfirmationOpen = false;
        this._projectRegistry = null;
        this._activeCustomerFilter = null;
        this._activeProjectFilter = null;
        this._activeCategoryFilter = null;
        this._activeTagFilter = null;
        this._custSort = { field: 'name', dir: 'asc' };
        this._projSort = { field: 'name', dir: 'asc' };
        this._catSort = { field: 'name', dir: 'asc' };
        this._tagSort = { field: 'name', dir: 'asc' };
        this._templateEditor = null;
        this._activeTemplateTab = 'notes';
        this._templateDrafts = {};
        this._geminiReconnectTimer = null;
        this._liveEngineRestart = Promise.resolve();
        this._liveEngineGeneration = 0;
        this._quickLanguageUpdate = Promise.resolve();
        this._liveDurationTimer = null;
        this._geminiDiscoveredModels = null;
        this._geminiModelsCacheTime = 0;
        this._geminiBlacklistedModels = new Set();
    }

    async init() {
        // UI Shell tabs (must be initialized first so tabs work immediately)
        this._initShellAndMenus();

        // Load settings
        await settingsManager.load();

        // Init transcript UI
        const transcriptContainer = document.getElementById('transcript-content');
        this.transcriptUI = new TranscriptUI(transcriptContainer);
        this.transcriptUI.onToast = (msg, type) => this._showToast(msg, type);
        this.transcriptUI.onActivity = () => this._resetInactivityTimer();

        // Init session store — one session file lives across many Start/Pause
        // cycles; it autosaves while recording and finalizes on Stop or app close.
        const initSettings = settingsManager.get();
        sessionStore.init({
            engine: initSettings.translation_mode || 'gemini',
            sourceLang: initSettings.source_language || 'ja',
            targetLang: initSettings.target_language || 'vi',
        });

        // Check platform — hide Local MLX on non-Apple-Silicon
        await this._checkPlatformSupport();

        // Apply saved settings to UI
        this._applySettings(settingsManager.get());

        // Bind event listeners
        this._bindEvents();

        // Flush the session on every close route (window ✕, Cmd+Q, Dock quit).
        await this._bindCloseHooks();

        // Bind keyboard shortcuts
        this._bindKeyboardShortcuts();

        // Subscribe to settings changes
        settingsManager.onChange((settings) => this._applySettings(settings));

        // Window position restore disabled — causes issues on Retina displays
        // await this._restoreWindowPosition();

        // Window modes: overlay ↔ expanded (⤢), restores last mode + sizes
        // Maximize window by default on app launch
        try {
            await this.appWindow.maximize();
        } catch (e) {
            console.warn('Failed to maximize window on start:', e);
        }

        // Always-on-top state: default false, or restore user preference
        const savedPinned = localStorage.getItem('is_pinned') === 'true';
        this.isPinned = savedPinned;
        try {
            await this.appWindow.setAlwaysOnTop(this.isPinned);
        } catch (e) {
            console.warn('Failed to set initial alwaysOnTop:', e);
        }
        const btnPin = document.getElementById('btn-pin');
        if (btnPin) btnPin.classList.toggle('active', this.isPinned);

        // Check for updates (non-blocking)
        this._initAboutTab();
        this._checkForUpdates();

        console.log('🌐 Meet Minder v0.9.1 initialized');
    }

    async _checkPlatformSupport() {
        try {
            // Apple Silicon detection must be Rosetta-proof: the x64 build on an
            // ARM Mac reports arch "x86_64" but is_arm_hardware asks the real CPU.
            // MLX runs as a native-ARM Python subprocess, so it works even when
            // the app binary itself is x64-under-Rosetta.
            const arch = await invoke('get_platform_info');
            const info = JSON.parse(arch);
            this._platformOs = info.os; // 'macos' | 'windows' | 'linux'
            this.isAppleSilicon = info.is_arm_hardware === true
                || (info.os === 'macos' && info.arch === 'aarch64');
        } catch {
            // Fallback: check via navigator
            this._platformOs = navigator.userAgent.includes('Mac OS X') ? 'macos'
                : navigator.userAgent.includes('Windows') ? 'windows' : 'linux';
            this.isAppleSilicon = navigator.platform === 'MacIntel' &&
                navigator.userAgent.includes('Mac OS X');
        }

        if (!this.isAppleSilicon) {
            // Keep Local MLX SELECTABLE — don't hard-block. We highlight a warning
            // when the user picks it (see _updateModeUI) and stop them at Start
            // (see start()) so they can't crash into an unsupported runtime.
            // Local TTS is CPU-based and unaffected; only the MLX engine needs
            // macOS Apple Silicon.
            const select = document.getElementById('select-translation-mode');
            const localOption = select?.querySelector('option[value="local"]');
            if (localOption) {
                // Platform-accurate label: Mac Intel needs Apple Silicon;
                // Windows/Linux aren't supported at all.
                const reason = this._platformOs === 'macos'
                    ? ' — cần chip Apple Silicon'
                    : ' — chỉ hỗ trợ macOS Apple Silicon';
                localOption.textContent += reason;
            }

            // Force soniox mode if user had local selected
            const settings = settingsManager.get();
            if (settings.translation_mode === 'local') {
                settings.translation_mode = 'soniox';
                settingsManager.save(settings);
            }
        }
    }

    // ─── Event Binding ──────────────────────────────────────

    _bindEvents() {
        // Settings button
        document.getElementById('btn-settings')?.addEventListener('click', () => {
            this._showView('settings');
        });

        // Back from settings
        document.getElementById('btn-back')?.addEventListener('click', () => {
            this._showView('overlay');
        });

        // Save Meeting Log buttons
        document.getElementById('btn-save-meeting')?.addEventListener('click', () => {
            this._promptSaveMeeting();
        });
        document.getElementById('btn-menu-save-meeting')?.addEventListener('click', () => {
            this._promptSaveMeeting();
        });

        // Back from session viewer to session list
        document.getElementById('btn-session-back-to-list')?.addEventListener('click', () => {
            this._exitSessionEditMode();
            document.getElementById('sessions-list-panel').style.display = '';
            document.getElementById('session-viewer').style.display = 'none';
            this._showSessions();
        });

        // Copy session content
        const btnSessionCopy = document.getElementById('btn-session-copy');
        btnSessionCopy?.addEventListener('click', async () => {
            const content = this._sessionViewerEditor ? this._sessionViewerEditor.getContent() : '';
            if (content) {
                await navigator.clipboard.writeText(content);
                this._showToast('Đã copy nội dung cuộc họp ✓', 'success');
                const orig = btnSessionCopy.innerHTML;
                btnSessionCopy.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#85e0a3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                setTimeout(() => { if (btnSessionCopy) btnSessionCopy.innerHTML = orig; }, 1500);
            }
        });

        // Session search box (debounced)
        const searchInput = document.getElementById('input-session-search');
        if (searchInput) {
            let t;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(t);
                const q = e.target.value;
                t = setTimeout(() => this._showSessions(q), 200);
            });
        }

        // Customer filter dropdown
        document.getElementById('select-session-customer-filter')?.addEventListener('change', (e) => {
            this._activeCustomerFilter = e.target.value || null;
            this._renderProjectFilterBar();
            this._renderFilteredSessions();
        });

        // Project filter dropdown
        document.getElementById('select-session-project-filter')?.addEventListener('change', (e) => {
            this._activeProjectFilter = e.target.value || null;
            this._renderFilteredSessions();
        });

        // Category filter dropdown
        document.getElementById('select-session-category-filter')?.addEventListener('change', (e) => {
            this._activeCategoryFilter = e.target.value || null;
            this._renderFilteredSessions();
        });

        // Tag filter dropdown
        document.getElementById('select-session-tag-filter')?.addEventListener('change', (e) => {
            this._activeTagFilter = e.target.value || null;
            this._renderFilteredSessions();
        });
        // Settings Sidebar 2-Column Navigation
        document.querySelectorAll('.settings-nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                this._showSettingsScreen(btn.dataset.screen);
            });
        });
        this._initSettingsTemplatesTab();

        // Add Customer Modal Triggers
        document.getElementById('btn-open-add-customer')?.addEventListener('click', () => {
            this._openAddCustomerModal();
        });
        document.getElementById('btn-close-add-customer')?.addEventListener('click', () => {
            this._closeAddCustomerModal();
        });
        document.getElementById('btn-cancel-add-customer')?.addEventListener('click', () => {
            this._closeAddCustomerModal();
        });
        document.getElementById('btn-save-add-customer')?.addEventListener('click', async () => {
            await this._handleSaveCustomerFromModal();
        });

        // Add Project Modal Triggers
        document.getElementById('btn-open-add-project')?.addEventListener('click', async () => {
            await this._openAddProjectModal();
        });
        document.getElementById('btn-close-add-project')?.addEventListener('click', () => {
            this._closeAddProjectModal();
        });
        document.getElementById('btn-cancel-add-project')?.addEventListener('click', () => {
            this._closeAddProjectModal();
        });
        document.getElementById('btn-save-add-project')?.addEventListener('click', async () => {
            await this._handleSaveProjectFromModal();
        });

        // Customer Search & Project Filter
        document.getElementById('input-search-customers')?.addEventListener('input', (e) => {
            this._renderSettingsCustomersTab(e.target.value);
        });
        document.getElementById('input-search-projects')?.addEventListener('input', (e) => {
            const custFilter = document.getElementById('select-settings-proj-cust-filter')?.value;
            this._renderSettingsProjectsTab(custFilter, e.target.value);
        });
        document.getElementById('select-settings-proj-cust-filter')?.addEventListener('change', (e) => {
            const searchVal = document.getElementById('input-search-projects')?.value;
            this._renderSettingsProjectsTab(e.target.value, searchVal);
        });

        // Quick create Category button
        document.getElementById('btn-create-category')?.addEventListener('click', async () => {
            await this._handleCreateCategory();
        });

        // Quick create Tag button
        document.getElementById('btn-create-tag')?.addEventListener('click', async () => {
            await this._handleCreateTag();
        });

        // Select all sessions checkbox
        document.getElementById('chk-select-all-sessions')?.addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.session-item-chk').forEach(chk => {
                chk.checked = checked;
                const id = chk.dataset.id;
                if (checked) this._selectedSessionIds.add(id);
                else this._selectedSessionIds.delete(id);
            });
            this._updateBatchSelectionUI();
        });

        // Batch delete sessions
        document.getElementById('btn-batch-delete-sessions')?.addEventListener('click', async () => {
            await this._deleteSelectedSessions();
        });

        // Batch export markdown
        document.getElementById('btn-batch-export-md')?.addEventListener('click', async () => {
            await this._batchExportMarkdown();
        });

        // Batch AI Digest
        document.getElementById('btn-batch-ai-digest')?.addEventListener('click', async () => {
            await this._batchAiDigest();
        });

        // AI Digest Modal events
        document.getElementById('btn-close-ai-digest')?.addEventListener('click', () => {
            const modal = document.getElementById('modal-ai-digest');
            if (modal) modal.style.display = 'none';
        });
        document.getElementById('btn-close-ai-digest-bottom')?.addEventListener('click', () => {
            const modal = document.getElementById('modal-ai-digest');
            if (modal) modal.style.display = 'none';
        });
        document.getElementById('btn-copy-ai-digest')?.addEventListener('click', async () => {
            if (this._currentAiDigestText) {
                await navigator.clipboard.writeText(this._currentAiDigestText);
                this._showToast('Đã copy nội dung tổng hợp ✓', 'success');
            }
        });
        document.getElementById('btn-export-ai-digest')?.addEventListener('click', () => {
            if (this._currentAiDigestText) {
                const blob = new Blob([this._currentAiDigestText], { type: 'text/markdown;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `meeting-chain-digest-${new Date().toISOString().slice(0, 10)}.md`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                this._showToast('Đã lưu file Markdown ✓', 'success');
            }
        });

        // Resume session from viewer
        document.getElementById('btn-session-resume')?.addEventListener('click', async () => {
            const cur = this._currentViewedSession;
            if (cur) await this._resumeSession(cur.id, cur.isLegacy);
        });

        // Edit metadata from viewer
        document.getElementById('btn-session-edit-tags')?.addEventListener('click', async () => {
            const cur = this._currentViewedSession;
            if (!cur || cur.isLegacy) {
                this._showToast('Không thể sửa thông tin cuộc họp định dạng cũ', 'info');
                return;
            }
            const res = await invoke('read_session', { id: cur.id });
            await this._editSessionMetadata({
                id: cur.id,
                title: res.json?.title || cur.title,
                project_id: res.json?.project_id || null,
                category: res.json?.category || null,
                tags: res.json?.tags || [],
            });
            if (this._currentViewedSession && this._currentViewedSession.id === cur.id) {
                try {
                    const refreshed = await invoke('read_session', { id: cur.id });
                    if (this._sessionViewerEditor) this._sessionViewerEditor.setContent(refreshed.md);
                    const titleEl = document.getElementById('session-viewer-title');
                    if (titleEl) titleEl.textContent = refreshed.json?.title || cur.id;
                } catch {}
            }
        });

        // TTS play session
        document.getElementById('btn-session-tts-play')?.addEventListener('click', () => {
            const cur = this._currentViewedSession;
            if (cur) this._playSessionTTS(cur.id, cur.isLegacy);
        });

        this._bindSessionPlayer(document.querySelector('.session-player-detail'));

        // Delete single session from viewer
        document.getElementById('btn-session-delete-single')?.addEventListener('click', async () => {
            const cur = this._currentViewedSession;
            if (!cur) return;
            if (cur.id === sessionStore.id) {
                this._showToast('Không thể xoá cuộc họp đang chạy — hãy Dừng trước', 'error');
                return;
            }
            if (!confirm('Xóa vĩnh viễn cuộc họp này?')) return;
            try {
                await invoke('delete_session', { id: cur.id });
                this._showToast('Đã xóa cuộc họp', 'success');
                document.getElementById('sessions-list-panel').style.display = '';
                document.getElementById('session-viewer').style.display = 'none';
                await this._showSessions();
            } catch (err) {
                this._showToast(`Xóa thất bại: ${err}`, 'error');
            }
        });

        // Edit session inline (title + content)
        document.getElementById('btn-session-edit-title')?.addEventListener('click', () => {
            this._enterSessionEditMode();
        });

        // Save session inline edit
        document.getElementById('btn-session-save-edit')?.addEventListener('click', () => {
            this._saveSessionEdit();
        });

        // Cancel session inline edit
        document.getElementById('btn-session-cancel-edit')?.addEventListener('click', () => {
            this._exitSessionEditMode();
        });

        this._initSessionViewerTabs();

        // Keybindings inside inline session inputs
        const inputSessionTitle = document.getElementById('input-session-viewer-title');

        inputSessionTitle?.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                e.stopPropagation();
                this._saveSessionEdit();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                this._sessionViewerEditor?.focus();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this._exitSessionEditMode();
            }
        });

        // Export session
        document.getElementById('btn-session-export-srt')?.addEventListener('click', () => this._exportCurrentSession('srt'));
        document.getElementById('btn-session-export-txt')?.addEventListener('click', () => this._exportCurrentSession('txt'));

        // macOS Traffic Light Window Controls
        document.getElementById('btn-win-close')?.addEventListener('click', async () => {
            await this._saveWindowPosition();
            await this.appWindow.close();
        });
        document.getElementById('btn-win-minimize')?.addEventListener('click', async () => {
            await this.appWindow.minimize();
        });
        document.getElementById('btn-win-maximize')?.addEventListener('click', async () => {
            await this.appWindow.toggleMaximize();
        });

        // Close button (overlay / legacy)
        document.getElementById('btn-close')?.addEventListener('click', async () => {
            await this._saveWindowPosition();
            await this.appWindow.close();
        });

        // Pin/Unpin button
        document.getElementById('btn-pin')?.addEventListener('click', () => {
            this._togglePin();
        });

        // View mode select pulldown (Dual / Original / Translation)
        document.getElementById('select-view-mode')?.addEventListener('change', (e) => {
            this._setViewMode(e.target.value);
        });

        // Quick Language Switchers (Source / Target)
        document.getElementById('quick-select-source-lang')?.addEventListener('change', async (e) => {
            await this._handleQuickSourceLangChange(e.target.value);
        });
        document.getElementById('quick-select-target-lang')?.addEventListener('change', async (e) => {
            await this._handleQuickTargetLangChange(e.target.value);
        });
        document.getElementById('btn-quick-swap-lang')?.addEventListener('click', async () => {
            await this._handleQuickLangSwap();
        });

        // Translation Timing select pulldown (Realtime vs Chờ dứt câu)
        document.getElementById('select-translation-timing')?.addEventListener('change', async (e) => {
            await this._setTranslationTiming(e.target.value);
        });

        // Font size quick controls
        document.getElementById('btn-font-up')?.addEventListener('click', () => this._adjustFontSize(4));
        document.getElementById('btn-font-down')?.addEventListener('click', () => this._adjustFontSize(-4));

        // Color dot controls
        document.querySelectorAll('.color-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
                const color = dot.dataset.color;
                this.transcriptUI.configure({ fontColor: color });
            });
        });

        // Main Start / Pause button
        document.getElementById('btn-start')?.addEventListener('click', async () => {
            if (this.isStarting) return;
            try {
                if (this.isRunning) {
                    // Running -> click to Pause
                    await this.pause();
                } else {
                    // Idle or Paused -> click to Start / Resume
                    this.isStarting = true;
                    await this.start();
                }
            } catch (err) {
                console.error('[App] Start/Pause error:', err);
                this._showToast(`Lỗi: ${err}`, 'error');
                this.isRunning = false;
                this.isPaused = false;
                this._updateStartButton();
                this._updateStatus('error');
            } finally {
                this.isStarting = false;
            }
        });

        // Dynamic Stop / Save Log button
        document.getElementById('btn-stop')?.addEventListener('click', async () => {
            if (this._isStopConfirmationOpen) return;
            const stopAction = await this._promptConfirmStop();
            await this._handleStopSessionAction(stopAction);
        });

        // Source buttons
        // Audio source dropdown (⌘1/2/3 still switch via _setSource)
        document.getElementById('select-audio-source')?.addEventListener('change', (e) => {
            this._setSource(e.target.value);
        });
        document.querySelectorAll('input[name="audio-source"]').forEach((radio) => {
            radio.addEventListener('change', (e) => this._setSource(e.target.value));
        });

        // Clear button — clears display only (auto-save happens on stop)
        document.getElementById('btn-clear')?.addEventListener('click', async () => {
            this.transcriptUI.clear();
            this.transcriptUI.showPlaceholder();
            this.recordingStartTime = null;
        });

        // Copy transcript button (if present)
        document.getElementById('btn-copy')?.addEventListener('click', async () => {
            const text = this.transcriptUI.getPlainText();
            if (text) {
                await navigator.clipboard.writeText(text);
                this._showToast('Copied to clipboard', 'success');
            } else {
                this._showToast('Nothing to copy', 'info');
            }
        });

        // Open saved transcripts folder in Finder
        document.getElementById('btn-open-transcripts-dir')?.addEventListener('click', async () => {
            try {
                await invoke('open_transcript_dir');
            } catch (err) {
                this._showToast('Failed to open folder: ' + err, 'error');
            }
        });
        document.getElementById('btn-open-transcripts')?.addEventListener('click', async () => {
            try {
                await invoke('open_transcript_dir');
            } catch (err) {
                this._showToast('Failed to open folder: ' + err, 'error');
            }
        });

        // Storage Directory Customization
        document.getElementById('btn-change-storage-dir')?.addEventListener('click', async () => {
            try {
                const info = await invoke('select_custom_transcripts_dir');
                if (info) {
                    this._showToast('Đã đổi thư mục lưu trữ thành công ✓', 'success');
                    this._renderSettingsStorageTab();
                    await this._showSessions();
                }
            } catch (err) {
                this._showToast(`Đổi thư mục thất bại: ${err}`, 'error');
            }
        });

        document.getElementById('btn-reset-storage-dir')?.addEventListener('click', async () => {
            const agreed = await this._promptConfirmDelete({
                title: 'Đặt lại thư mục mặc định',
                message: 'Bạn có muốn chuyển vị trí lưu trữ về lại thư mục mặc định của ứng dụng?',
                confirmText: 'Đặt lại'
            });
            if (!agreed) return;
            try {
                await invoke('set_custom_transcripts_dir', { path: null });
                this._showToast('Đã chuyển về thư mục mặc định ✓', 'success');
                this._renderSettingsStorageTab();
                await this._showSessions();
            } catch (err) {
                this._showToast(`Lỗi: ${err}`, 'error');
            }
        });

        // Initialize Horizontal Take Note Drawer
        this._initNotesModule();

        // Settings form elements
        this._bindSettingsForm();

        // Manual drag for settings view
        document.getElementById('settings-view')?.addEventListener('mousedown', (e) => {
            const interactive = e.target.closest('button, input, select, label, a, textarea, .settings-section, .settings-actions');
            if (!interactive && e.buttons === 1) {
                e.preventDefault();
                this.appWindow.startDragging();
            }
        });

        // Toggle API key visibility
        document.getElementById('btn-toggle-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-api-key');
            if (input) input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('btn-toggle-openai-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-openai-key');
            if (input) input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('btn-toggle-gemini-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-gemini-key');
            if (input) input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('btn-toggle-qwen-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-qwen-key');
            if (input) input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('select-gemini-model')?.addEventListener('change', (e) => {
            const customSection = document.getElementById('section-gemini-custom-model');
            if (customSection) {
                customSection.style.display = e.target.value === 'custom' ? 'block' : 'none';
            }
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('input-gemini-custom-model')?.addEventListener('input', () => {
            this._debouncedAutoSave();
        });

        document.getElementById('link-openai')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__.opener.openUrl('https://platform.openai.com/api-keys');
        });

        document.getElementById('link-gemini')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__.opener.openUrl('https://aistudio.google.com/app/apikey');
        });

        document.getElementById('link-soniox')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__.opener.openUrl('https://console.soniox.com/signup/');
        });

        // Inline key format validation + auto-save on change
        const sonioxInput = document.getElementById('input-api-key');
        const openaiInput = document.getElementById('input-openai-key');
        const geminiInput = document.getElementById('input-gemini-key');
        const qwenInput = document.getElementById('input-qwen-key');

        sonioxInput?.addEventListener('input', () => {
            this._refreshKeyStatus();
            this._debouncedAutoSave();
        });
        openaiInput?.addEventListener('input', () => {
            this._refreshKeyStatus();
            this._debouncedAutoSave();
        });
        geminiInput?.addEventListener('input', () => {
            this._refreshKeyStatus();
            this._debouncedAutoSave();
        });
        qwenInput?.addEventListener('input', () => {
            this._refreshKeyStatus();
            this._debouncedAutoSave();
        });

        // Test-connection buttons
        document.getElementById('btn-test-soniox')?.addEventListener('click', () => this._testConnection('soniox'));
        document.getElementById('btn-test-openai')?.addEventListener('click', () => this._testConnection('openai'));

        // Translation mode toggle
        document.getElementById('select-translation-mode')?.addEventListener('change', (e) => {
            this._updateModeUI(e.target.value);
            this._autoSaveSettingsFromForm();
        });

        // Inactivity timeout change
        document.getElementById('select-inactivity-timeout')?.addEventListener('change', (e) => {
            const val = parseInt(e.target.value, 10);
            settingsManager.save({ inactivity_timeout_min: isNaN(val) ? 10 : val });
            this._resetInactivityTimer();
        });

        // Welcome-screen engine cards
        document.querySelectorAll('#engine-picker .engine-card').forEach(card => {
            card.addEventListener('click', () => {
                this._selectEngineClass(card.dataset.engineClass);
                this._hideEnginePicker();
            });
        });

        // Toolbar engine pill
        document.querySelectorAll('#engine-pill .engine-pill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.isRunning || this.isStarting) {
                    this._showToast('Pause the session before switching engine', 'error');
                    return;
                }
                this._selectEngineClass(btn.dataset.engineClass);
            });
        });

        // Audio Source radio change
        document.querySelectorAll('input[name="audio-source"]').forEach(r => {
            r.addEventListener('change', () => this._autoSaveSettingsFromForm());
        });

        // Slider live updates & auto-save
        document.getElementById('range-opacity')?.addEventListener('input', (e) => {
            const valEl = document.getElementById('opacity-value');
            if (valEl) valEl.textContent = `${e.target.value}%`;
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('range-font-size')?.addEventListener('input', (e) => {
            const valEl = document.getElementById('font-size-value');
            if (valEl) valEl.textContent = `${e.target.value}px`;
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('range-note-font-size')?.addEventListener('input', (e) => {
            const valEl = document.getElementById('note-font-size-value');
            if (valEl) valEl.textContent = `${e.target.value}px`;
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('input-font-color')?.addEventListener('input', (e) => {
            const valEl = document.getElementById('font-color-value');
            if (valEl) valEl.textContent = e.target.value.toUpperCase();
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('select-font-family')?.addEventListener('change', () => {
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('range-max-lines')?.addEventListener('input', (e) => {
            const valEl = document.getElementById('max-lines-value');
            if (valEl) valEl.textContent = e.target.value;
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('check-show-original')?.addEventListener('change', () => {
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('range-endpoint-delay')?.addEventListener('input', (e) => {
            const valEl = document.getElementById('endpoint-delay-value');
            if (valEl) valEl.textContent = `${(e.target.value / 1000).toFixed(1)}s`;
            this._autoSaveSettingsFromForm();
        });

        // Context fields
        document.getElementById('input-context-terms')?.addEventListener('input', () => this._debouncedAutoSave());
        document.getElementById('input-context-text')?.addEventListener('input', () => this._debouncedAutoSave());

        // Audio Diagnostics & Test buttons
        document.getElementById('btn-test-mic-rec')?.addEventListener('click', () => {
            this._startAudioRecordingTest();
        });
        document.getElementById('btn-test-mic-live')?.addEventListener('click', () => {
            this._toggleAudioLiveMonitor();
        });

        // Settings wizard navigation: home cards open detail screens, back rows return home
        document.querySelectorAll('.settings-card, .settings-back-row').forEach(el => {
            el.addEventListener('click', () => {
                if (el.classList.contains('disabled')) return;
                this._showSettingsScreen(el.dataset.screen);
            });
        });

        // Add translation term row
        document.getElementById('btn-add-term')?.addEventListener('click', () => {
            this._addTermRow('', '');
        });

        // Add general context row
        document.getElementById('btn-add-general')?.addEventListener('click', () => {
            this._addGeneralRow('', '');
        });

        // Wire Soniox callbacks. Soniox emits original + translation as
        // separate finals; we FIFO-pair them into the session store so each
        // saved segment has both source and target text.
        this._sonioxOriginalQueue = [];
        this._sonioxPendingId = 0;
        sonioxClient.onOriginal = (text, speaker, language) => {
            const pendingId = ++this._sonioxPendingId;
            this.transcriptUI.addOriginal(text, speaker, language, pendingId);
            this._sonioxOriginalQueue.push({ text, pendingId });
            // Persist the source immediately. If the user changes language or
            // turns translation off before the target arrives, the utterance
            // must still remain in the session and must not block later pairs.
            sessionStore.addSegment(text, '', pendingId, speaker);
        };

        sonioxClient.onTranslation = (text) => {
            const pending = this._sonioxOriginalQueue.shift() || null;
            this.transcriptUI.addTranslation(text, pending?.pendingId ?? null);
            if (!sessionStore.completeFirstPendingTranslation(text, pending?.pendingId ?? null)) {
                sessionStore.addSegment(pending?.text || '', text);
            }
            this._speakIfEnabled(text);
        };

        sonioxClient.onProvisional = (text, speaker, language) => {
            if (text) {
                this.transcriptUI.setProvisional(text, speaker, language);
            } else {
                this.transcriptUI.clearProvisional();
            }
        };

        sonioxClient.onStatusChange = (status) => {
            this._updateStatus(status);
        };

        sonioxClient.onError = (error) => {
            this._showToast(error, 'error');
        };

        sonioxClient.onConfidence = (avgConfidence) => {
            this.transcriptUI.setConfidence(avgConfidence);
        };
    }

    _bindSettingsForm() {
        // These are handled in _populateSettingsForm and _saveSettingsFromForm
    }

    // ─── Keyboard Shortcuts ─────────────────────────────────

    _bindKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            const hasModifier = e.metaKey || e.ctrlKey;
            const isTyping = (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) && !e.target.readOnly;

            // Inline session editing shortcuts
            if (this._isSessionEditing) {
                if (hasModifier && (e.key === 's' || e.key === 'S')) {
                    e.preventDefault();
                    this._saveSessionEdit();
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this._exitSessionEditMode();
                    return;
                }
            }

            // Cmd/Ctrl + L/O: switch the top-level activity.
            if (hasModifier && !isTyping && (e.key === 'l' || e.key === 'L')) {
                e.preventDefault();
                setActivity('live');
                return;
            }
            if (hasModifier && !isTyping && (e.key === 'o' || e.key === 'O')) {
                e.preventDefault();
                setActivity('library');
                return;
            }

            // Cmd/Ctrl + C: Continue a paused session.
            if (hasModifier && !isTyping && (e.key === 'c' || e.key === 'C') && this.isPaused) {
                e.preventDefault();
                if (!this.isStarting) this.start();
                return;
            }

            // Cmd/Ctrl + S: Start a new session (or keep the legacy toggle).
            if (hasModifier && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                if (this.isStarting) return;
                (async () => {
                    try {
                        if (this.isRunning) {
                            await this.pause();
                        } else {
                            this.isStarting = true;
                            await this.start();
                        }
                    } catch (err) {
                        console.error('[App] Keyboard start/pause error:', err);
                        this._showToast(`Lỗi: ${err}`, 'error');
                        this.isRunning = false;
                        this.isPaused = false;
                        this._updateStartButton();
                        this._updateStatus('error');
                    } finally {
                        this.isStarting = false;
                    }
                })();
                return;
            }

            // Cmd/Ctrl + T: Stop (Kết thúc cuộc họp & Lưu)
            if (hasModifier && (e.key === 't' || e.key === 'T')) {
                e.preventDefault();
                if (this.isRunning || this.isPaused || this._hasUnsavedMeetingData) {
                    if (this._isStopConfirmationOpen) return;
                    // Keep the keyboard path consistent with the Stop button:
                    // users must be able to confirm the action and name the log.
                    (async () => {
                        const stopAction = await this._promptConfirmStop();
                        await this._handleStopSessionAction(stopAction);
                    })();
                }
                return;
            }

            // Cmd/Ctrl + N: Take Note (Mở / Đóng ghi chú nhanh)
            if (hasModifier && (e.key === 'n' || e.key === 'N')) {
                e.preventDefault();
                this._toggleNotesDrawer();
                return;
            }

            // Cmd/Ctrl + Enter: Start / Pause fallback
            if (hasModifier && e.key === 'Enter') {
                e.preventDefault();
                if (this.isStarting) return;
                (async () => {
                    try {
                        if (this.isRunning) {
                            await this.pause();
                        } else {
                            this.isStarting = true;
                            await this.start();
                        }
                    } catch (err) {
                        console.error('[App] Keyboard start/pause error:', err);
                        this._showToast(`Lỗi: ${err}`, 'error');
                        this.isRunning = false;
                        this.isPaused = false;
                        this._updateStartButton();
                        this._updateStatus('error');
                    } finally {
                        this.isStarting = false;
                    }
                })();
                return;
            }

            // Cmd/Ctrl + ,: Open settings
            if (hasModifier && e.key === ',') {
                e.preventDefault();
                this._showView('settings');
                return;
            }

            // Cmd/Ctrl + 1: Switch to System Audio
            if (hasModifier && e.key === '1') {
                e.preventDefault();
                this._setSource('system');
                return;
            }

            // Cmd/Ctrl + 2: Switch to Microphone
            if (hasModifier && e.key === '2') {
                e.preventDefault();
                this._setSource('microphone');
                return;
            }

            // Cmd/Ctrl + 3: Switch to Both
            if (hasModifier && e.key === '3') {
                e.preventDefault();
                this._setSource('both');
                return;
            }

            // Cmd/Ctrl + M: Minimize
            if (hasModifier && (e.key === 'm' || e.key === 'M')) {
                e.preventDefault();
                this._saveWindowPosition();
                this.appWindow.minimize();
                return;
            }

            // Cmd/Ctrl + P: Pause while running; otherwise toggle Pin.
            if (hasModifier && (e.key === 'p' || e.key === 'P')) {
                e.preventDefault();
                if (this.isRunning) this.pause();
                else this._togglePin();
                return;
            }

            // Non-modifier shortcuts below — ignore when typing in input fields
            if (isTyping) {
                return;
            }

            // Escape: Go back to overlay / close settings
            if (e.key === 'Escape') {
                e.preventDefault();
                // Shortcut sheet closes first if open
                const sheet = document.getElementById('shortcut-sheet');
                if (sheet && sheet.style.display !== 'none') {
                    this._toggleShortcutSheet?.(false);
                    return;
                }
                const settingsVisible = document.getElementById('settings-view').classList.contains('active');
                if (settingsVisible) {
                    this._showView('overlay');
                }
            }

            // "?": shortcut cheat-sheet
            if (e.key === '?' && !hasModifier) {
                e.preventDefault();
                this._toggleShortcutSheet?.(true);
            }
        });
    }

    // ─── Views ──────────────────────────────────────────────

    _showView(view) {
        document.getElementById('overlay-view').classList.toggle('active', view === 'overlay');
        document.getElementById('settings-view').classList.toggle('active', view === 'settings');

        if (view === 'settings') {
            this._populateSettingsForm();
            this._showSettingsScreen('tab-customers');
        }
        // Returning to the overlay while in Read mode: a voice/provider may have
        // changed in Settings — refresh both the capability hint AND the voice
        // quick-pick (else it keeps the old provider's options + settings key).
        if (view === 'overlay' && getActivity() === 'read') {
            this._populateReadQuickPick();
            this._showReadCapabilityHint();
        }
    }

    /** Show one settings screen (sidebar item selected) inside the 2-column settings view. */
    _showSettingsScreen(id) {
        if (!id || !document.getElementById(id)) id = 'tab-customers';
        this._currentSettingsScreen = id;

        // Highlight sidebar nav item
        document.querySelectorAll('.settings-nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.screen === id);
        });

        // Show active content tab
        document.querySelectorAll('.settings-tab-content').forEach(c => {
            c.classList.toggle('active', c.id === id);
        });

        if (id === 'tab-customers') {
            this._renderSettingsCustomersTab(document.getElementById('input-search-customers')?.value || '');
        } else if (id === 'tab-projects') {
            const custFilter = document.getElementById('select-settings-proj-cust-filter')?.value || '';
            const searchVal = document.getElementById('input-search-projects')?.value || '';
            this._renderSettingsProjectsTab(custFilter, searchVal);
        } else if (id === 'tab-categories') {
            this._renderSettingsCategoriesTab();
        } else if (id === 'tab-tags') {
            this._renderSettingsTagsTab();
        } else if (id === 'tab-storage') {
            this._renderSettingsStorageTab();
        } else if (id === 'tab-templates') {
            this._renderSettingsTemplatesTab();
        }

        this._updateSidebarBadges();
        document.querySelector('.settings-content-panel')?.scrollTo(0, 0);
    }

    // ─── Settings: Templates Manager ─────────────────────────

    _initSettingsTemplatesTab() {
        const subtabs = ['notes', 'minutes-ja', 'minutes-vi'];
        subtabs.forEach(tabKey => {
            const btn = document.getElementById(`subtab-template-${tabKey}`);
            btn?.addEventListener('click', () => {
                this._switchSettingsTemplateTab(tabKey);
            });
        });

        document.getElementById('btn-template-reset')?.addEventListener('click', () => {
            this._resetCurrentSettingsTemplate();
        });

        document.getElementById('btn-template-save')?.addEventListener('click', async () => {
            await this._saveSettingsTemplates();
        });
    }

    _renderSettingsTemplatesTab() {
        const s = settingsManager.get();
        if (this._templateDrafts.notes === undefined) {
            this._templateDrafts = {
                notes: (s.template_notes !== undefined && s.template_notes !== null && s.template_notes !== '') ? s.template_notes : DEFAULT_TEMPLATE_NOTES,
                'minutes-ja': (s.template_minutes_ja !== undefined && s.template_minutes_ja !== null && s.template_minutes_ja !== '') ? s.template_minutes_ja : DEFAULT_TEMPLATE_MINUTES_JA,
                'minutes-vi': (s.template_minutes_vi !== undefined && s.template_minutes_vi !== null && s.template_minutes_vi !== '') ? s.template_minutes_vi : DEFAULT_TEMPLATE_MINUTES_VI,
            };
        }

        const container = document.getElementById('template-codemirror-container');
        if (container && !this._templateEditor) {
            this._templateEditor = new NotesEditor();
            this._templateEditor.mount(container, {
                initialContent: this._templateDrafts[this._activeTemplateTab] || '',
                placeholderText: 'Nhập cấu trúc mẫu markdown...',
                onChange: (content) => {
                    this._templateDrafts[this._activeTemplateTab] = content;
                },
                onSave: () => {
                    this._saveSettingsTemplates();
                },
            });
        }

        this._switchSettingsTemplateTab(this._activeTemplateTab);
    }

    _switchSettingsTemplateTab(tabKey) {
        if (this._templateEditor) {
            this._templateDrafts[this._activeTemplateTab] = this._templateEditor.getContent();
        }
        this._activeTemplateTab = tabKey;

        const subtabs = ['notes', 'minutes-ja', 'minutes-vi'];
        subtabs.forEach(k => {
            const btn = document.getElementById(`subtab-template-${k}`);
            if (btn) btn.classList.toggle('active', k === tabKey);
        });

        const hintEl = document.getElementById('template-editor-hint');
        if (hintEl) {
            if (tabKey === 'notes') {
                hintEl.innerHTML = 'Biến tự động: <code>{{date}}</code>, <code>{{time}}</code>, <code>{{title}}</code>';
            } else {
                hintEl.innerHTML = 'Biến tự động: <code>{{title}}</code>, <code>{{date}}</code>, <code>{{duration}}</code>, <code>{{participants}}</code>';
            }
        }

        if (this._templateEditor) {
            this._templateEditor.setContent(this._templateDrafts[tabKey] || '');
        }
    }

    _resetCurrentSettingsTemplate() {
        let def = '';
        if (this._activeTemplateTab === 'notes') def = DEFAULT_TEMPLATE_NOTES;
        else if (this._activeTemplateTab === 'minutes-ja') def = DEFAULT_TEMPLATE_MINUTES_JA;
        else if (this._activeTemplateTab === 'minutes-vi') def = DEFAULT_TEMPLATE_MINUTES_VI;

        this._templateDrafts[this._activeTemplateTab] = def;
        if (this._templateEditor) {
            this._templateEditor.setContent(def);
        }
        this._showToast('Đã khôi phục mẫu mặc định ✓', 'info');
    }

    async _saveSettingsTemplates() {
        if (this._templateEditor) {
            this._templateDrafts[this._activeTemplateTab] = this._templateEditor.getContent();
        }
        try {
            await settingsManager.save({
                template_notes: this._templateDrafts.notes,
                template_minutes_ja: this._templateDrafts['minutes-ja'],
                template_minutes_vi: this._templateDrafts['minutes-vi'],
            });
            this._showToast('Đã lưu mẫu văn bản ✓', 'success');
        } catch (err) {
            this._showToast(`Lỗi lưu mẫu: ${err}`, 'error');
        }
    }

    // ─── Settings Form ─────────────────────────────────────

    _populateSettingsForm() {
        const s = settingsManager.get();

        document.getElementById('input-api-key').value = s.soniox_api_key || '';
        const openaiKeyInput = document.getElementById('input-openai-key');
        if (openaiKeyInput) openaiKeyInput.value = s.openai_api_key || '';
        const geminiKeyInput = document.getElementById('input-gemini-key');
        if (geminiKeyInput) geminiKeyInput.value = s.gemini_api_key || '';
        const geminiModelSelect = document.getElementById('select-gemini-model');
        const customModelSection = document.getElementById('section-gemini-custom-model');
        const customModelInput = document.getElementById('input-gemini-custom-model');
        if (geminiModelSelect) {
            const savedModel = s.gemini_model || 'models/gemini-2.0-flash-exp';
            const standardOptions = Array.from(geminiModelSelect.options).map(o => o.value);
            if (standardOptions.includes(savedModel)) {
                geminiModelSelect.value = savedModel;
                if (customModelSection) customModelSection.style.display = 'none';
            } else {
                geminiModelSelect.value = 'custom';
                if (customModelSection) customModelSection.style.display = 'block';
                if (customModelInput) customModelInput.value = savedModel;
            }
        }
        const qwenKeyInput = document.getElementById('input-qwen-key');
        if (qwenKeyInput) qwenKeyInput.value = s.qwen_api_key || '';
        const selectSrc = document.getElementById('select-source-lang');
        if (selectSrc) selectSrc.value = s.source_language || 'ja';
        const selectTgt = document.getElementById('select-target-lang');
        if (selectTgt) selectTgt.value = s.target_language || 'vi';
        const selectTransMode = document.getElementById('select-translation-mode');
        if (selectTransMode) selectTransMode.value = s.translation_mode || 'gemini';
        const inactSelect = document.getElementById('select-inactivity-timeout');
        if (inactSelect) inactSelect.value = String(s.inactivity_timeout_min ?? 10);
        this._updateModeUI(s.translation_mode || 'gemini');
        this._refreshKeyStatus();

        // Translation type (one-way / two-way)
        const translationType = s.translation_type || 'one_way';
        const selectTransType = document.getElementById('select-translation-type');
        if (selectTransType) selectTransType.value = translationType;

        // Two-way language selects
        const selectLangA = document.getElementById('select-lang-a');
        if (selectLangA) selectLangA.value = s.language_a || 'ja';
        const selectLangB = document.getElementById('select-lang-b');
        if (selectLangB) selectLangB.value = s.language_b || 'vi';

        // Strict language detection
        const checkStrict = document.getElementById('check-strict-lang');
        if (checkStrict) checkStrict.checked = s.language_hints_strict || false;

        // Endpoint delay
        const endpointDelay = s.endpoint_delay || 3000;
        const delaySlider = document.getElementById('range-endpoint-delay');
        if (delaySlider) delaySlider.value = endpointDelay;
        const delayValue = document.getElementById('endpoint-delay-value');
        if (delayValue) delayValue.textContent = `${(endpointDelay / 1000).toFixed(1)}s`;

        // Audio source radio
        const radioValue = s.audio_source || 'system';
        const radio = document.querySelector(`input[name="audio-source"][value="${radioValue}"]`);
        if (radio) radio.checked = true;

        // Display
        const opacityPercent = Math.round((s.overlay_opacity || 0.85) * 100);
        document.getElementById('range-opacity').value = opacityPercent;
        document.getElementById('opacity-value').textContent = `${opacityPercent}%`;

        document.getElementById('range-font-size').value = s.font_size || 16;
        document.getElementById('font-size-value').textContent = `${s.font_size || 16}px`;

        const noteFontSize = s.note_font_size || 14;
        const noteFontRange = document.getElementById('range-note-font-size');
        const noteFontVal = document.getElementById('note-font-size-value');
        if (noteFontRange) noteFontRange.value = noteFontSize;
        if (noteFontVal) noteFontVal.textContent = `${noteFontSize}px`;

        const fontColor = s.font_color || '#ffffff';
        document.getElementById('input-font-color').value = fontColor;
        document.getElementById('font-color-value').textContent = fontColor.toUpperCase();
        document.getElementById('select-font-family').value = s.font_family || 'system';

        document.getElementById('range-max-lines').value = s.max_lines || 5;
        document.getElementById('max-lines-value').textContent = s.max_lines || 5;

        document.getElementById('check-show-original').checked = s.show_original !== false;

        // Custom context (rich format)
        const ctx = s.custom_context;
        // General context rows
        const generalList = document.getElementById('context-general-list');
        if (generalList) {
            generalList.innerHTML = '';
            const generalPairs = ctx?.general || [];
            generalPairs.forEach(g => this._addGeneralRow(g.key, g.value));
        }
        // Transcription terms
        const termsInput = document.getElementById('input-context-terms');
        if (termsInput) {
            termsInput.value = (ctx?.terms || []).join('\n');
        }
        // Background text
        const textInput = document.getElementById('input-context-text');
        if (textInput) {
            textInput.value = ctx?.text || '';
        }
        // Load translation terms as rows
        const termsList = document.getElementById('translation-terms-list');
        if (termsList) {
            termsList.innerHTML = '';
            const terms = ctx?.translation_terms || [];
            terms.forEach(t => this._addTermRow(t.source, t.target));
        }
    }

    _debouncedAutoSave() {
        clearTimeout(this._autoSaveTimer);
        this._autoSaveTimer = setTimeout(() => {
            this._autoSaveSettingsFromForm();
        }, 300);
    }

    async _autoSaveSettingsFromForm() {
        const settings = {
            soniox_api_key: document.getElementById('input-api-key')?.value.trim() || '',
            openai_api_key: document.getElementById('input-openai-key')?.value.trim() || '',
            gemini_api_key: document.getElementById('input-gemini-key')?.value.trim() || '',
            gemini_model: (() => {
                const sel = document.getElementById('select-gemini-model')?.value;
                if (sel === 'custom') {
                    return document.getElementById('input-gemini-custom-model')?.value.trim() || 'models/gemini-2.0-flash-exp';
                }
                return sel || 'models/gemini-2.0-flash-exp';
            })(),
            qwen_api_key: document.getElementById('input-qwen-key')?.value.trim() || '',
            source_language: document.getElementById('quick-select-source-lang')?.value || settingsManager.get().source_language || 'ja',
            target_language: document.getElementById('quick-select-target-lang')?.value || settingsManager.get().target_language || 'vi',
            translation_mode: document.getElementById('select-translation-mode')?.value || 'gemini',
            inactivity_timeout_min: parseInt(document.getElementById('select-inactivity-timeout')?.value || '10', 10),
            translation_type: 'one_way',
            language_a: 'ja',
            language_b: 'vi',
            language_hints_strict: document.getElementById('check-strict-lang')?.checked || false,
            endpoint_delay: parseInt(document.getElementById('range-endpoint-delay')?.value || settingsManager.get().endpoint_delay || 3000),
            audio_source: document.querySelector('input[name="audio-source"]:checked')?.value || 'system',
            overlay_opacity: parseInt(document.getElementById('range-opacity')?.value || 85) / 100,
            font_size: parseInt(document.getElementById('range-font-size')?.value || 16),
            note_font_size: parseInt(document.getElementById('range-note-font-size')?.value || 14),
            font_color: document.getElementById('input-font-color')?.value || '#ffffff',
            font_family: document.getElementById('select-font-family')?.value || 'system',
            max_lines: parseInt(document.getElementById('range-max-lines')?.value || 5),
            show_original: document.getElementById('check-show-original')?.checked !== false,
            custom_context: null,
        };

        // Parse custom context (rich format)
        const generalPairs = [];
        document.querySelectorAll('#context-general-list .general-row').forEach(row => {
            const key = row.querySelector('.general-key')?.value.trim();
            const value = row.querySelector('.general-value')?.value.trim();
            if (key && value) generalPairs.push({ key, value });
        });

        const termsRaw = document.getElementById('input-context-terms')?.value.trim() || '';
        const terms = termsRaw ? termsRaw.split('\n').map(t => t.trim()).filter(Boolean) : [];
        const contextText = document.getElementById('input-context-text')?.value.trim() || '';

        const translationTerms = [];
        document.querySelectorAll('#translation-terms-list .term-row').forEach(row => {
            const source = row.querySelector('.term-source')?.value.trim();
            const target = row.querySelector('.term-target')?.value.trim();
            if (source && target) translationTerms.push({ source, target });
        });

        if (generalPairs.length > 0 || terms.length > 0 || contextText || translationTerms.length > 0) {
            settings.custom_context = {
                general: generalPairs,
                terms: terms,
                text: contextText || null,
                translation_terms: translationTerms,
            };
        }

        try {
            await settingsManager.save(settings);
            this._applySettings(settings);
        } catch (err) {
            console.error('Auto-save settings error:', err);
        }
    }

    async _saveSettingsFromForm() {
        await this._autoSaveSettingsFromForm();
        this._showToast('Đã lưu cài đặt ✓', 'success');
        this._showView('overlay');
    }

    // ─── Apply Settings ────────────────────────────────────

    _applySettings(settings) {
        // Update note editor font size
        const noteFontSize = settings.note_font_size || 14;
        document.documentElement.style.setProperty('--note-font-size', `${noteFontSize}px`);

        // Update overlay opacity
        const overlayView = document.getElementById('overlay-view');
        overlayView.style.opacity = settings.overlay_opacity || 0.85;

        // Live status row: language pair display
        const langEl = document.getElementById('live-lang');
        if (langEl) {
            const srcName = this._getQuickLangName(settings.source_language || 'vi');
            const tgtName = this._getQuickLangName(settings.target_language || 'none');
            langEl.textContent = `${srcName} → ${tgtName}`;
        }

        // Update transcript UI
        const viewMode = settings.view_mode || 'dual';
        if (this.transcriptUI) {
            this.transcriptUI.configure({
                maxLines: settings.max_lines || 5,
                showOriginal: settings.show_original !== false,
                fontSize: settings.font_size || 16,
                fontColor: settings.font_color || '#ffffff',
                fontFamily: settings.font_family || 'system',
                viewMode: viewMode,
                targetLanguage: settings.target_language || 'vi',
            });
        }
        this._setViewMode(viewMode);

        // Update quick language and timing in toolbar
        const quickSrc = document.getElementById('quick-select-source-lang');
        const quickTgt = document.getElementById('quick-select-target-lang');
        if (quickSrc) {
            const validSrcs = ['vi', 'ja', 'en'];
            quickSrc.value = validSrcs.includes(settings.source_language) ? settings.source_language : 'vi';
        }
        if (quickTgt) {
            const validTgts = ['vi', 'ja', 'en', 'none'];
            quickTgt.value = validTgts.includes(settings.target_language) ? settings.target_language : 'none';
        }

        const timing = settings.translation_timing || 'on_pause';
        const timingSel = document.getElementById('select-translation-timing');
        if (timingSel) timingSel.value = timing;

        // Update current source button states
        this.currentSource = settings.audio_source || 'system';
        this._updateSourceButtons();

        // Update current source button states
        this.currentSource = settings.audio_source || 'system';
        this._updateSourceButtons();
    }

    _addTermRow(source = '', target = '') {
        const list = document.getElementById('translation-terms-list');
        if (!list) return;
        const row = document.createElement('div');
        row.className = 'term-row';
        row.innerHTML = `<input type="text" class="term-source" value="${source}" placeholder="Source" />` +
            `<input type="text" class="term-target" value="${target}" placeholder="Target" />` +
            `<button type="button" class="btn-remove-term" title="Remove">×</button>`;
        row.querySelector('.btn-remove-term').addEventListener('click', () => row.remove());
        list.appendChild(row);
    }

    _addGeneralRow(key = '', value = '') {
        const list = document.getElementById('context-general-list');
        if (!list) return;
        const row = document.createElement('div');
        row.className = 'general-row';
        row.innerHTML = `<input type="text" class="general-key" value="${this._escAttr(key)}" placeholder="Key (e.g. domain)" />` +
            `<input type="text" class="general-value" value="${this._escAttr(value)}" placeholder="Value (e.g. Medical)" />` +
            `<button type="button" class="btn-remove-general" title="Remove">×</button>`;
        row.querySelector('.btn-remove-general').addEventListener('click', () => row.remove());
        list.appendChild(row);
    }

    _escAttr(str) {
        return String(str ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    _esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    _initShellAndMenus() {
        initShell();
        document.addEventListener('activity-changed', (e) => this._onActivityChanged(e.detail));
        const sheet = document.getElementById('shortcut-sheet');
        const toggleSheet = (show) => { if (sheet) sheet.style.display = show ? '' : 'none'; };
        document.getElementById('btn-shortcuts')?.addEventListener('click', () => toggleSheet(true));
        sheet?.addEventListener('click', (e) => { if (e.target === sheet) toggleSheet(false); });
        this._toggleShortcutSheet = toggleSheet;
    }

    _onActivityChanged({ activity, previous }) {
        if (activity === 'library') this._showSessions();
    }

    // ─── Source Control ────────────────────────────────────

    _setSource(source) {
        const wasRunning = this.isRunning;
        const labels = { system: 'System Audio', microphone: 'Microphone', both: 'System + Mic' };
        const label = labels[source] || source;
        // Persist so subsequent settings notifications don't reset us back.
        settingsManager.save({ audio_source: source });

        if (wasRunning) {
            this.pause().then(() => {
                this.currentSource = source;
                this._updateSourceButtons();
                this._showToast(`Switched to ${label}`, 'success');
                this.start();
            });
        } else {
            this.currentSource = source;
            this._updateSourceButtons();
            this._showToast(`Source: ${label}`, 'success');
        }
    }

    _updateSourceButtons() {
        const sel = document.getElementById('select-audio-source');
        if (sel) sel.value = this.currentSource;
        const radio = document.querySelector(`input[name="audio-source"][value="${this.currentSource}"]`);
        if (radio) radio.checked = true;
    }

    // ─── Engine picker (Standard vs OpenAI) ──────────────────
    // OpenAI Realtime is structurally different (text+voice fused, no two-way,
    // no custom TTS), so we surface the choice as a top-level decision rather
    // than burying it in Settings. "Standard" represents the Soniox/Local pair
    // — they share the same UX shape (text-only, optional TTS, two-way, etc.).

    _engineClassFromMode(mode) {
        if (mode === 'openai') return 'openai';
        if (mode === 'gemini') return 'gemini';
        if (mode === 'qwen') return 'qwen';
        return 'standard';
    }

    _selectEngineClass(klass) {
        const settings = settingsManager.get();
        const currentMode = settings.translation_mode || 'soniox';
        let nextMode = currentMode;
        if (klass === 'openai') {
            nextMode = 'openai';
        } else if (klass === 'gemini') {
            nextMode = 'gemini';
        } else if (klass === 'qwen') {
            nextMode = 'qwen';
        } else if (klass === 'standard') {
            // Stay on whatever standard sub-engine was configured before, or
            // default to soniox if previously a cloud realtime engine.
            nextMode = (currentMode === 'soniox' || currentMode === 'local')
                ? currentMode : 'soniox';
        }

        settingsManager.save({ translation_mode: nextMode });
        const select = document.getElementById('select-translation-mode');
        if (select) select.value = nextMode;
        this._updateModeUI(nextMode);
    }

    _resetInactivityTimer() {
        if (!this.isRunning || this.isPaused) {
            this._clearInactivityTimer();
            return;
        }
        const s = settingsManager.get();
        const timeoutMin = Number(s.inactivity_timeout_min ?? 10);
        if (timeoutMin <= 0) {
            this._clearInactivityTimer();
            return;
        }
        this._clearInactivityTimer();
        this._inactivityTimer = setTimeout(async () => {
            if (this.isRunning && !this.isPaused) {
                console.log(`[App] Auto-pausing due to ${timeoutMin}min of silence`);
                await this.pause();
                this._showToast(`⏱️ Automatically paused because no sound was detected for ${timeoutMin} minutes`, 'info');
            }
        }, timeoutMin * 60 * 1000);
    }

    _clearInactivityTimer() {
        if (this._inactivityTimer) {
            clearTimeout(this._inactivityTimer);
            this._inactivityTimer = null;
        }
    }

    _updatePillState(mode) {
        const klass = this._engineClassFromMode(mode);
        document.querySelectorAll('#engine-pill .engine-pill-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.engineClass === klass);
        });
    }

    _setEnginePillLocked(locked) {
        const pill = document.getElementById('engine-pill');
        if (!pill) return;
        pill.dataset.locked = locked ? 'true' : 'false';
        pill.querySelectorAll('.engine-pill-btn').forEach(btn => { btn.disabled = locked; });
    }

    _showEnginePicker() {}
    _hideEnginePicker() {}
    _maybeShowEnginePicker() {}

    _updateModeUI(mode) {
        const isSoniox = mode === 'soniox';
        const isLocal = mode === 'local';
        const isOpenAi = mode === 'openai';
        const isGemini = mode === 'gemini';
        const isQwen = mode === 'qwen';
        // Cloud-realtime engines that share the OpenAI-style audio toggle,
        // mic-only capture, and dual-panel routing. Used in place of bare
        // `isOpenAi` checks below so Gemini and Qwen inherit the same UI shape.
        const isCloudRealtime = isOpenAi || isGemini || isQwen;
        this._updatePillState(mode);

        // Single dynamic hint line per engine (mobile parity). Only #hint-mode-soniox
        // stays visible as the live container; the other hint nodes are kept hidden
        // so existing IDs remain wired but don't clutter the panel.
        const hintSoniox = document.getElementById('hint-mode-soniox');
        const hintLocal = document.getElementById('hint-mode-local');
        const hintOpenAi = document.getElementById('hint-mode-openai');
        const hintGemini = document.getElementById('hint-mode-gemini');
        const hintQwen = document.getElementById('hint-mode-qwen');
        const ENGINE_HINTS = {
            soniox: 'Cloud · 70+ languages · ~$0.12/hr',
            local: 'Offline · free · ~3–4s delay',
            openai: 'Cloud · 13 languages · text-only captions',
            gemini: 'Cloud · Gemini 2.0 Flash · free on Google AI Studio · 100+ languages',
            qwen: 'Cloud · 60+ languages · text-only · free preview · pick a source language',
        };
        if (hintSoniox) {
            hintSoniox.textContent = ENGINE_HINTS[mode] || '';
            hintSoniox.style.display = '';
        }
        // Highlight a warning when the picked engine can't run yet — either
        // Local MLX on unsupported hardware, or a cloud engine missing its key.
        // The option stays selectable (Hiếu's ask): the user needs to pick it
        // to add the key; start() blocks launch until the requirement is met.
        const s = settingsManager.get();
        const localUnsupported = isLocal && !this.isAppleSilicon;
        const missingKey =
            (isSoniox && !(s.soniox_api_key || '').trim()) ? 'Soniox' :
            (isOpenAi && !(s.openai_api_key || '').trim()) ? 'OpenAI Realtime' :
            (isGemini && !(s.gemini_api_key || '').trim()) ? 'Gemini' :
            (isQwen && !(s.qwen_api_key || '').trim()) ? 'Qwen' : null;
        if (hintSoniox) {
            const warn = localUnsupported || !!missingKey;
            hintSoniox.classList.toggle('hint-warning', warn);
            if (localUnsupported) {
                hintSoniox.textContent = this._platformOs === 'macos'
                    ? '⚠️ Local MLX cần chip Apple Silicon — máy này không chạy được, hãy chọn engine khác.'
                    : '⚠️ Local MLX chỉ chạy trên macOS Apple Silicon — trên máy này hãy chọn engine khác.';
            } else if (missingKey) {
                hintSoniox.textContent = `⚠️ ${missingKey} cần API key — nhập key bên dưới rồi mới bắt đầu được.`;
            }
        }
        if (hintLocal) hintLocal.style.display = 'none';
        if (hintOpenAi) hintOpenAi.style.display = 'none';
        if (hintGemini) hintGemini.style.display = 'none';
        if (hintQwen) hintQwen.style.display = 'none';

        const costWarning = document.getElementById('openai-cost-warning');
        if (costWarning) costWarning.style.display = isOpenAi ? '' : 'none';

        // Mobile-parity: show only the key section for the active engine.
        // Local hides them all (no key needed).
        const sectionApiKey = document.getElementById('section-api-key');
        const sectionOpenAiKey = document.getElementById('section-openai-key');
        const sectionGeminiKey = document.getElementById('section-gemini-key');
        const sectionQwenKey = document.getElementById('section-qwen-key');
        if (sectionApiKey) sectionApiKey.style.display = isSoniox ? '' : 'none';
        if (sectionOpenAiKey) sectionOpenAiKey.style.display = isOpenAi ? '' : 'none';
        if (sectionGeminiKey) sectionGeminiKey.style.display = isGemini ? '' : 'none';
        if (sectionQwenKey) sectionQwenKey.style.display = isQwen ? '' : 'none';

        // Soniox-only features: Custom context, Strict language detection,
        // Endpoint delay. The realtime engines manage these internally.
        const sectionContext = document.getElementById('section-soniox-context');
        if (sectionContext) sectionContext.style.display = isSoniox ? '' : 'none';
        const sectionStrictLang = document.getElementById('section-strict-lang');
        if (sectionStrictLang) sectionStrictLang.style.display = isSoniox ? '' : 'none';
        const sectionEndpointDelay = document.getElementById('section-endpoint-delay');
        if (sectionEndpointDelay) sectionEndpointDelay.style.display = isSoniox ? '' : 'none';

        // Two-way mode incompatible with realtime translation engines — force
        // one-way + disable the option for any cloud-realtime mode.
        const typeSelect = document.getElementById('select-translation-type');
        if (typeSelect) {
            const twoWayOpt = typeSelect.querySelector('option[value="two_way"]');
            if (twoWayOpt) twoWayOpt.disabled = isCloudRealtime;
            if (isCloudRealtime && typeSelect.value === 'two_way') {
                typeSelect.value = 'one_way';
                this._updateTranslationTypeUI('one_way');
            }
        }

        this._updateSettingsCards();
        const btnOpenAiAudio = document.getElementById('btn-openai-audio');
        if (btnOpenAiAudio) btnOpenAiAudio.style.display = 'none';

        // Restrict target language list to 13 OpenAI-supported in openai mode.
        // Qwen LiveTranslate Flash has its own 60-language list (mirrors mobile
        // v0.4.3); Qwen also hides Auto on the source picker because the model
        // rejects "auto" on real mic input.
        this._refreshTargetLangList(mode);
        this._refreshSourceLangList(mode);
    }

    _refreshTargetLangList(mode) {
        const select = document.getElementById('select-target-lang');
        if (!select) return;
        const OPENAI_LANGS = [
            ['en','English'], ['es','Spanish'], ['pt','Portuguese'], ['fr','French'],
            ['de','German'], ['it','Italian'], ['ru','Russian'], ['hi','Hindi'],
            ['id','Indonesian'], ['vi','Vietnamese'], ['ja','Japanese'],
            ['ko','Korean'], ['zh','Chinese'],
        ];
        const current = select.value;
        if (mode === 'openai') {
            if (!this._fullTargetLangHTML) this._fullTargetLangHTML = select.innerHTML;
            select.innerHTML = OPENAI_LANGS
                .map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
            select.value = OPENAI_LANGS.some(([c]) => c === current) ? current : 'vi';
        } else if (mode === 'qwen') {
            if (!this._fullTargetLangHTML) this._fullTargetLangHTML = select.innerHTML;
            const langs = QWEN_LANGS;
            select.innerHTML = langs
                .map((l) => `<option value="${l.code}">${l.name}</option>`).join('');
            select.value = langs.some((l) => l.code === current) ? current : 'vi';
        } else if (this._fullTargetLangHTML) {
            select.innerHTML = this._fullTargetLangHTML;
            select.value = current || 'vi';
        }
    }

    _refreshSourceLangList(mode) {
        const select = document.getElementById('select-source-lang');
        if (!select) return;
        const current = select.value;
        if (mode === 'qwen') {
            if (!this._fullSourceLangHTML) this._fullSourceLangHTML = select.innerHTML;
            const langs = QWEN_LANGS;
            // No "Auto" — Live Flash stalls after one segment on real mic when
            // source isn't explicit (verified iPhone v0.4.2, 2026-05-25).
            select.innerHTML = langs
                .map((l) => `<option value="${l.code}">${l.name}</option>`).join('');
            const validCurrent = langs.some((l) => l.code === current) && current !== 'auto';
            select.value = validCurrent ? current : 'en';
        } else if (this._fullSourceLangHTML) {
            select.innerHTML = this._fullSourceLangHTML;
            select.value = current || 'auto';
        }
    }

    // ─── API key validation & connection test ─────────────

    // Inline format check — runs on every keystroke. Cheap, no network.
    // Updates: per-field status badge + engine dropdown option enable/disable.
    _refreshKeyStatus() {
        const sonioxKey = document.getElementById('input-api-key')?.value.trim() || '';
        const openaiKey = document.getElementById('input-openai-key')?.value.trim() || '';
        const geminiKey = document.getElementById('input-gemini-key')?.value.trim() || '';

        // Soniox keys are opaque hex-like strings, ~32+ chars. Be lenient.
        const sonioxOk = sonioxKey.length >= 20;
        // OpenAI keys start with sk- and are ~50+ chars.
        const openaiOk = /^sk-[A-Za-z0-9_\-]{20,}$/.test(openaiKey);
        // Gemini API keys start with AIzaSy and are ~39 chars.
        const geminiOk = geminiKey.length >= 20;

        const sonioxStatus = document.getElementById('key-status-soniox');
        if (sonioxStatus) {
            sonioxStatus.className = 'key-status ' + (sonioxKey === '' ? '' : sonioxOk ? 'ok' : 'bad');
            sonioxStatus.textContent = sonioxKey === '' ? '' : sonioxOk ? '✓ format ok' : '✗ check format';
        }
        const openaiStatus = document.getElementById('key-status-openai');
        if (openaiStatus) {
            openaiStatus.className = 'key-status ' + (openaiKey === '' ? '' : openaiOk ? 'ok' : 'bad');
            openaiStatus.textContent = openaiKey === '' ? '' : openaiOk ? '✓ format ok' : '✗ should start with sk-';
        }
        const geminiStatus = document.getElementById('key-status-gemini');
        if (geminiStatus) {
            geminiStatus.className = 'key-status ' + (geminiKey === '' ? '' : geminiOk ? 'ok' : 'bad');
            geminiStatus.textContent = geminiKey === '' ? '' : geminiOk ? '✓ format ok' : '✗ check format';
        }

        // Engines that need a key stay SELECTABLE even when it's missing —
        // otherwise the user can't pick the engine to add its key (catch-22).
        // The label hints "add key first", and start() blocks launch until the
        // key is present. (Same not-hard-disabled principle as Local MLX.)
        const select = document.getElementById('select-translation-mode');
        if (select) {
            const sonioxOpt = select.querySelector('option[value="soniox"]');
            const openaiOpt = select.querySelector('option[value="openai"]');
            const geminiOpt = select.querySelector('option[value="gemini"]');
            if (sonioxOpt) {
                sonioxOpt.disabled = false;
                sonioxOpt.textContent = sonioxOk ? '☁️ Soniox' : '☁️ Soniox — cần nhập key';
            }
            if (openaiOpt) {
                openaiOpt.disabled = false;
                openaiOpt.textContent = openaiOk ? '⚡ OpenAI Realtime' : '⚡ OpenAI Realtime — cần nhập key';
            }
            if (geminiOpt) {
                geminiOpt.disabled = false;
                geminiOpt.textContent = geminiOk ? '✨ Google Gemini Live' : '✨ Google Gemini Live — cần nhập key';
            }
        }
    }

    // Live ping the provider to verify key actually works.
    async _testConnection(provider) {
        const statusEl = document.getElementById(`key-status-${provider}`);
        const btn = document.getElementById(`btn-test-${provider}`);
        if (!statusEl || !btn) return;

        const inputId = provider === 'soniox' ? 'input-api-key' : 'input-openai-key';
        const key = document.getElementById(inputId)?.value.trim() || '';
        if (!key) {
            statusEl.className = 'key-status bad';
            statusEl.textContent = '✗ empty';
            return;
        }

        btn.disabled = true;
        statusEl.className = 'key-status checking';
        statusEl.textContent = '… testing';

        try {
            const ok = provider === 'soniox'
                ? await this._pingSoniox(key)
                : await this._pingOpenAi(key);
            statusEl.className = 'key-status ' + (ok ? 'ok' : 'bad');
            statusEl.textContent = ok ? '✓ connected' : '✗ rejected';
        } catch (e) {
            statusEl.className = 'key-status bad';
            statusEl.textContent = '✗ ' + (e?.message || 'failed');
        } finally {
            btn.disabled = false;
        }
    }

    // Soniox: open WS, send config, wait for first response, close.
    _pingSoniox(apiKey) {
        return new Promise((resolve) => {
            const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
            const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(false); }, 5000);
            ws.onopen = () => {
                ws.send(JSON.stringify({ api_key: apiKey, model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1 }));
            };
            ws.onmessage = (e) => {
                clearTimeout(timer);
                try {
                    const v = JSON.parse(e.data);
                    resolve(!v.error_code);
                } catch { resolve(true); }
                try { ws.close(); } catch {}
            };
            ws.onerror = () => { clearTimeout(timer); resolve(false); };
        });
    }

    // OpenAI: cheap HTTP GET /v1/models with the key.
    async _pingOpenAi(apiKey) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        try {
            const r = await fetch('https://api.openai.com/v1/models', {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: ctrl.signal,
            });
            return r.ok;
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    // ─── Start/Stop ────────────────────────────────────────

    async start() {
        const settings = settingsManager.get();
        this.translationMode = settings.translation_mode || 'soniox';
        console.log('[App] start() called, translation_mode:', this.translationMode, 'settings:', JSON.stringify(settings));

        // Local MLX needs macOS Apple Silicon — block here (option is selectable
        // but can't actually run on other platforms) instead of crashing.
        if (this.translationMode === 'local' && !this.isAppleSilicon) {
            this._showToast('Local MLX chỉ chạy trên macOS Apple Silicon. Hãy chọn engine khác trong Cài đặt.', 'error');
            this._showView('settings');
            return;
        }

        // Check Soniox API key only for cloud mode
        if (this.translationMode === 'soniox' && !settings.soniox_api_key) {
            this._showToast('Soniox API key is required. Add it in Settings.', 'error');
            this._showView('settings');
            return;
        }

        // Check OpenAI API key for openai mode
        if (this.translationMode === 'openai' && !settings.openai_api_key) {
            this._showToast('OpenAI API key is required. Add it in Settings.', 'error');
            this._showView('settings');
            return;
        }

        // Check Gemini API key for gemini mode
        if (this.translationMode === 'gemini' && !settings.gemini_api_key) {
            this._showToast('Gemini API key is required. Add it in Settings.', 'error');
            this._showView('settings');
            return;
        }

        // Check Qwen API key for qwen mode
        if (this.translationMode === 'qwen' && !settings.qwen_api_key) {
            this._showToast('Qwen (DashScope) API key is required. Add it in Settings.', 'error');
            this._showView('settings');
            return;
        }

        if (this.currentSource === 'microphone' || this.currentSource === 'both') {
            if (!await this._ensureMicrophonePermission()) return;
        }

        this.isRunning = true;
        this.isPaused = false;
        this._hasUnsavedMeetingData = false;
        this._updateStartButton();
        this._hideEnginePicker();
        this._setEnginePillLocked(true);
        if (!this.recordingStartTime) this.recordingStartTime = Date.now();

        // Record session metadata for auto-save
        if (!this.sessionStartTime) {
            this.sessionStartTime = new Date();
            const translationType = settings.translation_type || 'one_way';
            this.sessionMode = translationType;
            if (translationType === 'two_way') {
                this.sessionSourceLang = settings.language_a || 'ja';
                this.sessionTargetLang = settings.language_b || 'vi';
            } else {
                this.sessionSourceLang = settings.source_language || 'ja';
                this.sessionTargetLang = settings.target_language || 'vi';
            }
        }

        // Begin a session chunk — every Start/Stop cycle becomes one chunk in
        // the persistent SessionStore. Engine/lang may have changed since
        // last chunk, so pass them in.
        sessionStore.beginChunk({
            engine: this.translationMode,
            sourceLang: this.sessionSourceLang,
            targetLang: this.sessionTargetLang,
        });

        this._startLiveDurationTimer();

        // Clear transcript only if nothing is showing
        if (!this.transcriptUI.hasContent()) {
            this.transcriptUI.showListening();
        } else {
            this.transcriptUI.clearProvisional();
        }

        await this._startTranslationEngine(settings);

        this._resetInactivityTimer();
    }

    async _getSessionRecordPath() {
        if (sessionStore && sessionStore.id) {
            try {
                return await invoke('get_session_record_path', { id: sessionStore.id });
            } catch (e) {
                console.warn('[App] Failed to get session record path:', e);
            }
        }
        return null;
    }

    async _startTranslationEngine(settings) {
        if (this.translationMode === 'local') {
            await this._startLocalMode(settings);
        } else if (this.translationMode === 'openai') {
            await this._startOpenAiMode(settings);
        } else if (this.translationMode === 'gemini') {
            await this._startGeminiMode(settings);
        } else if (this.translationMode === 'qwen') {
            await this._startQwenMode(settings);
        } else {
            await this._startSonioxMode(settings);
        }
    }

    async _ensureMicrophonePermission() {
        try {
            let status = await invoke('check_permissions');
            if (status?.microphone === 'not_determined') {
                await invoke('request_microphone_permission');
                status = await invoke('check_permissions');
            }
            if (status?.microphone === 'granted') return true;

            const state = status?.microphone || 'unknown';
            this._showToast(
                state === 'denied' || state === 'restricted'
                    ? 'Microphone bị từ chối. Hãy bật Meet Minder trong System Settings → Privacy & Security → Microphone.'
                    : `Không xác định được quyền microphone (trạng thái: ${state}).`,
                'error',
            );
            this._updateStatus('error');
            return false;
        } catch (err) {
            console.error('[App] Microphone permission check failed:', err);
            this._showToast(`Không kiểm tra được quyền microphone: ${err}`, 'error');
            return false;
        }
    }

    _scheduleCaptureHealthCheck() {
        if (this._captureHealthTimer) clearTimeout(this._captureHealthTimer);
        this._captureHealthTimer = setTimeout(async () => {
            this._captureHealthTimer = null;
            if (!this.isRunning || this.currentSource === 'system') return;
            try {
                const status = await invoke('get_capture_status');
                if (!this.isRunning) return;
                const micSamples = status?.microphone_received_samples ?? status?.received_samples ?? 0;
                if (micSamples === 0) {
                    this._showToast('Microphone stream đã mở nhưng không nhận được sample. Hãy kiểm tra thiết bị input và quyền Microphone.', 'error');
                } else {
                    // RMS=0 can be legitimate while nobody is speaking. The
                    // explicit 3-second recording test reports silence; live
                    // capture only treats missing callbacks as a hard fault.
                    console.log('[App] Microphone capture health:', {
                        samples: micSamples,
                        nonzeroSamples: status.microphone_nonzero_samples,
                        rms: status.microphone_rms,
                    });
                }
            } catch (err) {
                console.warn('[App] Capture health check failed:', err);
            }
        }, 2000);
    }

    async _startOpenAiMode(settings) {
        this._updateStatus('connecting');
        const { OpenAiRealtimeClient } = await import('./openai-realtime-client.js');
        const { OpenAiAudioOutputQueue } = await import('./openai-audio-output-queue.js');

        // Tell the UI which provider is active so dual-panel rendering routes
        // provisional text to the correct panel (source vs target).
        this.transcriptUI.provider = 'openai';

        this.openAiOutputQueue = new OpenAiAudioOutputQueue();
        this.openAiClient = new OpenAiRealtimeClient();

        this.openAiClient.onStatusChange = (state) => {
            if (state === 'ready') this._updateStatus('connected');
            else if (state === 'connecting') this._updateStatus('connecting');
        };
        this.openAiClient.onProvisional = (text) => {
            this.transcriptUI.setProvisional(text, null, null);
        };
        this.openAiClient.onSourceProvisional = (text) => {
            this.transcriptUI.setSourceProvisional(text);
        };
        this.openAiClient.onSegment = (original, translation) => {
            this.transcriptUI.addSegment(original, translation, null, null);
            sessionStore.addSegment(original, translation);
        };
        this.openAiClient.onError = (err) => {
            console.error('[OpenAI Realtime] error:', err);
            this._showToast(`OpenAI error: ${err}`, 'error');
            this._updateStatus('error');
        };
        this.openAiClient.onClosed = (reason) => {
            console.warn('[OpenAI Realtime] closed:', reason);
            if (this.isRunning) {
                this._showToast('OpenAI session closed — reconnecting…', 'success');
                setTimeout(() => {
                    if (this.isRunning) this._restartLiveEngineForSettings();
                }, 1000);
            }
        };

        try {
            await this.openAiClient.connect({
                apiKey: settings.openai_api_key,
                sourceLanguage: settings.source_language || 'ja',
                targetLanguage: settings.target_language,
                audioOutput: false,
            }, this.openAiOutputQueue);
        } catch (err) {
            this._showToast(`OpenAI connect failed: ${err}`, 'error');
            await this.pause();
            return;
        }

        if (!this._audioCaptureActive) {
            try {
                let audioBatchCount = 0;
                const channel = new window.__TAURI__.core.Channel();
                channel.onmessage = (pcmData) => {
                    audioBatchCount++;
                    if (audioBatchCount <= 3 || audioBatchCount % 50 === 0) {
                        console.log(`[OpenAI capture] batch #${audioBatchCount}, size:`, pcmData?.length || 0);
                    }
                    const bytes = new Uint8Array(pcmData);
                    if (this.openAiClient) this.openAiClient.sendAudio(bytes.buffer);
                    this._updateAudioMeter(bytes);
                };
                console.log('[OpenAI] Starting audio capture, source:', this.currentSource);
                const recordPath = await this._getSessionRecordPath();
                await invoke('start_capture', {
                    source: this.currentSource,
                    channel,
                    recordPath,
                });
                this._audioCaptureActive = true;
                console.log('[OpenAI] start_capture invoked OK');
                this._scheduleCaptureHealthCheck();
            } catch (err) {
                console.error('Failed to start audio capture:', err);
                this._showToast(`Audio error: ${err}`, 'error');
                await this.pause();
            }
        }
    }

    async _startGeminiMode(settings) {
        this._updateStatus('connecting');
        const { GeminiRealtimeClient } = await import('./gemini-realtime-client.js');

        this.transcriptUI.provider = 'gemini';

        this.geminiClient = new GeminiRealtimeClient();

        this.geminiClient.onStatusChange = (state) => {
            if (state === 'ready') this._updateStatus('connected');
            else if (state === 'connecting') this._updateStatus('connecting');
        };
        this.geminiClient.onProvisional = (text) => {
            this.transcriptUI.setProvisional(text, null, null);
        };
        this.geminiClient.onSourceFinal = (sourceText, pendingId = null, speaker = null) => {
            if (!sourceText || !sourceText.trim()) return;
            const source = sourceText.trim();
            // The final source event supersedes Gemini's interim line. Clear it
            // before adding the durable pending-source segment, otherwise the
            // same utterance is rendered twice (italic provisional + final).
            this.transcriptUI.clearProvisional();
            const existing = this.transcriptUI.segments.find(
                segment => segment.status === 'original'
                    && segment.original === source
                    && (pendingId === null || segment.pendingId === null || segment.pendingId === pendingId),
            );
            if (existing) {
                if (pendingId !== null && existing.pendingId === null) {
                    existing.pendingId = pendingId;
                    sessionStore.bindPendingSegmentId(source, pendingId);
                }
                return;
            }
            this.transcriptUI.addOriginal(source, speaker, null, pendingId);
            // Persist the source immediately. Translation is allowed to arrive
            // later, or time out during Stop, without losing this utterance.
            sessionStore.addSegment(source, '', pendingId, speaker);
        };
        this.geminiClient.onTranslationFailed = (pendingId, message) => {
            console.warn('[Gemini Realtime] Translation failed:', pendingId, message);
            if (pendingId !== null) {
                this.transcriptUI.markTranslationFailed(pendingId);
            }
        };
        this.geminiClient.onSegment = (sourceText, translatedText, pendingId = null, speaker = null) => {
            // New backend versions emit SourceTranscript first and attach the
            // same id to the later REST translation. Never pair by whichever
            // source happens to remain in the bounded UI buffer.
            if (pendingId !== null) {
                const hasSource = this.transcriptUI.segments.some(
                    s => s.status === 'original' && s.pendingId === pendingId,
                );
                if (!hasSource) {
                    this.transcriptUI.addOriginal(sourceText || '', speaker, null, pendingId);
                    sessionStore.addSegment(sourceText || '', '', pendingId, speaker);
                }
                this.transcriptUI.addTranslation(translatedText, pendingId);
                if (!sessionStore.completeFirstPendingTranslation(translatedText || '', pendingId)) {
                    sessionStore.addSegment(sourceText || '', translatedText || '');
                }
            } else if (sourceText) {
                // Compatibility fallback for direct/older events without an id.
                this.transcriptUI.addOriginal(sourceText, speaker, null);
                this.transcriptUI.addTranslation(translatedText);
                if (!sessionStore.completeFirstPendingTranslation(translatedText || '')) {
                    sessionStore.addSegment(sourceText, translatedText || '', null, speaker);
                }
            } else if (!this.transcriptUI.segments.some(s => s.status === 'original')) {
                // A direct modelTurn translation has no source/job id. Do not
                // attach it to a different pending source; REST owns that pair.
                this.transcriptUI.addTranslation(translatedText);
                sessionStore.addSegment('', translatedText || '');
            }
        };
        this.geminiClient.onError = (code, msg) => {
            console.error('[Gemini Realtime]', code, msg);
            const msgStr = String(msg || '');
            if ((code === 'connect_failed' || code === 'session_failed') && (msgStr.includes('API key') || msgStr.includes('PERMISSION_DENIED'))) {
                this._showToast(`Gemini: ${msgStr || code}`, 'error');
                this._updateStatus('error');
                this.pause();
            } else if (this.isRunning) {
                this._scheduleGeminiReconnect(1000);
            }
        };
        this.geminiClient.onClosed = (reason) => {
            console.warn('[Gemini Realtime] closed:', reason);
            if (this.isRunning) {
                this._scheduleGeminiReconnect(500);
            }
        };

        try {
            await this.geminiClient.connect({
                apiKey: settings.gemini_api_key,
                sourceLanguage: settings.source_language || 'ja',
                targetLanguage: settings.target_language || 'vi',
                model: settings.gemini_model || 'models/gemini-3.5-transcribe-live',
            });
        } catch (err) {
            console.error('[Gemini Realtime] connect error:', err);
            const errStr = String(err);
            if (errStr.includes('API key') || errStr.includes('PERMISSION_DENIED')) {
                this._showToast(`Gemini connect failed: ${err}`, 'error');
                await this.pause();
                return;
            }
            if (this.isRunning) {
                console.log('[Gemini Realtime] Connection failed, retrying in 2000ms...');
                this._scheduleGeminiReconnect(2000);
            }
            return;
        }

        if (!this._audioCaptureActive) {
            try {
                let audioBatchCount = 0;
                const channel = new window.__TAURI__.core.Channel();
                channel.onmessage = (pcmData) => {
                    audioBatchCount++;
                    if (audioBatchCount <= 3 || audioBatchCount % 50 === 0) {
                        console.log(`[Gemini capture] batch #${audioBatchCount}, size:`, pcmData?.length || 0);
                    }
                    const bytes = new Uint8Array(pcmData);
                    if (this.geminiClient) this.geminiClient.sendAudio(bytes.buffer);
                    this._updateAudioMeter(bytes);
                };
                console.log('[Gemini] Starting audio capture, source:', this.currentSource);
                const recordPath = await this._getSessionRecordPath();
                await invoke('start_capture', {
                    source: this.currentSource,
                    channel,
                    recordPath,
                });
                this._audioCaptureActive = true;
                console.log('[Gemini] start_capture invoked OK');
                this._scheduleCaptureHealthCheck();
            } catch (err) {
                console.error('Failed to start audio capture:', err);
                const errStr = String(err);
                if (errStr.includes('Screen Recording') || errStr.includes('TCC') || errStr.includes('shareable content')) {
                    this._showToast('Vui lòng bật quyền Screen & System Audio trong System Settings', 'error');
                    try {
                        await invoke('request_screen_capture_permission');
                    } catch {}
                } else {
                    this._showToast(`Audio error: ${err}`, 'error');
                }
                await this.pause();
            }
        }
    }

    _scheduleGeminiReconnect(delayMs = 500) {
        if (!this.isRunning) return;
        if (this._geminiReconnectTimer) {
            clearTimeout(this._geminiReconnectTimer);
            this._geminiReconnectTimer = null;
        }
        console.log(`[Gemini Realtime] Scheduling auto-reconnect in ${delayMs}ms...`);
        this._geminiReconnectTimer = setTimeout(async () => {
            this._geminiReconnectTimer = null;
            if (!this.isRunning) return;
            await this._restartLiveEngineForSettings();
        }, delayMs);
    }

    async _startQwenMode(settings) {
        this._updateStatus('connecting');
        const { QwenRealtimeClient } = await import('./qwen-realtime-client.js');

        // Live Flash is translation-only (no source transcript). Force the
        // single-panel translation view; dual-panel would render an empty
        // source column.
        this.transcriptUI.provider = 'qwen';

        this.qwenClient = new QwenRealtimeClient();

        this.qwenClient.onStatusChange = (state) => {
            if (state === 'ready') this._updateStatus('connected');
            else if (state === 'connecting') this._updateStatus('connecting');
        };
        this.qwenClient.onProvisional = (text) => {
            this.transcriptUI.setProvisional(text, null, null);
        };
        this.qwenClient.onSegment = (sourceText, translatedText) => {
            this.transcriptUI.addTranslation(translatedText);
            sessionStore.addSegment('', translatedText || '');
            this.transcriptUI.clearProvisional();
        };
        this.qwenClient.onError = (code, msg) => {
            console.error('[Qwen Realtime]', code, msg);
            this._showToast(`${code}: ${msg}`, 'error');
            this._updateStatus('error');
        };
        this.qwenClient.onClosed = (reason) => {
            console.warn('[Qwen Realtime] closed:', reason);
            if (this.isRunning) {
                this._showToast('Qwen session closed — reconnecting…', 'success');
                setTimeout(() => {
                    if (this.isRunning) this._restartLiveEngineForSettings();
                }, 1000);
            }
        };

        try {
            // Live Flash rejects "auto" — fall back to English. UI also
            // strips the "auto" option when engine = qwen (see
            // _refreshSourceLangList), so this is belt-and-suspenders.
            const sourceLang =
                settings.source_language && settings.source_language !== 'auto'
                    ? settings.source_language
                    : 'en';
            await this.qwenClient.connect({
                apiKey: settings.qwen_api_key,
                sourceLanguage: sourceLang,
                targetLanguage: settings.target_language,
            });
        } catch (err) {
            this._showToast(`Qwen connect failed: ${err}`, 'error');
            await this.pause();
            return;
        }

        if (!this._audioCaptureActive) {
            try {
                let audioBatchCount = 0;
                const channel = new window.__TAURI__.core.Channel();
                channel.onmessage = (pcmData) => {
                    audioBatchCount++;
                    if (audioBatchCount <= 3 || audioBatchCount % 50 === 0) {
                        console.log(`[Qwen capture] batch #${audioBatchCount}, size:`, pcmData?.length || 0);
                    }
                    const bytes = new Uint8Array(pcmData);
                    if (this.qwenClient) this.qwenClient.sendAudio(bytes.buffer);
                    this._updateAudioMeter(bytes);
                };
                console.log('[Qwen] Starting audio capture, source:', this.currentSource);
                const recordPath = await this._getSessionRecordPath();
                await invoke('start_capture', {
                    source: this.currentSource,
                    channel,
                    recordPath,
                });
                this._audioCaptureActive = true;
                console.log('[Qwen] start_capture invoked OK');
                this._scheduleCaptureHealthCheck();
            } catch (err) {
                console.error('Failed to start audio capture:', err);
                this._showToast(`Audio error: ${err}`, 'error');
                await this.pause();
            }
        }
    }

    async _startSonioxMode(settings) {
        // Connect to Soniox
        console.log('[App] Connecting to Soniox...');
        this.transcriptUI.provider = 'soniox';
        this._updateStatus('connecting');
        sonioxClient.connect({
            apiKey: settings.soniox_api_key,
            sourceLanguage: settings.source_language,
            targetLanguage: settings.target_language,
            customContext: settings.custom_context,
            translationType: settings.translation_type || 'one_way',
            languageA: settings.language_a,
            languageB: settings.language_b,
            languageHintsStrict: settings.language_hints_strict || false,
            endpointDelay: settings.endpoint_delay || 3000,
        });

        if (!this._audioCaptureActive) {
            // Start audio capture — Rust batches audio every 200ms, JS just forwards
            try {
                let audioChunkCount = 0;

                const channel = new window.__TAURI__.core.Channel();
                channel.onmessage = (pcmData) => {
                    audioChunkCount++;
                    if (audioChunkCount <= 3 || audioChunkCount % 50 === 0) {
                        console.log(`[Audio] Batch #${audioChunkCount}, size:`, pcmData?.length || 0);
                    }
                    // Forward batched audio to Soniox
                    const bytes = new Uint8Array(pcmData);
                    sonioxClient.sendAudio(bytes.buffer);
                    this._updateAudioMeter(bytes);
                };

                console.log('[App] Starting audio capture, source:', this.currentSource);
                const recordPath = await this._getSessionRecordPath();
                await invoke('start_capture', {
                    source: this.currentSource,
                    channel: channel,
                    recordPath,
                });
                this._audioCaptureActive = true;
                console.log('[App] Audio capture started successfully');
                this._scheduleCaptureHealthCheck();
            } catch (err) {
                console.error('Failed to start audio capture:', err);
                this._showToast(`Audio error: ${err}`, 'error');
                await this.pause();
            }
        }
    }

    async _startLocalMode(settings) {
        console.log('[App] Starting Local mode (MLX models)...');
        this.transcriptUI.provider = 'soniox';
        this._updateStatus('connecting');

        // Step 0: Check audio permission FIRST (before loading models)
        try {
            await invoke('start_capture', {
                source: this.currentSource,
                channel: new window.__TAURI__.core.Channel(), // dummy channel for permission check
                recordPath: null,
            });
            await invoke('stop_capture');
        } catch (err) {
            console.error('[App] Audio permission check failed:', err);
            this._showToast(`Audio permission required: ${err}`, 'error');
            this.isRunning = false;
            this._updateStartButton();
            this._updateStatus('error');
            this.transcriptUI.clear();
            this.transcriptUI.showPlaceholder();
            return;
        }

        // Step 1: Check if MLX setup is complete
        try {
            const checkResult = await invoke('check_mlx_setup');
            const status = JSON.parse(checkResult);
            if (!status.ready) {
                this._showToast('Setting up MLX models (one-time, ~5GB)...', 'success');
                this.transcriptUI.showStatusMessage('Downloading MLX models (one-time setup)...');
                await this._runMlxSetup();
            }
        } catch (err) {
            console.warn('[App] MLX check failed (proceeding anyway):', err);
        }

        console.log('[App] MLX check passed, starting pipeline...');

        // Step 1: Start pipeline FIRST (independent of audio)
        try {
            this._showToast('Starting local pipeline...', 'success');

            this.localPipelineChannel = new window.__TAURI__.core.Channel();
            this.localPipelineReady = false;

            this.localPipelineChannel.onmessage = (msg) => {
                let data;
                try {
                    data = (typeof msg === 'string') ? JSON.parse(msg) : msg;
                } catch (e) {
                    console.warn('[Local] JSON parse failed:', typeof msg, msg);
                    return;
                }
                try {
                    this._handleLocalPipelineResult(data);
                } catch (e) {
                    console.error('[Local] Handler error for type:', data?.type, e);
                }
            };

            const sourceLangMap = {
                'auto': 'auto', 'ja': 'Japanese', 'en': 'English',
                'zh': 'Chinese', 'ko': 'Korean', 'vi': 'Vietnamese',
            };
            const sourceLang = sourceLangMap[settings.source_language] || 'Japanese';

            await invoke('start_local_pipeline', {
                sourceLang: sourceLang,
                targetLang: settings.target_language || 'vi',
                channel: this.localPipelineChannel,
            });
            console.log('[App] Local pipeline spawned');
        } catch (err) {
            console.error('Failed to start pipeline:', err);
            this._showToast(`Pipeline error: ${err}`, 'error');
            await this.pause();
            return;
        }

        // Step 2: Start audio capture
        try {
            const audioChannel = new window.__TAURI__.core.Channel();
            let audioChunkCount = 0;

            audioChannel.onmessage = async (pcmData) => {
                audioChunkCount++;
                if (audioChunkCount <= 3 || audioChunkCount % 50 === 0) {
                    console.log(`[Local] Audio batch #${audioChunkCount}, size:`, pcmData?.length || 0);
                }
                this._updateAudioMeter(pcmData);
                try {
                    await invoke('send_audio_to_pipeline', { data: Array.from(new Uint8Array(pcmData)) });
                } catch (e) {
                    // Pipeline may not be ready yet
                }
            };

            const recordPath = await this._getSessionRecordPath();
            await invoke('start_capture', {
                source: this.currentSource,
                channel: audioChannel,
                recordPath,
            });
            console.log('[App] Audio capture started');
            this._scheduleCaptureHealthCheck();
        } catch (err) {
            console.error('Audio capture failed (pipeline still running):', err);
            this._showToast(`Audio: ${err}. Pipeline still loading...`, 'error');
        }
    }

    _handleLocalPipelineResult(data) {
        switch (data.type) {
            case 'ready':
                this.localPipelineReady = true;
                this._updateStatus('connected');
                this.transcriptUI.removeStatusMessage();
                this.transcriptUI.showListening();
                this._showToast('Local models ready!', 'success');
                break;
            case 'result':
                // Chase effect: show original first (gray), then translation (white)
                if (data.original) {
                    this.transcriptUI.addOriginal(data.original);
                }
                // Small delay for visual "chase" effect
                setTimeout(() => {
                if (data.translated) {
                    this.transcriptUI.addTranslation(data.translated);
                    this._speakIfEnabled(data.translated);
                }
                }, 80);
                // Persist atomically — Local pipeline gives both texts in
                // one event so we don't need FIFO pairing.
                sessionStore.addSegment(data.original || '', data.translated || '');
                break;
            case 'status':
                const msg = data.message || 'Loading...';
                // Status bar: show compact message (strip [pipeline] prefix)
                const statusText = document.getElementById('status-text');
                if (statusText) {
                    const compact = msg.replace(/^\[pipeline\]\s*/, '');
                    statusText.textContent = compact;
                }
                // Transcript area: only show loading/starting messages, not debug logs
                if (!msg.startsWith('[pipeline]')) {
                    this.transcriptUI.showStatusMessage(msg);
                }
                break;
            case 'done':
                this._updateStatus('disconnected');
                break;
        }
    }

    async _runMlxSetup() {
        const modal = document.getElementById('setup-modal');
        const progressFill = document.getElementById('setup-progress-fill');
        const progressPct = document.getElementById('setup-progress-pct');
        const statusText = document.getElementById('setup-status-text');
        const cancelBtn = document.getElementById('btn-cancel-setup');

        // Step mapping: step name → total progress weight
        const stepWeights = { check: 5, venv: 10, packages: 35, models: 50 };
        let totalProgress = 0;

        const updateStep = (stepName, icon, isActive) => {
            const stepEl = document.getElementById(`step-${stepName}`);
            if (!stepEl) return;
            stepEl.querySelector('.step-icon').textContent = icon;
            stepEl.classList.toggle('active', isActive);
            stepEl.classList.toggle('done', icon === '✅');
        };

        const updateProgress = (pct) => {
            totalProgress = Math.min(100, pct);
            progressFill.style.width = totalProgress + '%';
            progressPct.textContent = Math.round(totalProgress) + '%';
        };

        // Show modal
        modal.style.display = 'flex';

        return new Promise((resolve, reject) => {
            const channel = new window.__TAURI__.core.Channel();

            // Cancel handler
            const onCancel = () => {
                modal.style.display = 'none';
                reject(new Error('Setup cancelled'));
            };
            cancelBtn.addEventListener('click', onCancel, { once: true });

            channel.onmessage = (msg) => {
                let data;
                try {
                    data = (typeof msg === 'string') ? JSON.parse(msg) : msg;
                } catch (e) {
                    return;
                }

                switch (data.type) {
                    case 'progress':
                        statusText.textContent = data.message || 'Working...';

                        // Update step indicators
                        if (data.step) {
                            // Mark previous steps as done
                            const steps = ['check', 'venv', 'packages', 'models'];
                            const currentIdx = steps.indexOf(data.step);
                            steps.forEach((s, i) => {
                                if (i < currentIdx) updateStep(s, '✅', false);
                                else if (i === currentIdx) updateStep(s, '🔄', true);
                            });

                            if (data.done) {
                                updateStep(data.step, '✅', false);
                            }

                            // Calculate overall progress
                            let pct = 0;
                            steps.forEach((s, i) => {
                                if (i < currentIdx) pct += stepWeights[s];
                                else if (i === currentIdx) {
                                    pct += (data.progress || 0) / 100 * stepWeights[s];
                                }
                            });
                            updateProgress(pct);
                        }
                        break;

                    case 'complete':
                        updateProgress(100);
                        statusText.textContent = '✅ ' + (data.message || 'Setup complete!');
                        ['check', 'venv', 'packages', 'models'].forEach(s => updateStep(s, '✅', false));

                        // Close modal after brief delay
                        setTimeout(() => {
                            modal.style.display = 'none';
                            resolve();
                        }, 1000);
                        break;

                    case 'error':
                        statusText.textContent = '❌ ' + (data.message || 'Setup failed');
                        cancelBtn.textContent = 'Close';
                        cancelBtn.removeEventListener('click', onCancel);
                        cancelBtn.addEventListener('click', () => {
                            modal.style.display = 'none';
                            reject(new Error(data.message));
                        }, { once: true });
                        break;

                    case 'log':
                        console.log('[MLX Setup]', data.message);
                        break;
                }
            };

            invoke('run_mlx_setup', { channel })
                .catch(err => {
                    statusText.textContent = '❌ ' + err;
                    modal.style.display = 'none';
                    reject(err);
                });
        });
    }

    async _stopTranslationEngine() {
        this._audioCaptureActive = false;
        // Stop audio capture
        try {
            await invoke('stop_capture');
        } catch (err) {
            console.error('Failed to stop audio capture:', err);
        }

        if (this.translationMode === 'local') {
            // Stop local pipeline
            try {
                await invoke('stop_local_pipeline');
            } catch (err) {
                console.error('Failed to stop local pipeline:', err);
            }
            this.localPipelineReady = false;
            this.transcriptUI.removeStatusMessage();
            this._updateStatus('disconnected');
        } else if (this.translationMode === 'openai') {
            if (this.openAiClient) {
                try { await this.openAiClient.disconnect(); } catch {}
                this.openAiClient = null;
            }
            if (this.openAiOutputQueue) {
                this.openAiOutputQueue.close();
                this.openAiOutputQueue = null;
            }
            this._updateStatus('disconnected');
        } else if (this.translationMode === 'gemini') {
            if (this.geminiClient) {
                try { await this.geminiClient.disconnect(); } catch {}
                this.geminiClient = null;
            }
            this._updateStatus('disconnected');
        } else if (this.translationMode === 'qwen') {
            if (this.qwenClient) {
                try { await this.qwenClient.disconnect(); } catch {}
                this.qwenClient = null;
            }
            this._updateStatus('disconnected');
        } else {
            // Disconnect Soniox
            sonioxClient.disconnect();
        }

        // Keep transcript visible — don't clear
        this.transcriptUI.clearProvisional();

        // Drain any leftover Soniox originals that didn't get paired
        if (this._sonioxOriginalQueue) this._sonioxOriginalQueue.length = 0;
    }

    // Pause: stop capture and persist the current chunk, but keep the session
    // file open. The next Start appends a new chunk to the same file. Finalizing
    // into a new file is stopSession()'s job.
    async pause() {
        if (this._geminiReconnectTimer) {
            clearTimeout(this._geminiReconnectTimer);
            this._geminiReconnectTimer = null;
        }
        this._liveEngineGeneration++;
        this.isRunning = false;
        this.isPaused = true;
        this._updateStartButton();
        this._setEnginePillLocked(false);
        this._clearInactivityTimer();
        await this._stopTranslationEngine();

        // Close the chunk and persist the whole session (md + json sidecar).
        // Transcript stays on screen — clearSession is no longer called here
        // so user can review & continue in next chunk.
        sessionStore.endChunk();
        const result = await sessionStore.persist();
        if (result === 'saved') {
            const n = sessionStore.totalSegmentCount();
            this._showToast(`Saved ${n} segment${n === 1 ? '' : 's'}`, 'success');
        } else if (result === 'failed') {
            this._showToast('Save failed — session kept in memory', 'error');
        }
        // 'skipped' → data already on disk or nothing to save; no toast.

        // sessionStartTime stays — pausing keeps the same session file, which
        // lives across many Start/Pause cycles. stopSession() resets it.
    }

    // Stop: pause (if running), finalize the current session file with custom title,
    // then start a fresh session so the next Start writes a new file pair.
    async _promptConfirmStop() {
        const modal = document.getElementById('modal-confirm-stop');
        const input = document.getElementById('input-stop-meeting-title');
        const inputTags = document.getElementById('input-stop-meeting-tags');
        const selectCust = document.getElementById('select-stop-meeting-customer');
        const selectProj = document.getElementById('select-stop-meeting-project');
        const selectCat = document.getElementById('select-stop-meeting-category');
        const defaultTitle = sessionStore.title || this._formatDefaultMeetingTitle(this.sessionStartTime || this.recordingStartTime);

        const reg = await this._loadProjectRegistry();
        const activeCustomers = (reg.customers || []).filter(c => c.status === 'active');
        const activeProjects = (reg.projects || []).filter(p => p.status === 'active');

        // Populate customer select
        if (selectCust) {
            let custHtml = '<option value="">(Không chọn KH)</option>';
            for (const c of activeCustomers) {
                custHtml += `<option value="${this._escAttr(c.id)}">🏢 ${this._esc(c.name)}</option>`;
            }
            selectCust.innerHTML = custHtml;
            selectCust.value = sessionStore.customerId || '';
        }

        // Helper to populate projects filtered by selected customer
        const updateProjectsDropdown = (selectedCustomerId) => {
            if (!selectProj) return;
            const filteredProjs = selectedCustomerId
                ? activeProjects.filter(p => p.customer_id === selectedCustomerId)
                : activeProjects;
            let projHtml = '<option value="">(Không gán dự án)</option>';
            for (const p of filteredProjs) {
                projHtml += `<option value="${this._escAttr(p.id)}">📁 ${this._esc(p.name)}</option>`;
            }
            selectProj.innerHTML = projHtml;
            if (filteredProjs.some(p => p.id === sessionStore.projectId)) {
                selectProj.value = sessionStore.projectId;
            } else {
                selectProj.value = '';
            }
        };

        updateProjectsDropdown(selectCust?.value || sessionStore.customerId);

        const onCustChange = () => {
            updateProjectsDropdown(selectCust?.value);
        };
        const onProjChange = () => {
            const pId = selectProj?.value;
            if (pId) {
                const foundProj = activeProjects.find(p => p.id === pId);
                if (foundProj && foundProj.customer_id && selectCust) {
                    selectCust.value = foundProj.customer_id;
                }
            }
        };

        selectCust?.addEventListener('change', onCustChange);
        selectProj?.addEventListener('change', onProjChange);

        if (selectCat) {
            let catHtml = '<option value="">(Không phân loại)</option>';
            for (const c of (reg.categories || [])) {
                catHtml += `<option value="${this._escAttr(c.name)}">📅 ${this._esc(c.name)}</option>`;
            }
            selectCat.innerHTML = catHtml;
            selectCat.value = sessionStore.category || '';
        }

        const chkAutoMinutes = document.getElementById('chk-stop-auto-minutes');

        const savedAutoMinutes = localStorage.getItem('meet_minder_auto_minutes');
        if (chkAutoMinutes) {
            chkAutoMinutes.checked = savedAutoMinutes !== 'false';
        }

        const onAutoMinutesChange = () => {
            if (!chkAutoMinutes) return;
            localStorage.setItem('meet_minder_auto_minutes', chkAutoMinutes.checked ? 'true' : 'false');
        };
        chkAutoMinutes?.addEventListener('change', onAutoMinutesChange);

        const s = settingsManager.get();
        const srcLang = sessionStore.sourceLang || s.source_language || 'ja';
        const tgtLang = sessionStore.targetLang || s.target_language || 'vi';
        const isNoTranslation = !tgtLang || tgtLang === 'none' || tgtLang === srcLang;

        let autoMinutesLang = 'ja';
        let autoMinutesLangText = 'Tiếng Nhật 🇯🇵';
        let autoMinutesHintText = 'Mặc định tạo tiếng Nhật để tiết kiệm token. Có thể tạo thêm tiếng Việt trong tab Biên bản bất kỳ lúc nào.';

        if (isNoTranslation) {
            if (srcLang === 'vi') {
                autoMinutesLang = 'vi';
                autoMinutesLangText = 'Tiếng Việt 🇻🇳';
                autoMinutesHintText = 'Cuộc họp không dịch sẽ được tự động tạo Meeting Minutes bằng Tiếng Việt.';
            } else if (srcLang === 'ja') {
                autoMinutesLang = 'ja';
                autoMinutesLangText = 'Tiếng Nhật 🇯🇵';
                autoMinutesHintText = 'Cuộc họp không dịch sẽ được tự động tạo Meeting Minutes bằng Tiếng Nhật.';
            } else {
                autoMinutesLang = 'vi';
                autoMinutesLangText = 'Tiếng Việt 🇻🇳';
                autoMinutesHintText = 'Biên bản cuộc họp sẽ được tự động tạo bằng Tiếng Việt.';
            }
        }

        const chkAutoMinutesLabel = document.getElementById('chk-stop-auto-minutes-label');
        const chkAutoMinutesHint = document.getElementById('chk-stop-auto-minutes-hint');
        if (chkAutoMinutesLabel) {
            chkAutoMinutesLabel.textContent = `✨ Tự động tạo Meeting Minutes (${autoMinutesLangText}) sau khi lưu`;
        }
        if (chkAutoMinutesHint) {
            chkAutoMinutesHint.textContent = autoMinutesHintText;
        }

        if (!modal) {
            const entered = prompt('Nhập tên cuộc họp để kết thúc & lưu:', defaultTitle);
            return entered !== null ? {
                title: entered.trim() || defaultTitle,
                tags: sessionStore.tags || [],
                customerId: sessionStore.customerId,
                projectId: sessionStore.projectId,
                category: sessionStore.category,
                autoGenerateMinutes: chkAutoMinutes ? chkAutoMinutes.checked : false,
                minutesLang: autoMinutesLang,
                discard: false
            } : null;
        }

        if (input) {
            input.value = defaultTitle;
        }
        if (inputTags) {
            inputTags.value = (sessionStore.tags || []).map(t => `#${t}`).join(', ');
        }
        this._isStopConfirmationOpen = true;
        modal.style.display = 'flex';
        if (input) {
            input.focus();
            input.select();
        }

        return new Promise((resolve) => {
            const onConfirm = () => {
                cleanup();
                const chosenTitle = (input ? input.value.trim() : '') || defaultTitle;
                const chosenTags = (inputTags ? inputTags.value : '')
                    .split(',')
                    .map(t => t.trim().replace(/^#/, '').toLowerCase())
                    .filter(Boolean);
                const chosenCustomerId = selectCust?.value || null;
                const chosenProjectId = selectProj?.value || null;
                const chosenCategory = selectCat?.value || null;
                const autoGenerateMinutes = chkAutoMinutes ? chkAutoMinutes.checked : false;
                modal.style.display = 'none';
                resolve({
                    title: chosenTitle,
                    tags: chosenTags,
                    customerId: chosenCustomerId,
                    projectId: chosenProjectId,
                    category: chosenCategory,
                    autoGenerateMinutes,
                    minutesLang: autoMinutesLang,
                    discard: false,
                });
            };
            const onDiscard = () => {
                cleanup();
                modal.style.display = 'none';
                resolve({ discard: true });
            };
            const onCancel = () => {
                cleanup();
                modal.style.display = 'none';
                resolve(null);
            };
            const onKeyDown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    onConfirm();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                }
            };
            const cleanup = () => {
                this._isStopConfirmationOpen = false;
                selectCust?.removeEventListener('change', onCustChange);
                selectProj?.removeEventListener('change', onProjChange);
                chkAutoMinutes?.removeEventListener('change', onAutoMinutesChange);
                document.getElementById('btn-agree-confirm-stop')?.removeEventListener('click', onConfirm);
                document.getElementById('btn-discard-confirm-stop')?.removeEventListener('click', onDiscard);
                document.getElementById('btn-cancel-confirm-stop')?.removeEventListener('click', onCancel);
                document.getElementById('btn-close-confirm-stop')?.removeEventListener('click', onCancel);
                input?.removeEventListener('keydown', onKeyDown);
                inputTags?.removeEventListener('keydown', onKeyDown);
                window.removeEventListener('keydown', onKeyDown);
            };

            document.getElementById('btn-agree-confirm-stop')?.addEventListener('click', onConfirm);
            document.getElementById('btn-discard-confirm-stop')?.addEventListener('click', onDiscard);
            document.getElementById('btn-cancel-confirm-stop')?.addEventListener('click', onCancel);
            document.getElementById('btn-close-confirm-stop')?.addEventListener('click', onCancel);
            input?.addEventListener('keydown', onKeyDown);
            inputTags?.addEventListener('keydown', onKeyDown);
            window.addEventListener('keydown', onKeyDown);
        });
    }

    async stopSession(chosenTitle = null, chosenTags = null, chosenCustomerId = null, chosenProjectId = null, chosenCategory = null) {
        if (this.isRunning) await this.pause();

        const hadData = !sessionStore.isEmpty() && sessionStore.totalSegmentCount() > 0;
        const savedSessionId = sessionStore.id;

        if (chosenTitle) {
            sessionStore.title = chosenTitle;
        }
        if (chosenTags && Array.isArray(chosenTags)) {
            sessionStore.tags = chosenTags;
        }
        if (chosenCustomerId !== undefined) {
            sessionStore.customerId = chosenCustomerId;
        }
        if (chosenProjectId !== undefined) {
            sessionStore.projectId = chosenProjectId;
        }
        if (chosenCategory !== undefined) {
            sessionStore.category = chosenCategory;
        }

        if (!hadData) {
            this._showToast('Không có dữ liệu cuộc họp để lưu', 'info');
            this._hasUnsavedMeetingData = false;
        } else {
            const result = await sessionStore.endSession();
            if (result === 'failed') {
                this._showToast('Lưu thất bại — dữ liệu được giữ tạm trong bộ nhớ', 'error');
            } else {
                this._hasUnsavedMeetingData = false;
                this._showToast(`💾 Đã kết thúc & lưu: ${sessionStore.title || 'Cuộc họp'} ✓`, 'success');
            }
        }

        this.isRunning = false;
        this.isPaused = false;
        this.sessionStartTime = null;
        this.recordingStartTime = null;
        this._stopLiveDurationTimer();
        this._clearInactivityTimer();

        // Clear transcript UI back to fresh empty placeholder screen
        if (this.transcriptUI) {
            this.transcriptUI.clear();
            this.transcriptUI.showPlaceholder();
        }
        this._updateStatus('idle');

        // Reset live notes to template and clear metadata selectors (keep drawer open by default)
        if (this._liveNotesEditor) {
            const template = this._getNoteTemplate();
            this._liveNotesEditor.setContent(template);
            sessionStore.notes = template;
        }
        this._resetNoteMetadataSelectors();

        const settings = settingsManager.get();
        sessionStore.init({
            engine: settings.translation_mode || 'gemini',
            sourceLang: settings.source_language || 'ja',
            targetLang: settings.target_language || 'vi',
        });
        this._updateStartButton();

        return hadData ? savedSessionId : null;
    }

    async _handleStopSessionAction(stopAction) {
        if (!stopAction) return;
        try {
            if (stopAction.discard) {
                await this.discardSession();
            } else {
                const savedId = await this.stopSession(
                    stopAction.title,
                    stopAction.tags,
                    stopAction.customerId,
                    stopAction.projectId,
                    stopAction.category
                );

                if (stopAction.autoGenerateMinutes && savedId) {
                    setActivity('library');
                    await this._openSession(savedId);
                    this._switchSessionTab('minutes');
                    await this._generateMeetingMinutesForSession(savedId, stopAction.minutesLang || 'vi');
                }
            }
        } catch (err) {
            console.error('[App] Stop session error:', err);
            this._showToast(`Lỗi kết thúc: ${err}`, 'error');
        }
    }

    async discardSession() {
        if (this.isRunning) {
            this.isRunning = false;
            this.isPaused = true;
            this._updateStartButton();
            this._setEnginePillLocked(false);
            this._clearInactivityTimer();
            await this._stopTranslationEngine();
        }

        this.transcriptUI.clearProvisional();
        if (this._sonioxOriginalQueue) this._sonioxOriginalQueue.length = 0;

        try {
            await sessionStore.discard();
            this._showToast('🗑 Đã kết thúc và bỏ cuộc họp', 'info');
        } catch (err) {
            this._showToast(`Không thể bỏ cuộc họp: ${err}`, 'error');
            return;
        }

        this.isRunning = false;
        this.isPaused = false;
        this._hasUnsavedMeetingData = false;
        this.sessionStartTime = null;
        this.recordingStartTime = null;
        this._stopLiveDurationTimer();
        this._clearInactivityTimer();
        if (this.transcriptUI) {
            this.transcriptUI.clear();
            this.transcriptUI.showPlaceholder();
        }
        if (this._liveNotesEditor) {
            const template = this._getNoteTemplate();
            this._liveNotesEditor.setContent(template);
            sessionStore.notes = template;
        }
        this._resetNoteMetadataSelectors();

        const settings = settingsManager.get();
        sessionStore.init({
            engine: settings.translation_mode || 'gemini',
            sourceLang: settings.source_language || 'ja',
            targetLang: settings.target_language || 'vi',
        });
        this._updateStatus('idle');
        this._updateStartButton();
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Persist the session on the way out. endSession() first (cheap local write
    // that finalizes the file), then best-effort engine teardown via pause().
    // Both are idempotent, so running this more than once is harmless.
    async _flushOnExit() {
        try { await sessionStore.endSession(); } catch (e) { console.error('[App] exit flush (endSession) failed:', e); }
        try { await this.pause(); } catch (e) { console.error('[App] exit flush (pause) failed:', e); }
    }

    // Two close routes, one flush:
    //  • window ✕ / appWindow.close() → onCloseRequested (frontend)
    //  • Cmd+Q / Dock quit → Rust RunEvent::ExitRequested emits 'app-exit-requested'
    // Both flush (raced against a 3s deadline so a hung engine can't wedge the
    // app) then exit_app, which force-exits the process cleanly in Rust.
    async _bindCloseHooks() {
        await this.appWindow.onCloseRequested(async (event) => {
            if (this._closing) return;
            this._closing = true;
            event.preventDefault();
            await Promise.race([this._flushOnExit(), this._sleep(3000)]);
            try {
                await invoke('exit_app');
            } catch {
                try { await this.appWindow.destroy(); } catch {}
            }
        });

        await this.appWindow.listen('app-exit-requested', async () => {
            if (this._closing) return;
            this._closing = true;
            await Promise.race([this._flushOnExit(), this._sleep(3000)]);
            try { await invoke('exit_app'); } catch {}
        });
    }

    _startLiveDurationTimer() {
        if (this._liveDurationTimer) clearInterval(this._liveDurationTimer);
        this._updateLiveDurationDisplay();
        this._liveDurationTimer = setInterval(() => {
            this._updateLiveDurationDisplay();
        }, 1000);
    }

    _stopLiveDurationTimer() {
        if (this._liveDurationTimer) {
            clearInterval(this._liveDurationTimer);
            this._liveDurationTimer = null;
        }
        this._updateLiveDurationDisplay();
    }

    _updateLiveDurationDisplay() {
        const badge = document.getElementById('live-meeting-duration');
        const text = document.getElementById('live-duration-text');
        if (!badge || !text) return;

        if (!this.sessionStartTime) {
            badge.className = 'live-duration-badge is-idle';
            text.textContent = '00:00:00';
            badge.title = 'Thời gian diễn ra cuộc họp';
            return;
        }

        const elapsed = Math.max(0, Math.floor((Date.now() - this.sessionStartTime.getTime()) / 1000));
        const hrs = Math.floor(elapsed / 3600);
        const mins = Math.floor((elapsed % 3600) / 60);
        const secs = elapsed % 60;
        const p = (n) => String(n).padStart(2, '0');
        text.textContent = `${p(hrs)}:${p(mins)}:${p(secs)}`;

        if (this.isRunning) {
            badge.className = 'live-duration-badge is-running';
            badge.title = `Cuộc họp đang diễn ra: ${text.textContent}`;
        } else if (this.isPaused) {
            badge.className = 'live-duration-badge is-paused';
            badge.title = `Cuộc họp đang tạm dừng: ${text.textContent}`;
        } else {
            badge.className = 'live-duration-badge is-idle';
            badge.title = 'Thời gian diễn ra cuộc họp';
        }
    }

    _updateStartButton() {
        this._updateLiveDurationDisplay();

        const btnStart = document.getElementById('btn-start');
        const iconPlay = document.getElementById('icon-play');
        const iconPause = document.getElementById('icon-pause');
        const labelStart = document.getElementById('btn-start-label');

        const btnStop = document.getElementById('btn-stop');
        const iconStopSq = document.getElementById('icon-stop-sq');
        const iconSaveFloppy = document.getElementById('icon-save-floppy');
        const labelStop = document.getElementById('btn-stop-label');

        if (!btnStart) return;

        if (this.isRunning) {
            // Running -> "Tạm dừng"
            btnStart.className = 'primary-action-btn running-state';
            if (iconPlay) iconPlay.style.display = 'none';
            if (iconPause) iconPause.style.display = 'block';
            if (labelStart) labelStart.innerHTML = '<u>P</u>ause';
            btnStart.title = 'Pause translation (⌘P)';

            if (btnStop) {
                btnStop.style.display = 'inline-flex';
                btnStop.className = 'action-btn btn-stop-action';
                if (iconStopSq) iconStopSq.style.display = 'block';
                if (iconSaveFloppy) iconSaveFloppy.style.display = 'none';
                if (labelStop) labelStop.innerHTML = 'S<u>t</u>op';
                btnStop.title = 'Kết thúc cuộc họp & Lưu (⌘T)';
            }
        } else if (this.isPaused) {
            // Paused -> "Tiếp tục"
            btnStart.className = 'primary-action-btn paused-state';
            if (iconPlay) iconPlay.style.display = 'block';
            if (iconPause) iconPause.style.display = 'none';
            if (labelStart) labelStart.innerHTML = '<u>C</u>ontinue';
            btnStart.title = 'Continue translation (⌘C)';

            if (btnStop) {
                btnStop.style.display = 'inline-flex';
                btnStop.className = 'action-btn btn-stop-action';
                if (iconStopSq) iconStopSq.style.display = 'block';
                if (iconSaveFloppy) iconSaveFloppy.style.display = 'none';
                if (labelStop) labelStop.innerHTML = 'S<u>t</u>op';
                btnStop.title = 'Kết thúc cuộc họp & Lưu (⌘T)';
            }
        } else if (this._hasUnsavedMeetingData) {
            // Stopped with data -> Start btn resets to "Bắt đầu", Stop btn transitions to "Lưu Log"
            btnStart.className = 'primary-action-btn';
            if (iconPlay) iconPlay.style.display = 'block';
            if (iconPause) iconPause.style.display = 'none';
            if (labelStart) labelStart.innerHTML = '<u>S</u>tart';
            btnStart.title = 'Start a new translation (⌘S)';

            if (btnStop) {
                btnStop.style.display = 'inline-flex';
                btnStop.className = 'action-btn btn-stop-action is-save-log';
                if (iconStopSq) iconStopSq.style.display = 'none';
                if (iconSaveFloppy) iconSaveFloppy.style.display = 'block';
                if (labelStop) labelStop.textContent = 'Lưu Log';
                btnStop.title = 'Lưu / Đổi tên cuộc họp này (⌘T)';
            }
        } else {
            // Idle (Initial / No data) -> "Bắt đầu", Stop button hidden
            btnStart.className = 'primary-action-btn';
            if (iconPlay) iconPlay.style.display = 'block';
            if (iconPause) iconPause.style.display = 'none';
            if (labelStart) labelStart.innerHTML = '<u>S</u>tart';
            btnStart.title = 'Start translation (⌘S)';

            if (btnStop) {
                btnStop.style.display = 'none';
            }
        }
    }

    // ─── Transcript Persistence ───────────────────────────────

    _formatDuration(ms) {
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}m ${sec}s`;
    }

    async _saveTranscriptFile() {
        const startMs = this.recordingStartTime || Date.now();
        const durationMs = Date.now() - startMs;
        const duration = this._formatDuration(durationMs);

        // Use session metadata captured at start()
        const sourceLang = this.sessionSourceLang || document.getElementById('quick-select-source-lang')?.value || 'auto';
        const targetLang = this.sessionTargetLang || document.getElementById('quick-select-target-lang')?.value || 'vi';
        const mode = this.sessionMode || 'one_way';

        const content = this.transcriptUI.getFullSessionText({
            model: this.translationMode === 'soniox' ? 'Soniox Cloud API' : 'Local MLX Whisper',
            sourceLang,
            targetLang,
            duration,
            mode,
            audioSource: this.currentSource,
        });

        if (!content) return;

        try {
            const path = await invoke('save_transcript', { content });
            const filename = path.split('/').pop();
            this._showToast(`Saved: ${filename}`, 'success');
        } catch (err) {
            console.error('Failed to save transcript:', err);
            this._showToast('Failed to save transcript', 'error');
        }
    }

    // ─── Status ────────────────────────────────────────────

    _updateStatus(status) {
        switch (status) {
            case 'connecting':
            case 'disconnected':
            case 'idle':
                setLiveBadge('waiting');
                break;
            case 'connected':
            case 'listening':
                setLiveBadge('listening');
                break;
            case 'error':
                setLiveBadge('error');
                break;
            default:
                setLiveBadge(this.isRunning ? 'listening' : 'waiting');
        }
    }

    // ─── Window Position ───────────────────────────────────

    async _saveWindowPosition() {
        try {
            const factor = await this.appWindow.scaleFactor();
            const pos = await this.appWindow.outerPosition();
            const size = await this.appWindow.innerSize();
            // Save logical coordinates (physical / scaleFactor)
            localStorage.setItem('window_state', JSON.stringify({
                x: Math.round(pos.x / factor),
                y: Math.round(pos.y / factor),
                width: Math.round(size.width / factor),
                height: Math.round(size.height / factor),
            }));
        } catch (err) {
            console.error('Failed to save window position:', err);
        }
    }

    async _restoreWindowPosition() {
        try {
            const saved = localStorage.getItem('window_state');
            if (!saved) return;

            const state = JSON.parse(saved);
            const { LogicalPosition, LogicalSize } = window.__TAURI__.window;

            // Validate — don't restore if position seems off-screen
            if (state.x < -100 || state.y < -100 || state.x > 5000 || state.y > 3000) {
                console.warn('Saved window position looks off-screen, skipping restore');
                localStorage.removeItem('window_state');
                return;
            }

            if (state.width && state.height && state.width >= 300 && state.height >= 100) {
                await this.appWindow.setSize(new LogicalSize(state.width, state.height));
            }
            if (state.x !== undefined && state.y !== undefined) {
                await this.appWindow.setPosition(new LogicalPosition(state.x, state.y));
            }
        } catch (err) {
            console.error('Failed to restore window position:', err);
            localStorage.removeItem('window_state');
        }
    }

    // ─── Pin / Unpin (Always on Top) ────────────────────

    async _togglePin() {
        this.isPinned = !this.isPinned;
        await this.appWindow.setAlwaysOnTop(this.isPinned);
        localStorage.setItem('is_pinned', this.isPinned ? 'true' : 'false');
        const btn = document.getElementById('btn-pin');
        if (btn) btn.classList.toggle('active', this.isPinned);
        this._showToast(this.isPinned ? '📌 Đã ghim trên cùng' : 'Đã bỏ ghim — cửa sổ có thể ẩn phía sau', 'success');
    }

    // ─── Compact Mode ───────────────────────────────

    _toggleCompact() {
        // Unified with auto-hide in ui-shell — one chrome hide/show mechanism.
        this.isCompact = toggleManualCompact();
    }

    _setViewMode(mode) {
        if (!mode) return;
        this.currentViewMode = mode;
        this.transcriptUI.configure({ viewMode: mode });
        const selectView = document.getElementById('select-view-mode');
        if (selectView) selectView.value = mode;
    }

    _toggleViewMode() {
        const isDual = this.transcriptUI.viewMode === 'dual' || this.transcriptUI.viewMode === 'both';
        const newMode = isDual ? 'translation' : 'dual';
        this._setViewMode(newMode);
    }

    /**
     * Serialize quick language changes. Change events can arrive while the
     * previous settings write is still in flight; reading the current selects
     * here prevents a fast source/target toggle from restoring stale values.
     */
    _saveQuickLanguageSettings(changes) {
        this._quickLanguageUpdate = this._quickLanguageUpdate
            .catch(() => {})
            .then(async () => {
                const next = { ...settingsManager.get(), ...changes };
                const sourceSelect = document.getElementById('quick-select-source-lang');
                const targetSelect = document.getElementById('quick-select-target-lang');
                if (sourceSelect?.value) next.source_language = sourceSelect.value;
                if (targetSelect?.value) next.target_language = targetSelect.value;
                await settingsManager.save(next);
                return next;
            });
        return this._quickLanguageUpdate;
    }

    /**
     * Stop only the translation provider while leaving the shared audio
     * capture alive. The old client's callbacks are detached first because
     * disconnect() may flush an in-flight partial result.
     */
    async _disconnectLiveEngine() {
        if (this.translationMode === 'gemini' && this.geminiClient) {
            const client = this.geminiClient;
            this.geminiClient = null;
            client.onStatusChange = () => {};
            client.onSegment = () => {};
            client.onSourceFinal = () => {};
            client.onTranslationFailed = () => {};
            client.onProvisional = () => {};
            client.onError = () => {};
            client.onClosed = () => {};
            try { await client.disconnect(); } catch (err) {
                console.warn('[Gemini Realtime] Error stopping old client:', err);
            }
        } else if (this.translationMode === 'openai' && this.openAiClient) {
            const client = this.openAiClient;
            this.openAiClient = null;
            client.onStatusChange = () => {};
            client.onSegment = () => {};
            client.onSourceProvisional = () => {};
            client.onProvisional = () => {};
            client.onError = () => {};
            client.onClosed = () => {};
            try { await client.disconnect(); } catch (err) {
                console.warn('[OpenAI Realtime] Error stopping old client:', err);
            }
            if (this.openAiOutputQueue) {
                this.openAiOutputQueue.close();
                this.openAiOutputQueue = null;
            }
        } else if (this.translationMode === 'qwen' && this.qwenClient) {
            const client = this.qwenClient;
            this.qwenClient = null;
            client.onStatusChange = () => {};
            client.onSegment = () => {};
            client.onProvisional = () => {};
            client.onError = () => {};
            client.onClosed = () => {};
            try { await client.disconnect(); } catch (err) {
                console.warn('[Qwen Realtime] Error stopping old client:', err);
            }
        } else if (this.translationMode === 'soniox') {
            sonioxClient.disconnect();
            // A source-only Soniox segment can be left pending when a socket is
            // restarted. Mark it as intentionally untranslated so a new
            // socket's translation cannot attach to an old UI segment.
            for (const pending of this._sonioxOriginalQueue) {
                this.transcriptUI.addTranslation('', pending.pendingId);
            }
            this._sonioxOriginalQueue.length = 0;
        }
        this.transcriptUI.clearProvisional();
    }

    /**
     * Reconnect the current provider in order, so rapid language and
     * translate/no-translate toggles cannot leave multiple providers sending
     * results into the same transcript.
     */
    _restartLiveEngineForSettings() {
        const generation = ++this._liveEngineGeneration;
        if (this._geminiReconnectTimer) {
            clearTimeout(this._geminiReconnectTimer);
            this._geminiReconnectTimer = null;
        }
        this._liveEngineRestart = this._liveEngineRestart
            .catch(() => {})
            .then(async () => {
                if (!this.isRunning || generation !== this._liveEngineGeneration) return;
                if (this.translationMode === 'local') {
                    // The local pipeline reads its language pair only at
                    // startup, so it also needs the shared capture restarted.
                    await this._stopTranslationEngine();
                } else {
                    await this._disconnectLiveEngine();
                }
                if (!this.isRunning || generation !== this._liveEngineGeneration) return;
                await this._startTranslationEngine(settingsManager.get());
            });
        return this._liveEngineRestart;
    }

    async _handleQuickSourceLangChange(srcLang) {
        const s = await this._saveQuickLanguageSettings({ source_language: srcLang });
        const srcName = this._getQuickLangName(srcLang);
        this._showToast(`Ngôn ngữ gốc: ${srcName}`, 'info');
        const langEl = document.getElementById('live-lang');
        if (langEl) {
            const tgtName = this._getQuickLangName(s.target_language || 'none');
            langEl.textContent = `${srcName} → ${tgtName}`;
        }
        if (this.isRunning) await this._restartLiveEngineForSettings();
    }

    async _handleQuickTargetLangChange(tgtLang) {
        const s = await this._saveQuickLanguageSettings({ target_language: tgtLang });
        if (this.transcriptUI) {
            this.transcriptUI.configure({ targetLanguage: tgtLang });
        }
        const tgtName = this._getQuickLangName(tgtLang);
        if (tgtLang === 'none') {
            if (this.transcriptUI.viewMode !== 'original') {
                this._viewModeBeforeNoTranslation = this.transcriptUI.viewMode;
            }
            this._forcedOriginalForNoTranslation = true;
            const selectViewMode = document.getElementById('select-view-mode');
            if (selectViewMode) selectViewMode.value = 'original';
            this._setViewMode('original');
            this._showToast('Đã tắt dịch (Chỉ chép lời)', 'info');
        } else {
            if (this._forcedOriginalForNoTranslation) {
                this._forcedOriginalForNoTranslation = false;
                this._setViewMode(this._viewModeBeforeNoTranslation || 'dual');
                this._viewModeBeforeNoTranslation = null;
            }
            this._showToast(`Ngôn ngữ dịch: ${tgtName}`, 'info');
        }
        const langEl = document.getElementById('live-lang');
        if (langEl) {
            const srcName = this._getQuickLangName(s.source_language || 'vi');
            langEl.textContent = `${srcName} → ${tgtName}`;
        }
        if (this.isRunning) await this._restartLiveEngineForSettings();
    }

    async _handleQuickLangSwap() {
        const current = settingsManager.get();
        const curSrc = current.source_language || 'vi';
        const curTgt = current.target_language || 'ja';

        if (curTgt === 'none') {
            this._showToast('Không thể đổi chiều khi đang tắt dịch', 'warning');
            return;
        }

        const newSrc = curTgt;
        const newTgt = curSrc === 'auto' ? 'en' : curSrc;

        const quickSrc = document.getElementById('quick-select-source-lang');
        const quickTgt = document.getElementById('quick-select-target-lang');

        if (quickSrc) quickSrc.value = newSrc;
        if (quickTgt) quickTgt.value = newTgt;

        await this._saveQuickLanguageSettings({
            source_language: newSrc,
            target_language: newTgt,
        });
        if (this.transcriptUI) {
            this.transcriptUI.configure({ targetLanguage: newTgt });
        }
        const newSrcName = this._getQuickLangName(newSrc);
        const newTgtName = this._getQuickLangName(newTgt);
        this._showToast(`Đã đổi chiều: ${newSrcName} → ${newTgtName}`, 'success');

        const langEl = document.getElementById('live-lang');
        if (langEl) {
            langEl.textContent = `${newSrcName} → ${newTgtName}`;
        }

        if (this.isRunning) await this._restartLiveEngineForSettings();
    }

    async _setTranslationTiming(timing) {
        const s = settingsManager.get();
        s.translation_timing = timing;
        if (timing === 'realtime') {
            s.endpoint_delay = 500;
        } else {
            s.endpoint_delay = 3000;
        }
        const selectTiming = document.getElementById('select-translation-timing');
        if (selectTiming) selectTiming.value = timing;
        await settingsManager.save(s);
        this._showToast(timing === 'realtime' ? '⚡ Kiểu dịch: Dịch real time' : '⏳ Kiểu dịch: Dịch hết câu', 'info');
    }

    _adjustFontSize(delta) {
        const current = this.transcriptUI.fontSize || 16;
        const newSize = Math.max(12, Math.min(140, current + delta));
        this.transcriptUI.configure({ fontSize: newSize });

        // Update display
        const display = document.getElementById('font-size-display');
        if (display) display.textContent = newSize;

        // Sync with settings slider
        const slider = document.getElementById('range-font-size');
        if (slider) slider.value = newSize;
        const sliderVal = document.getElementById('font-size-value');
        if (sliderVal) sliderVal.textContent = `${newSize}px`;
    }

    // ─── Toast ─────────────────────────────────────────────

    // ─── Session History ───────────────────────────────────

    // ─── Session History / Meeting Logs ───────────────────

    _updateBatchSelectionUI() {
        const count = this._selectedSessionIds.size;
        const countEl = document.getElementById('sessions-selected-count');
        const batchBtn = document.getElementById('btn-batch-delete-sessions');
        const batchExportBtn = document.getElementById('btn-batch-export-md');
        const batchAiBtn = document.getElementById('btn-batch-ai-digest');
        const selectAllChk = document.getElementById('chk-select-all-sessions');
        const totalItems = document.querySelectorAll('.session-item-chk').length;

        if (countEl) countEl.textContent = `${count} đã chọn`;
        if (batchBtn) batchBtn.disabled = count === 0;
        if (batchExportBtn) batchExportBtn.disabled = count === 0;
        if (batchAiBtn) batchAiBtn.disabled = count === 0;
        if (selectAllChk) selectAllChk.checked = totalItems > 0 && count === totalItems;
    }

    async _deleteSelectedSessions() {
        if (this._selectedSessionIds.size === 0) return;
        const ids = Array.from(this._selectedSessionIds);
        const count = ids.length;

        if (ids.includes(sessionStore.id)) {
            this._showToast('Không thể xoá cuộc họp đang chạy — hãy Dừng trước', 'error');
            return;
        }

        if (!confirm(`Xóa vĩnh viễn ${count} cuộc họp đã chọn?`)) return;

        try {
            await invoke('delete_sessions', { ids });
            this._selectedSessionIds.clear();
            this._showToast(`Đã xóa ${count} cuộc họp`, 'success');
            await this._showSessions();
        } catch (err) {
            this._showToast(`Xóa thất bại: ${err}`, 'error');
        }
    }

    async _promptSaveMeeting(isStopping = false) {
        const modal = document.getElementById('modal-save-meeting');
        const input = document.getElementById('input-meeting-title');
        if (!modal || !input) return;

        const defaultTitle = sessionStore.title || this._formatDefaultMeetingTitle(this.sessionStartTime || this.recordingStartTime);
        input.value = defaultTitle;
        modal.style.display = 'flex';
        input.focus();
        input.select();

        return new Promise((resolve) => {
            const onConfirm = async () => {
                cleanup();
                const chosenTitle = input.value.trim() || defaultTitle;
                sessionStore.title = chosenTitle;
                if (sessionStore.id) {
                    await sessionStore.persist();
                    try {
                        await invoke('update_session_title', { id: sessionStore.id, title: chosenTitle });
                    } catch {}
                }
                modal.style.display = 'none';
                this._showToast(`💾 Đã lưu: ${chosenTitle}`, 'success');
                resolve(chosenTitle);
            };
            const onCancel = () => {
                cleanup();
                modal.style.display = 'none';
                resolve(null);
            };
            const onKeyDown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    onConfirm();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                }
            };
            const cleanup = () => {
                document.getElementById('btn-confirm-save-meeting')?.removeEventListener('click', onConfirm);
                document.getElementById('btn-cancel-save-meeting')?.removeEventListener('click', onCancel);
                document.getElementById('btn-close-save-meeting')?.removeEventListener('click', onCancel);
                input.removeEventListener('keydown', onKeyDown);
            };

            document.getElementById('btn-confirm-save-meeting')?.addEventListener('click', onConfirm);
            document.getElementById('btn-cancel-save-meeting')?.addEventListener('click', onCancel);
            document.getElementById('btn-close-save-meeting')?.addEventListener('click', onCancel);
            input.addEventListener('keydown', onKeyDown);
        });
    }

    async _renameSession(id, currentTitle = '') {
        const modal = document.getElementById('modal-rename-meeting');
        const input = document.getElementById('input-rename-meeting-title');
        if (!modal || !input) return;

        input.value = currentTitle;
        modal.style.display = 'flex';
        input.focus();
        input.select();

        return new Promise((resolve) => {
            const onConfirm = async () => {
                cleanup();
                const newTitle = input.value.trim();
                if (newTitle && newTitle !== currentTitle) {
                    try {
                        await invoke('update_session_title', { id, title: newTitle });
                        if (this._currentViewedSession && this._currentViewedSession.id === id) {
                            const titleEl = document.getElementById('session-viewer-title');
                            if (titleEl) titleEl.textContent = newTitle;
                        }
                        this._showToast('Đã đổi tên cuộc họp', 'success');
                        await this._showSessions();
                    } catch (err) {
                        this._showToast(`Đổi tên thất bại: ${err}`, 'error');
                    }
                }
                modal.style.display = 'none';
                resolve(newTitle);
            };
            const onCancel = () => {
                cleanup();
                modal.style.display = 'none';
                resolve(null);
            };
            const onKeyDown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    onConfirm();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                }
            };
            const cleanup = () => {
                document.getElementById('btn-confirm-rename-meeting')?.removeEventListener('click', onConfirm);
                document.getElementById('btn-cancel-rename-meeting')?.removeEventListener('click', onCancel);
                document.getElementById('btn-close-rename-meeting')?.removeEventListener('click', onCancel);
                input.removeEventListener('keydown', onKeyDown);
            };

            document.getElementById('btn-confirm-rename-meeting')?.addEventListener('click', onConfirm);
            document.getElementById('btn-cancel-rename-meeting')?.addEventListener('click', onCancel);
            document.getElementById('btn-close-rename-meeting')?.addEventListener('click', onCancel);
            input.addEventListener('keydown', onKeyDown);
        });
    }

    _formatDefaultMeetingTitle(dateObj) {
        const d = dateObj ? new Date(dateObj) : new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `MM_${y}${m}${day}_${hh}:${mm}`;
    }

    async _playSessionTTS(id, isLegacy = false) {
        try {
            const btn = document.getElementById('btn-session-tts-play');

            // Stop any currently playing session audio
            if (this._sessionAudioElement) {
                const wasPlayingSame = this._sessionAudioId === id;
                this._sessionAudioElement.pause();
                this._sessionAudioElement = null;
                this._sessionAudioId = null;
                this._resetSessionPlayerUI();
                if (wasPlayingSame) {
                    this._showToast('Đã dừng phát ghi âm', 'info');
                    return;
                }
            }

            if (isLegacy) {
                this._showToast('Cuộc họp cũ này không có file ghi âm âm thanh', 'info');
                return;
            }

            // Read the meeting audio recording file (.wav)
            let audioDataUrl = null;
            try {
                audioDataUrl = await invoke('read_session_audio', { id });
            } catch (audioErr) {
                console.warn('[App] read_session_audio failed:', audioErr);
            }

            if (!audioDataUrl) {
                this._showToast('Không có file ghi âm cho cuộc họp này', 'info');
                if (btn) btn.innerHTML = '🔊 Nghe lại';
                return;
            }

            this._showToast('🔊 Đang phát lại bản ghi âm cuộc họp...', 'info');
            if (btn) btn.innerHTML = '⏸ Tạm dừng';

            const audio = new Audio(audioDataUrl);
            this._sessionAudioElement = audio;
            this._sessionAudioId = id;
            this._setSessionPlayerUI(id, true);
            audio.onloadedmetadata = () => this._updateSessionPlayerUI(audio);
            audio.ontimeupdate = () => this._updateSessionPlayerUI(audio);
            audio.onpause = () => this._setSessionPlayerUI(id, false);
            audio.onplay = () => this._setSessionPlayerUI(id, true);
            audio.onended = () => {
                this._sessionAudioElement = null;
                this._sessionAudioId = null;
                this._resetSessionPlayerUI();
            };
            audio.onerror = () => {
                const mediaError = audio.error;
                console.error('[App] Audio playback error:', mediaError?.code, mediaError?.message);
                this._showToast(`Lỗi khi phát file ghi âm${mediaError?.message ? `: ${mediaError.message}` : ''}`, 'error');
                this._sessionAudioElement = null;
                this._sessionAudioId = null;
                this._resetSessionPlayerUI();
            };
            await audio.play();
        } catch (err) {
            this._showToast(`Lỗi phát âm thanh: ${err}`, 'error');
            const btn = document.getElementById('btn-session-tts-play');
            this._resetSessionPlayerUI();
        }
    }

    _formatPlayerTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = String(total % 60).padStart(2, '0');
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
    }

    _sessionPlayerElements() {
        return Array.from(document.querySelectorAll('.session-player'));
    }

    _setSessionPlayerUI(id, playing) {
        this._sessionPlayerElements().forEach(player => {
            const isCurrent = player.dataset.playerId === id;
            const toggle = player.querySelector('[data-player-toggle]');
            if (isCurrent) {
                player.classList.add('is-active');
                if (toggle) {
                    toggle.textContent = playing ? '❚❚' : '▶';
                    toggle.title = playing ? 'Tạm dừng' : 'Tiếp tục phát';
                }
            } else if (!id) {
                player.classList.remove('is-active');
            }
        });
        const detailBtn = document.getElementById('btn-session-tts-play');
        if (detailBtn && this._currentViewedSession?.id === id) {
            detailBtn.innerHTML = playing ? '⏸ Tạm dừng' : '🔊 Nghe lại';
        }
    }

    _updateSessionPlayerUI(audio) {
        this._sessionPlayerElements().forEach(player => {
            if (player.dataset.playerId !== this._sessionAudioId) return;
            const timeline = player.querySelector('[data-player-timeline]');
            const current = player.querySelector('[data-player-current]');
            const duration = player.querySelector('[data-player-duration]');
            if (timeline) {
                timeline.max = Number.isFinite(audio.duration) ? audio.duration : 0;
                timeline.value = audio.currentTime || 0;
                timeline.style.setProperty('--player-progress', `${audio.duration ? (audio.currentTime / audio.duration) * 100 : 0}%`);
            }
            if (current) current.textContent = this._formatPlayerTime(audio.currentTime);
            if (duration) duration.textContent = this._formatPlayerTime(audio.duration);
        });
    }

    _resetSessionPlayerUI() {
        this._sessionPlayerElements().forEach(player => {
            player.classList.remove('is-active');
            player.dataset.playerId = '';
            const toggle = player.querySelector('[data-player-toggle]');
            const timeline = player.querySelector('[data-player-timeline]');
            if (toggle) { toggle.textContent = '▶'; toggle.title = 'Phát bản ghi âm'; }
            if (timeline) { timeline.value = 0; timeline.max = 0; timeline.style.setProperty('--player-progress', '0%'); }
            const current = player.querySelector('[data-player-current]');
            const duration = player.querySelector('[data-player-duration]');
            if (current) current.textContent = '0:00';
            if (duration) duration.textContent = '0:00';
        });
        const detailBtn = document.getElementById('btn-session-tts-play');
        if (detailBtn) detailBtn.innerHTML = '🔊 Nghe lại';
    }

    _bindSessionPlayer(player) {
        if (!player || player.dataset.bound === '1') return;
        player.dataset.bound = '1';
        player.querySelector('[data-player-toggle]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = player.dataset.playerId || player.dataset.id;
            if (id) this._playSessionTTS(id, player.dataset.legacy === '1');
        });
        player.querySelector('[data-player-timeline]')?.addEventListener('input', (e) => {
            if (this._sessionAudioElement && player.dataset.playerId === this._sessionAudioId) {
                this._sessionAudioElement.currentTime = Number(e.target.value);
                this._updateSessionPlayerUI(this._sessionAudioElement);
            }
        });
    }

    async _loadProjectRegistry() {
        try {
            this._projectRegistry = await invoke('get_project_registry');
        } catch (err) {
            console.error('Failed to load project registry:', err);
            this._projectRegistry = { projects: [], categories: [], tags: [] };
        }
        this._populateNoteMetadataSelectors?.();
        return this._projectRegistry;
    }

    _renderCustomerFilterBar() {
        const select = document.getElementById('select-session-customer-filter');
        if (!select) return;
        const customers = this._projectRegistry?.customers || [];
        let html = '<option value="">🏢 Tất cả KH</option>';
        for (const c of customers) {
            const statusIcon = c.status === 'active' ? '🟢' : '⚪';
            const selected = this._activeCustomerFilter === c.id ? 'selected' : '';
            html += `<option value="${this._escAttr(c.id)}" ${selected}>${statusIcon} ${this._esc(c.name)}</option>`;
        }
        select.innerHTML = html;
        select.value = this._activeCustomerFilter || '';
    }

    _renderProjectFilterBar() {
        const select = document.getElementById('select-session-project-filter');
        if (!select) return;
        let projects = this._projectRegistry?.projects || [];
        if (this._activeCustomerFilter) {
            projects = projects.filter(p => p.customer_id === this._activeCustomerFilter);
        }
        let html = '<option value="">📁 Tất cả dự án</option>';
        for (const p of projects) {
            const statusIcon = p.status === 'active' ? '🟢' : '⚪';
            const selected = this._activeProjectFilter === p.id ? 'selected' : '';
            html += `<option value="${this._escAttr(p.id)}" ${selected}>${statusIcon} ${this._esc(p.name)}</option>`;
        }
        select.innerHTML = html;
        if (projects.some(p => p.id === this._activeProjectFilter)) {
            select.value = this._activeProjectFilter;
        } else {
            this._activeProjectFilter = null;
            select.value = '';
        }
    }

    _renderCategoryFilterSelect() {
        const select = document.getElementById('select-session-category-filter');
        if (!select) return;
        const categories = this._projectRegistry?.categories || [];
        let html = '<option value="">📅 Tất cả phân loại</option>';
        for (const c of categories) {
            const selected = this._activeCategoryFilter === c.name ? 'selected' : '';
            html += `<option value="${this._escAttr(c.name)}" ${selected}>📅 ${this._esc(c.name)}</option>`;
        }
        select.innerHTML = html;
        select.value = this._activeCategoryFilter || '';
    }

    _renderTagFilterSelect() {
        const select = document.getElementById('select-session-tag-filter');
        if (!select) return;
        const sessionTags = (this._cachedSessions || []).flatMap(s => s.tags || []);
        const regTags = this._projectRegistry?.tags || [];
        const allTags = Array.from(new Set([...regTags, ...sessionTags])).filter(Boolean);
        let html = '<option value="">#️⃣ Tất cả thẻ</option>';
        for (const tag of allTags) {
            const count = (this._cachedSessions || []).filter(s => (s.tags || []).includes(tag)).length;
            const selected = this._activeTagFilter === tag ? 'selected' : '';
            html += `<option value="${this._escAttr(tag)}" ${selected}>#${this._esc(tag)} (${count})</option>`;
        }
        select.innerHTML = html;
        select.value = this._activeTagFilter || '';
    }

    async _showSessions(query) {
        if (this._sessionAudioElement) {
            this._sessionAudioElement.pause();
            this._sessionAudioElement = null;
            this._sessionAudioId = null;
        }
        this._resetSessionPlayerUI();
        const listEl = document.getElementById('sessions-list');
        const listPanel = document.getElementById('sessions-list-panel');
        const viewer = document.getElementById('session-viewer');

        if (listPanel) listPanel.style.display = '';
        if (viewer) viewer.style.display = 'none';
        if (!listEl) return;

        listEl.innerHTML = '<div class="sessions-loading">Loading...</div>';

        try {
            await this._loadProjectRegistry();
            const cmd = query && query.trim() ? 'search_sessions' : 'list_sessions';
            const args = query && query.trim() ? { query: query.trim() } : {};
            const sessions = await invoke(cmd, args);
            this._cachedSessions = sessions || [];

            this._renderCustomerFilterBar();
            this._renderProjectFilterBar();
            this._renderCategoryFilterSelect();
            this._renderTagFilterSelect();

            if (this._cachedSessions.length === 0) {
                listEl.innerHTML = '<div class="sessions-empty">Chưa có meeting log nào được lưu.</div>';
                this._updateBatchSelectionUI();
                return;
            }

            // Ensure newest first sorting
            this._cachedSessions.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

            this._renderFilteredSessions();
        } catch (err) {
            listEl.innerHTML = `<div class="sessions-empty">Error: ${err}</div>`;
        }
    }

    _renderFilteredSessions() {
        const listEl = document.getElementById('sessions-list');
        if (!listEl) return;

        let filtered = this._cachedSessions || [];
        if (this._activeCustomerFilter) {
            filtered = filtered.filter(s => s.customer_id === this._activeCustomerFilter);
        }
        if (this._activeProjectFilter) {
            filtered = filtered.filter(s => s.project_id === this._activeProjectFilter);
        }
        if (this._activeCategoryFilter) {
            filtered = filtered.filter(s => s.category === this._activeCategoryFilter);
        }
        if (this._activeTagFilter) {
            filtered = filtered.filter(s => (s.tags || []).includes(this._activeTagFilter));
        }

        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="sessions-empty">Không tìm thấy cuộc họp nào phù hợp bộ lọc.</div>`;
            this._updateBatchSelectionUI();
            return;
        }

        listEl.innerHTML = filtered.map(s => this._renderSessionItem(s)).join('');
        this._updateBatchSelectionUI();

        // Checkbox changes
        listEl.querySelectorAll('.session-item-chk').forEach(chk => {
            chk.addEventListener('click', (e) => e.stopPropagation());
            chk.addEventListener('change', (e) => {
                const id = e.target.dataset.id;
                if (e.target.checked) this._selectedSessionIds.add(id);
                else this._selectedSessionIds.delete(id);
                this._updateBatchSelectionUI();
            });
        });

        // Resume session
        listEl.querySelectorAll('.session-btn-action.resume').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const legacy = btn.dataset.legacy === '1';
                this._resumeSession(id, legacy);
            });
        });

        // Edit session metadata & rename combined
        listEl.querySelectorAll('.session-btn-action.edit-meta').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const sess = this._cachedSessions.find(s => s.id === id);
                if (sess) {
                    this._editSessionMetadata(sess);
                }
            });
        });

        // Customer badge click on item (filters by that customer)
        listEl.querySelectorAll('.session-customer-badge').forEach(badge => {
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                const cid = badge.dataset.customerId;
                if (cid) {
                    this._activeCustomerFilter = (this._activeCustomerFilter === cid) ? null : cid;
                    this._renderCustomerFilterBar();
                    this._renderProjectFilterBar();
                    this._renderFilteredSessions();
                }
            });
        });

        // Project badge click on item (filters by that project)
        listEl.querySelectorAll('.session-project-badge').forEach(badge => {
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                const pid = badge.dataset.projectId;
                if (pid) {
                    this._activeProjectFilter = (this._activeProjectFilter === pid) ? null : pid;
                    this._renderProjectFilterBar();
                    this._renderFilteredSessions();
                }
            });
        });

        // Category badge click on item (filters by that category)
        listEl.querySelectorAll('.session-category-badge').forEach(badge => {
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                const cat = badge.dataset.category;
                if (cat) {
                    this._activeCategoryFilter = (this._activeCategoryFilter === cat) ? null : cat;
                    this._renderCategoryFilterSelect();
                    this._renderFilteredSessions();
                }
            });
        });

        // Tag badge click on item (filters by that tag)
        listEl.querySelectorAll('.session-tag-badge').forEach(badge => {
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = badge.dataset.tag;
                if (tag) {
                    this._activeTagFilter = (this._activeTagFilter === tag) ? null : tag;
                    this._renderTagFilterSelect();
                    this._renderFilteredSessions();
                }
            });
        });

        // TTS play
        listEl.querySelectorAll('.session-btn-action.play-tts').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const legacy = btn.dataset.legacy === '1';
                this._playSessionTTS(id, legacy);
            });
        });

        // Copy session
        listEl.querySelectorAll('.session-btn-action.copy-session').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const legacy = btn.dataset.legacy === '1';
                try {
                    let text = '';
                    if (legacy) {
                        text = await invoke('read_legacy_session', { id });
                    } else {
                        const res = await invoke('read_session', { id });
                        text = res.md;
                    }
                    if (text) {
                        await navigator.clipboard.writeText(text);
                        this._showToast('Đã copy nội dung cuộc họp ✓', 'success');
                        const orig = btn.innerHTML;
                        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#85e0a3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                        setTimeout(() => { if (btn) btn.innerHTML = orig; }, 1500);
                    }
                } catch (err) {
                    this._showToast(`Lỗi copy: ${err}`, 'error');
                }
            });
        });

        // Delete
        listEl.querySelectorAll('.session-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                if (id === sessionStore.id) {
                    this._showToast('Không thể xoá cuộc họp đang chạy — hãy Dừng trước', 'error');
                    return;
                }
                if (!confirm('Xóa vĩnh viễn cuộc họp này?')) return;
                try {
                    await invoke('delete_session', { id });
                    this._selectedSessionIds.delete(id);
                    await this._showSessions();
                    this._showToast('Đã xóa cuộc họp', 'success');
                } catch (err) {
                    this._showToast(`Delete failed: ${err}`, 'error');
                }
            });
        });

        // Item click
        listEl.querySelectorAll('.session-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.session-delete-btn, .session-btn-action, .session-tag-badge, .session-project-badge, .session-customer-badge, .session-category-badge, .session-item-chk')) return;
                const id = item.dataset.id;
                const legacy = item.dataset.legacy === '1';
                this._openSession(id, legacy);
            });
        });
    }

    _renderSessionItem(s) {
        const title = this._esc(s.title || 'Cuộc họp chưa đặt tên');
        const created = this._esc(s.created_at || '').slice(0, 16);
        const duration = this._formatSeconds(s.duration_sec || 0);
        const engine = s.engine || 'unknown';
        const engineBadge = s.has_legacy_only
            ? `<span class="session-badge badge-legacy">legacy</span>`
            : `<span class="session-badge badge-engine">${this._esc(engine)}</span>`;
        const isSingleLanguage = !s.target_lang || s.target_lang === 'none' || s.target_lang === 'off' || s.target_lang === s.source_lang;
        const langPair = s.source_lang
            ? (isSingleLanguage
                ? `<span class="session-badge session-language-pair">${this._formatLanguage(s.source_lang)}</span>`
                : `<span class="session-badge session-language-pair">${this._formatLanguage(s.source_lang)} <span class="session-language-arrow">→</span> ${this._formatLanguage(s.target_lang)}</span>`)
            : '';
        const segCount = s.segment_count > 0 ? `<span class="session-meta-dim">${s.segment_count} câu</span>` : '';
        const isChecked = this._selectedSessionIds.has(s.id);

        // Customer badge
        const customerBadge = (!s.has_legacy_only && s.customer_name)
            ? `<span class="session-customer-badge" data-customer-id="${this._escAttr(s.customer_id || '')}" style="border-color:${this._escAttr(s.customer_color || '#431A46')}44; color:${this._escAttr(s.customer_color || '#D9B0DE')}; background:${this._escAttr(s.customer_color || '#431A46')}1a;" title="Khách hàng: ${this._escAttr(s.customer_name)}">🏢 ${this._esc(s.customer_name)}</span>`
            : '';

        // Project badge
        const projectBadge = (!s.has_legacy_only && s.project_name)
            ? `<span class="session-project-badge ${s.project_status === 'archived' ? 'archived' : ''}" data-project-id="${this._escAttr(s.project_id || '')}" style="border-color:${this._escAttr(s.project_color || '#431A46')}44; color:${this._escAttr(s.project_color || '#D9B0DE')}; background:${this._escAttr(s.project_color || '#431A46')}1a;" title="Dự án: ${this._escAttr(s.project_name)}${s.project_status === 'archived' ? ' (Đã dừng)' : ''}">📁 ${this._esc(s.project_name)}</span>`
            : '';

        // Category badge
        const categoryBadge = (!s.has_legacy_only && s.category)
            ? `<span class="session-category-badge" data-category="${this._escAttr(s.category)}" title="Phân loại: ${this._escAttr(s.category)}">📅 ${this._esc(s.category)}</span>`
            : '';

        // Tags
        const tagsHtml = (!s.has_legacy_only && s.tags && s.tags.length > 0)
            ? s.tags.map(t => `<span class="session-tag-badge" data-tag="${this._escAttr(t)}" title="Lọc theo #${this._escAttr(t)}">#${this._esc(t)}</span>`).join('')
            : '';

        const resumeBtn = !s.has_legacy_only
            ? `<button type="button" class="session-btn-action resume" data-id="${this._escAttr(s.id)}" data-legacy="0" title="Tiếp tục ghi vào cuộc họp này">▶ Nối tiếp</button>`
            : '';
        const editBtn = !s.has_legacy_only
            ? `<button type="button" class="session-btn-action edit-meta" data-id="${this._escAttr(s.id)}" title="Sửa thông tin / Đổi tên / Dự án / Phân loại / Thẻ">${PENCIL_YELLOW_ICON}Sửa</button>`
            : '';

        const minutesBadge = s.has_meeting_minutes
            ? `<span class="session-badge" style="background:#10b98126;color:#34d399;border:1px solid #10b9814d;" title="Đã có biên bản Meeting Minutes">📋 Minutes</span>`
            : '';

        return `<div class="session-item" data-id="${this._escAttr(s.id)}" data-legacy="${s.has_legacy_only ? '1' : '0'}">
            <div class="session-item-row1">
                <input type="checkbox" class="session-item-chk" data-id="${this._escAttr(s.id)}" ${isChecked ? 'checked' : ''} />
                <span class="session-item-title">${title}</span>
                <div class="session-actions-inline">
                    ${resumeBtn}
                    ${editBtn}
                    <button type="button" class="session-btn-action copy-session" data-id="${this._escAttr(s.id)}" data-legacy="${s.has_legacy_only ? '1' : '0'}" title="Copy nội dung cuộc họp">
                        <svg class="icon-copy-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                    <button type="button" class="session-delete-btn" data-id="${this._escAttr(s.id)}" title="Xóa">×</button>
                </div>
            </div>
            <div class="session-item-row2">
                ${customerBadge}
                ${projectBadge}
                ${categoryBadge}
                ${minutesBadge}
                ${engineBadge}
                ${langPair}
                ${tagsHtml}
                <span class="session-meta-dim">${created}</span>
                ${duration ? `<span class="session-meta-dim">${duration}</span>` : ''}
                ${segCount}
            </div>
        </div>`;
    }

    async _editSessionMetadata(sess) {
        const modal = document.getElementById('modal-edit-tags');
        const inputTitle = document.getElementById('input-edit-session-title');
        const selectCust = document.getElementById('select-edit-session-customer');
        const selectProj = document.getElementById('select-edit-session-project');
        const selectCat = document.getElementById('select-edit-session-category');
        const inputTags = document.getElementById('input-edit-tags-value');
        if (!modal) return;

        const reg = await this._loadProjectRegistry();
        const id = sess.id;
        const currentTitle = sess.title || '';
        const currentCustomerId = sess.customer_id || '';
        const currentProjectId = sess.project_id || '';
        const currentCategory = sess.category || '';
        const currentTags = Array.isArray(sess.tags) ? sess.tags : [];

        if (inputTitle) inputTitle.value = currentTitle;
        if (inputTags) inputTags.value = currentTags.map(t => `#${t}`).join(', ');

        const allCustomers = reg.customers || [];
        const allProjects = reg.projects || [];

        // Populate customer select
        if (selectCust) {
            let custHtml = '<option value="">(Không chọn KH)</option>';
            for (const c of allCustomers) {
                const statusSuffix = c.status === 'archived' ? ' (Đã dừng)' : '';
                custHtml += `<option value="${this._escAttr(c.id)}">🏢 ${this._esc(c.name)}${statusSuffix}</option>`;
            }
            selectCust.innerHTML = custHtml;
            selectCust.value = currentCustomerId;
        }

        // Helper to populate projects
        const updateProjectsDropdown = (selectedCustomerId) => {
            if (!selectProj) return;
            const filteredProjs = selectedCustomerId
                ? allProjects.filter(p => p.customer_id === selectedCustomerId || p.id === currentProjectId)
                : allProjects;
            let projHtml = '<option value="">(Không gán dự án)</option>';
            for (const p of filteredProjs) {
                const statusSuffix = p.status === 'archived' ? ' (Đã dừng)' : '';
                projHtml += `<option value="${this._escAttr(p.id)}">📁 ${this._esc(p.name)}${statusSuffix}</option>`;
            }
            selectProj.innerHTML = projHtml;
            if (filteredProjs.some(p => p.id === currentProjectId)) {
                selectProj.value = currentProjectId;
            } else {
                selectProj.value = '';
            }
        };

        updateProjectsDropdown(currentCustomerId);

        const onCustChange = () => {
            updateProjectsDropdown(selectCust?.value);
        };
        const onProjChange = () => {
            const pId = selectProj?.value;
            if (pId) {
                const foundProj = allProjects.find(p => p.id === pId);
                if (foundProj && foundProj.customer_id && selectCust) {
                    selectCust.value = foundProj.customer_id;
                }
            }
        };

        selectCust?.addEventListener('change', onCustChange);
        selectProj?.addEventListener('change', onProjChange);

        if (selectCat) {
            let catHtml = '<option value="">(Không phân loại)</option>';
            for (const c of (reg.categories || [])) {
                catHtml += `<option value="${this._escAttr(c.name)}">📅 ${this._esc(c.name)}</option>`;
            }
            selectCat.innerHTML = catHtml;
            selectCat.value = currentCategory;
        }

        modal.style.display = 'flex';
        inputTitle?.focus();

        return new Promise((resolve) => {
            const onConfirm = async () => {
                cleanup();
                modal.style.display = 'none';
                const newTitle = inputTitle?.value.trim() || currentTitle;
                const newCustomerId = selectCust?.value || null;
                const newProjectId = selectProj?.value || null;
                const newCategory = selectCat?.value || null;
                const cleanTags = (inputTags?.value || '')
                    .split(',')
                    .map(t => t.trim().replace(/^#/, '').toLowerCase())
                    .filter(Boolean);
                try {
                    await invoke('update_session_metadata', {
                        id,
                        title: newTitle,
                        customerId: newCustomerId,
                        projectId: newProjectId,
                        category: newCategory,
                        tags: cleanTags,
                    });
                    if (sessionStore.id === id) {
                        sessionStore.title = newTitle;
                        sessionStore.customerId = newCustomerId;
                        sessionStore.projectId = newProjectId;
                        sessionStore.category = newCategory;
                        sessionStore.tags = cleanTags;
                    }
                    this._showToast('Đã lưu thông tin cuộc họp ✓', 'success');
                    await this._showSessions();
                } catch (err) {
                    this._showToast(`Lỗi lưu thông tin: ${err}`, 'error');
                }
                resolve();
            };
            const onCancel = () => {
                cleanup();
                modal.style.display = 'none';
                resolve();
            };
            const onKeyDown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    onConfirm();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                }
            };
            const cleanup = () => {
                selectCust?.removeEventListener('change', onCustChange);
                selectProj?.removeEventListener('change', onProjChange);
                document.getElementById('btn-confirm-edit-tags')?.removeEventListener('click', onConfirm);
                document.getElementById('btn-cancel-edit-tags')?.removeEventListener('click', onCancel);
                document.getElementById('btn-close-edit-tags')?.removeEventListener('click', onCancel);
                inputTitle?.removeEventListener('keydown', onKeyDown);
                inputTags?.removeEventListener('keydown', onKeyDown);
            };

            document.getElementById('btn-confirm-edit-tags')?.addEventListener('click', onConfirm);
            document.getElementById('btn-cancel-edit-tags')?.addEventListener('click', onCancel);
            document.getElementById('btn-close-edit-tags')?.addEventListener('click', onCancel);
            inputTitle?.addEventListener('keydown', onKeyDown);
            inputTags?.addEventListener('keydown', onKeyDown);
        });
    }

    // ─── Settings Data Management Tabs ─────────────────────────────────────

    // ─── Universal Confirm Delete Modal ─────────────────────────────────────

    _promptConfirmDelete({ title = 'Xác nhận xoá', message = 'Bạn có chắc chắn muốn xoá mục này?', confirmText = 'Xoá' }) {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal-confirm-delete');
            const titleEl = document.getElementById('confirm-delete-title-text');
            const msgEl = document.getElementById('confirm-delete-message');
            const agreeBtn = document.getElementById('btn-agree-confirm-delete');
            const cancelBtn = document.getElementById('btn-cancel-confirm-delete');
            const closeBtn = document.getElementById('btn-close-confirm-delete');

            if (!modal) {
                resolve(window.confirm(message));
                return;
            }

            if (titleEl) titleEl.textContent = title;
            if (msgEl) msgEl.textContent = message;
            if (agreeBtn) agreeBtn.textContent = confirmText;

            const cleanup = () => {
                modal.style.display = 'none';
                agreeBtn?.removeEventListener('click', onAgree);
                cancelBtn?.removeEventListener('click', onCancel);
                closeBtn?.removeEventListener('click', onCancel);
                modal.removeEventListener('click', onBackdrop);
            };

            const onAgree = () => {
                cleanup();
                resolve(true);
            };

            const onCancel = () => {
                cleanup();
                resolve(false);
            };

            const onBackdrop = (e) => {
                if (e.target === modal) {
                    cleanup();
                    resolve(false);
                }
            };

            agreeBtn?.addEventListener('click', onAgree);
            cancelBtn?.addEventListener('click', onCancel);
            closeBtn?.addEventListener('click', onCancel);
            modal.addEventListener('click', onBackdrop);

            modal.style.display = 'flex';
        });
    }

    // ─── Add Customer / Add Project Modals ──────────────────────────────────

    // ─── Add / Edit Customer & Add Project Modals ──────────────────────────

    _openAddCustomerModal() {
        const modal = document.getElementById('modal-add-customer');
        if (!modal) return;
        const titleEl = document.getElementById('modal-cust-title');
        const idInput = document.getElementById('input-modal-cust-id');
        const nameInput = document.getElementById('input-modal-cust-name');
        const codeInput = document.getElementById('input-modal-cust-code');
        const statusSelect = document.getElementById('select-modal-cust-status');
        const colorInput = document.getElementById('input-modal-cust-color');
        const descInput = document.getElementById('input-modal-cust-desc');
        const projsSec = document.getElementById('modal-cust-projs-section');
        const saveBtn = document.getElementById('btn-save-add-customer');

        if (titleEl) titleEl.textContent = '🏢 Thêm Khách hàng mới';
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';
        if (codeInput) codeInput.value = '';
        if (statusSelect) statusSelect.value = 'active';
        if (colorInput) colorInput.value = '#431A46';
        if (descInput) descInput.value = '';
        if (projsSec) projsSec.style.display = 'none';
        if (saveBtn) saveBtn.textContent = '+ Thêm Khách hàng';

        modal.style.display = 'flex';
        setTimeout(() => nameInput?.focus(), 50);
    }

    async _openEditCustomerModal(customer) {
        if (!customer) return;
        const modal = document.getElementById('modal-add-customer');
        if (!modal) return;
        const titleEl = document.getElementById('modal-cust-title');
        const idInput = document.getElementById('input-modal-cust-id');
        const nameInput = document.getElementById('input-modal-cust-name');
        const codeInput = document.getElementById('input-modal-cust-code');
        const statusSelect = document.getElementById('select-modal-cust-status');
        const colorInput = document.getElementById('input-modal-cust-color');
        const descInput = document.getElementById('input-modal-cust-desc');
        const projsSec = document.getElementById('modal-cust-projs-section');
        const projsList = document.getElementById('modal-cust-projs-list');
        const saveBtn = document.getElementById('btn-save-add-customer');

        if (titleEl) titleEl.textContent = `🏢 Chi tiết: ${customer.name}`;
        if (idInput) idInput.value = customer.id || '';
        if (nameInput) nameInput.value = customer.name || '';
        if (codeInput) codeInput.value = customer.code || '';
        if (statusSelect) statusSelect.value = customer.status || 'active';
        if (colorInput) colorInput.value = customer.color || '#431A46';
        if (descInput) descInput.value = customer.description || '';
        if (saveBtn) saveBtn.textContent = 'Lưu thay đổi';

        if (projsSec && projsList) {
            const reg = await this._loadProjectRegistry();
            const projs = (reg.projects || []).filter(p => p.customer_id === customer.id);
            if (projs.length > 0) {
                projsSec.style.display = 'block';
                projsList.innerHTML = projs.map(p => `
                    <span class="table-proj-chip" style="cursor:default;" title="${this._escAttr(p.name)}">
                        <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${this._escAttr(p.color || '#431A46')};"></span>
                        ${this._esc(p.name)} (${p.status === 'active' ? '🟢' : '⚪'})
                    </span>
                `).join('');
            } else {
                projsSec.style.display = 'none';
            }
        }

        modal.style.display = 'flex';
        setTimeout(() => nameInput?.focus(), 50);
    }

    _closeAddCustomerModal() {
        const modal = document.getElementById('modal-add-customer');
        if (modal) modal.style.display = 'none';
    }

    async _handleSaveCustomerFromModal() {
        const id = document.getElementById('input-modal-cust-id')?.value.trim() || '';
        const nameInput = document.getElementById('input-modal-cust-name');
        const codeInput = document.getElementById('input-modal-cust-code');
        const statusSelect = document.getElementById('select-modal-cust-status');
        const colorInput = document.getElementById('input-modal-cust-color');
        const descInput = document.getElementById('input-modal-cust-desc');
        const name = nameInput?.value.trim();
        if (!name) {
            this._showToast('Vui lòng nhập tên khách hàng', 'error');
            return;
        }
        const code = codeInput?.value.trim().toUpperCase() || '';
        const status = statusSelect?.value || 'active';
        const color = colorInput?.value || '#431A46';
        const description = descInput?.value.trim() || '';
        try {
            await invoke('save_customer', {
                customer: {
                    id,
                    name,
                    code,
                    description,
                    color,
                    status,
                    created_at: '',
                    updated_at: '',
                }
            });
            this._closeAddCustomerModal();
            this._showToast(id ? `Đã cập nhật khách hàng "${name}" ✓` : `Đã thêm khách hàng "${name}" ✓`, 'success');
            await this._loadProjectRegistry();
            this._renderSettingsCustomersTab(document.getElementById('input-search-customers')?.value || '');
            this._renderCustomerFilterBar();
            this._updateSidebarBadges();
            await this._showSessions();
        } catch (err) {
            this._showToast(`Lưu khách hàng thất bại: ${err}`, 'error');
        }
    }

    async _openAddProjectModal() {
        const modal = document.getElementById('modal-add-project');
        if (!modal) return;
        const reg = await this._loadProjectRegistry();
        const customers = (reg.customers || []).filter(c => c.status === 'active');
        const custSelect = document.getElementById('select-modal-proj-customer');
        const nameInput = document.getElementById('input-modal-proj-name');
        const colorInput = document.getElementById('input-modal-proj-color');
        const descInput = document.getElementById('input-modal-proj-desc');

        if (custSelect) {
            let html = '<option value="">(Không chọn KH / Dự án nội bộ)</option>';
            for (const c of customers) {
                html += `<option value="${this._escAttr(c.id)}">🏢 ${this._esc(c.name)}</option>`;
            }
            custSelect.innerHTML = html;
            const activeFilter = document.getElementById('select-settings-proj-cust-filter')?.value;
            if (activeFilter) custSelect.value = activeFilter;
        }

        if (nameInput) nameInput.value = '';
        if (colorInput) colorInput.value = '#431A46';
        if (descInput) descInput.value = '';
        modal.style.display = 'flex';
        setTimeout(() => nameInput?.focus(), 50);
    }

    _closeAddProjectModal() {
        const modal = document.getElementById('modal-add-project');
        if (modal) modal.style.display = 'none';
    }

    async _handleSaveProjectFromModal() {
        const custSelect = document.getElementById('select-modal-proj-customer');
        const nameInput = document.getElementById('input-modal-proj-name');
        const colorInput = document.getElementById('input-modal-proj-color');
        const descInput = document.getElementById('input-modal-proj-desc');
        const name = nameInput?.value.trim();
        if (!name) {
            this._showToast('Vui lòng nhập tên dự án', 'error');
            return;
        }
        const customer_id = custSelect?.value || null;
        const color = colorInput?.value || '#431A46';
        const description = descInput?.value.trim() || '';
        try {
            await invoke('save_project', {
                project: {
                    id: '',
                    name,
                    customer_id,
                    description,
                    color,
                    status: 'active',
                    created_at: '',
                    updated_at: '',
                }
            });
            this._closeAddProjectModal();
            this._showToast(`Đã tạo dự án "${name}" ✓`, 'success');
            await this._loadProjectRegistry();
            this._renderSettingsProjectsTab(document.getElementById('select-settings-proj-cust-filter')?.value || '');
            this._renderProjectFilterBar();
            this._updateSidebarBadges();
            await this._showSessions();
        } catch (err) {
            this._showToast(`Tạo dự án thất bại: ${err}`, 'error');
        }
    }

    // ─── Settings Data Management Tabs (Structured Data Tables) ───────────

    _getSortIcon(sortState, field) {
        if (!sortState || sortState.field !== field) {
            return '<span class="sort-icon">⇅</span>';
        }
        return sortState.dir === 'desc' ? '<span class="sort-icon">▼</span>' : '<span class="sort-icon">▲</span>';
    }

    _sortItems(items, sortState, getFieldVal) {
        if (!sortState || !sortState.field || sortState.field === 'index') {
            return sortState?.dir === 'desc' ? [...items].reverse() : [...items];
        }
        const field = sortState.field;
        const dir = sortState.dir === 'desc' ? -1 : 1;
        return [...items].sort((a, b) => {
            const valA = getFieldVal(a, field);
            const valB = getFieldVal(b, field);
            if (typeof valA === 'number' && typeof valB === 'number') {
                return (valA - valB) * dir;
            }
            return String(valA || '').localeCompare(String(valB || ''), undefined, { numeric: true, sensitivity: 'base' }) * dir;
        });
    }

    async _updateSidebarBadges() {
        try {
            const reg = await this._loadProjectRegistry();
            const customers = reg.customers || [];
            const projects = reg.projects || [];
            const categories = reg.categories || [];
            const sessionTags = (this._cachedSessions || []).flatMap(sess => sess.tags || []);
            const allTags = Array.from(new Set([...(reg.tags || []), ...sessionTags])).filter(Boolean);

            const badgeCust = document.getElementById('badge-nav-customers');
            if (badgeCust) badgeCust.textContent = String(customers.length);

            const badgeProj = document.getElementById('badge-nav-projects');
            if (badgeProj) badgeProj.textContent = String(projects.length);

            const badgeCat = document.getElementById('badge-nav-categories');
            if (badgeCat) badgeCat.textContent = String(categories.length);

            const badgeTags = document.getElementById('badge-nav-tags');
            if (badgeTags) badgeTags.textContent = String(allTags.length);
        } catch (err) {
            console.error('Failed to update sidebar badges:', err);
        }
    }

    async _renderSettingsStorageTab() {
        const pathEl = document.getElementById('storage-dir-path-text');
        const badgeEl = document.getElementById('storage-type-badge');
        const statsEl = document.getElementById('storage-stats-info');
        if (!pathEl || !statsEl) return;

        try {
            const info = await invoke('get_storage_info');
            pathEl.textContent = info.current_path;
            if (badgeEl) {
                badgeEl.textContent = info.is_custom ? 'Tùy chỉnh' : 'Mặc định';
                badgeEl.className = `status-pill ${info.is_custom ? 'archived' : 'active'}`;
            }

            const sizeMb = (info.total_size_bytes / (1024 * 1024)).toFixed(2);
            statsEl.innerHTML = `
                <div>• <b>Tổng số cuộc họp đã lưu:</b> ${info.session_count} cuộc họp</div>
                <div>• <b>Dung lượng dữ liệu trên đĩa:</b> ${sizeMb} MB (${info.total_size_bytes.toLocaleString()} bytes)</div>
                <div>• <b>Định dạng tệp:</b> Markdown (.md), JSON metadata (.json) và Audio (.wav)</div>
                <div>• <b>Vị trí mặc định:</b> <span style="font-family:monospace; font-size:11px; opacity:0.8;">${this._esc(info.default_path)}</span></div>
            `;
        } catch (err) {
            console.error('Failed to get storage info:', err);
            statsEl.textContent = `Lỗi tải thông tin lưu trữ: ${err}`;
        }
    }

    async _renderSettingsCustomersTab(searchFilter = '') {
        const listEl = document.getElementById('settings-customers-list');
        if (!listEl) return;
        const reg = await this._loadProjectRegistry();
        let customers = reg.customers || [];
        const projects = reg.projects || [];

        const q = (searchFilter || '').trim().toLowerCase();
        if (q) {
            customers = customers.filter(c => (c.name || '').toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q));
        }

        if (customers.length === 0) {
            listEl.innerHTML = '<div class="sessions-empty" style="padding: 24px;">Chưa có khách hàng nào. Bấm nút "+ Thêm khách hàng" ở góc trên để tạo mới.</div>';
            return;
        }

        // Sort items
        const sortedCustomers = this._sortItems(customers, this._custSort, (c, field) => {
            if (field === 'code') return c.code || '';
            if (field === 'name') return c.name || '';
            if (field === 'description') return c.description || '';
            if (field === 'status') return c.status || 'active';
            if (field === 'projects') return projects.filter(p => p.customer_id === c.id).length;
            return 0;
        });

        const sort = this._custSort;
        let html = `
        <div class="mgr-table-container">
          <table class="mgr-table">
            <thead>
              <tr>
                <th class="sortable ${sort.field === 'index' ? 'active-sort' : ''}" data-sort="index" style="width: 45px; text-align: center;"># ${this._getSortIcon(sort, 'index')}</th>
                <th class="sortable ${sort.field === 'code' ? 'active-sort' : ''}" data-sort="code" style="width: 95px;">Mã KH ${this._getSortIcon(sort, 'code')}</th>
                <th class="sortable ${sort.field === 'name' ? 'active-sort' : ''}" data-sort="name">Tên khách hàng ${this._getSortIcon(sort, 'name')}</th>
                <th class="sortable ${sort.field === 'description' ? 'active-sort' : ''}" data-sort="description">Mô tả ${this._getSortIcon(sort, 'description')}</th>
                <th class="sortable ${sort.field === 'status' ? 'active-sort' : ''}" data-sort="status" style="width: 120px;">Trạng thái ${this._getSortIcon(sort, 'status')}</th>
                <th class="sortable ${sort.field === 'projects' ? 'active-sort' : ''}" data-sort="projects" style="width: 220px;">Dự án đang làm ${this._getSortIcon(sort, 'projects')}</th>
                <th style="width: 90px; text-align: center;">Thao tác</th>
              </tr>
            </thead>
            <tbody>
        `;

        sortedCustomers.forEach((c, idx) => {
            const isActive = c.status === 'active';
            const custProjects = projects.filter(p => p.customer_id === c.id);
            const activeProjects = custProjects.filter(p => p.status === 'active');
            const targetProjects = activeProjects.length > 0 ? activeProjects : custProjects;

            const maxChips = 3;
            const visibleProjects = targetProjects.slice(0, maxChips);
            const remaining = targetProjects.length - maxChips;

            let projChipsHtml = '';
            if (targetProjects.length === 0) {
                projChipsHtml = '<span style="opacity:0.4; font-size:11px;">(Chưa có dự án)</span>';
            } else {
                projChipsHtml = `<div class="table-proj-chips">` +
                    visibleProjects.map(p => `
                        <span class="table-proj-chip btn-view-cust-projs" data-id="${this._escAttr(c.id)}" title="${this._escAttr(p.name)}">
                            <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${this._escAttr(p.color || '#431A46')};"></span>
                            ${this._esc(p.name)}
                        </span>
                    `).join('') +
                    (remaining > 0 ? `<span class="table-proj-more btn-view-cust-projs" data-id="${this._escAttr(c.id)}" title="Xem tất cả ${targetProjects.length} dự án">+${remaining} khác</span>` : '') +
                    `</div>`;
            }

            const codeBadge = c.code ? `<span class="mgr-customer-code">${this._esc(c.code)}</span>` : '<span style="opacity:0.3;">-</span>';

            html += `
              <tr class="cust-row" data-id="${this._escAttr(c.id)}">
                <td style="text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 11px;">${idx + 1}</td>
                <td class="btn-open-cust-details" data-id="${this._escAttr(c.id)}" style="cursor: pointer;">${codeBadge}</td>
                <td class="btn-open-cust-details" data-id="${this._escAttr(c.id)}" style="cursor: pointer;">
                  <div style="display:flex; align-items:center; gap:8px; font-weight:600;">
                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${this._escAttr(c.color || '#431A46')}; flex-shrink:0;"></span>
                    <span style="color: var(--md-sys-color-primary); text-decoration: underline; text-underline-offset: 2px;">${this._esc(c.name)}</span>
                  </div>
                </td>
                <td class="btn-open-cust-details" data-id="${this._escAttr(c.id)}" style="cursor: pointer; color: var(--md-sys-color-on-surface-variant); font-size:11px; max-width: 200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${this._escAttr(c.description || '')}">
                  ${c.description ? this._esc(c.description) : '<span style="opacity:0.3;">-</span>'}
                </td>
                <td class="btn-open-cust-details" data-id="${this._escAttr(c.id)}" style="cursor: pointer;">
                  <span class="status-pill ${isActive ? 'active' : 'archived'}">${isActive ? '🟢 Đang hợp tác' : '⚪ Đã dừng'}</span>
                </td>
                <td>${projChipsHtml}</td>
                <td style="text-align: center;">
                  <div class="mgr-item-actions" style="justify-content: center; gap: 4px;">
                    <button type="button" class="btn-secondary-small btn-toggle-cust" data-id="${this._escAttr(c.id)}" title="${isActive ? 'Tạm dừng hợp tác' : 'Kích hoạt hợp tác'}" style="padding: 4px 8px; font-size: 12px; line-height: 1;">
                      ${isActive ? '⏸' : '▶'}
                    </button>
                    <button type="button" class="btn-danger-small btn-del-cust" data-id="${this._escAttr(c.id)}" data-name="${this._escAttr(c.name)}" title="Xoá khách hàng" style="padding: 4px 8px; font-size: 12px; line-height: 1;">
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
            `;
        });

        html += `
            </tbody>
          </table>
        </div>
        `;

        listEl.innerHTML = html;

        // Sort header listeners
        listEl.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (this._custSort.field === field) {
                    this._custSort.dir = this._custSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    this._custSort.field = field;
                    this._custSort.dir = 'asc';
                }
                this._renderSettingsCustomersTab(searchFilter);
            });
        });

        // Click customer name / info opens Details Modal
        listEl.querySelectorAll('.btn-open-cust-details').forEach(cell => {
            cell.addEventListener('click', () => {
                const cid = cell.dataset.id;
                const cust = customers.find(c => c.id === cid);
                if (cust) {
                    this._openEditCustomerModal(cust);
                }
            });
        });

        // Click project chip jumps to Projects tab
        listEl.querySelectorAll('.btn-view-cust-projs').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const cid = btn.dataset.id;
                this._showSettingsScreen('tab-projects');
                const filterSelect = document.getElementById('select-settings-proj-cust-filter');
                if (filterSelect) {
                    filterSelect.value = cid;
                    this._renderSettingsProjectsTab(cid);
                }
            });
        });

        // Toggle status (icon only)
        listEl.querySelectorAll('.btn-toggle-cust').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                try {
                    const newStatus = await invoke('toggle_customer_status', { id });
                    this._showToast(`Đã chuyển trạng thái KH: ${newStatus === 'active' ? 'Đang hợp tác' : 'Đã dừng'}`, 'success');
                    await this._loadProjectRegistry();
                    this._renderSettingsCustomersTab(document.getElementById('input-search-customers')?.value);
                    this._renderCustomerFilterBar();
                    this._updateSidebarBadges();
                    await this._showSessions();
                } catch (err) {
                    this._showToast(`Lỗi: ${err}`, 'error');
                }
            });
        });

        // Delete customer
        listEl.querySelectorAll('.btn-del-cust').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const name = btn.dataset.name || 'khách hàng';
                const agreed = await this._promptConfirmDelete({
                    title: 'Xoá khách hàng',
                    message: `Bạn có chắc muốn xoá khách hàng "${name}"?\nCác dự án liên kết sẽ được huỷ gán nhưng không bị xoá, toàn bộ meeting log cũ vẫn an toàn.`,
                    confirmText: 'Xoá khách hàng'
                });
                if (!agreed) return;
                try {
                    await invoke('delete_customer', { id });
                    this._showToast('Đã xóa khách hàng', 'success');
                    await this._loadProjectRegistry();
                    this._renderSettingsCustomersTab(document.getElementById('input-search-customers')?.value);
                    this._renderCustomerFilterBar();
                    this._updateSidebarBadges();
                    await this._showSessions();
                } catch (err) {
                    this._showToast(`Lỗi: ${err}`, 'error');
                }
            });
        });
    }

    async _renderSettingsProjectsTab(customerFilter = '', searchFilter = '') {
        const listEl = document.getElementById('settings-projects-list');
        const selectFilterCust = document.getElementById('select-settings-proj-cust-filter');
        if (!listEl) return;

        const reg = await this._loadProjectRegistry();
        const customers = reg.customers || [];
        let projects = reg.projects || [];
        const sessions = this._cachedSessions || [];

        // Populate project list filter dropdown
        if (selectFilterCust) {
            const currentVal = customerFilter !== undefined ? customerFilter : selectFilterCust.value || '';
            let filterHtml = '<option value="">🏢 Tất cả khách hàng</option>';
            for (const c of customers) {
                const sel = currentVal === c.id ? 'selected' : '';
                filterHtml += `<option value="${this._escAttr(c.id)}" ${sel}>🏢 ${this._esc(c.name)}</option>`;
            }
            selectFilterCust.innerHTML = filterHtml;
            if (customerFilter) selectFilterCust.value = customerFilter;
        }

        const effectiveFilter = customerFilter || selectFilterCust?.value || '';
        if (effectiveFilter) {
            projects = projects.filter(p => p.customer_id === effectiveFilter);
        }

        const q = (searchFilter || '').trim().toLowerCase();
        if (q) {
            projects = projects.filter(p => (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
        }

        if (projects.length === 0) {
            listEl.innerHTML = '<div class="sessions-empty" style="padding: 24px;">Chưa có dự án nào phù hợp. Bấm nút "+ Thêm dự án" ở góc trên để tạo mới.</div>';
            return;
        }

        // Sort items
        const sortedProjects = this._sortItems(projects, this._projSort, (p, field) => {
            if (field === 'name') return p.name || '';
            if (field === 'customer') {
                const cust = customers.find(c => c.id === p.customer_id);
                return cust ? cust.name : '';
            }
            if (field === 'description') return p.description || '';
            if (field === 'status') return p.status || 'active';
            if (field === 'sessions') return sessions.filter(s => s.project_id === p.id).length;
            return 0;
        });

        const sort = this._projSort;
        let html = `
        <div class="mgr-table-container">
          <table class="mgr-table">
            <thead>
              <tr>
                <th class="sortable ${sort.field === 'index' ? 'active-sort' : ''}" data-sort="index" style="width: 45px; text-align: center;"># ${this._getSortIcon(sort, 'index')}</th>
                <th class="sortable ${sort.field === 'name' ? 'active-sort' : ''}" data-sort="name">Tên dự án ${this._getSortIcon(sort, 'name')}</th>
                <th class="sortable ${sort.field === 'customer' ? 'active-sort' : ''}" data-sort="customer" style="width: 170px;">Khách hàng ${this._getSortIcon(sort, 'customer')}</th>
                <th class="sortable ${sort.field === 'description' ? 'active-sort' : ''}" data-sort="description">Mô tả ${this._getSortIcon(sort, 'description')}</th>
                <th class="sortable ${sort.field === 'status' ? 'active-sort' : ''}" data-sort="status" style="width: 110px;">Trạng thái ${this._getSortIcon(sort, 'status')}</th>
                <th class="sortable ${sort.field === 'sessions' ? 'active-sort' : ''}" data-sort="sessions" style="width: 100px; text-align: center;">Số cuộc họp ${this._getSortIcon(sort, 'sessions')}</th>
                <th style="width: 90px; text-align: center;">Thao tác</th>
              </tr>
            </thead>
            <tbody>
        `;

        sortedProjects.forEach((p, idx) => {
            const isActive = p.status === 'active';
            const cust = customers.find(c => c.id === p.customer_id);
            const sessCount = sessions.filter(s => s.project_id === p.id).length;

            const custBadge = cust
                ? `<span class="session-customer-badge btn-jump-to-customer" data-cust-id="${this._escAttr(cust.id)}" style="border-color:${this._escAttr(cust.color || '#431A46')}44; color:${this._escAttr(cust.color || '#D9B0DE')}; background:${this._escAttr(cust.color || '#431A46')}1a; cursor:pointer;" title="Mở thông tin khách hàng ${this._escAttr(cust.name)}">🏢 ${this._esc(cust.name)} ↗</span>`
                : `<span style="font-size:11px; opacity:0.4;">(Chưa gán KH)</span>`;

            html += `
              <tr>
                <td style="text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 11px;">${idx + 1}</td>
                <td>
                  <div style="display:flex; align-items:center; gap:8px; font-weight:600;">
                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${this._escAttr(p.color || '#431A46')}; flex-shrink:0;"></span>
                    <span>${this._esc(p.name)}</span>
                  </div>
                </td>
                <td>${custBadge}</td>
                <td style="color: var(--md-sys-color-on-surface-variant); font-size:11px; max-width: 220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${this._escAttr(p.description || '')}">
                  ${p.description ? this._esc(p.description) : '<span style="opacity:0.3;">-</span>'}
                </td>
                <td>
                  <span class="status-pill ${isActive ? 'active' : 'archived'}">${isActive ? '🟢 Đang chạy' : '⚪ Đã dừng'}</span>
                </td>
                <td style="text-align: center; font-weight:600; color: var(--md-sys-color-primary);">
                  ${sessCount > 0 ? `${sessCount} cuộc họp` : '<span style="opacity:0.4; font-weight:normal;">0</span>'}
                </td>
                <td style="text-align: center;">
                  <div class="mgr-item-actions" style="justify-content: center; gap: 4px;">
                    <button type="button" class="btn-secondary-small btn-toggle-proj" data-id="${this._escAttr(p.id)}" title="${isActive ? 'Tạm dừng dự án' : 'Kích hoạt dự án'}" style="padding: 4px 8px; font-size: 12px; line-height: 1;">
                      ${isActive ? '⏸' : '▶'}
                    </button>
                    <button type="button" class="btn-danger-small btn-del-proj" data-id="${this._escAttr(p.id)}" data-name="${this._escAttr(p.name)}" title="Xoá dự án" style="padding: 4px 8px; font-size: 12px; line-height: 1;">
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
            `;
        });

        html += `
            </tbody>
          </table>
        </div>
        `;

        listEl.innerHTML = html;

        // Sort header listeners
        listEl.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (this._projSort.field === field) {
                    this._projSort.dir = this._projSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    this._projSort.field = field;
                    this._projSort.dir = 'asc';
                }
                this._renderSettingsProjectsTab(customerFilter, searchFilter);
            });
        });

        // Click customer badge in project table opens Customer Details
        listEl.querySelectorAll('.btn-jump-to-customer').forEach(badge => {
            badge.addEventListener('click', async () => {
                const custId = badge.dataset.custId;
                const reg = await this._loadProjectRegistry();
                const targetCust = (reg.customers || []).find(c => c.id === custId);
                this._showSettingsScreen('tab-customers');
                if (targetCust) {
                    this._openEditCustomerModal(targetCust);
                }
            });
        });

        // Toggle project status (icon only)
        listEl.querySelectorAll('.btn-toggle-proj').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                try {
                    const newStatus = await invoke('toggle_project_status', { id });
                    this._showToast(`Đã chuyển dự án sang: ${newStatus === 'active' ? 'Đang chạy' : 'Đã dừng'}`, 'success');
                    await this._loadProjectRegistry();
                    this._renderSettingsProjectsTab(selectFilterCust?.value, document.getElementById('input-search-projects')?.value);
                    this._renderProjectFilterBar();
                    this._updateSidebarBadges();
                    await this._showSessions();
                } catch (err) {
                    this._showToast(`Lỗi: ${err}`, 'error');
                }
            });
        });

        // Delete project
        listEl.querySelectorAll('.btn-del-proj').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const name = btn.dataset.name || 'dự án';
                const agreed = await this._promptConfirmDelete({
                    title: 'Xoá dự án',
                    message: `Bạn có chắc muốn xoá dự án "${name}"?\nToàn bộ meeting log đã ghi trước đây vẫn được giữ nguyên an toàn.`,
                    confirmText: 'Xoá dự án'
                });
                if (!agreed) return;
                try {
                    await invoke('delete_project', { id });
                    this._showToast('Đã xóa dự án', 'success');
                    await this._loadProjectRegistry();
                    this._renderSettingsProjectsTab(selectFilterCust?.value, document.getElementById('input-search-projects')?.value);
                    this._renderProjectFilterBar();
                    this._updateSidebarBadges();
                    await this._showSessions();
                } catch (err) {
                    this._showToast(`Lỗi: ${err}`, 'error');
                }
            });
        });
    }

    async _renderSettingsCategoriesTab() {
        const listEl = document.getElementById('settings-categories-list');
        if (!listEl) return;
        const reg = await this._loadProjectRegistry();
        const categories = reg.categories || [];
        const sessions = this._cachedSessions || [];

        if (categories.length === 0) {
            listEl.innerHTML = '<div class="sessions-empty" style="padding: 24px;">Chưa có phân loại nào. Hãy thêm phân loại ở ô trên.</div>';
            return;
        }

        // Sort categories
        const sortedCategories = this._sortItems(categories, this._catSort, (c, field) => {
            if (field === 'name') return c.name || '';
            if (field === 'sessions') return sessions.filter(s => s.category === c.name || s.category === c.id).length;
            return 0;
        });

        const sort = this._catSort;
        let html = `
        <div class="mgr-table-container">
          <table class="mgr-table">
            <thead>
              <tr>
                <th class="sortable ${sort.field === 'index' ? 'active-sort' : ''}" data-sort="index" style="width: 45px; text-align: center;"># ${this._getSortIcon(sort, 'index')}</th>
                <th class="sortable ${sort.field === 'name' ? 'active-sort' : ''}" data-sort="name">Tên phân loại cuộc họp ${this._getSortIcon(sort, 'name')}</th>
                <th class="sortable ${sort.field === 'sessions' ? 'active-sort' : ''}" data-sort="sessions" style="width: 140px; text-align: center;">Số cuộc họp gắn ${this._getSortIcon(sort, 'sessions')}</th>
                <th style="width: 80px; text-align: center;">Thao tác</th>
              </tr>
            </thead>
            <tbody>
        `;

        sortedCategories.forEach((c, idx) => {
            const sessCount = sessions.filter(s => s.category === c.name || s.category === c.id).length;
            html += `
              <tr>
                <td style="text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 11px;">${idx + 1}</td>
                <td>
                  <div style="display:flex; align-items:center; gap:8px; font-weight:600;">
                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${this._escAttr(c.color || '#431A46')}; flex-shrink:0;"></span>
                    <span>${this._esc(c.name)}</span>
                  </div>
                </td>
                <td style="text-align: center; font-weight:600; color: var(--md-sys-color-primary);">
                  ${sessCount > 0 ? `${sessCount} cuộc họp` : '<span style="opacity:0.4; font-weight:normal;">0</span>'}
                </td>
                <td style="text-align: center;">
                  <button type="button" class="btn-danger-small btn-del-cat" data-id="${this._escAttr(c.id)}" data-name="${this._escAttr(c.name)}" title="Xoá phân loại">
                    🗑
                  </button>
                </td>
              </tr>
            `;
        });

        html += `
            </tbody>
          </table>
        </div>
        `;

        listEl.innerHTML = html;

        // Sort header listeners
        listEl.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (this._catSort.field === field) {
                    this._catSort.dir = this._catSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    this._catSort.field = field;
                    this._catSort.dir = 'asc';
                }
                this._renderSettingsCategoriesTab();
            });
        });

        // Delete category
        listEl.querySelectorAll('.btn-del-cat').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const name = btn.dataset.name || 'phân loại';
                const agreed = await this._promptConfirmDelete({
                    title: 'Xoá phân loại',
                    message: `Bạn có chắc muốn xoá phân loại "${name}" khỏi hệ thống?`,
                    confirmText: 'Xoá phân loại'
                });
                if (!agreed) return;
                try {
                    await invoke('delete_category', { id });
                    this._showToast('Đã xóa phân loại', 'success');
                    await this._loadProjectRegistry();
                    this._renderSettingsCategoriesTab();
                    this._renderCategoryFilterBar();
                    this._updateSidebarBadges();
                    await this._showSessions();
                } catch (err) {
                    this._showToast(`Lỗi: ${err}`, 'error');
                }
            });
        });
    }

    async _renderSettingsTagsTab() {
        const listEl = document.getElementById('settings-tags-list');
        if (!listEl) return;
        const reg = await this._loadProjectRegistry();
        const sessionTags = (this._cachedSessions || []).flatMap(s => s.tags || []);
        const allTags = Array.from(new Set([...(reg.tags || []), ...sessionTags])).filter(Boolean);
        const sessions = this._cachedSessions || [];

        if (allTags.length === 0) {
            listEl.innerHTML = '<div class="sessions-empty" style="padding: 24px;">Chưa có thẻ nào trong hệ thống. Hãy thêm thẻ mới ở ô trên.</div>';
            return;
        }

        const tagObjects = allTags.map(t => ({
            name: t,
            count: sessions.filter(s => (s.tags || []).includes(t)).length
        }));

        const sortedTags = this._sortItems(tagObjects, this._tagSort, (t, field) => {
            if (field === 'name') return t.name || '';
            if (field === 'sessions') return t.count;
            return 0;
        });

        const sort = this._tagSort;
        let html = `
        <div class="mgr-table-container">
          <table class="mgr-table">
            <thead>
              <tr>
                <th class="sortable ${sort.field === 'index' ? 'active-sort' : ''}" data-sort="index" style="width: 45px; text-align: center;"># ${this._getSortIcon(sort, 'index')}</th>
                <th class="sortable ${sort.field === 'name' ? 'active-sort' : ''}" data-sort="name">Tên thẻ (Tag) ${this._getSortIcon(sort, 'name')}</th>
                <th class="sortable ${sort.field === 'sessions' ? 'active-sort' : ''}" data-sort="sessions" style="width: 140px; text-align: center;">Số cuộc họp gắn ${this._getSortIcon(sort, 'sessions')}</th>
                <th style="width: 80px; text-align: center;">Thao tác</th>
              </tr>
            </thead>
            <tbody>
        `;

        sortedTags.forEach((t, idx) => {
            html += `
              <tr>
                <td style="text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 11px;">${idx + 1}</td>
                <td>
                  <span class="mgr-tag-chip" style="font-size:12px; font-weight:600;">#${this._esc(t.name)}</span>
                </td>
                <td style="text-align: center; font-weight:600; color: var(--md-sys-color-primary);">
                  ${t.count > 0 ? `${t.count} cuộc họp` : '<span style="opacity:0.4; font-weight:normal;">0</span>'}
                </td>
                <td style="text-align: center;">
                  <button type="button" class="btn-danger-small btn-del-tag-tbl" data-tag="${this._escAttr(t.name)}" title="Xoá thẻ">
                    🗑
                  </button>
                </td>
              </tr>
            `;
        });

        html += `
            </tbody>
          </table>
        </div>
        `;

        listEl.innerHTML = html;

        // Sort header listeners
        listEl.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (this._tagSort.field === field) {
                    this._tagSort.dir = this._tagSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    this._tagSort.field = field;
                    this._tagSort.dir = 'asc';
                }
                this._renderSettingsTagsTab();
            });
        });

        // Delete tag
        listEl.querySelectorAll('.btn-del-tag-tbl').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tag = btn.dataset.tag;
                const agreed = await this._promptConfirmDelete({
                    title: 'Xoá thẻ',
                    message: `Bạn có chắc muốn xoá thẻ #${tag} khỏi hệ thống?`,
                    confirmText: 'Xoá thẻ'
                });
                if (!agreed) return;
                try {
                    await invoke('delete_tag', { tag });
                    this._showToast(`Đã xóa thẻ #${tag}`, 'success');
                    await this._loadProjectRegistry();
                    this._renderSettingsTagsTab();
                    this._renderTagFilterBar();
                    this._updateSidebarBadges();
                    await this._showSessions();
                } catch (err) {
                    this._showToast(`Lỗi: ${err}`, 'error');
                }
            });
        });
    }

    async _handleCreateCategory() {
        const nameInput = document.getElementById('input-new-cat-name');
        const colorInput = document.getElementById('input-new-cat-color');
        const name = nameInput?.value.trim();
        if (!name) {
            this._showToast('Vui lòng nhập tên phân loại', 'error');
            return;
        }
        const color = colorInput?.value || '#10b981';
        try {
            await invoke('save_category', {
                category: {
                    id: '',
                    name,
                    color,
                }
            });
            if (nameInput) nameInput.value = '';
            this._showToast(`Đã thêm phân loại "${name}" ✓`, 'success');
            await this._loadProjectRegistry();
            this._renderSettingsCategoriesTab();
            this._renderCategoryFilterBar();
            this._updateSidebarBadges();
            await this._showSessions();
        } catch (err) {
            this._showToast(`Thêm phân loại thất bại: ${err}`, 'error');
        }
    }

    async _handleCreateTag() {
        const tagInput = document.getElementById('input-new-tag-name');
        const tag = tagInput?.value.trim().replace(/^#+/, '');
        if (!tag) {
            this._showToast('Vui lòng nhập tên thẻ', 'error');
            return;
        }
        try {
            await invoke('save_tag', { tag });
            if (tagInput) tagInput.value = '';
            this._showToast(`Đã thêm thẻ #${tag} ✓`, 'success');
            await this._loadProjectRegistry();
            this._renderSettingsTagsTab();
            this._renderTagFilterBar();
            this._updateSidebarBadges();
            await this._showSessions();
        } catch (err) {
            this._showToast(`Thêm thẻ thất bại: ${err}`, 'error');
        }
    }

    async _batchExportMarkdown() {
        if (this._selectedSessionIds.size === 0) return;
        const ids = Array.from(this._selectedSessionIds);
        try {
            const text = await invoke('export_batch_sessions_md', { ids });
            const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `project-meetings-export-${new Date().toISOString().slice(0, 10)}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            await navigator.clipboard.writeText(text);
            this._showToast(`Đã xuất & copy ${ids.length} cuộc họp ✓`, 'success');
        } catch (err) {
            this._showToast(`Xuất thất bại: ${err}`, 'error');
        }
    }

    async _batchAiDigest() {
        if (this._selectedSessionIds.size === 0) return;
        const ids = Array.from(this._selectedSessionIds);
        const modal = document.getElementById('modal-ai-digest');
        const loadingEl = document.getElementById('ai-digest-loading');
        const loadingText = document.getElementById('ai-digest-loading-text');
        const contentEl = document.getElementById('ai-digest-content');
        const titleEl = document.getElementById('ai-digest-title');

        if (!modal) return;
        modal.style.display = 'flex';
        if (loadingEl) loadingEl.style.display = 'block';
        if (contentEl) {
            contentEl.style.display = 'none';
            contentEl.textContent = '';
        }
        if (titleEl) titleEl.textContent = `✨ Tổng hợp ${ids.length} cuộc họp (AI Digest)`;

        const settings = settingsManager.get();
        const geminiKey = settings.gemini_api_key?.trim();
        const openaiKey = settings.openai_api_key?.trim();

        if (!geminiKey && !openaiKey) {
            if (loadingEl) loadingEl.style.display = 'none';
            if (contentEl) {
                contentEl.style.display = 'block';
                contentEl.innerHTML = '<p style="color:var(--md-sys-color-error);">⚠️ Bạn chưa cài đặt <b>Gemini API Key</b> hoặc <b>OpenAI API Key</b> trong phần Cài đặt (⌘,). Vui lòng thêm API Key để sử dụng tính năng AI Tổng hợp.</p>';
            }
            return;
        }

        try {
            if (loadingText) loadingText.textContent = `Đang đọc nội dung ${ids.length} cuộc họp...`;
            const combinedMd = await invoke('export_batch_sessions_md', { ids });

            if (loadingText) loadingText.textContent = `Đang phân tích & móc nối quyết định, việc cần làm bằng AI...`;

            const prompt = `Bạn là trợ lý quản lý dự án và phân tích cuộc họp thông minh.
Dưới đây là biên bản ghi chép chi tiết của ${ids.length} cuộc họp thuộc cùng một dự án/chuỗi chủ đề:

---
${combinedMd}
---

Hãy phân tích toàn bộ chuỗi cuộc họp trên và tạo một BẢN TỔNG HỢP MÓC NỐI THÔNG TIN DỰ ÁN hoàn chỉnh bằng tiếng Việt theo định dạng Markdown rõ ràng, súc tích:

# 📊 TỔNG HỢP CHUỖI CUỘC HỌP DỰ ÁN

## 1. 📌 Tóm tắt tiến độ & Diễn biến chính
(Tóm tắt ngắn gọn mạch câu chuyện và sự tiến triển từ buổi đầu đến buổi gần nhất)

## 2. 🎯 Nhật ký Quyết định (Decision Log)
(Liệt kê các quyết định đã được chốt qua các buổi, ghi rõ ngày/buổi nếu có)

## 3. 📋 Kế hoạch & Danh sách việc cần làm (Action Items)
(Bảng hoặc checklist: Ai làm gì? Việc nào đã xong, việc nào còn tồn đọng cần làm tiếp?)

## 4. ⚠️ Các vấn đề cần theo dõi / Blockers
(Những điểm còn tranh luận, vướng mắc chưa giải quyết cho buổi họp tiếp theo)
`;

            let resultText = '';
            if (geminiKey) {
                try {
                    resultText = await this._callGeminiAi(geminiKey, prompt, (statusMsg) => {
                        if (loadingEl) {
                            const p = loadingEl.querySelector('p');
                            if (p) p.textContent = statusMsg;
                        }
                    });
                } catch (geminiErr) {
                    if (openaiKey) {
                        console.warn('[App] Gemini không khả dụng, tự động chuyển sang OpenAI...', geminiErr);
                        resultText = await this._callOpenAi(openaiKey, prompt);
                    } else {
                        throw geminiErr;
                    }
                }
            } else {
                resultText = await this._callOpenAi(openaiKey, prompt);
            }

            this._currentAiDigestText = resultText;
            if (loadingEl) loadingEl.style.display = 'none';
            if (contentEl) {
                contentEl.style.display = 'block';
                contentEl.textContent = resultText;
            }
        } catch (err) {
            console.error('[App] _batchAiDigest failed:', err);
            if (loadingEl) loadingEl.style.display = 'none';
            if (contentEl) {
                contentEl.style.display = 'block';
                contentEl.textContent = `Lỗi tổng hợp AI: ${err.message || err}`;
            }
        }
    }

    async _getGeminiCandidateModels(apiKey) {
        const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
        const cacheKey = 'meet_minder_gemini_models_cache';

        // 1. Kiểm tra cache trong memory
        if (this._geminiDiscoveredModels && (Date.now() - this._geminiModelsCacheTime < CACHE_TTL_MS)) {
            return this._filterAvailableModels(this._geminiDiscoveredModels);
        }

        // 2. Kiểm tra cache trong localStorage
        try {
            const raw = localStorage.getItem(cacheKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.timestamp && (Date.now() - parsed.timestamp < CACHE_TTL_MS) && Array.isArray(parsed.models) && parsed.models.length > 0) {
                    this._geminiDiscoveredModels = parsed.models;
                    this._geminiModelsCacheTime = parsed.timestamp;
                    return this._filterAvailableModels(this._geminiDiscoveredModels);
                }
            }
        } catch (_) {}

        // 3. Tự động truy vấn danh sách model thời gian thực từ Google API
        try {
            console.log('[App] Đang phát hiện tự động các model Gemini từ Google Generative Language API...');
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            if (res.ok) {
                const data = await res.json();
                const rawModels = (data.models || [])
                    .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
                    .map(m => (m.name || '').replace(/^models\//, ''))
                    .filter(name => {
                        if (!name.startsWith('gemini-')) return false;
                        const lower = name.toLowerCase();
                        return !lower.includes('tts') &&
                               !lower.includes('image') &&
                               !lower.includes('robotics') &&
                               !lower.includes('clip') &&
                               !lower.includes('banana') &&
                               !lower.includes('embedding');
                    });

                // Chấm điểm ưu tiên: Flash model phiên bản cao nhất đứng đầu, kế đến là Pro, sau cùng là preview/exp
                const scoreModel = (name) => {
                    let s = 0;
                    if (name.includes('flash')) s += 100;
                    if (name.includes('pro')) s += 40;
                    if (name.includes('latest')) s += 15;
                    if (name.includes('lite')) s -= 5;
                    if (name.includes('preview') || name.includes('exp')) s -= 10;
                    // Điểm theo version: v4 > v3.8 > v3.7 > v3.6 > v3.5
                    const vMatch = name.match(/gemini-(\d+(?:\.\d+)?)/);
                    if (vMatch) {
                        s += parseFloat(vMatch[1]) * 20;
                    }
                    return s;
                };

                rawModels.sort((a, b) => scoreModel(b) - scoreModel(a));

                // Bổ sung các alias chính thức của Google vào chuỗi nếu chưa có
                if (!rawModels.includes('gemini-flash-latest')) rawModels.push('gemini-flash-latest');
                if (!rawModels.includes('gemini-flash-lite-latest')) rawModels.push('gemini-flash-lite-latest');

                if (rawModels.length > 0) {
                    this._geminiDiscoveredModels = rawModels;
                    this._geminiModelsCacheTime = Date.now();
                    try {
                        localStorage.setItem(cacheKey, JSON.stringify({
                            timestamp: this._geminiModelsCacheTime,
                            models: rawModels,
                        }));
                    } catch (_) {}
                    console.log('[App] Đã tự động phát hiện danh sách model Gemini khả dụng:', rawModels);
                    return this._filterAvailableModels(rawModels);
                }
            }
        } catch (err) {
            console.warn('[App] Không thể tải danh sách model động từ Google, dùng danh sách dự phòng:', err);
        }

        // 4. Danh sách tĩnh dự phòng nếu không kết nối được API discovery
        const fallback = [
            'gemini-3.1-flash-lite',
            'gemini-3.1-flash-lite-preview',
            'gemini-flash-lite-latest',
            'gemini-3.5-flash-lite',
            'gemini-3.8-flash',
            'gemini-3.7-flash',
            'gemini-3.6-flash',
            'gemini-3.5-flash',
            'gemini-flash-latest',
        ];
        return this._filterAvailableModels(fallback);
    }

    _filterAvailableModels(models) {
        if (!this._geminiBlacklistedModels) this._geminiBlacklistedModels = new Set();
        return models.filter(m => !this._geminiBlacklistedModels.has(m));
    }

    async _callGeminiAi(apiKey, promptText, onProgress = null) {
        const candidateModels = await this._getGeminiCandidateModels(apiKey);

        let lastErr = null;
        for (let i = 0; i < candidateModels.length; i++) {
            const model = candidateModels[i];
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

            // Tối đa 2 lần thử cho mỗi model nếu gặp lỗi tạm thời (503/429/5xx)
            const maxAttempts = 2;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    if (onProgress) {
                        if (i > 0 || attempt > 1) {
                            onProgress(`Đang gọi ${model}${attempt > 1 ? ` (thử lại lần ${attempt})` : ''}...`);
                        }
                    }

                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: promptText }] }],
                            generationConfig: {
                                temperature: 0.3,
                                maxOutputTokens: 8192,
                            }
                        })
                    });

                    if (!res.ok) {
                        const errText = await res.text();
                        let parsedMsg = errText;
                        try {
                            const errJson = JSON.parse(errText);
                            parsedMsg = errJson.error?.message || errText;
                        } catch (_) {}

                        lastErr = new Error(`Gemini API error (${res.status}): ${parsedMsg}`);

                        // 404: Model không tồn tại hoặc đã bị Google ngừng phục vụ -> blacklist và chuyển model tiếp theo ngay
                        if (res.status === 404) {
                            console.warn(`[App] Gemini model ${model} không khả dụng (404), thêm vào blacklist và chuyển model tiếp theo...`);
                            if (!this._geminiBlacklistedModels) this._geminiBlacklistedModels = new Set();
                            this._geminiBlacklistedModels.add(model);
                            break;
                        }

                        // 503 (quá tải), 429 (rate limit), hoặc 5xx (lỗi server): thử lại sau 1.5s
                        if (attempt < maxAttempts && (res.status === 503 || res.status === 429 || res.status >= 500)) {
                            console.warn(`[App] Gemini model ${model} trả về ${res.status}. Thử lại sau 1.5s...`);
                            if (onProgress) {
                                onProgress(`${model} quá tải tạm thời (${res.status}), thử lại sau 1.5s...`);
                            }
                            await new Promise(r => setTimeout(r, 1500));
                            continue;
                        }

                        // Nếu đã hết số lần thử của model này: chuyển sang model kế tiếp trong candidateModels
                        console.warn(`[App] Gemini model ${model} thất bại (${res.status}), chuyển sang model tiếp theo...`);
                        break;
                    }

                    const data = await res.json();
                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text && text.trim()) {
                        return text;
                    } else {
                        throw new Error(`Model ${model} không trả về nội dung văn bản hợp lệ.`);
                    }
                } catch (fetchErr) {
                    lastErr = fetchErr;
                    console.warn(`[App] Lỗi kết nối tới model ${model} (lần ${attempt}):`, fetchErr);
                    if (attempt < maxAttempts) {
                        await new Promise(r => setTimeout(r, 1200));
                        continue;
                    }
                    break;
                }
            }
        }

        throw lastErr || new Error('Tất cả các model Gemini đều không khả dụng vào lúc này.');
    }

    async _callOpenAi(apiKey, promptText) {
        const url = 'https://api.openai.com/v1/chat/completions';
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: promptText }],
                temperature: 0.3,
            })
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`OpenAI API error (${res.status}): ${err}`);
        }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || 'Không có kết quả trả về từ OpenAI.';
    }

    _getQuickLangName(code) {
        const map = {
            vi: 'Tiếng Việt',
            ja: '日本語',
            en: 'English',
            none: 'Không dịch',
            off: 'Không dịch',
            auto: 'Tự động',
        };
        const normalized = String(code || '').toLowerCase().split(/[-_]/)[0];
        return map[normalized] || LANGUAGE_DISPLAY[normalized]?.[1] || code;
    }

    _formatLanguage(code) {
        const normalized = String(code || '').toLowerCase().split(/[-_]/)[0];
        const [flag, name] = LANGUAGE_DISPLAY[normalized] || ['🌐', String(code || '').toUpperCase()];
        return `<span class="session-language"><span class="session-language-flag">${flag}</span> ${this._esc(name)}</span>`;
    }

    _initSessionViewerTabs() {
        // Tab switching buttons
        const tabMinutes = document.getElementById('tab-btn-minutes');
        const tabNotes = document.getElementById('tab-btn-notes');
        const tabLogs = document.getElementById('tab-btn-logs');

        tabMinutes?.addEventListener('click', () => this._switchSessionTab('minutes'));
        tabNotes?.addEventListener('click', () => this._switchSessionTab('notes'));
        tabLogs?.addEventListener('click', () => this._switchSessionTab('logs'));

        // Minutes Sub-tab buttons
        document.getElementById('subtab-btn-minutes-ja')?.addEventListener('click', () => this._switchMinutesSubtab('ja'));
        document.getElementById('subtab-btn-minutes-vi')?.addEventListener('click', () => this._switchMinutesSubtab('vi'));

        // Tab Minutes actions
        document.getElementById('btn-minutes-edit')?.addEventListener('click', () => this._enterMinutesEditMode());
        document.getElementById('btn-minutes-save')?.addEventListener('click', () => this._saveMinutesEdit());
        document.getElementById('btn-minutes-cancel')?.addEventListener('click', () => this._exitMinutesEditMode());
        document.getElementById('btn-minutes-copy-rich')?.addEventListener('click', () => this._copyRichMeetingMinutes());
        document.getElementById('btn-minutes-copy-md')?.addEventListener('click', async () => {
            if (this._sessionMinutesEditor) {
                const md = this._sessionMinutesEditor.getContent();
                if (md) {
                    await navigator.clipboard.writeText(md);
                    this._showToast('Đã copy Markdown Meeting Minutes ✓', 'success');
                }
            }
        });
        document.getElementById('btn-minutes-regenerate')?.addEventListener('click', async () => {
            const cur = this._currentViewedSession;
            if (!cur || cur.isLegacy) return;
            await this._generateMeetingMinutesForSession(cur.id, this._activeMinutesLang || 'ja');
        });
        document.getElementById('btn-minutes-generate-empty')?.addEventListener('click', async () => {
            const cur = this._currentViewedSession;
            if (!cur || cur.isLegacy) return;
            await this._generateMeetingMinutesForSession(cur.id, this._activeMinutesLang || 'ja');
        });

        // Tab Notes actions
        document.getElementById('btn-notes-edit')?.addEventListener('click', () => this._enterNotesEditMode());
        document.getElementById('btn-notes-save')?.addEventListener('click', () => this._saveNotesEdit());
        document.getElementById('btn-notes-cancel')?.addEventListener('click', () => this._exitNotesEditMode());
        document.getElementById('btn-notes-copy-rich')?.addEventListener('click', () => this._copyRichNotes());
        document.getElementById('btn-notes-copy-md')?.addEventListener('click', async () => {
            if (this._sessionNotesEditor) {
                const notes = this._sessionNotesEditor.getContent();
                if (notes) {
                    await navigator.clipboard.writeText(notes);
                    this._showToast('Đã copy Markdown ghi chú ✓', 'success');
                }
            }
        });

        // Tab Logs actions
        document.getElementById('btn-logs-copy')?.addEventListener('click', async () => {
            if (this._sessionLogsEditor) {
                const logs = this._sessionLogsEditor.getContent();
                if (logs) {
                    await navigator.clipboard.writeText(logs);
                    this._showToast('Đã copy thoại cuộc họp ✓', 'success');
                }
            }
        });
    }

    _switchSessionTab(tab) {
        this._activeSessionTab = tab;
        const tabs = ['minutes', 'notes', 'logs'];
        tabs.forEach(t => {
            const btn = document.getElementById(`tab-btn-${t}`);
            const panel = document.getElementById(`session-tab-panel-${t}`);
            if (btn) btn.classList.toggle('active', t === tab);
            if (panel) {
                panel.classList.toggle('active', t === tab);
                panel.style.display = (t === tab) ? 'flex' : 'none';
            }
        });
    }

    _switchMinutesSubtab(lang) {
        this._activeMinutesLang = lang || 'ja';
        const subtabs = ['ja', 'vi'];
        subtabs.forEach(l => {
            const btn = document.getElementById(`subtab-btn-minutes-${l}`);
            if (btn) btn.classList.toggle('active', l === this._activeMinutesLang);
        });

        this._exitMinutesEditMode();
        this._renderCurrentMinutesSubtab();
    }

    _renderCurrentMinutesSubtab() {
        const lang = this._activeMinutesLang || 'ja';
        const content = (this._loadedMinutes && this._loadedMinutes[lang]) ? this._loadedMinutes[lang].trim() : '';

        const emptyEl = document.getElementById('minutes-empty');
        const loadingEl = document.getElementById('minutes-loading');
        const editorContainer = document.getElementById('session-minutes-editor-container');
        const emptyTitle = document.getElementById('minutes-empty-title');
        const emptyBtn = document.getElementById('btn-minutes-generate-empty');

        if (loadingEl) loadingEl.style.display = 'none';

        if (content) {
            if (emptyEl) emptyEl.style.display = 'none';
            if (editorContainer) editorContainer.style.display = '';
            if (this._sessionMinutesEditor) {
                this._sessionMinutesEditor.setContent(content);
                this._sessionMinutesEditor.setReadOnly(true);
            }
        } else {
            if (emptyEl) emptyEl.style.display = 'flex';
            if (editorContainer) editorContainer.style.display = 'none';
            if (emptyTitle) {
                emptyTitle.textContent = lang === 'ja'
                    ? 'Chưa có Meeting Minutes tiếng Nhật cho cuộc họp này'
                    : 'Chưa có Meeting Minutes tiếng Việt cho cuộc họp này';
            }
            if (emptyBtn) {
                emptyBtn.textContent = lang === 'ja'
                    ? '✨ Tạo Meeting Minutes (Tiếng Nhật 🇯🇵)'
                    : '✨ Tạo Meeting Minutes (Tiếng Việt 🇻🇳)';
            }
            if (this._sessionMinutesEditor) {
                this._sessionMinutesEditor.setContent('');
                this._sessionMinutesEditor.setReadOnly(true);
            }
        }
    }

    _updateMinutesBadges() {
        const hasJa = !!(this._loadedMinutes && this._loadedMinutes.ja && this._loadedMinutes.ja.trim());
        const hasVi = !!(this._loadedMinutes && this._loadedMinutes.vi && this._loadedMinutes.vi.trim());

        const badgeJa = document.getElementById('subtab-badge-minutes-ja');
        if (badgeJa) badgeJa.style.display = hasJa ? 'inline-block' : 'none';

        const badgeVi = document.getElementById('subtab-badge-minutes-vi');
        if (badgeVi) badgeVi.style.display = hasVi ? 'inline-block' : 'none';

        const badgeMain = document.getElementById('tab-badge-minutes');
        if (badgeMain) badgeMain.style.display = (hasJa || hasVi) ? 'inline-block' : 'none';
    }

    _ensureSessionViewerEditorsMounted() {
        const minCont = document.getElementById('session-minutes-editor-container');
        if (!this._sessionMinutesEditor && minCont) {
            this._sessionMinutesEditor = new NotesEditor();
            this._sessionMinutesEditor.mount(minCont, {
                initialContent: '',
                readOnly: true,
                placeholderText: 'Biên bản cuộc họp (Meeting Minutes)...',
                onSave: () => {
                    if (this._isMinutesEditing) this._saveMinutesEdit();
                },
                onCancel: () => {
                    if (this._isMinutesEditing) this._exitMinutesEditMode();
                },
            });
        }

        const notesCont = document.getElementById('session-notes-editor-container');
        if (!this._sessionNotesEditor && notesCont) {
            this._sessionNotesEditor = new NotesEditor();
            this._sessionNotesEditor.mount(notesCont, {
                initialContent: '',
                readOnly: true,
                placeholderText: 'Ghi chú cuộc họp...',
                onSave: () => {
                    if (this._isNotesEditing) this._saveNotesEdit();
                },
                onCancel: () => {
                    if (this._isNotesEditing) this._exitNotesEditMode();
                },
            });
        }

        const logsCont = document.getElementById('session-logs-editor-container');
        if (!this._sessionLogsEditor && logsCont) {
            this._sessionLogsEditor = new NotesEditor();
            this._sessionLogsEditor.mount(logsCont, {
                initialContent: '',
                readOnly: true,
                placeholderText: 'Nội dung thoại...',
            });
            this._sessionViewerEditor = this._sessionLogsEditor;
        }
    }

    _formatTranscriptFromChunks(chunks) {
        const srcLines = [];
        const tgtLines = [];
        for (const chunk of (chunks || [])) {
            for (const seg of (chunk.segments || [])) {
                const ts = seg.ts ? `[${seg.ts}] ` : '';
                const spk = seg.speaker ? `(Speaker ${seg.speaker}) ` : '';
                const src = (seg.src || '').trim();
                const tgt = (seg.tgt || '').trim();
                if (src) srcLines.push(`${ts}${spk}${src}`);
                if (tgt) tgtLines.push(`${ts}${spk}${tgt}`);
            }
        }

        const lines = [];
        if (tgtLines.length > 0) {
            lines.push('## 🗣️ Bản gốc (Original)');
            lines.push('');
            lines.push(srcLines.length > 0 ? srcLines.join('\n') : '*(Không có nội dung bản gốc)*');
            lines.push('');
            lines.push('---');
            lines.push('');
            lines.push('## 🌐 Bản dịch (Translation)');
            lines.push('');
            lines.push(tgtLines.join('\n'));
        } else {
            lines.push('## 🗣️ Lịch sử thoại cuộc họp');
            lines.push('');
            lines.push(srcLines.length > 0 ? srcLines.join('\n') : '*(Không có nội dung ghi âm)*');
        }

        return lines.join('\n');
    }

    _stripNotesFromMarkdown(mdText) {
        if (!mdText) return '';
        return mdText
            .replace(/^# [^\n]*\n+/i, '')
            .replace(/\*\*Thông tin\*\*:[^\n]*\n+/i, '')
            .replace(/## 📝 Ghi chú cuộc họp[^\n]*[\s\S]*?(?=(## |---|$))/gi, '')
            .replace(/## 📋 Biên bản cuộc họp[^\n]*[\s\S]*?(?=(## |---|$))/gi, '')
            .replace(/^[-\s]*\n/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    _markdownToRichHtml(md) {
        if (!md) return '';
        const lines = md.split('\n');
        let html = '';
        let inList = false;
        let inTable = false;
        let tableHeaderDone = false;

        const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const formatInline = (text) => {
            return text
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;color:#0f172a;padding:2px 4px;border-radius:3px;font-size:12px;">$1</code>');
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Table rows
            if (line.startsWith('|') && line.endsWith('|')) {
                const cells = line.slice(1, -1).split('|').map(c => c.trim());
                if (cells.every(c => /^:?-+:?$/.test(c))) {
                    tableHeaderDone = true;
                    continue;
                }
                if (!inTable) {
                    if (inList) { html += '</ul>\n'; inList = false; }
                    inTable = true;
                    tableHeaderDone = false;
                    html += '<table style="border-collapse:collapse;width:100%;margin:12px 0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:13px;">\n';
                }
                const tag = !tableHeaderDone ? 'th' : 'td';
                const cellStyle = !tableHeaderDone
                    ? 'border:1px solid #cbd5e1;padding:8px 12px;background:#f8fafc;font-weight:600;text-align:left;'
                    : 'border:1px solid #cbd5e1;padding:8px 12px;text-align:left;';
                html += '  <tr>' + cells.map(c => `<${tag} style="${cellStyle}">${formatInline(escapeHtml(c))}</${tag}>`).join('') + '</tr>\n';
                continue;
            } else if (inTable) {
                html += '</table>\n';
                inTable = false;
            }

            // Horizontal rule
            if (line === '---' || line === '***') {
                if (inList) { html += '</ul>\n'; inList = false; }
                html += '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;" />\n';
                continue;
            }

            // Headings
            if (line.startsWith('# ')) {
                if (inList) { html += '</ul>\n'; inList = false; }
                html += `<h1 style="color:#0f172a;font-size:18px;font-weight:700;margin:16px 0 8px 0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">${formatInline(escapeHtml(line.slice(2)))}</h1>\n`;
                continue;
            }
            if (line.startsWith('## ')) {
                if (inList) { html += '</ul>\n'; inList = false; }
                html += `<h2 style="color:#1e293b;font-size:15px;font-weight:700;margin:14px 0 6px 0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">${formatInline(escapeHtml(line.slice(3)))}</h2>\n`;
                continue;
            }
            if (line.startsWith('### ')) {
                if (inList) { html += '</ul>\n'; inList = false; }
                html += `<h3 style="color:#334155;font-size:13px;font-weight:600;margin:12px 0 4px 0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">${formatInline(escapeHtml(line.slice(4)))}</h3>\n`;
                continue;
            }

            // Bullet lists
            if (line.startsWith('- ') || line.startsWith('* ')) {
                if (!inList) {
                    html += '<ul style="margin:6px 0;padding-left:20px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;">\n';
                    inList = true;
                }
                html += `  <li>${formatInline(escapeHtml(line.slice(2)))}</li>\n`;
                continue;
            } else if (inList) {
                html += '</ul>\n';
                inList = false;
            }

            if (!line) continue;

            html += `<p style="margin:6px 0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#1e293b;">${formatInline(escapeHtml(line))}</p>\n`;
        }

        if (inList) html += '</ul>\n';
        if (inTable) html += '</table>\n';

        return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${html}</div>`;
    }

    _buildMeetingMinutesPrompt(sessionData, targetLang = 'vi') {
        const title = sessionData.title || sessionData.id;
        const createdAt = sessionData.created_at || '';
        const durationMin = Math.round((sessionData.duration_sec || 0) / 60);
        const notes = sessionData.notes?.trim() || '(Không có ghi chú riêng)';

        const logLines = [];
        for (const chunk of (sessionData.chunks || [])) {
            for (const seg of (chunk.segments || [])) {
                const ts = seg.ts ? `[${seg.ts}] ` : '';
                const spk = seg.speaker ? `(Speaker ${seg.speaker}) ` : '';
                const src = (seg.src || '').trim();
                const tgt = (seg.tgt || '').trim();
                if (tgt) {
                    logLines.push(`${ts}${spk}${tgt}${src ? ` (Gốc: ${src})` : ''}`);
                } else if (src) {
                    logLines.push(`${ts}${spk}${src}`);
                }
            }
        }
        const transcriptText = logLines.join('\n');

        const s = settingsManager.get();
        if (targetLang === 'ja') {
            let jaTemplate = (s.template_minutes_ja && s.template_minutes_ja.trim()) ? s.template_minutes_ja : DEFAULT_TEMPLATE_MINUTES_JA;
            jaTemplate = jaTemplate
                .replace(/\{\{title\}\}/g, title)
                .replace(/\{\{date\}\}/g, createdAt)
                .replace(/\{\{duration\}\}/g, String(durationMin))
                .replace(/\{\{participants\}\}/g, '(発言ログやメモから判明する参加者・発言者、または想定される担当者)');

            return `あなたはプロフェッショナルな議事録作成アシスタントです。
以下の会議情報、ユーザーの手書きメモ、および会議のリアルタイム発言ログをもとに、クライアントや関係者にそのまま共有・送信できる高品質で正式な「会議議事録（Meeting Minutes）」を日本語のMarkdown形式で作成してください。

【会議基本情報】
- 会議名: ${title}
- 日時: ${createdAt}
- 所要時間: 約 ${durationMin} 分

【参加者の手書きメモ】
${notes}

【発言・翻訳ログ】
${transcriptText}

---

【出力フォーマット（必ず以下のテンプレート構造・見出しに厳格に従って記述してください）】

${jaTemplate}

※客観的かつ簡潔・明瞭なビジネス日本語（「です・ます」調）で作成してください。`;
        }

        // Default: Vietnamese
        let viTemplate = (s.template_minutes_vi && s.template_minutes_vi.trim()) ? s.template_minutes_vi : DEFAULT_TEMPLATE_MINUTES_VI;
        viTemplate = viTemplate
            .replace(/\{\{title\}\}/g, title)
            .replace(/\{\{date\}\}/g, createdAt)
            .replace(/\{\{duration\}\}/g, String(durationMin))
            .replace(/\{\{participants\}\}/g, '(Tổng hợp tên người nói hoặc các bên tham gia dựa theo hội thoại/ghi chú)');

        return `Bạn là một trợ lý thư ký cuộc họp chuyên nghiệp và sắc bén.
Dưới đây là thông tin cuộc họp, ghi chú viết tay của người tham gia và toàn bộ dữ liệu đối thoại/bản dịch ghi nhận được trong cuộc họp:

【THÔNG TIN CUỘC HỌP】
- Tiêu đề: ${title}
- Thời gian bắt đầu: ${createdAt}
- Thời lượng: khoảng ${durationMin} phút

【GHI CHÚ VIẾT TAY (NOTES)】
${notes}

【LỊCH SỬ THOẠI & BẢN DỊCH】
${transcriptText}

---

Hãy phân tích toàn diện và soạn thảo một BẢN BIÊN BẢN CUỘC HỌP (MEETING MINUTES) chuẩn chỉnh, trang trọng và súc tích bằng Tiếng Việt theo ĐÚNG CẤU TRÚC MẪU (TEMPLATE) DƯỚI ĐÂY:

${viTemplate}

Lưu ý: Văn phong trang trọng, chuẩn mực công việc, rõ ràng, gãy gọn.`;
    }

    async _generateMeetingMinutesForSession(sessionId, targetLang = null) {
        const lang = targetLang || this._activeMinutesLang || 'ja';
        const loadingEl = document.getElementById('minutes-loading');
        const emptyEl = document.getElementById('minutes-empty');
        const editorContainer = document.getElementById('session-minutes-editor-container');
        const loadingText = document.getElementById('minutes-loading-text');

        if (loadingEl) loadingEl.style.display = 'flex';
        if (emptyEl) emptyEl.style.display = 'none';
        if (editorContainer) editorContainer.style.display = 'none';
        if (loadingText) loadingText.textContent = `Đang phân tích & soạn thảo Meeting Minutes (${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Việt'})...`;

        const settings = settingsManager.get();
        const geminiKey = settings.gemini_api_key?.trim();
        const openaiKey = settings.openai_api_key?.trim();

        if (!geminiKey && !openaiKey) {
            if (loadingEl) loadingEl.style.display = 'none';
            this._renderCurrentMinutesSubtab();
            this._showToast('Vui lòng cài đặt Gemini hoặc OpenAI API Key trong Cài đặt (⌘,) để tạo Meeting Minutes', 'error');
            return;
        }

        try {
            const res = await invoke('read_session', { id: sessionId });
            const prompt = this._buildMeetingMinutesPrompt(res.json, lang);

            let resultText = '';
            const onStatusUpdate = (msg) => {
                if (loadingText) loadingText.textContent = msg;
            };

            if (geminiKey) {
                try {
                    resultText = await this._callGeminiAi(geminiKey, prompt, onStatusUpdate);
                } catch (geminiErr) {
                    if (openaiKey) {
                        console.warn('[App] Gemini không khả dụng, tự động chuyển sang OpenAI...', geminiErr);
                        onStatusUpdate('Gemini quá tải, đang chuyển sang OpenAI gpt-4o-mini...');
                        resultText = await this._callOpenAi(openaiKey, prompt);
                    } else {
                        throw geminiErr;
                    }
                }
            } else {
                resultText = await this._callOpenAi(openaiKey, prompt);
            }

            // Save to backend
            await invoke('update_session_meeting_minutes', {
                id: sessionId,
                minutes: resultText,
                lang,
            });

            this._loadedMinutes[lang] = resultText;
            this._updateMinutesBadges();
            this._switchMinutesSubtab(lang);

            this._showToast(`Đã tạo Meeting Minutes (${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Việt'}) thành công ✓`, 'success');
        } catch (err) {
            console.error('[App] _generateMeetingMinutesForSession error:', err);
            if (loadingEl) loadingEl.style.display = 'none';
            this._renderCurrentMinutesSubtab();
            const errMsg = err.message || String(err);
            if (errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('quá tải')) {
                this._showToast('Máy chủ AI đang quá tải tạm thời. Vui lòng bấm tạo lại sau giây lát.', 'error');
            } else {
                this._showToast(`Lỗi tạo Meeting Minutes: ${errMsg}`, 'error');
            }
        }
    }

    _enterMinutesEditMode() {
        const cur = this._currentViewedSession;
        if (!cur || !this._sessionMinutesEditor) return;
        this._isMinutesEditing = true;
        this._sessionMinutesEditor.setReadOnly(false);
        this._sessionMinutesEditor.focus();
        const editBtn = document.getElementById('btn-minutes-edit');
        if (editBtn) editBtn.style.display = 'none';
        const saveBtn = document.getElementById('btn-minutes-save');
        if (saveBtn) saveBtn.style.display = '';
        const cancelBtn = document.getElementById('btn-minutes-cancel');
        if (cancelBtn) cancelBtn.style.display = '';
        const copyRich = document.getElementById('btn-minutes-copy-rich');
        if (copyRich) copyRich.style.display = 'none';
        const copyMd = document.getElementById('btn-minutes-copy-md');
        if (copyMd) copyMd.style.display = 'none';
        const regen = document.getElementById('btn-minutes-regenerate');
        if (regen) regen.style.display = 'none';
    }

    _exitMinutesEditMode() {
        this._isMinutesEditing = false;
        if (this._sessionMinutesEditor) {
            this._sessionMinutesEditor.setReadOnly(true);
        }
        const editBtn = document.getElementById('btn-minutes-edit');
        if (editBtn) editBtn.style.display = '';
        const saveBtn = document.getElementById('btn-minutes-save');
        if (saveBtn) saveBtn.style.display = 'none';
        const cancelBtn = document.getElementById('btn-minutes-cancel');
        if (cancelBtn) cancelBtn.style.display = 'none';
        const copyRich = document.getElementById('btn-minutes-copy-rich');
        if (copyRich) copyRich.style.display = '';
        const copyMd = document.getElementById('btn-minutes-copy-md');
        if (copyMd) copyMd.style.display = '';
        const regen = document.getElementById('btn-minutes-regenerate');
        if (regen) regen.style.display = '';
    }

    async _saveMinutesEdit() {
        const cur = this._currentViewedSession;
        if (!cur || !this._sessionMinutesEditor) return;
        const lang = this._activeMinutesLang || 'ja';
        const newMinutes = this._sessionMinutesEditor.getContent();
        try {
            await invoke('update_session_meeting_minutes', {
                id: cur.id,
                minutes: newMinutes,
                lang,
            });
            this._loadedMinutes[lang] = newMinutes;
            this._updateMinutesBadges();
            this._exitMinutesEditMode();
            this._showToast(`Đã lưu Meeting Minutes (${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Việt'}) ✓`, 'success');
        } catch (err) {
            this._showToast(`Lỗi lưu Meeting Minutes: ${err}`, 'error');
        }
    }

    _enterNotesEditMode() {
        const cur = this._currentViewedSession;
        if (!cur || !this._sessionNotesEditor) return;
        this._isNotesEditing = true;
        this._sessionNotesEditor.setReadOnly(false);
        this._sessionNotesEditor.focus();
        const editBtn = document.getElementById('btn-notes-edit');
        if (editBtn) editBtn.style.display = 'none';
        const saveBtn = document.getElementById('btn-notes-save');
        if (saveBtn) saveBtn.style.display = '';
        const cancelBtn = document.getElementById('btn-notes-cancel');
        if (cancelBtn) cancelBtn.style.display = '';
        const copyRich = document.getElementById('btn-notes-copy-rich');
        if (copyRich) copyRich.style.display = 'none';
        const copyMd = document.getElementById('btn-notes-copy-md');
        if (copyMd) copyMd.style.display = 'none';
    }

    _exitNotesEditMode() {
        this._isNotesEditing = false;
        if (this._sessionNotesEditor) {
            this._sessionNotesEditor.setReadOnly(true);
        }
        const editBtn = document.getElementById('btn-notes-edit');
        if (editBtn) editBtn.style.display = '';
        const saveBtn = document.getElementById('btn-notes-save');
        if (saveBtn) saveBtn.style.display = 'none';
        const cancelBtn = document.getElementById('btn-notes-cancel');
        if (cancelBtn) cancelBtn.style.display = 'none';
        const copyRich = document.getElementById('btn-notes-copy-rich');
        if (copyRich) copyRich.style.display = '';
        const copyMd = document.getElementById('btn-notes-copy-md');
        if (copyMd) copyMd.style.display = '';
    }

    async _saveNotesEdit() {
        const cur = this._currentViewedSession;
        if (!cur || !this._sessionNotesEditor) return;
        const newNotes = this._sessionNotesEditor.getContent();
        try {
            await invoke('update_session_notes', {
                id: cur.id,
                notes: newNotes,
            });
            this._exitNotesEditMode();
            this._showToast('Đã lưu ghi chú ✓', 'success');
        } catch (err) {
            this._showToast(`Lỗi lưu ghi chú: ${err}`, 'error');
        }
    }

    async _copyRichMeetingMinutes() {
        if (!this._sessionMinutesEditor) return;
        const md = this._sessionMinutesEditor.getContent();
        if (!md || !md.trim()) {
            this._showToast('Chưa có nội dung Meeting Minutes để copy', 'info');
            return;
        }
        try {
            const html = this._markdownToRichHtml(md);
            if (window.ClipboardItem && navigator.clipboard?.write) {
                const textBlob = new Blob([md], { type: 'text/plain' });
                const htmlBlob = new Blob([html], { type: 'text/html' });
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/plain': textBlob,
                        'text/html': htmlBlob,
                    })
                ]);
            } else {
                await navigator.clipboard.writeText(md);
            }
            this._showToast('Đã copy HTML Meeting Minutes ✓', 'success');
        } catch (err) {
            console.error('[App] _copyRichMeetingMinutes failed:', err);
            await navigator.clipboard.writeText(md);
            this._showToast('Đã copy Meeting Minutes (văn bản) ✓', 'success');
        }
    }

    async _copyRichNotes() {
        if (!this._sessionNotesEditor) return;
        const md = this._sessionNotesEditor.getContent();
        if (!md || !md.trim()) {
            this._showToast('Chưa có nội dung ghi chú để copy', 'info');
            return;
        }
        try {
            const html = this._markdownToRichHtml(md);
            if (window.ClipboardItem && navigator.clipboard?.write) {
                const textBlob = new Blob([md], { type: 'text/plain' });
                const htmlBlob = new Blob([html], { type: 'text/html' });
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/plain': textBlob,
                        'text/html': htmlBlob,
                    })
                ]);
            } else {
                await navigator.clipboard.writeText(md);
            }
            this._showToast('Đã copy HTML ghi chú ✓', 'success');
        } catch (err) {
            console.error('[App] _copyRichNotes failed:', err);
            await navigator.clipboard.writeText(md);
            this._showToast('Đã copy ghi chú (văn bản) ✓', 'success');
        }
    }

    async _openSession(id, isLegacy = false) {
        this._exitSessionEditMode();
        this._exitMinutesEditMode();
        this._exitNotesEditMode();

        if (this._sessionAudioElement) {
            this._sessionAudioElement.pause();
            this._sessionAudioElement = null;
            this._sessionAudioId = null;
        }
        this._resetSessionPlayerUI();

        const listPanel = document.getElementById('sessions-list-panel');
        const viewer = document.getElementById('session-viewer');
        const title = document.getElementById('session-viewer-title');
        const detailPlayer = document.querySelector('.session-player-detail');

        if (listPanel) listPanel.style.display = 'none';
        if (viewer) viewer.style.display = '';
        if (title) title.textContent = id;
        if (detailPlayer) {
            detailPlayer.dataset.playerId = id;
            detailPlayer.dataset.legacy = isLegacy ? '1' : '0';
            detailPlayer.classList.toggle('is-disabled', isLegacy);
            detailPlayer.querySelector('[data-player-toggle]').disabled = isLegacy;
            detailPlayer.querySelector('[data-player-timeline]').disabled = isLegacy;
        }
        this._currentViewedSession = { id, isLegacy };

        this._ensureSessionViewerEditorsMounted();

        const tabBtnMinutes = document.getElementById('tab-btn-minutes');
        const tabBtnNotes = document.getElementById('tab-btn-notes');

        try {
            if (isLegacy) {
                const text = await invoke('read_legacy_session', { id });
                const strippedText = this._stripNotesFromMarkdown(text);
                if (this._sessionLogsEditor) this._sessionLogsEditor.setContent(strippedText);
                if (title) title.textContent = id;
                if (tabBtnMinutes) tabBtnMinutes.style.display = 'none';
                if (tabBtnNotes) tabBtnNotes.style.display = 'none';
                this._switchSessionTab('logs');
            } else {
                if (tabBtnMinutes) tabBtnMinutes.style.display = '';
                if (tabBtnNotes) tabBtnNotes.style.display = '';

                const result = await invoke('read_session', { id });
                const json = result.json;
                if (title) title.textContent = json.title || id;

                // 1. Minutes Tab (JA & VI Sub-tabs)
                const mmJa = json.meeting_minutes_ja || (json.meeting_minutes_lang === 'ja' ? json.meeting_minutes : '') || '';
                const mmVi = json.meeting_minutes_vi || (json.meeting_minutes_lang === 'vi' ? json.meeting_minutes : '') || '';
                this._loadedMinutes = {
                    ja: mmJa.trim(),
                    vi: mmVi.trim(),
                };

                this._updateMinutesBadges();

                // If single-language session (no translation requested or same language)
                const isNoTranslation = !json.target_lang || json.target_lang === 'none' || json.target_lang === json.source_lang;
                const subtabJa = document.getElementById('subtab-btn-minutes-ja');
                const subtabVi = document.getElementById('subtab-btn-minutes-vi');

                if (isNoTranslation) {
                    const sessionLang = json.source_lang || 'vi';
                    if (sessionLang === 'vi') {
                        if (subtabJa) subtabJa.style.display = 'none';
                        if (subtabVi) subtabVi.style.display = '';
                        this._switchMinutesSubtab('vi');
                    } else if (sessionLang === 'ja') {
                        if (subtabJa) subtabJa.style.display = '';
                        if (subtabVi) subtabVi.style.display = 'none';
                        this._switchMinutesSubtab('ja');
                    } else {
                        if (subtabJa) subtabJa.style.display = 'none';
                        if (subtabVi) subtabVi.style.display = '';
                        this._switchMinutesSubtab('vi');
                    }
                } else {
                    if (subtabJa) subtabJa.style.display = '';
                    if (subtabVi) subtabVi.style.display = '';
                    const preferredSubtab = this._loadedMinutes.ja ? 'ja' : (this._loadedMinutes.vi ? 'vi' : 'ja');
                    this._switchMinutesSubtab(preferredSubtab);
                }

                // 2. Notes Tab
                const notesText = json.notes || '';
                if (this._sessionNotesEditor) {
                    this._sessionNotesEditor.setContent(notesText);
                    this._sessionNotesEditor.setReadOnly(true);
                }

                // 3. Logs Tab (tách riêng bản gốc và bản dịch, không gộp lẫn ghi chú)
                let logsText = this._formatTranscriptFromChunks(json.chunks);
                if ((!logsText || (logsText.includes('*(Không có nội dung bản gốc)*') && logsText.includes('*(Không có nội dung bản dịch)*'))) && result.md) {
                    logsText = this._stripNotesFromMarkdown(result.md);
                }
                if (!logsText) {
                    logsText = '*(Không có nội dung ghi âm / bản dịch)*';
                }
                if (this._sessionLogsEditor) {
                    this._sessionLogsEditor.setContent(logsText);
                    this._sessionLogsEditor.setReadOnly(true);
                }

                // Default Tab: if has any minutes -> 'minutes', otherwise -> 'logs'
                if (this._loadedMinutes.ja || this._loadedMinutes.vi) {
                    this._switchSessionTab('minutes');
                } else {
                    this._switchSessionTab('logs');
                }
            }
        } catch (err) {
            console.error('[App] _openSession error:', err);
            this._showToast(`Lỗi đọc cuộc họp: ${err}`, 'error');
        }
    }

    _enterSessionEditMode() {
        const cur = this._currentViewedSession;
        if (!cur) return;

        const titleEl = document.getElementById('session-viewer-title');
        const inputTitle = document.getElementById('input-session-viewer-title');
        const normalActions = document.getElementById('session-viewer-normal-actions');
        const editActions = document.getElementById('session-viewer-edit-actions');

        if (!titleEl || !inputTitle) return;

        this._isSessionEditing = true;

        const currentTitle = titleEl.textContent || '';
        inputTitle.value = currentTitle;

        titleEl.style.display = 'none';
        inputTitle.style.display = '';

        if (normalActions) normalActions.style.display = 'none';
        if (editActions) editActions.style.display = '';

        if (this._sessionViewerEditor) {
            this._sessionViewerEditor.setReadOnly(false);
            this._sessionViewerEditor.focus();
        }

        inputTitle.focus();
        inputTitle.select();
    }

    _exitSessionEditMode() {
        this._isSessionEditing = false;
        const titleEl = document.getElementById('session-viewer-title');
        const inputTitle = document.getElementById('input-session-viewer-title');
        const normalActions = document.getElementById('session-viewer-normal-actions');
        const editActions = document.getElementById('session-viewer-edit-actions');

        if (titleEl) titleEl.style.display = '';
        if (inputTitle) inputTitle.style.display = 'none';
        if (normalActions) normalActions.style.display = '';
        if (editActions) editActions.style.display = 'none';

        if (this._sessionViewerEditor) {
            this._sessionViewerEditor.setReadOnly(true);
        }
    }

    async _saveSessionEdit() {
        const cur = this._currentViewedSession;
        if (!cur) return;

        const inputTitle = document.getElementById('input-session-viewer-title');
        const titleEl = document.getElementById('session-viewer-title');

        const newTitle = inputTitle?.value.trim() || 'Cuộc họp chưa đặt tên';
        let newContent = this._sessionViewerEditor ? this._sessionViewerEditor.getContent() : '';

        // If markdown starts with # <heading>, sync heading with newTitle
        if (newTitle && newContent.startsWith('# ')) {
            const firstEol = newContent.indexOf('\n');
            if (firstEol !== -1) {
                newContent = `# ${newTitle}\n${newContent.slice(firstEol + 1)}`;
            } else {
                newContent = `# ${newTitle}`;
            }
            if (this._sessionViewerEditor) this._sessionViewerEditor.setContent(newContent);
        }

        try {
            await invoke('update_session_content', {
                id: cur.id,
                title: newTitle,
                mdContent: newContent,
            });

            if (titleEl) titleEl.textContent = newTitle;

            if (sessionStore.id === cur.id) {
                sessionStore.title = newTitle;
            }

            if (this._cachedSessions) {
                const s = this._cachedSessions.find(item => item.id === cur.id);
                if (s) s.title = newTitle;
            }

            this._exitSessionEditMode();
            this._showToast('Đã lưu thay đổi ✓', 'success');

            // Refresh sessions list in background without closing detail viewer
            try {
                const sessions = await invoke('list_sessions');
                this._cachedSessions = sessions || [];
            } catch {}
        } catch (err) {
            this._showToast(`Lỗi lưu thay đổi: ${err}`, 'error');
        }
    }

    _formatSeconds(sec) {
        if (!sec) return '';
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m`;
        return `${sec}s`;
    }

    async _exportCurrentSession(format) {
        const cur = this._currentViewedSession;
        if (!cur || cur.isLegacy) {
            this._showToast('Cannot export legacy sessions', 'error');
            return;
        }
        try {
            const cmd = format === 'srt' ? 'export_session_srt' : 'export_session_txt';
            const text = await invoke(cmd, { id: cur.id });
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${cur.id}.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this._showToast(`Exported .${format}`, 'success');
        } catch (err) {
            this._showToast(`Export failed: ${err}`, 'error');
        }
    }

    async _checkForUpdates() {
        updater.onUpdateFound = (version, notes) => {
            this._onUpdateAvailable(version, notes);
        };
        updater.onError = (err) => {
            const statusText = document.getElementById('update-status-text');
            if (statusText) statusText.textContent = `⚠️ Check failed: ${err.message || err}`;
        };
        updater.onCheckComplete = (hasUpdate) => {
            const checkBtn = document.getElementById('btn-check-update');
            if (checkBtn) checkBtn.classList.remove('spinning');
            if (!hasUpdate && !this._pendingUpdateVersion) {
                const statusText = document.getElementById('update-status-text');
                if (statusText) statusText.textContent = '✅ App is up to date';
            }
        };
        // Delay check slightly so app finishes loading first
        setTimeout(() => {
            const statusText = document.getElementById('update-status-text');
            const checkBtn = document.getElementById('btn-check-update');
            if (statusText) statusText.textContent = 'Checking for updates...';
            if (checkBtn) checkBtn.classList.add('spinning');
            updater.checkForUpdates();
        }, 3000);
    }

    _triggerUpdateCheck() {
        const statusText = document.getElementById('update-status-text');
        const checkBtn = document.getElementById('btn-check-update');
        if (statusText) statusText.textContent = 'Checking for updates...';
        if (checkBtn) checkBtn.classList.add('spinning');
        updater.checkForUpdates();
    }

    _onUpdateAvailable(version, notes) {
        this._pendingUpdateVersion = version;

        // 1. Show badge on settings gear
        const badge = document.getElementById('settings-badge');
        if (badge) badge.style.display = '';

        // 2. Update About tab status
        const statusEl = document.getElementById('update-status');
        const statusText = document.getElementById('update-status-text');
        const actions = document.getElementById('update-actions');
        if (statusEl) statusEl.classList.add('has-update');
        if (statusText) statusText.textContent = `🆕 Update v${version} available`;
        if (actions) actions.style.display = '';

        // 3. Show subtle hint on main screen
        const existing = document.querySelector('.update-hint');
        if (existing) existing.remove();
        const hint = document.createElement('div');
        hint.className = 'update-hint';
        hint.textContent = `Update v${version} available — go to Settings → About`;
        hint.addEventListener('click', () => {
            this._showView('settings');
            this._showSettingsScreen('tab-about');
            hint.remove();
        });
        document.body.appendChild(hint);

        // Auto-hide hint after 8 seconds
        setTimeout(() => { if (hint.parentNode) hint.remove(); }, 8000);
    }

    _initAboutTab() {
        // GitHub links
        document.getElementById('link-github')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__?.opener?.openUrl('https://github.com/phuc-nt/my-translator');
        });
        document.getElementById('link-issues')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__?.opener?.openUrl('https://github.com/phuc-nt/my-translator/issues');
        });

        // Check for Updates button
        document.getElementById('btn-check-update')?.addEventListener('click', () => {
            this._triggerUpdateCheck();
        });

        // Download & Install button
        document.getElementById('btn-do-update')?.addEventListener('click', async () => {
            const btnText = document.getElementById('update-btn-text');
            const btn = document.getElementById('btn-do-update');
            const progressDiv = document.getElementById('update-progress');
            const progressFill = document.getElementById('update-progress-fill');
            const progressPct = document.getElementById('update-progress-pct');

            if (btn) btn.disabled = true;
            if (btnText) btnText.textContent = 'Downloading...';
            if (progressDiv) progressDiv.style.display = '';

            try {
                await updater.downloadAndInstall((downloaded, total) => {
                    if (total > 0) {
                        const pct = Math.round((downloaded / total) * 100);
                        if (progressFill) progressFill.style.width = `${pct}%`;
                        if (progressPct) progressPct.textContent = `${pct}%`;
                        if (btnText) btnText.textContent = `Downloading ${pct}%...`;
                    }
                });
                // Install succeeded! Try to restart
                if (btnText) btnText.textContent = 'Restarting...';
                try {
                    const relaunch = window.__TAURI__?.process?.relaunch;
                    if (relaunch) {
                        await relaunch();
                    } else {
                        const invoke = window.__TAURI__?.core?.invoke;
                        if (invoke) await invoke('plugin:process|restart');
                    }
                } catch (restartErr) {
                    // Restart failed (e.g. process plugin not available) but update IS installed
                    console.warn('[Update] Restart failed, update is installed:', restartErr);
                    if (btnText) btnText.textContent = '✅ Updated! Restart app';
                    const statusText = document.getElementById('update-status-text');
                    if (statusText) statusText.textContent = '✅ Update installed — close and reopen the app';
                    if (btn) btn.disabled = true;
                }
            } catch (err) {
                const errMsg = err?.message || String(err);
                if (btnText) btnText.textContent = 'Failed — try again';
                const statusText = document.getElementById('update-status-text');
                if (statusText) statusText.textContent = `⚠️ Install error: ${errMsg}`;
                if (btn) btn.disabled = false;
                console.error('[Update]', err);
            }
        });
    }

    _updateAudioMeter(pcmData) {
        if (!pcmData || pcmData.length === 0) {
            this._renderAudioMeter(0);
            return;
        }
        const bytes = pcmData instanceof Uint8Array ? pcmData : new Uint8Array(pcmData);
        const { percent } = this._calculateAudioRms(bytes);
        this._renderAudioMeter(percent);
        if (percent > 6) {
            this._resetInactivityTimer();
        }
    }

    _calculateAudioRms(pcmBytes) {
        if (!pcmBytes || pcmBytes.length === 0) return { rms: 0, percent: 0 };
        const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
        const numSamples = Math.floor(pcmBytes.length / 2);
        if (numSamples === 0) return { rms: 0, percent: 0 };

        let sumSquares = 0;
        for (let i = 0; i < numSamples; i++) {
            const s = view.getInt16(i * 2, true) / 32768.0;
            sumSquares += s * s;
        }
        const rms = Math.sqrt(sumSquares / numSamples);
        const percent = Math.min(100, Math.round(Math.pow(rms * 5.0, 0.65) * 100));
        return { rms, percent };
    }

    _renderAudioMeter(percent) {
        // 1. Update mini status-bar VU meter
        const liveMeter = document.getElementById('live-audio-meter');
        if (liveMeter) {
            const bars = liveMeter.querySelectorAll('.vu-bar');
            if (bars && bars.length === 4) {
                bars[0].style.height = percent > 3 ? `${Math.min(100, Math.max(20, percent * 1.5))}%` : '20%';
                bars[1].style.height = percent > 20 ? `${Math.min(100, Math.max(20, percent * 1.2))}%` : '20%';
                bars[2].style.height = percent > 45 ? `${Math.min(100, Math.max(20, percent * 1.0))}%` : '20%';
                bars[3].style.height = percent > 70 ? `${Math.min(100, Math.max(20, percent * 0.9))}%` : '20%';

                bars.forEach(b => {
                    if (percent <= 3) b.style.background = 'rgba(255,255,255,0.2)';
                    else if (b.dataset.origBg) b.style.background = b.dataset.origBg;
                });
            }
        }

        // 2. Update Settings Audio Test Bar
        const testBar = document.getElementById('audio-test-meter-bar');
        const testText = document.getElementById('audio-test-level-text');
        if (testBar) {
            testBar.style.width = `${percent}%`;
        }
        if (testText) {
            testText.textContent = `${percent}%`;
        }
    }

    async _playPcmAudio(pcmBytes, sampleRate = 16000) {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx({ sampleRate });
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }
            const numSamples = Math.floor(pcmBytes.length / 2);
            if (numSamples === 0) return;
            const samples = new Float32Array(numSamples);
            const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, numSamples * 2);
            for (let i = 0; i < numSamples; i++) {
                samples[i] = view.getInt16(i * 2, true) / 32768.0;
            }
            const buffer = ctx.createBuffer(1, numSamples, sampleRate);
            buffer.getChannelData(0).set(samples);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start(0);
        } catch (e) {
            console.error('[Audio Playback] failed:', e);
        }
    }

    async _startAudioRecordingTest() {
        if (this._isAudioTesting) return;
        
        // If live monitoring is active, stop it first
        if (this._isLiveMonitoring) {
            this._isLiveMonitoring = false;
            const btnLive = document.getElementById('btn-test-mic-live');
            if (btnLive) btnLive.innerHTML = '🔊 Bật Live Monitor';
            try { await invoke('stop_capture'); } catch {}
            await new Promise(r => setTimeout(r, 100));
        }

        this._isAudioTesting = true;

        const statusEl = document.getElementById('audio-test-status');
        const btnRec = document.getElementById('btn-test-mic-rec');
        const originalBtnText = '🎙️ Ghi âm thử 3s & Nghe lại';

        if (statusEl) statusEl.textContent = '⏳ Đang khởi động...';
        if (btnRec) {
            btnRec.disabled = true;
            btnRec.innerHTML = '🔴 Đang thu (3s)...';
        }

        const recordedChunks = [];
        let totalRms = 0;
        let batchCount = 0;
        const testChannel = new window.__TAURI__.core.Channel();

        testChannel.onmessage = (pcmData) => {
            if (!this._isAudioTesting) return;
            const bytes = new Uint8Array(pcmData);
            recordedChunks.push(bytes);
            const level = this._calculateAudioRms(bytes);
            totalRms += level.rms;
            batchCount++;
            this._renderAudioMeter(level.percent);
        };

        const testSource = this.currentSource || document.querySelector('input[name="audio-source"]:checked')?.value || 'system';

        try {
            await invoke('start_capture', {
                source: testSource,
                channel: testChannel,
            });

            // Countdown 3 seconds
            for (let sec = 3; sec > 0; sec--) {
                if (statusEl) statusEl.textContent = `🔴 Thu từ ${testSource}: ${sec}s...`;
                if (btnRec) btnRec.innerHTML = `🔴 Đang thu (${sec}s)...`;
                await new Promise(r => setTimeout(r, 1000));
            }

            // Stop capture
            await invoke('stop_capture');
            this._renderAudioMeter(0);

            // Merge recorded chunks
            const totalBytes = recordedChunks.reduce((acc, c) => acc + c.length, 0);
            const merged = new Uint8Array(totalBytes);
            let offset = 0;
            for (const chunk of recordedChunks) {
                merged.set(chunk, offset);
                offset += chunk.length;
            }

            const avgRms = batchCount > 0 ? (totalRms / batchCount) : 0;
            console.log(`[Audio Test] Recorded ${totalBytes} bytes, avg RMS: ${avgRms.toFixed(5)}`);

            if (totalBytes === 0 || avgRms < 0.001) {
                if (statusEl) {
                    statusEl.innerHTML = '<span style="color: #ef4444; font-weight:600;">⚠️ Im lặng (Không có tiếng)</span>';
                }
                this._showToast('Không thu được âm thanh! Hãy kiểm tra microphone hoặc quyền Screen Recording trong macOS.', 'error');
            } else {
                if (statusEl) {
                    statusEl.innerHTML = '<span style="color: #10b981; font-weight:600;">🔊 Đang phát lại âm thanh vừa thu...</span>';
                }
                if (btnRec) btnRec.innerHTML = '🔊 Đang phát lại...';
                await this._playPcmAudio(merged, 16000);

                const playDuration = Math.round(totalBytes / 32000 * 1000);
                setTimeout(() => {
                    if (statusEl) {
                        statusEl.innerHTML = '<span style="color: #10b981; font-weight:600;">✅ Thu âm tốt (RMS: ' + (avgRms * 100).toFixed(1) + '%)</span>';
                    }
                    if (btnRec) {
                        btnRec.disabled = false;
                        btnRec.innerHTML = originalBtnText;
                    }
                    this._isAudioTesting = false;
                }, playDuration + 500);
                return;
            }
        } catch (err) {
            console.error('[Audio Test] Error:', err);
            if (statusEl) statusEl.textContent = `❌ Lỗi: ${err}`;
            this._showToast(`Lỗi thu âm: ${err}`, 'error');
            try { await invoke('stop_capture'); } catch {}
        } finally {
            if (btnRec && !btnRec.innerHTML.includes('phát lại')) {
                btnRec.disabled = false;
                btnRec.innerHTML = originalBtnText;
                this._isAudioTesting = false;
            }
        }
    }

    async _toggleAudioLiveMonitor() {
        const btnLive = document.getElementById('btn-test-mic-live');
        const statusEl = document.getElementById('audio-test-status');

        if (this._isLiveMonitoring) {
            this._isLiveMonitoring = false;
            try { await invoke('stop_capture'); } catch {}
            this._renderAudioMeter(0);
            if (btnLive) btnLive.innerHTML = '🔊 Bật Live Monitor';
            if (statusEl) statusEl.textContent = 'Đã dừng Monitor';
            return;
        }

        this._isLiveMonitoring = true;
        if (btnLive) btnLive.innerHTML = '⏹ Dừng Monitor';
        if (statusEl) statusEl.textContent = '🟢 Đang đo âm lượng Live...';

        const testChannel = new window.__TAURI__.core.Channel();
        testChannel.onmessage = (pcmData) => {
            if (!this._isLiveMonitoring) return;
            const bytes = new Uint8Array(pcmData);
            const level = this._calculateAudioRms(bytes);
            this._renderAudioMeter(level.percent);
            if (statusEl) {
                const db = level.rms > 0 ? (20 * Math.log10(level.rms)).toFixed(1) : '-inf';
                statusEl.innerHTML = `🟢 Live: <b style="color:${level.percent > 5 ? '#10b981' : '#94a3b8'}">${level.percent}%</b> (${db} dB)`;
            }
        };

        const testSource = this.currentSource || document.querySelector('input[name="audio-source"]:checked')?.value || 'system';
        try {
            await invoke('start_capture', {
                source: testSource,
                channel: testChannel,
            });
        } catch (err) {
            this._isLiveMonitoring = false;
            if (btnLive) btnLive.innerHTML = '🔊 Bật Live Monitor';
            if (statusEl) statusEl.textContent = `❌ Lỗi: ${err}`;
            this._showToast(`Lỗi Monitor: ${err}`, 'error');
        }
    }

    // ─── Take Note Module ──────────────────────────────────────

    _initNotesModule() {
        const btnToggleNotes = document.getElementById('btn-toggle-notes');
        const btnClose = document.getElementById('btn-note-close');
        const btnCopy = document.getElementById('btn-note-copy');
        const editorContainer = document.getElementById('live-note-editor');
        const fmtButtons = document.querySelectorAll('.note-fmt-btn');

        btnToggleNotes?.addEventListener('click', () => {
            this._toggleNotesDrawer();
        });

        btnClose?.addEventListener('click', () => {
            this._toggleNotesDrawer(false);
        });

        btnCopy?.addEventListener('click', async () => {
            const text = this._liveNotesEditor?.getContent();
            if (text && text.trim()) {
                await navigator.clipboard.writeText(text);
                this._showToast('📋 Đã copy ghi chú vào clipboard', 'success');
            } else {
                this._showToast('Ghi chú đang trống', 'info');
            }
        });

        fmtButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const fmt = btn.dataset.fmt;
                if (fmt && this._liveNotesEditor) {
                    this._liveNotesEditor.applyFormat(fmt);
                }
            });
        });

        if (editorContainer && !this._liveNotesEditor) {
            this._liveNotesEditor = new NotesEditor();
            this._liveNotesEditor.mount(editorContainer, {
                initialContent: sessionStore.notes || '',
                placeholderText: 'Nhập ghi chú cuộc họp dạng Markdown (Live Preview)...',
                onChange: (val) => {
                    sessionStore.notes = val;
                },
            });
        }

        this._initNotesResize();
        this._initNoteMetadataSelectors();
        this._toggleNotesDrawer(true, false);
    }

    async _initNoteMetadataSelectors() {
        const selectCust = document.getElementById('select-note-customer');
        const selectProj = document.getElementById('select-note-project');
        const selectCat = document.getElementById('select-note-category');
        const inputTags = document.getElementById('input-note-tags');

        if (!this._projectRegistry) {
            await this._loadProjectRegistry();
        } else {
            this._populateNoteMetadataSelectors();
        }

        selectCust?.addEventListener('change', () => {
            const custId = selectCust.value || null;
            sessionStore.customerId = custId;
            sessionStore._mutations++;
            this._updateNoteProjectsDropdown(custId);
            const curProjId = selectProj?.value || null;
            const regProjs = (this._projectRegistry?.projects || []).filter(p => p.status === 'active');
            if (curProjId) {
                const projObj = regProjs.find(p => p.id === curProjId);
                if (custId && projObj && projObj.customer_id && projObj.customer_id !== custId) {
                    selectProj.value = '';
                    sessionStore.projectId = null;
                }
            }
        });

        selectProj?.addEventListener('change', () => {
            const projId = selectProj.value || null;
            sessionStore.projectId = projId;
            sessionStore._mutations++;
            if (projId && selectCust) {
                const regProjs = (this._projectRegistry?.projects || []).filter(p => p.status === 'active');
                const foundProj = regProjs.find(p => p.id === projId);
                if (foundProj && foundProj.customer_id) {
                    selectCust.value = foundProj.customer_id;
                    sessionStore.customerId = foundProj.customer_id;
                    this._updateNoteProjectsDropdown(foundProj.customer_id, projId);
                }
            }
        });

        selectCat?.addEventListener('change', () => {
            sessionStore.category = selectCat.value || null;
            sessionStore._mutations++;
        });

        inputTags?.addEventListener('input', () => {
            const raw = inputTags.value || '';
            sessionStore.tags = raw
                .split(',')
                .map(t => t.trim().replace(/^#/, '').toLowerCase())
                .filter(Boolean);
            sessionStore._mutations++;
        });
    }

    _populateNoteMetadataSelectors() {
        const selectCust = document.getElementById('select-note-customer');
        const selectProj = document.getElementById('select-note-project');
        const selectCat = document.getElementById('select-note-category');
        const datalistTags = document.getElementById('datalist-note-tags');
        const inputTags = document.getElementById('input-note-tags');

        const reg = this._projectRegistry || { customers: [], projects: [], categories: [], tags: [] };
        const activeCustomers = (reg.customers || []).filter(c => c.status === 'active');

        if (selectCust) {
            const curVal = selectCust.value || sessionStore.customerId || '';
            let html = '<option value="">🏢 Khách hàng...</option>';
            for (const c of activeCustomers) {
                html += `<option value="${this._escAttr(c.id)}">🏢 ${this._esc(c.name)}</option>`;
            }
            selectCust.innerHTML = html;
            selectCust.value = curVal;
        }

        this._updateNoteProjectsDropdown(selectCust?.value || sessionStore.customerId, sessionStore.projectId);

        if (selectCat) {
            const curCat = selectCat.value || sessionStore.category || '';
            let catHtml = '<option value="">📅 Phân loại...</option>';
            for (const c of (reg.categories || [])) {
                catHtml += `<option value="${this._escAttr(c.name)}">📅 ${this._esc(c.name)}</option>`;
            }
            selectCat.innerHTML = catHtml;
            selectCat.value = curCat;
        }

        if (datalistTags) {
            let tagHtml = '';
            for (const t of (reg.tags || [])) {
                tagHtml += `<option value="#${this._escAttr(t.name)}">`;
            }
            datalistTags.innerHTML = tagHtml;
        }

        if (inputTags && !inputTags.value && sessionStore.tags && sessionStore.tags.length > 0) {
            inputTags.value = sessionStore.tags.map(t => `#${t}`).join(', ');
        }
    }

    _updateNoteProjectsDropdown(selectedCustomerId = null, targetProjectId = null) {
        const selectProj = document.getElementById('select-note-project');
        if (!selectProj) return;
        const reg = this._projectRegistry || { projects: [] };
        const activeProjects = (reg.projects || []).filter(p => p.status === 'active');
        const filteredProjs = selectedCustomerId
            ? activeProjects.filter(p => p.customer_id === selectedCustomerId)
            : activeProjects;

        let projHtml = '<option value="">📁 Dự án...</option>';
        for (const p of filteredProjs) {
            projHtml += `<option value="${this._escAttr(p.id)}">📁 ${this._esc(p.name)}</option>`;
        }
        selectProj.innerHTML = projHtml;

        const desired = targetProjectId || sessionStore.projectId || selectProj.value;
        if (desired && filteredProjs.some(p => p.id === desired)) {
            selectProj.value = desired;
        } else {
            selectProj.value = '';
        }
    }

    _resetNoteMetadataSelectors() {
        const selectCust = document.getElementById('select-note-customer');
        const selectProj = document.getElementById('select-note-project');
        const selectCat = document.getElementById('select-note-category');
        const inputTags = document.getElementById('input-note-tags');

        if (selectCust) selectCust.value = '';
        if (selectProj) {
            this._updateNoteProjectsDropdown(null);
            selectProj.value = '';
        }
        if (selectCat) selectCat.value = '';
        if (inputTags) inputTags.value = '';
    }

    _initNotesResize() {
        const drawer = document.getElementById('live-notes-drawer');
        const resizer = document.getElementById('live-notes-resizer');
        const container = document.getElementById('transcript-container');
        if (!drawer || !resizer) return;

        const DEFAULT_HEIGHT = 190;
        const MIN_HEIGHT = 100;

        // Restore saved height if available
        const savedHeight = parseInt(localStorage.getItem('live_notes_height'), 10);
        if (!isNaN(savedHeight) && savedHeight >= MIN_HEIGHT) {
            drawer.style.height = `${savedHeight}px`;
        }

        let isDragging = false;
        let startY = 0;
        let startHeight = 0;

        const onPointerDown = (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            isDragging = true;
            startY = e.clientY;
            startHeight = drawer.getBoundingClientRect().height;

            try {
                resizer.setPointerCapture(e.pointerId);
            } catch (_) {}

            drawer.classList.add('is-resizing');
            document.body.classList.add('resizing-vertical');
            e.preventDefault();
        };

        const onPointerMove = (e) => {
            if (!isDragging) return;
            const deltaY = startY - e.clientY; // moving up increases drawer height
            const containerHeight = container ? container.clientHeight : window.innerHeight;
            const maxHeight = Math.max(MIN_HEIGHT + 50, containerHeight - 60);
            const targetHeight = Math.round(Math.min(Math.max(startHeight + deltaY, MIN_HEIGHT), maxHeight));

            drawer.style.height = `${targetHeight}px`;
        };

        const onPointerUp = (e) => {
            if (!isDragging) return;
            isDragging = false;

            try {
                resizer.releasePointerCapture(e.pointerId);
            } catch (_) {}

            drawer.classList.remove('is-resizing');
            document.body.classList.remove('resizing-vertical');

            const currentHeight = Math.round(drawer.getBoundingClientRect().height);
            if (currentHeight >= MIN_HEIGHT) {
                localStorage.setItem('live_notes_height', String(currentHeight));
            }
        };

        resizer.addEventListener('pointerdown', onPointerDown);
        resizer.addEventListener('pointermove', onPointerMove);
        resizer.addEventListener('pointerup', onPointerUp);
        resizer.addEventListener('pointercancel', onPointerUp);

        // Double-click to reset to default height
        resizer.addEventListener('dblclick', () => {
            drawer.style.height = `${DEFAULT_HEIGHT}px`;
            localStorage.setItem('live_notes_height', String(DEFAULT_HEIGHT));
        });
    }

    _getNoteTemplate() {
        const now = new Date();
        const p = n => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}/${p(now.getMonth() + 1)}/${p(now.getDate())}`;
        const timeStr = `${p(now.getHours())}:${p(now.getMinutes())}`;
        const s = settingsManager.get();
        const raw = (s.template_notes && s.template_notes.trim()) ? s.template_notes : DEFAULT_TEMPLATE_NOTES;
        return raw
            .replace(/\{\{date\}\}/g, dateStr)
            .replace(/\{\{time\}\}/g, timeStr)
            .replace(/\{\{title\}\}/g, sessionStore.sessionTitle || 'MTG Title');
    }

    _toggleNotesDrawer(forceOpen = null, shouldFocus = true) {
        const drawer = document.getElementById('live-notes-drawer');
        const btnToggleNotes = document.getElementById('btn-toggle-notes');
        if (!drawer) return;

        const isOpen = drawer.style.display !== 'none';
        const shouldOpen = forceOpen !== null ? forceOpen : !isOpen;

        if (shouldOpen) {
            drawer.style.display = 'flex';
            if (btnToggleNotes) btnToggleNotes.classList.add('active');

            const container = document.getElementById('transcript-container');
            if (container && drawer.style.height) {
                const currentHeight = parseInt(drawer.style.height, 10);
                const maxHeight = Math.max(150, container.clientHeight - 60);
                if (currentHeight > maxHeight) {
                    drawer.style.height = `${maxHeight}px`;
                }
            }

            if (this._liveNotesEditor) {
                const content = this._liveNotesEditor.getContent();
                if (!content || !content.trim()) {
                    const template = this._getNoteTemplate();
                    this._liveNotesEditor.setContent(template);
                    sessionStore.notes = template;
                }
                if (shouldFocus) {
                    this._liveNotesEditor.focus();
                }
            }
        } else {
            drawer.style.display = 'none';
            if (btnToggleNotes) btnToggleNotes.classList.remove('active');
        }
    }

    _formatInlineMarkdown(text) {
        if (!text) return '';
        return text
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/\*(.*?)\*/g, '<i>$1</i>')
            .replace(/~~(.*?)~~/g, '<del>$1</del>')
            .replace(/`(.*?)`/g, '<code>$1</code>');
    }

    _showToast(message, type = 'success') {
        // Remove existing toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const msgSpan = document.createElement('span');
        msgSpan.className = 'toast-msg';
        msgSpan.textContent = message;
        toast.appendChild(msgSpan);

        // Only add copy button for error/bug messages
        if (type === 'error') {
            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'toast-copy-btn';
            copyBtn.title = 'Copy thông báo lỗi';
            const copySvg = `<svg class="icon-copy-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
            const checkSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#85e0a3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            copyBtn.innerHTML = copySvg;
            copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(String(message));
                    } else {
                        const ta = document.createElement('textarea');
                        ta.value = String(message);
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        ta.remove();
                    }
                    copyBtn.innerHTML = checkSvg;
                    setTimeout(() => {
                        if (copyBtn) copyBtn.innerHTML = copySvg;
                    }, 1500);
                } catch (err) {
                    console.error('Failed to copy toast message:', err);
                }
            });
            toast.appendChild(copyBtn);
        }

        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto-remove (longer for errors so user has ample time to copy)
        const duration = type === 'error' ? 8000 : 3500;
        let removeTimer = setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);

        toast.addEventListener('mouseenter', () => {
            clearTimeout(removeTimer);
        });
        toast.addEventListener('mouseleave', () => {
            removeTimer = setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        });
    }
}

// Initialize on DOM ready or immediately if already loaded
function startApp() {
    const app = new App();
    window.__app = app;
    app.init().catch(err => {
        console.error('[App] Init failed:', err);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}
