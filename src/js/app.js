/**
 * App — main application controller
 * Wires together: settings, UI, Soniox client, and audio capture
 */

import { settingsManager } from './settings.js';
import { TranscriptUI } from './ui.js';
import { sonioxClient } from './soniox.js';
import { updater } from './updater.js';
import { sessionStore } from './session-store.js';
import { QWEN_LANGS } from './qwen-langs.js';
import {
    initShell, setActivity, getActivity, setLiveBadge, bindMenu, initWindowModes,
} from './ui-shell.js';

const { invoke, Channel } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

class App {
    constructor() {
        this.isRunning = false;
        this.isStarting = false; // Guard against re-entry
        this.currentSource = 'system'; // 'system' | 'microphone' | 'both'
        this.currentViewMode = 'dual'; // 'dual' | 'original' | 'translation'
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
        this._hasUnsavedMeetingData = false;
        this._inactivityTimer = null;
        this._isStopConfirmationOpen = false;
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
            sourceLang: initSettings.source_language || 'auto',
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

        console.log('🌐 My Translator v0.9.1 initialized');
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
            document.getElementById('sessions-list-panel').style.display = '';
            document.getElementById('session-viewer').style.display = 'none';
            this._showSessions();
        });

        // Copy session content
        const btnSessionCopy = document.getElementById('btn-session-copy');
        btnSessionCopy?.addEventListener('click', async () => {
            const content = document.getElementById('session-viewer-content')?.textContent || '';
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

        // TTS play session
        document.getElementById('btn-session-tts-play')?.addEventListener('click', () => {
            const cur = this._currentViewedSession;
            if (cur) this._playSessionTTS(cur.id, cur.isLegacy);
        });

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

        // Edit session title (modal/prompt)
        document.getElementById('btn-session-edit-title')?.addEventListener('click', async () => {
            const cur = this._currentViewedSession;
            if (!cur || cur.isLegacy) {
                this._showToast('Cannot rename legacy sessions', 'error');
                return;
            }
            const titleEl = document.getElementById('session-viewer-title');
            const oldTitle = titleEl?.textContent || '';
            await this._renameSession(cur.id, oldTitle);
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
            const chosenTitle = await this._promptConfirmStop();
            if (!chosenTitle) return;

            try {
                await this.stopSession(chosenTitle);
            } catch (err) {
                console.error('[App] Stop session error:', err);
                this._showToast(`Lỗi kết thúc: ${err}`, 'error');
            }
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

        // Open saved transcripts folder (kept for Finder access)
        document.getElementById('btn-open-transcripts')?.addEventListener('click', async () => {
            try {
                await invoke('open_transcript_dir');
            } catch (err) {
                this._showToast('Failed to open folder: ' + err, 'error');
            }
        });

        // Initialize Horizontal Take Note Drawer
        this._initNotesModule();

        // Settings form elements
        this._bindSettingsForm();

        // Manual drag for settings view
        // data-tauri-drag-region doesn't work well when parent contains buttons
        // Using Tauri's recommended appWindow.startDragging() approach instead
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
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('btn-toggle-openai-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-openai-key');
            if (input) input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('btn-toggle-gemini-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-gemini-key');
            if (input) input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('select-gemini-model')?.addEventListener('change', (e) => {
            const customSection = document.getElementById('section-gemini-custom-model');
            if (customSection) {
                customSection.style.display = e.target.value === 'custom' ? 'block' : 'none';
            }
            this._saveSettingsFromForm().then(() => settingsManager.save(settingsManager.get()));
        });

        document.getElementById('input-gemini-custom-model')?.addEventListener('change', () => {
            this._saveSettingsFromForm().then(() => settingsManager.save(settingsManager.get()));
        });

        document.getElementById('link-openai')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__.opener.openUrl('https://platform.openai.com/api-keys');
        });

        document.getElementById('link-gemini')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__.opener.openUrl('https://aistudio.google.com/app/apikey');
        });

        // Inline key format validation + engine-option enable/disable
        const sonioxInput = document.getElementById('input-api-key');
        const openaiInput = document.getElementById('input-openai-key');
        const geminiInput = document.getElementById('input-gemini-key');
        sonioxInput?.addEventListener('input', () => this._refreshKeyStatus());
        openaiInput?.addEventListener('input', () => this._refreshKeyStatus());
        geminiInput?.addEventListener('input', () => this._refreshKeyStatus());

        // Test-connection buttons
        document.getElementById('btn-test-soniox')?.addEventListener('click', () => this._testConnection('soniox'));
        document.getElementById('btn-test-openai')?.addEventListener('click', () => this._testConnection('openai'));

        // Translation mode toggle
        document.getElementById('select-translation-mode')?.addEventListener('change', (e) => {
            this._updateModeUI(e.target.value);
        });

        // Inactivity timeout change
        document.getElementById('select-inactivity-timeout')?.addEventListener('change', (e) => {
            const val = parseInt(e.target.value, 10);
            settingsManager.save({ inactivity_timeout_min: isNaN(val) ? 10 : val });
            this._resetInactivityTimer();
        });

        // Welcome-screen engine cards: pick a class (standard / openai),
        // remember it, hide the picker, sync the rest of the UI.
        document.querySelectorAll('#engine-picker .engine-card').forEach(card => {
            card.addEventListener('click', () => {
                this._selectEngineClass(card.dataset.engineClass);
                this._hideEnginePicker();
            });
        });

        // Toolbar engine pill: same switch, available any time the session isn't
        // running. While running, the pill is locked (visual feedback only).
        document.querySelectorAll('#engine-pill .engine-pill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.isRunning || this.isStarting) {
                    this._showToast('Pause the session before switching engine', 'error');
                    return;
                }
                this._selectEngineClass(btn.dataset.engineClass);
            });
        });

        // Translation type toggle (one-way / two-way)
        document.getElementById('select-translation-type')?.addEventListener('change', (e) => {
            this._updateTranslationTypeUI(e.target.value);
        });

        // Soniox link
        document.getElementById('link-soniox').addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__.opener.openUrl('https://console.soniox.com/signup/');
        });

        // ElevenLabs link
        document.getElementById('link-elevenlabs')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__.opener.openUrl('https://elevenlabs.io/app/sign-up');
        });

        // Save settings — both top and bottom buttons
        document.getElementById('btn-save-settings').addEventListener('click', () => {
            this._saveSettingsFromForm();
        });
        document.getElementById('btn-save-settings-top')?.addEventListener('click', () => {
            this._saveSettingsFromForm();
        });

        // Slider live updates
        document.getElementById('range-opacity').addEventListener('input', (e) => {
            document.getElementById('opacity-value').textContent = `${e.target.value}%`;
        });

        document.getElementById('range-font-size').addEventListener('input', (e) => {
            document.getElementById('font-size-value').textContent = `${e.target.value}px`;
        });

        document.getElementById('range-max-lines').addEventListener('input', (e) => {
            document.getElementById('max-lines-value').textContent = e.target.value;
        });

        document.getElementById('range-endpoint-delay')?.addEventListener('input', (e) => {
            document.getElementById('endpoint-delay-value').textContent = `${(e.target.value / 1000).toFixed(1)}s`;
        });

        // Toggle ElevenLabs API key visibility
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
        sonioxClient.onOriginal = (text, speaker, language) => {
            this.transcriptUI.addOriginal(text, speaker, language);
            this._sonioxOriginalQueue.push(text);
        };

        sonioxClient.onTranslation = (text) => {
            this.transcriptUI.addTranslation(text);
            const src = this._sonioxOriginalQueue.shift() || '';
            sessionStore.addSegment(src, text);
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
                        const chosenTitle = await this._promptConfirmStop();
                        if (!chosenTitle) return;
                        try {
                            await this.stopSession(chosenTitle);
                        } catch (err) {
                            console.error('[App] Keyboard stop session error:', err);
                            this._showToast(`Lỗi kết thúc: ${err}`, 'error');
                        }
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
            this._showSettingsScreen('settings-home'); // wizard always opens at home
        }
        // Returning to the overlay while in Read mode: a voice/provider may have
        // changed in Settings — refresh both the capability hint AND the voice
        // quick-pick (else it keeps the old provider's options + settings key).
        if (view === 'overlay' && getActivity() === 'read') {
            this._populateReadQuickPick();
            this._showReadCapabilityHint();
        }
    }

    /** Wizard: show one settings screen (home or a detail) inside the settings view. */
    _showSettingsScreen(id) {
        if (!id || !document.getElementById(id)) id = 'settings-home';
        document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        if (id === 'settings-home') this._updateSettingsCards();
        document.querySelector('.settings-body')?.scrollTo(0, 0);
    }

    /** Wizard: refresh the home cards' status subtitles from current settings. */
    _updateSettingsCards() {
        const s = settingsManager.get();
        const mode = s.translation_mode || 'soniox';
        const engineNames = { soniox: 'Soniox', local: 'Local MLX', openai: 'OpenAI Realtime', gemini: 'Google Gemini Live', qwen: 'Qwen LiveTranslate' };
        const keyField = { soniox: 'soniox_api_key', openai: 'openai_api_key', gemini: 'gemini_api_key', qwen: 'qwen_api_key' };
        const hasKey = mode === 'local' || !!(s[keyField[mode]] || '').trim();
        const subT = document.getElementById('card-translation-sub');
        if (subT) {
            subT.textContent =
                `${engineNames[mode] || mode} · ${s.source_language || 'auto'} → ${s.target_language || 'vi'}` +
                (hasKey ? '' : ' · ⚠️ chưa có API key');
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
        document.getElementById('select-source-lang').value = s.source_language || 'auto';
        document.getElementById('select-target-lang').value = s.target_language || 'vi';
        document.getElementById('select-translation-mode').value = s.translation_mode || 'gemini';
        const inactSelect = document.getElementById('select-inactivity-timeout');
        if (inactSelect) inactSelect.value = String(s.inactivity_timeout_min ?? 10);
        this._updateModeUI(s.translation_mode || 'gemini');
        this._refreshKeyStatus();

        // Translation type (one-way / two-way)
        const translationType = s.translation_type || 'one_way';
        document.getElementById('select-translation-type').value = translationType;

        // Two-way language selects
        document.getElementById('select-lang-a').value = s.language_a || 'ja';
        document.getElementById('select-lang-b').value = s.language_b || 'vi';

        // Strict language detection
        document.getElementById('check-strict-lang').checked = s.language_hints_strict || false;

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

    async _saveSettingsFromForm() {
        const settings = {
            soniox_api_key: document.getElementById('input-api-key').value.trim(),
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
            source_language: document.getElementById('select-source-lang').value,
            target_language: document.getElementById('select-target-lang').value,
            translation_mode: document.getElementById('select-translation-mode').value,
            inactivity_timeout_min: parseInt(document.getElementById('select-inactivity-timeout')?.value || '10', 10),
            translation_type: document.getElementById('select-translation-type')?.value || 'one_way',
            language_a: document.getElementById('select-lang-a')?.value || 'ja',
            language_b: document.getElementById('select-lang-b')?.value || 'vi',
            language_hints_strict: document.getElementById('check-strict-lang')?.checked || false,
            endpoint_delay: parseInt(document.getElementById('range-endpoint-delay')?.value || 3000),
            audio_source: document.querySelector('input[name="audio-source"]:checked')?.value || 'system',
            overlay_opacity: parseInt(document.getElementById('range-opacity').value) / 100,
            font_size: parseInt(document.getElementById('range-font-size').value),
            max_lines: parseInt(document.getElementById('range-max-lines').value),
            show_original: document.getElementById('check-show-original').checked,
            custom_context: null,
        };

        // Parse custom context (rich format)
        // General key-value pairs
        const generalPairs = [];
        document.querySelectorAll('#context-general-list .general-row').forEach(row => {
            const key = row.querySelector('.general-key')?.value.trim();
            const value = row.querySelector('.general-value')?.value.trim();
            if (key && value) generalPairs.push({ key, value });
        });

        // Transcription terms
        const termsRaw = document.getElementById('input-context-terms')?.value.trim() || '';
        const terms = termsRaw ? termsRaw.split('\n').map(t => t.trim()).filter(t => t) : [];

        // Background text
        const contextText = document.getElementById('input-context-text')?.value.trim() || '';

        // Translation terms
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
            this._showToast('Settings saved', 'success');
            this._showView('overlay');
        } catch (err) {
            this._showToast(`Failed to save: ${err}`, 'error');
        }
    }

    // ─── Apply Settings ────────────────────────────────────

    _applySettings(settings) {
        // Update overlay opacity
        const overlayView = document.getElementById('overlay-view');
        overlayView.style.opacity = settings.overlay_opacity || 0.85;

        // Live status row: language pair display
        const langEl = document.getElementById('live-lang');
        if (langEl) {
            langEl.textContent = `${settings.source_language || 'auto'} → ${settings.target_language || 'vi'}`;
        }

        // Update transcript UI
        const viewMode = settings.view_mode || 'dual';
        if (this.transcriptUI) {
            this.transcriptUI.configure({
                maxLines: settings.max_lines || 5,
                showOriginal: settings.show_original !== false,
                fontSize: settings.font_size || 16,
                viewMode: viewMode,
            });
        }
        this._setViewMode(viewMode);

        // Update quick language and timing in toolbar
        const quickSrc = document.getElementById('quick-select-source-lang');
        const quickTgt = document.getElementById('quick-select-target-lang');
        if (quickSrc) quickSrc.value = settings.source_language || 'auto';
        if (quickTgt) quickTgt.value = settings.target_language || 'vi';

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
                this.sessionSourceLang = settings.source_language || 'auto';
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

        // Clear transcript only if nothing is showing
        if (!this.transcriptUI.hasContent()) {
            this.transcriptUI.showListening();
        } else {
            this.transcriptUI.clearProvisional();
        }

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
        this.openAiClient.onFinal = (original, translation) => {
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
                    if (this.isRunning) this._startOpenAiMode(settingsManager.get());
                }, 1000);
            }
        };

        try {
            await this.openAiClient.connect({
                apiKey: settings.openai_api_key,
                sourceLanguage: settings.source_language || 'auto',
                targetLanguage: settings.target_language,
                audioOutput: false,
            }, this.openAiOutputQueue);
        } catch (err) {
            this._showToast(`OpenAI connect failed: ${err}`, 'error');
            await this.pause();
            return;
        }

        try {
            let audioBatchCount = 0;
            const channel = new window.__TAURI__.core.Channel();
            channel.onmessage = (pcmData) => {
                audioBatchCount++;
                if (audioBatchCount <= 3 || audioBatchCount % 50 === 0) {
                    console.log(`[OpenAI capture] batch #${audioBatchCount}, size:`, pcmData?.length || 0);
                }
                const bytes = new Uint8Array(pcmData);
                this.openAiClient.sendAudio(bytes.buffer);
                this._updateAudioMeter(bytes);
            };
            console.log('[OpenAI] Starting audio capture, source:', this.currentSource);
            const recordPath = await this._getSessionRecordPath();
            await invoke('start_capture', {
                source: this.currentSource,
                channel,
                recordPath,
            });
            console.log('[OpenAI] start_capture invoked OK');
        } catch (err) {
            console.error('Failed to start audio capture:', err);
            this._showToast(`Audio error: ${err}`, 'error');
            await this.pause();
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
        this.geminiClient.onSegment = (sourceText, translatedText) => {
            if (sourceText) {
                this.transcriptUI.addOriginal(sourceText, null, null);
            }
            this.transcriptUI.addTranslation(translatedText);
            sessionStore.addSegment(sourceText || '', translatedText || '');
            this.transcriptUI.clearProvisional();
        };
        this.geminiClient.onError = (code, msg) => {
            console.error('[Gemini Realtime]', code, msg);
            if (code === 'connect_failed' && String(msg).includes('API key')) {
                this._showToast(`Gemini: ${msg || code}`, 'error');
                this._updateStatus('error');
                this.pause();
            } else if (this.isRunning) {
                console.log('[Gemini Realtime] Connection error, auto-reconnecting...');
                setTimeout(() => {
                    if (this.isRunning) this._startGeminiMode(settingsManager.get());
                }, 1000);
            }
        };
        this.geminiClient.onClosed = (reason) => {
            console.warn('[Gemini Realtime] closed:', reason);
            if (this.isRunning) {
                console.log('[Gemini Realtime] Session closed, auto-reconnecting...');
                setTimeout(() => {
                    if (this.isRunning) this._startGeminiMode(settingsManager.get());
                }, 500);
            }
        };

        try {
            await this.geminiClient.connect({
                apiKey: settings.gemini_api_key,
                sourceLanguage: settings.source_language || 'auto',
                targetLanguage: settings.target_language || 'vi',
                model: settings.gemini_model || 'models/gemini-3.5-transcribe-live',
            });
        } catch (err) {
            this._showToast(`Gemini connect failed: ${err}`, 'error');
            await this.pause();
            return;
        }

        try {
            let audioBatchCount = 0;
            const channel = new window.__TAURI__.core.Channel();
            channel.onmessage = (pcmData) => {
                audioBatchCount++;
                if (audioBatchCount <= 3 || audioBatchCount % 50 === 0) {
                    console.log(`[Gemini capture] batch #${audioBatchCount}, size:`, pcmData?.length || 0);
                }
                const bytes = new Uint8Array(pcmData);
                this.geminiClient.sendAudio(bytes.buffer);
                this._updateAudioMeter(bytes);
            };
            console.log('[Gemini] Starting audio capture, source:', this.currentSource);
            const recordPath = await this._getSessionRecordPath();
            await invoke('start_capture', {
                source: this.currentSource,
                channel,
                recordPath,
            });
            console.log('[Gemini] start_capture invoked OK');
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
                    if (this.isRunning) this._startQwenMode(settingsManager.get());
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

        try {
            let audioBatchCount = 0;
            const channel = new window.__TAURI__.core.Channel();
            channel.onmessage = (pcmData) => {
                audioBatchCount++;
                if (audioBatchCount <= 3 || audioBatchCount % 50 === 0) {
                    console.log(`[Qwen capture] batch #${audioBatchCount}, size:`, pcmData?.length || 0);
                }
                const bytes = new Uint8Array(pcmData);
                this.qwenClient.sendAudio(bytes.buffer);
                this._updateAudioMeter(bytes);
            };
            console.log('[Qwen] Starting audio capture, source:', this.currentSource);
            const recordPath = await this._getSessionRecordPath();
            await invoke('start_capture', {
                source: this.currentSource,
                channel,
                recordPath,
            });
            console.log('[Qwen] start_capture invoked OK');
        } catch (err) {
            console.error('Failed to start audio capture:', err);
            this._showToast(`Audio error: ${err}`, 'error');
            await this.pause();
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
            console.log('[App] Audio capture started successfully');
        } catch (err) {
            console.error('Failed to start audio capture:', err);
            this._showToast(`Audio error: ${err}`, 'error');
            await this.pause();
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

    // Pause: stop capture and persist the current chunk, but keep the session
    // file open. The next Start appends a new chunk to the same file. Finalizing
    // into a new file is stopSession()'s job.
    async pause() {
        this.isRunning = false;
        this.isPaused = true;
        this._updateStartButton();
        this._setEnginePillLocked(false);
        this._clearInactivityTimer();

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
            try { await invoke('stop_capture'); } catch {}
            this._updateStatus('disconnected');
        } else if (this.translationMode === 'qwen') {
            if (this.qwenClient) {
                try { await this.qwenClient.disconnect(); } catch {}
                this.qwenClient = null;
            }
            try { await invoke('stop_capture'); } catch {}
            this._updateStatus('disconnected');
        } else {
            // Disconnect Soniox
            sonioxClient.disconnect();
        }

        // Keep transcript visible — don't clear
        this.transcriptUI.clearProvisional();

        // Drain any leftover Soniox originals that didn't get paired
        if (this._sonioxOriginalQueue) this._sonioxOriginalQueue.length = 0;

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

    // Stop: pause (if running), finalize the current session file, then start a
    // Stop: pause (if running), finalize the current session file with custom title,
    // then start a fresh session so the next Start writes a new file pair.
    async _promptConfirmStop() {
        const modal = document.getElementById('modal-confirm-stop');
        const input = document.getElementById('input-stop-meeting-title');
        const defaultTitle = sessionStore.title || this._formatDefaultMeetingTitle(this.sessionStartTime || this.recordingStartTime);

        if (!modal) {
            const entered = prompt('Nhập tên cuộc họp để kết thúc & lưu:', defaultTitle);
            return entered !== null ? (entered.trim() || defaultTitle) : null;
        }

        if (input) {
            input.value = defaultTitle;
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
                modal.style.display = 'none';
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
                this._isStopConfirmationOpen = false;
                document.getElementById('btn-agree-confirm-stop')?.removeEventListener('click', onConfirm);
                document.getElementById('btn-cancel-confirm-stop')?.removeEventListener('click', onCancel);
                document.getElementById('btn-close-confirm-stop')?.removeEventListener('click', onCancel);
                input?.removeEventListener('keydown', onKeyDown);
                window.removeEventListener('keydown', onKeyDown);
            };

            document.getElementById('btn-agree-confirm-stop')?.addEventListener('click', onConfirm);
            document.getElementById('btn-cancel-confirm-stop')?.addEventListener('click', onCancel);
            document.getElementById('btn-close-confirm-stop')?.addEventListener('click', onCancel);
            input?.addEventListener('keydown', onKeyDown);
            window.addEventListener('keydown', onKeyDown);
        });
    }

    async stopSession(chosenTitle = null) {
        if (this.isRunning) await this.pause();

        const hadData = !sessionStore.isEmpty() && sessionStore.totalSegmentCount() > 0;

        if (chosenTitle) {
            sessionStore.title = chosenTitle;
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
        this._clearInactivityTimer();

        // Clear transcript UI back to fresh empty placeholder screen
        if (this.transcriptUI) {
            this.transcriptUI.clear();
            this.transcriptUI.showPlaceholder();
        }
        this._updateStatus('idle');

        // Clear live note textarea and close note drawer
        const noteTextarea = document.getElementById('live-note-textarea');
        if (noteTextarea) noteTextarea.value = '';
        this._toggleNotesDrawer(false);

        const settings = settingsManager.get();
        sessionStore.init({
            engine: settings.translation_mode || 'gemini',
            sourceLang: settings.source_language || 'auto',
            targetLang: settings.target_language || 'vi',
        });
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

    _updateStartButton() {
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
        const sourceLang = this.sessionSourceLang || document.getElementById('select-source-lang')?.value || 'auto';
        const targetLang = this.sessionTargetLang || document.getElementById('select-target-lang')?.value || 'vi';
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

    async _handleQuickSourceLangChange(srcLang) {
        const s = settingsManager.get();
        s.source_language = srcLang;
        const selectSource = document.getElementById('select-source-lang');
        if (selectSource) selectSource.value = srcLang;
        await settingsManager.save(s);
        this._showToast(`Ngôn ngữ gốc: ${srcLang.toUpperCase()}`, 'info');
        if (this.isRunning && this.translationMode === 'gemini') {
            this._startGeminiMode(s);
        }
    }

    async _handleQuickTargetLangChange(tgtLang) {
        const s = settingsManager.get();
        s.target_language = tgtLang;
        const selectTarget = document.getElementById('select-target-lang');
        if (selectTarget) selectTarget.value = tgtLang;
        await settingsManager.save(s);
        if (this.geminiClient && this.geminiClient.isConnected) {
            await this.geminiClient.setTargetLanguage(tgtLang);
        }
        this._showToast(`Ngôn ngữ dịch: ${tgtLang.toUpperCase()}`, 'info');
    }

    async _handleQuickLangSwap() {
        const s = settingsManager.get();
        const curSrc = s.source_language || 'ja';
        const curTgt = s.target_language || 'vi';

        const newSrc = curTgt;
        const newTgt = curSrc === 'auto' ? 'en' : curSrc;

        s.source_language = newSrc;
        s.target_language = newTgt;

        const quickSrc = document.getElementById('quick-select-source-lang');
        const quickTgt = document.getElementById('quick-select-target-lang');
        const selectSrc = document.getElementById('select-source-lang');
        const selectTgt = document.getElementById('select-target-lang');

        if (quickSrc) quickSrc.value = newSrc;
        if (quickTgt) quickTgt.value = newTgt;
        if (selectSrc) selectSrc.value = newSrc;
        if (selectTgt) selectTgt.value = newTgt;

        await settingsManager.save(s);
        if (this.geminiClient && this.geminiClient.isConnected) {
            await this.geminiClient.setTargetLanguage(newTgt);
        }
        this._showToast(`Đã đổi chiều: ${newSrc.toUpperCase()} → ${newTgt.toUpperCase()}`, 'success');

        if (this.isRunning && this.translationMode === 'gemini') {
            this._startGeminiMode(s);
        }
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
        this._showToast(timing === 'realtime' ? '⚡ Kiểu dịch: Nghe real time' : '⏳ Kiểu dịch: Nghe dứt câu', 'info');
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
        const selectAllChk = document.getElementById('chk-select-all-sessions');
        const totalItems = document.querySelectorAll('.session-item-chk').length;

        if (countEl) countEl.textContent = `${count} đã chọn`;
        if (batchBtn) batchBtn.disabled = count === 0;
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
        return `${y}${m}${day} ${hh}:${mm}`;
    }

    async _playSessionTTS(id, isLegacy = false) {
        try {
            const btn = document.getElementById('btn-session-tts-play');

            // Stop any currently playing session audio
            if (this._sessionAudioElement) {
                this._sessionAudioElement.pause();
                this._sessionAudioElement = null;
                const wasPlayingSame = this._sessionAudioId === id;
                this._sessionAudioId = null;
                if (btn) btn.innerHTML = '🔊 Nghe lại';
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
            if (btn) btn.innerHTML = '⏹ Dừng nghe';

            const audio = new Audio(audioDataUrl);
            this._sessionAudioElement = audio;
            this._sessionAudioId = id;
            audio.onended = () => {
                this._sessionAudioElement = null;
                this._sessionAudioId = null;
                if (btn) btn.innerHTML = '🔊 Nghe lại';
            };
            audio.onerror = () => {
                const mediaError = audio.error;
                console.error('[App] Audio playback error:', mediaError?.code, mediaError?.message);
                this._showToast(`Lỗi khi phát file ghi âm${mediaError?.message ? `: ${mediaError.message}` : ''}`, 'error');
                this._sessionAudioElement = null;
                this._sessionAudioId = null;
                if (btn) btn.innerHTML = '🔊 Nghe lại';
            };
            await audio.play();
        } catch (err) {
            this._showToast(`Lỗi phát âm thanh: ${err}`, 'error');
            const btn = document.getElementById('btn-session-tts-play');
            if (btn) btn.innerHTML = '🔊 Nghe lại';
        }
    }

    async _showSessions(query) {
        if (this._sessionAudioElement) {
            this._sessionAudioElement.pause();
            this._sessionAudioElement = null;
            this._sessionAudioId = null;
        }
        const listEl = document.getElementById('sessions-list');
        const listPanel = document.getElementById('sessions-list-panel');
        const viewer = document.getElementById('session-viewer');

        if (listPanel) listPanel.style.display = '';
        if (viewer) viewer.style.display = 'none';
        if (!listEl) return;

        listEl.innerHTML = '<div class="sessions-loading">Loading...</div>';

        try {
            const cmd = query && query.trim() ? 'search_sessions' : 'list_sessions';
            const args = query && query.trim() ? { query: query.trim() } : {};
            const sessions = await invoke(cmd, args);
            if (sessions.length === 0) {
                listEl.innerHTML = '<div class="sessions-empty">Chưa có meeting log nào được lưu.</div>';
                this._updateBatchSelectionUI();
                return;
            }

            // Ensure newest first sorting
            sessions.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

            listEl.innerHTML = sessions.map(s => this._renderSessionItem(s)).join('');
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

            // TTS play
            listEl.querySelectorAll('.session-btn-action.play-tts').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    const legacy = btn.dataset.legacy === '1';
                    this._playSessionTTS(id, legacy);
                });
            });

            // Rename
            listEl.querySelectorAll('.session-btn-action.rename').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    const oldTitle = btn.dataset.title;
                    this._renameSession(id, oldTitle);
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
                            this._showToast('Đã sao chép nội dung cuộc họp ✓', 'success');
                            const orig = btn.innerHTML;
                            btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#85e0a3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                            setTimeout(() => { if (btn) btn.innerHTML = orig; }, 1500);
                        }
                    } catch (err) {
                        this._showToast(`Lỗi sao chép: ${err}`, 'error');
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
                    if (e.target.closest('.session-delete-btn, .session-btn-action, .session-item-chk')) return;
                    const id = item.dataset.id;
                    const legacy = item.dataset.legacy === '1';
                    this._openSession(id, legacy);
                });
            });
        } catch (err) {
            listEl.innerHTML = `<div class="sessions-empty">Error: ${err}</div>`;
        }
    }

    _renderSessionItem(s) {
        const title = this._esc(s.title || 'Cuộc họp chưa đặt tên');
        const created = this._esc(s.created_at || '').slice(0, 16);
        const duration = this._formatSeconds(s.duration_sec || 0);
        const engine = s.engine || 'unknown';
        const engineBadge = s.has_legacy_only
            ? `<span class="session-badge badge-legacy">legacy</span>`
            : `<span class="session-badge badge-engine">${this._esc(engine)}</span>`;
        const langPair = s.source_lang && s.target_lang
            ? `<span class="session-badge">${this._esc(s.source_lang)} → ${this._esc(s.target_lang)}</span>`
            : '';
        const segCount = s.segment_count > 0 ? `<span class="session-meta-dim">${s.segment_count} câu</span>` : '';
        const isChecked = this._selectedSessionIds.has(s.id);

        return `<div class="session-item" data-id="${this._escAttr(s.id)}" data-legacy="${s.has_legacy_only ? '1' : '0'}">
            <div class="session-item-row1">
                <input type="checkbox" class="session-item-chk" data-id="${this._escAttr(s.id)}" ${isChecked ? 'checked' : ''} />
                <span class="session-item-title">${title}</span>
                <div class="session-actions-inline">
                    <button type="button" class="session-btn-action copy-session" data-id="${this._escAttr(s.id)}" data-legacy="${s.has_legacy_only ? '1' : '0'}" title="Sao chép nội dung cuộc họp">
                        <svg class="icon-copy-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                    <button type="button" class="session-btn-action play-tts" data-id="${this._escAttr(s.id)}" data-legacy="${s.has_legacy_only ? '1' : '0'}" title="Nghe lại cuộc họp này">🔊</button>
                    <button type="button" class="session-btn-action rename" data-id="${this._escAttr(s.id)}" data-title="${this._escAttr(s.title || '')}" title="Đổi tên">✏️</button>
                    <button type="button" class="session-delete-btn" data-id="${this._escAttr(s.id)}" title="Xóa">×</button>
                </div>
            </div>
            <div class="session-item-row2">
                ${engineBadge}
                ${langPair}
                <span class="session-meta-dim">${created}</span>
                ${duration ? `<span class="session-meta-dim">${duration}</span>` : ''}
                ${segCount}
            </div>
        </div>`;
    }

    async _openSession(id, isLegacy = false) {
        if (this._sessionAudioElement) {
            this._sessionAudioElement.pause();
            this._sessionAudioElement = null;
            this._sessionAudioId = null;
        }
        const playBtn = document.getElementById('btn-session-tts-play');
        if (playBtn) playBtn.innerHTML = '🔊 Nghe lại';

        const listPanel = document.getElementById('sessions-list-panel');
        const viewer = document.getElementById('session-viewer');
        const title = document.getElementById('session-viewer-title');
        const content = document.getElementById('session-viewer-content');

        if (listPanel) listPanel.style.display = 'none';
        if (viewer) viewer.style.display = '';
        if (title) title.textContent = id;
        if (content) content.textContent = 'Loading...';
        this._currentViewedSession = { id, isLegacy };

        try {
            if (isLegacy) {
                const text = await invoke('read_legacy_session', { id });
                if (content) content.textContent = text;
                if (title) title.textContent = id;
            } else {
                const result = await invoke('read_session', { id });
                if (content) content.textContent = result.md;
                if (title) title.textContent = result.json.title || id;
            }
        } catch (err) {
            if (content) content.textContent = `Error loading session: ${err}`;
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
        const btnPreview = document.getElementById('btn-note-toggle-preview');
        const noteTextarea = document.getElementById('live-note-textarea');
        const fmtButtons = document.querySelectorAll('.note-fmt-btn');

        this._isNotePreviewActive = false;

        btnToggleNotes?.addEventListener('click', () => {
            this._toggleNotesDrawer();
        });

        btnClose?.addEventListener('click', () => {
            this._toggleNotesDrawer(false);
        });

        btnCopy?.addEventListener('click', async () => {
            const text = noteTextarea?.value;
            if (text && text.trim()) {
                await navigator.clipboard.writeText(text);
                this._showToast('📋 Đã copy ghi chú vào clipboard', 'success');
            } else {
                this._showToast('Ghi chú đang trống', 'info');
            }
        });

        btnPreview?.addEventListener('click', () => {
            this._toggleNotePreview();
        });

        fmtButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const fmt = btn.dataset.fmt;
                if (fmt) this._applyNoteFormat(fmt);
            });
        });

        noteTextarea?.addEventListener('input', (e) => {
            const val = e.target.value;
            sessionStore.notes = val;
            if (this._isNotePreviewActive) {
                this._renderNotePreview();
            }
        });
    }

    _getNoteTemplate() {
        const now = new Date();
        const p = n => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}/${p(now.getMonth() + 1)}/${p(now.getDate())}`;
        return `# MTG Title\n## Thông tin cuộc họp\n- Người tham gia: \n- Ngày tháng: ${dateStr}\n\n## Nội dung cuộc họp \n\n\n## TODO\n- \n`;
    }

    _toggleNotesDrawer(forceOpen = null) {
        const drawer = document.getElementById('live-notes-drawer');
        const textarea = document.getElementById('live-note-textarea');
        const btnToggleNotes = document.getElementById('btn-toggle-notes');
        if (!drawer || !textarea) return;

        const isOpen = drawer.style.display !== 'none';
        const shouldOpen = forceOpen !== null ? forceOpen : !isOpen;

        if (shouldOpen) {
            drawer.style.display = 'flex';
            if (btnToggleNotes) btnToggleNotes.classList.add('active');
            if (!textarea.value.trim()) {
                textarea.value = this._getNoteTemplate();
                sessionStore.notes = textarea.value;
            }
            if (this._isNotePreviewActive) {
                this._renderNotePreview();
            }
            textarea.focus();
        } else {
            drawer.style.display = 'none';
            if (btnToggleNotes) btnToggleNotes.classList.remove('active');
        }
    }

    _toggleNotePreview() {
        const textarea = document.getElementById('live-note-textarea');
        const preview = document.getElementById('live-note-preview');
        const btnPreview = document.getElementById('btn-note-toggle-preview');
        if (!textarea || !preview || !btnPreview) return;

        this._isNotePreviewActive = !this._isNotePreviewActive;

        if (this._isNotePreviewActive) {
            this._renderNotePreview();
            textarea.style.display = 'none';
            preview.style.display = 'block';
            btnPreview.classList.add('active');
            btnPreview.textContent = '✏️ Edit';
        } else {
            textarea.style.display = 'block';
            preview.style.display = 'none';
            btnPreview.classList.remove('active');
            btnPreview.textContent = '👁️ Preview';
            textarea.focus();
        }
    }

    _applyNoteFormat(fmt) {
        const textarea = document.getElementById('live-note-textarea');
        if (!textarea) return;

        // If preview is active, switch back to edit mode first
        if (this._isNotePreviewActive) {
            this._toggleNotePreview();
        }

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selected = text.substring(start, end);

        let replacement = '';
        let newCursorPos = end;

        switch (fmt) {
            case 'bold':
                replacement = `**${selected || 'in đậm'}**`;
                newCursorPos = selected ? start + replacement.length : start + 2;
                break;
            case 'italic':
                replacement = `*${selected || 'in nghiêng'}*`;
                newCursorPos = selected ? start + replacement.length : start + 1;
                break;
            case 'h1':
                replacement = selected ? `# ${selected}` : '# ';
                newCursorPos = start + replacement.length;
                break;
            case 'h2':
                replacement = selected ? `## ${selected}` : '## ';
                newCursorPos = start + replacement.length;
                break;
            case 'list':
                replacement = selected ? `- ${selected}` : '- ';
                newCursorPos = start + replacement.length;
                break;
            case 'todo':
                replacement = selected ? `- [ ] ${selected}` : '- [ ] ';
                newCursorPos = start + replacement.length;
                break;
            case 'code':
                replacement = `\`${selected || 'code'}\``;
                newCursorPos = selected ? start + replacement.length : start + 1;
                break;
        }

        textarea.setRangeText(replacement, start, end, 'end');
        textarea.selectionStart = newCursorPos;
        textarea.selectionEnd = newCursorPos;
        sessionStore.notes = textarea.value;
        textarea.focus();
    }

    _renderNotePreview() {
        const textarea = document.getElementById('live-note-textarea');
        const preview = document.getElementById('live-note-preview');
        if (!textarea || !preview) return;

        const raw = textarea.value;
        const lines = raw.split('\n');
        const htmlLines = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Checkboxes: - [ ] or - [x]
            const todoMatch = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
            if (todoMatch) {
                const checked = todoMatch[2].toLowerCase() === 'x';
                const text = this._esc(todoMatch[3]);
                htmlLines.push(`<div class="todo-item ${checked ? 'done' : ''}" data-line="${i}"><input type="checkbox" ${checked ? 'checked' : ''} data-line="${i}"> <span>${this._formatInlineMarkdown(text)}</span></div>`);
                continue;
            }

            // Headers
            if (line.startsWith('# ')) {
                htmlLines.push(`<h1>${this._formatInlineMarkdown(this._esc(line.slice(2)))}</h1>`);
            } else if (line.startsWith('## ')) {
                htmlLines.push(`<h2>${this._formatInlineMarkdown(this._esc(line.slice(3)))}</h2>`);
            } else if (line.startsWith('### ')) {
                htmlLines.push(`<h3>${this._formatInlineMarkdown(this._esc(line.slice(4)))}</h3>`);
            } else if (line.match(/^(\s*)-\s+(.*)$/)) {
                const m = line.match(/^(\s*)-\s+(.*)$/);
                htmlLines.push(`<ul><li>${this._formatInlineMarkdown(this._esc(m[2]))}</li></ul>`);
            } else if (!line.trim()) {
                htmlLines.push('<div style="height:6px;"></div>');
            } else {
                htmlLines.push(`<p style="margin:2px 0;">${this._formatInlineMarkdown(this._esc(line))}</p>`);
            }
        }

        preview.innerHTML = htmlLines.join('');

        // Wire checkbox clicking to toggle in underlying markdown
        preview.querySelectorAll('input[type="checkbox"]').forEach(chk => {
            chk.addEventListener('change', (e) => {
                const lineIdx = parseInt(e.target.dataset.line);
                const currentLines = textarea.value.split('\n');
                if (currentLines[lineIdx]) {
                    if (e.target.checked) {
                        currentLines[lineIdx] = currentLines[lineIdx].replace(/-\s+\[ \]/, '- [x]');
                    } else {
                        currentLines[lineIdx] = currentLines[lineIdx].replace(/-\s+\[[xX]\]/, '- [ ]');
                    }
                    textarea.value = currentLines.join('\n');
                    sessionStore.notes = textarea.value;
                    this._renderNotePreview();
                }
            });
        });
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

        // Add copy button for all toasts (especially useful for error messages)
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'toast-copy-btn';
        copyBtn.title = 'Sao chép thông báo';
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
