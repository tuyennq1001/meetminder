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

const { invoke, Channel, convertFileSrc } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const LANGUAGE_DISPLAY = {
    auto: ['🌐', 'Auto'], en: ['🇬🇧', 'English'], ja: ['🇯🇵', '日本語'],
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

const PRESET_TEMPLATE_TECH_JA = `# 💻 技術・アーキテクチャ検討議事録 (Technical Review)

### 📌 基本情報
- **議題**: {{title}}
- **日時**: {{date}} (所要時間: 約 {{duration}} 分)
- **参加エンジニア**: {{participants}}

---

### 🔍 1. 課題と背景 (Problem Statement)
- **技術的課題・背景**:
  - (パフォーマンス問題、新アーキテクチャ要件、リファクタリング等の課題)
- **達成目標**:
  - (要件、SLA、制約条件)

---

### ⚙️ 2. 検討案と比較 (Options & Trade-offs)
- **案A**: (メリット・デメリット・コスト)
- **案B**: (メリット・デメリット・コスト)

---

### 🎯 3. 採択された技術方針・決定事項 (Technical Decisions)
- **決定方針**:
  - (採択理由と留意点)
- **潜在的リスクと対策**:
  - (懸念点およびバックアッププラン)

---

### 🛠 4. 実装タスク・次のステップ (Implementation Tasks)
| No | タスク (Task) | 担当者 | 期日 | 備考 / PR |
|:---|:---|:---|:---|:---|
| 1 | ... | ... | ... | ... |
`;

const PRESET_TEMPLATE_TECH_VI = `# 💻 BIÊN BẢN HỌP KỸ THUẬT & KIẾN TRÚC (TECHNICAL SYNC)

### 📌 THÔNG TIN CHUNG
- **Chủ đề kỹ thuật**: {{title}}
- **Thời gian**: {{date}} (Thời lượng: ~{{duration}} phút)
- **Kỹ sư / Thành viên tham gia**: {{participants}}

---

### 🔍 1. VẤN ĐỀ & BỐI CẢNH KỸ THUẬT (PROBLEM STATEMENT)
- **Vấn đề / Thách thức kỹ thuật đặt ra**:
  - (Mô tả lỗi, nút thắt hiệu năng, yêu cầu kiến trúc mới hoặc công nghệ cần tích hợp)
- **Mục tiêu kỹ thuật cần đạt**:
  - (SLAs, hiệu năng, độ chịu tải, thời gian hoàn thành)

---

### ⚙️ 2. CÁC PHƯƠNG ÁN CÂN NHẮC (OPTIONS & TRADE-OFFS)
- **Phương án A**: (Ưu điểm & Nhược điểm)
- **Phương án B**: (Ưu điểm & Nhược điểm)

---

### 🎯 3. QUYẾT ĐỊNH KIẾN TRÚC & CÔNG NGHỆ (ARCHITECTURAL DECISIONS)
- **Giải pháp được chọn chốt**:
  - (Lý do chọn phương án và các lưu ý triển khai)
- **Rủi ro kỹ thuật & Giải pháp dự phòng**:
  - (Các rủi ro tiềm ẩn và kế hoạch xử lý)

---

### 🛠 4. KẾ HOẠCH TRIỂN KHAI (IMPLEMENTATION TASKS)
| STT | Nhiệm vụ kỹ thuật (Tech Task) | Người phụ trách | Hạn chót | Nhánh / PR / Repo |
|:---|:---|:---|:---|:---|
| 1 | ... | ... | ... | ... |
`;

const PRESET_TEMPLATE_1ON1_JA = `# 👥 1on1ミーティング・面談記録 (1-on-1 Notes)

### 📌 基本情報
- **面談名**: {{title}}
- **日時**: {{date}} (所要時間: 約 {{duration}} 分)
- **参加者**: {{participants}}

---

### 📊 1. 業務進捗と成果 (Status & Achievements)
- **良かった点・達成できた成果**:
  - (直近のポジティブな成果、貢献)
- **現在の業務状況**:
  - (進行中プロジェクトの状況)

---

### 💬 2. フィードバックと対話 (Feedback & Discussion)
- **メンバーからの共有・所感**:
  - (業務のやりがい、関心事、キャリアに関する希望など)
- **マネージャーからのフィードバック・期待**:
  - (評価点、今後の成長に向けたアドバイス)

---

### 🚧 3. 課題・ボトルネックと支援 (Blockers & Support)
- (チーム連携、ツール、リソースなどの課題と必要なサポート)

---

### 🎯 4. 次回までのアクションプラン (Action Items)
- [ ] **アクション 1**: (期日・コミット内容)
- [ ] **アクション 2**: (期日・コミット内容)
`;

const PRESET_TEMPLATE_1ON1_VI = `# 👥 BIÊN BẢN TRAO ĐỔI 1-ON-1 & ĐÁNH GIÁ

### 📌 THÔNG TIN BUỔI GẶP
- **Chủ đề**: {{title}}
- **Thời gian**: {{date}} (Thời lượng: ~{{duration}} phút)
- **Thành viên tham gia**: {{participants}}

---

### 📊 1. CẬP NHẬT TÌNH HÌNH & TIẾN ĐỘ HIỆN TẠI (STATUS UPDATE)
- **Những kết quả tốt đạt được**:
  - (Những việc đã hoàn thành tốt, điểm sáng trong kỳ)
- **Tình trạng công việc đang chạy**:
  - (Tiến độ thực tế so với kế hoạch)

---

### 💬 2. PHẢN HỒI & TÂM TƯ HAI CHIỀU (FEEDBACK & INSIGHTS)
- **Chia sẻ từ nhân viên / thành viên**:
  - (Tâm tư, nguyện vọng, mức độ hài lòng hoặc khó khăn trong công việc)
- **Phản hồi & Định hướng từ Quản lý / Mentor**:
  - (Góp ý mang tính xây dựng, định hướng phát triển)

---

### 🚧 3. KHÓ KHĂN & ĐỀ XUẤT HỖ TRỢ (BLOCKERS & SUPPORT NEEDED)
- (Các rào cản về công cụ, quy trình, phối hợp team cần tháo gỡ)

---

### 🎯 4. MỤC TIÊU TIẾP THEO & HÀNH ĐỘNG CỤ THỂ (NEXT GOALS & ACTIONS)
- [ ] **Mục tiêu 1**: (Thời hạn & cam kết)
- [ ] **Mục tiêu 2**: (Thời hạn & cam kết)
`;

const PRESET_TEMPLATE_PERSONAL_JA = `# 👤 個人メモ・学習まとめ (Personal Notes)

### 📌 基本情報
- **テーマ**: {{title}}
- **日時**: {{date}} (所要時間: 約 {{duration}} 分)
- **相手 / ソース**: {{participants}}

---

### 💡 1. 主な学びと気づき (Key Takeaways)
- (会話やセッションから得られた最も重要・印象的なインサイト)

---

### 📝 2. 内容の要約 (Detailed Summary)
- **トピック 1**:
  - (具体的なポイントや議論の内容)
- **トピック 2**:
  - (具体的なポイントや議論の内容)

---

### 🎯 3. 自分自身のアクションプラン (My Next Steps)
- [ ] ...
- [ ] ...

---

### 💭 4. 所感・振り返り (Reflections)
- (個人的な考察、感想、さらに深掘りしたい疑問など)
`;

const PRESET_TEMPLATE_PERSONAL_VI = `# 👤 GHI CHÉP & TÓM TẮT CÁ NHÂN

### 📌 THÔNG TIN
- **Chủ đề**: {{title}}
- **Thời gian**: {{date}} (Thời lượng: ~{{duration}} phút)
- **Người trao đổi / Nguồn**: {{participants}}

---

### 💡 1. ĐIỂM MẤU CHỐT & BÀI HỌC RÚT RA (KEY TAKEAWAYS)
- (Những ý tưởng hay, góc nhìn mới, bài học sâu sắc nhất từ cuộc trò chuyện/buổi học)

---

### 📝 2. TÓM TẮT NỘI DUNG TRAO ĐỔI (DETAILED SUMMARY)
- **Chủ đề 1**:
  - (Chi tiết các điểm đáng chú ý)
- **Chủ đề 2**:
  - (Chi tiết các điểm đáng chú ý)

---

### 🎯 3. VIỆC CẦN LÀM CHO BẢN THÂN (MY ACTION ITEMS)
- [ ] ...
- [ ] ...

---

### 💭 4. CẢM NHẬN & SUY NGẪM THÊM (REFLECTIONS)
- (Ghi chú suy nghĩ cá nhân, cảm xúc hoặc câu hỏi cần đào sâu thêm)
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
        this.currentSessionId = null;
        this.sessionTimer = null;
        this.totalDurationSec = 0;
        this.lastFinalText = '';
        this.lastInterimText = '';
        this._lastFinalizedId = 0;
        this._lastFinalizedOriginal = '';
        this._lastFinalizedTranslation = '';
        this.isPaused = false;
        this._pausedAt = null;
        this._totalPausedMs = 0;
        this._lastLiveNoteContent = '';
        this._isMinutesEditing = false;
        this._isNotesEditing = false;
        this._hasUnsavedMeetingData = false;
        this._inactivityTimer = null;
        this._captureHealthTimer = null;
        this._isStopConfirmationOpen = false;
        this._isStoppingSession = false;
        this._pendingUpdateVersion = null;
        this._updateReadyVersion = null;
        this._isDownloadingUpdate = false;
        this._pendingUpdateReadyBanner = null;
        this._updateEscapeBound = false;
        this._projectRegistry = null;
        this._activeLogsScopeFilter = 'work'; // 'work' | 'personal' | 'all'
        this._activeCustomerFilter = [];
        this._activeProjectFilter = [];
        this._activeCategoryFilter = [];
        this._activeTagFilter = [];
        this._projScopeFilter = '';
        this._activeMinutesGeneration = null;
        this._lastCompletedMinutes = null;
        this._minutesDismissTimeout = null;
        this._suppressNextShowSessions = false;
        this._sessionNameQuery = '';
        // Logs table sort: default newest first, restore the user's last choice.
        this._sessionSort = { field: 'created_at', dir: 'desc' };
        try {
            const savedSort = JSON.parse(localStorage.getItem('meet_minder_logs_sort') || 'null');
            const validFields = ['created_at', 'title', 'customer_name', 'project_name', 'category', 'tags'];
            if (savedSort && validFields.includes(savedSort.field) && ['asc', 'desc'].includes(savedSort.dir)) {
                this._sessionSort = { field: savedSort.field, dir: savedSort.dir };
            }
        } catch (_) {
            // keep default sort
        }
        this._sessionPage = 1;
        try {
            const savedPageSize = Number(localStorage.getItem('meet_minder_logs_page_size'));
            this._sessionPageSize = [10, 20, 50].includes(savedPageSize) ? savedPageSize : 10;
        } catch (_) {
            this._sessionPageSize = 10;
        }
        this._custSort = { field: 'name', dir: 'asc' };
        this._projSort = { field: 'name', dir: 'asc' };
        this._catSort = { field: 'name', dir: 'asc' };
        this._tagSort = { field: 'name', dir: 'asc' };
        this._custFilters = { name: '', description: '', status: '' };
        this._projFilters = { name: '', scope: '', customer_id: '', description: '', status: '' };
        this._catFilters = { name: '', scope: '', template_id: '' };
        this._tagFilters = { name: '', scope: '' };
        this._projScopeFilter = 'work';
        this._catScopeFilter = 'work';
        this._tagScopeFilter = 'work';
        this._templateEditor = null;
        this._activeTemplatesMainTab = 'minutes';
        this._activeTemplatePreset = 'standard';
        this._activeTemplateLang = 'vi';
        this._templateDrafts = {};
        this._notesTemplateEditor = null;
        this._selectedSessionIds = new Set();
        this._cachedSessions = [];
        this._filteredSessions = [];
        this._geminiReconnectTimer = null;
        this._liveEngineRestart = Promise.resolve();
        this._liveEngineGeneration = 0;
        this._quickLanguageUpdate = Promise.resolve();
        this._liveDurationTimer = null;
        this._geminiDiscoveredModels = null;
        this._geminiModelsCacheTime = 0;
        this._geminiBlacklistedModels = new Set();
        this._networkAlertBannerVisible = false;
        this._hadNetworkIssueInSession = false;
        this._isLocalMlxReady = false;
        this._gitBackupTimer = null;
        this._gitBackupBusy = false;
        this._gitBackupLastCommitAt = 0;
        this._gitBackupLastPushAt = 0;
    }

    async init() {
        try {
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
            await this._checkMlxReadiness();

            // Apply saved settings to UI
            this._applySettings(settingsManager.get());
            this._configureGitBackupScheduler(settingsManager.get());
        } catch (initErr) {
            console.error('[App] Partial error during early init:', initErr);
        }

        // Bind event listeners (always runs)
        try {
            this._bindEvents();
        } catch (err) {
            console.error('[App] _bindEvents error:', err);
        }

        try {
            await this._bindAudioTranscriptProgressEvents();
        } catch (err) {
            console.warn('[App] Could not bind audio transcript progress events:', err);
        }

        // All modal overlays use the same dismissal behavior: Escape and a
        // click on the backdrop act exactly like the modal's Cancel button.
        try {
            this._bindModalDismissal();
        } catch (err) {
            console.error('[App] _bindModalDismissal error:', err);
        }

        // Flush the session on every close route (window ✕, Cmd+Q, Dock quit).
        try {
            await this._bindCloseHooks();
        } catch (err) {
            console.warn('[App] _bindCloseHooks error:', err);
        }

        // Bind keyboard shortcuts
        try {
            this._bindKeyboardShortcuts();
        } catch (err) {
            console.error('[App] _bindKeyboardShortcuts error:', err);
        }

        // Subscribe to settings changes
        settingsManager.onChange((settings) => {
            this._applySettings(settings);
            this._configureGitBackupScheduler(settings);
            if (this._currentSettingsScreen === 'tab-storage') this._renderSettingsStorageTab();
        });

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

    async _checkMlxReadiness() {
        if (!this.isAppleSilicon) {
            this._isLocalMlxReady = false;
            this._localMlxInfo = null;
            this._updateMlxSettingsUI();
            return false;
        }
        try {
            const infoResult = await invoke('get_local_models_info');
            const info = typeof infoResult === 'string' ? JSON.parse(infoResult) : infoResult;
            this._isLocalMlxReady = !!info?.ready;
            this._localMlxInfo = info;
        } catch (e) {
            console.warn('[App] get_local_models_info error, falling back:', e);
            try {
                const checkResult = await invoke('check_mlx_setup');
                const status = typeof checkResult === 'string' ? JSON.parse(checkResult) : checkResult;
                this._isLocalMlxReady = !!status?.ready;
            } catch {
                this._isLocalMlxReady = false;
            }
            this._localMlxInfo = null;
        }
        this._updateMlxSettingsUI();
        return this._isLocalMlxReady;
    }

    _updateMlxSettingsUI() {
        const badge = document.getElementById('local-mlx-badge');
        const btnInstall = document.getElementById('btn-install-mlx');
        const btnDelete = document.getElementById('btn-delete-mlx');
        const sizeTag = document.getElementById('local-mlx-size');
        const desc = document.getElementById('local-mlx-desc');
        if (!badge || !btnInstall) return;

        if (!this.isAppleSilicon) {
            badge.className = 'local-mlx-badge not-ready';
            badge.textContent = 'Không khả dụng';
            btnInstall.style.display = 'none';
            if (btnDelete) btnDelete.style.display = 'none';
            if (sizeTag) sizeTag.style.display = 'none';
            if (desc) desc.textContent = 'Local MLX chỉ hoạt động trên macOS với chip Apple Silicon (M1/M2/M3/M4).';
            return;
        }

        btnInstall.style.display = 'inline-flex';
        const info = this._localMlxInfo;
        const sizeBytes = Number(info?.size_bytes || 0);
        const sizeFormatted = info?.size_formatted || '';

        if (sizeBytes > 0 && sizeTag) {
            sizeTag.textContent = `💾 ${sizeFormatted}`;
            sizeTag.style.display = 'inline-flex';
        } else if (sizeTag) {
            sizeTag.style.display = 'none';
        }

        if (btnDelete) {
            if (sizeBytes > 0) {
                btnDelete.style.display = 'inline-flex';
                btnDelete.textContent = `🗑️ Xoá mô hình (${sizeFormatted})`;
            } else {
                btnDelete.style.display = 'none';
            }
        }

        if (this._isLocalMlxReady) {
            badge.className = 'local-mlx-badge is-ready';
            badge.textContent = '✅ Đã cài đặt sẵn sàng';
            btnInstall.textContent = '🔄 Cài đặt lại mô hình';
            if (desc) desc.textContent = 'Mô hình Whisper & Gemma đã tải sẵn trên máy. Sẵn sàng dự phòng ngoại tuyến 100% khi mất mạng.';
        } else {
            badge.className = 'local-mlx-badge not-ready';
            badge.textContent = '⚠️ Chưa cài đặt mô hình';
            btnInstall.textContent = '⬇️ Cài đặt / Tải trước mô hình Local MLX';
            if (desc) desc.textContent = 'Tải trước mô hình AI (~3.5 GB) về máy Mac để có thể phiên dịch ngoại tuyến bất cứ khi nào mất mạng hoặc Wi-Fi yếu.';
        }
    }

    async _handleInstallMlxClick() {
        try {
            await this._runMlxSetup();
            await this._checkMlxReadiness();
            this._showToast('Cài đặt mô hình Local MLX hoàn tất ✓', 'success');
        } catch (err) {
            console.error('[App] MLX setup failed:', err);
            this._showToast(`Cài đặt MLX không thành công: ${err?.message || err}`, 'error');
            await this._checkMlxReadiness();
        }
    }

    async _handleDeleteMlxClick() {
        const sizeFormatted = this._localMlxInfo?.size_formatted || 'khoảng 5.7 GB';
        const confirmed = window.confirm(
            `Bạn có chắc chắn muốn xoá toàn bộ mô hình Local AI và môi trường offline (${sizeFormatted}) để giải phóng ổ cứng?\n\n` +
            `• Dung lượng sẽ được giải phóng: ${sizeFormatted}\n` +
            `• Thư mục sẽ xoá: mlx-env và cache mô hình mlx-community\n\n` +
            `Lưu ý: Sau khi xoá, nếu mất mạng app sẽ không tự động chuyển sang dịch offline được cho đến khi bạn cài đặt lại.`
        );
        if (!confirmed) return;

        const badge = document.getElementById('local-mlx-badge');
        const btnInstall = document.getElementById('btn-install-mlx');
        const btnDelete = document.getElementById('btn-delete-mlx');

        if (badge) {
            badge.className = 'local-mlx-badge is-checking';
            badge.textContent = 'Đang xoá mô hình...';
        }
        if (btnInstall) btnInstall.disabled = true;
        if (btnDelete) btnDelete.disabled = true;

        try {
            // If user currently has 'local' mode selected, fallback to 'gemini'
            if (this.translationMode === 'local') {
                console.log('[App] Switching from local mode to gemini before model deletion...');
                this.translationMode = 'gemini';
                settingsManager.save({ translation_mode: 'gemini' });
                const select = document.getElementById('select-translation-mode');
                if (select) select.value = 'gemini';
                this._updateModeUI('gemini');
                this._showToast('Đã tự động chuyển sang engine Gemini Live', 'info');
            }

            const res = await invoke('delete_local_models');
            const data = typeof res === 'string' ? JSON.parse(res) : res;
            const freed = data?.freed_formatted || sizeFormatted;

            this._showToast(`Đã xoá mô hình cục bộ và giải phóng ${freed} dung lượng ổ cứng ✓`, 'success');
        } catch (err) {
            console.error('[App] Failed to delete local models:', err);
            this._showToast(`Lỗi khi xoá mô hình: ${err?.message || err}`, 'error');
        } finally {
            if (btnInstall) btnInstall.disabled = false;
            if (btnDelete) btnDelete.disabled = false;
            await this._checkMlxReadiness();
        }
    }

    async _showNetworkAlertBanner(engine = '', reason = '') {
        if (!this.isRunning || this.translationMode === 'local') return;
        const banner = document.getElementById('live-network-alert-banner');
        if (!banner) return;

        this._networkAlertBannerVisible = true;
        this._hadNetworkIssueInSession = true;

        await this._checkMlxReadiness();

        const icon = document.getElementById('network-alert-icon');
        const title = document.getElementById('network-alert-title');
        const desc = document.getElementById('network-alert-desc');
        const btnLocal = document.getElementById('btn-net-fallback-local');
        const btnGemini = document.getElementById('btn-net-fallback-gemini');
        const btnNoTrans = document.getElementById('btn-net-fallback-notrans');
        const btnRetry = document.getElementById('btn-net-retry');

        if (icon) icon.textContent = '⚠️';
        if (title) title.textContent = 'Mạng gián đoạn — Bản dịch trực tiếp tạm dừng';
        if (desc) desc.textContent = 'File ghi âm (.wav) & ghi chú vẫn đang được lưu an toàn 100%.';
        if (btnGemini) btnGemini.style.display = 'none';
        if (btnRetry) btnRetry.style.display = 'inline-flex';

        if (btnLocal) {
            btnLocal.style.display = (this._isLocalMlxReady && this.isAppleSilicon) ? 'inline-flex' : 'none';
        }
        if (btnNoTrans) {
            const s = settingsManager.get();
            btnNoTrans.style.display = (s.target_language === 'none') ? 'none' : 'inline-flex';
        }

        banner.style.display = 'flex';
    }

    _showNetworkRestoredBanner() {
        const banner = document.getElementById('live-network-alert-banner');
        if (!banner) return;
        this._networkAlertBannerVisible = true;

        const icon = document.getElementById('network-alert-icon');
        const title = document.getElementById('network-alert-title');
        const desc = document.getElementById('network-alert-desc');
        const btnLocal = document.getElementById('btn-net-fallback-local');
        const btnGemini = document.getElementById('btn-net-fallback-gemini');
        const btnNoTrans = document.getElementById('btn-net-fallback-notrans');
        const btnRetry = document.getElementById('btn-net-retry');

        if (icon) icon.textContent = '🌐';
        if (title) title.textContent = 'Đã có kết nối mạng internet trở lại';
        if (desc) desc.textContent = 'Bạn có thể chuyển về Google Gemini Live để tiếp tục phiên dịch trực tuyến.';
        if (btnLocal) btnLocal.style.display = 'none';
        if (btnGemini) btnGemini.style.display = 'inline-flex';
        if (btnNoTrans) btnNoTrans.style.display = 'none';
        if (btnRetry) btnRetry.style.display = 'none';

        banner.style.display = 'flex';
        this._showToast('🌐 Đã có mạng internet trở lại. Có thể chuyển về Gemini Live.', 'info');
    }

    _hideNetworkAlertBanner() {
        const banner = document.getElementById('live-network-alert-banner');
        if (banner) banner.style.display = 'none';
        this._networkAlertBannerVisible = false;
    }

    async _hotSwapToEngine(newMode) {
        if (!this.isRunning) return;
        this._hideNetworkAlertBanner();
        const modeLabel = newMode === 'local' ? 'Local MLX (Offline)' : (newMode === 'gemini' ? 'Google Gemini Live' : newMode);
        this._showToast(`Đang chuyển sang ${modeLabel}...`, 'info');

        // Completely stop previous engine, capture channel, and reconnect timers
        await this._stopTranslationEngine();

        this.translationMode = newMode;
        await settingsManager.save({ translation_mode: newMode });

        const selectMode = document.getElementById('select-translation-mode');
        if (selectMode) selectMode.value = newMode;
        this._updateModeUI(newMode);

        sessionStore.beginChunk({
            engine: newMode,
            sourceLang: this.sessionSourceLang,
            targetLang: this.sessionTargetLang,
        });

        try {
            await this._startTranslationEngine(settingsManager.get());
            this._showToast(`Đã chuyển sang ${modeLabel} ✓`, 'success');
        } catch (err) {
            console.error(`[App] Hot-swap to ${newMode} failed:`, err);
            this._showToast(`Lỗi chuyển engine: ${err}`, 'error');
            this._showNetworkAlertBanner(newMode, String(err));
        }
    }

    // ─── Event Binding ──────────────────────────────────────

    _bindEvents() {
        // Smart Network Interruption Banner buttons
        document.getElementById('btn-net-fallback-local')?.addEventListener('click', () => {
            this._hotSwapToEngine('local');
        });
        document.getElementById('btn-net-fallback-gemini')?.addEventListener('click', () => {
            this._hideNetworkAlertBanner();
            this._hotSwapToEngine('gemini');
        });
        document.getElementById('btn-net-fallback-notrans')?.addEventListener('click', () => {
            this._hideNetworkAlertBanner();
            this._handleQuickTargetLangChange('none');
        });
        document.getElementById('btn-net-retry')?.addEventListener('click', () => {
            this._showToast('Đang thử kết nối lại...', 'info');
            this._restartLiveEngineForSettings();
        });
        document.getElementById('btn-net-dismiss')?.addEventListener('click', () => {
            this._hideNetworkAlertBanner();
        });

        // Local MLX install & delete buttons in Settings
        document.getElementById('btn-install-mlx')?.addEventListener('click', () => {
            this._handleInstallMlxClick();
        });
        document.getElementById('btn-delete-mlx')?.addEventListener('click', () => {
            this._handleDeleteMlxClick();
        });

        // Offline / Online window events
        window.addEventListener('offline', () => {
            if (this.isRunning && this.translationMode !== 'local') {
                this._showNetworkAlertBanner(this.translationMode, 'Mất kết nối mạng internet');
            }
        });
        window.addEventListener('online', () => {
            if (this.isRunning) {
                if (this.translationMode === 'local') {
                    this._showNetworkRestoredBanner();
                } else if (this._networkAlertBannerVisible) {
                    this._showToast('Đã có mạng trở lại. Đang tự động kết nối...', 'info');
                    this._restartLiveEngineForSettings();
                }
            }
        });

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

        // Log name filter (debounced)
        const searchInput = document.getElementById('input-session-search');
        if (searchInput) {
            let t;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(t);
                this._sessionNameQuery = e.target.value;
                this._sessionPage = 1;
                t = setTimeout(() => this._renderFilteredSessions(), 200);
            });
        }

        // Customer filter dropdown
        document.getElementById('select-session-customer-filter')?.addEventListener('change', (e) => {
            this._activeCustomerFilter = this._selectedValues(e.target);
            this._sessionPage = 1;
            this._renderProjectFilterBar();
            this._renderFilteredSessions();
        });

        // Project filter dropdown
        document.getElementById('select-session-project-filter')?.addEventListener('change', (e) => {
            this._activeProjectFilter = this._selectedValues(e.target);
            this._sessionPage = 1;
            this._renderFilteredSessions();
        });

        // Category filter dropdown
        document.getElementById('select-session-category-filter')?.addEventListener('change', (e) => {
            this._activeCategoryFilter = this._selectedValues(e.target);
            this._sessionPage = 1;
            this._renderFilteredSessions();
        });

        // Tag filter dropdown
        document.getElementById('select-session-tag-filter')?.addEventListener('change', (e) => {
            this._activeTagFilter = this._selectedValues(e.target);
            this._sessionPage = 1;
            this._renderFilteredSessions();
        });

        // Scope tabs in logs list view (Work / Personal / All)
        document.querySelectorAll('.logs-scope-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const scope = btn.dataset.scope;
                if (scope && scope !== this._activeLogsScopeFilter) {
                    this._activeLogsScopeFilter = scope;
                    this._sessionPage = 1;
                    if (scope === 'personal') {
                        this._activeCustomerFilter = [];
                    }
                    this._renderFilteredSessions();
                }
            });
        });

        // Settings Sidebar 2-Column Navigation
        document.querySelectorAll('.settings-nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                this._showSettingsScreen(btn.dataset.screen);
            });
        });
        this._initSettingsScopeTabs();
        this._initSettingsTemplatesTab();
        this._initSettingsNotesTemplateTab();

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

        // Add Project Modal Scope radios
        const onModalProjScopeChange = () => {
            const chosen = document.querySelector('input[name="modal-proj-scope"]:checked')?.value || 'work';
            document.querySelectorAll('#modal-proj-scope-group .scope-radio-btn').forEach(btn => {
                const r = btn.querySelector('input[type="radio"]');
                btn.classList.toggle('active', r && r.checked);
            });
            const custWrap = document.getElementById('modal-proj-customer-wrap');
            if (custWrap) {
                custWrap.style.display = chosen === 'personal' ? 'none' : '';
            }
        };

        document.querySelectorAll('input[name="modal-proj-scope"]').forEach(radio => {
            radio.addEventListener('change', onModalProjScopeChange);
        });

        document.querySelectorAll('#modal-proj-scope-group .scope-radio-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const rad = btn.querySelector('input[type="radio"]');
                if (rad && !rad.checked) {
                    rad.checked = true;
                    onModalProjScopeChange();
                }
            });
        });

        // Category Modal Triggers
        document.getElementById('btn-open-add-category')?.addEventListener('click', () => {
            this._openAddCategoryModal();
        });
        document.getElementById('btn-close-edit-category')?.addEventListener('click', () => {
            this._closeEditCategoryModal();
        });
        document.getElementById('btn-cancel-edit-category')?.addEventListener('click', () => {
            this._closeEditCategoryModal();
        });
        document.getElementById('btn-save-edit-category')?.addEventListener('click', async () => {
            await this._handleSaveCategoryFromModal();
        });
        document.getElementById('input-modal-cat-name')?.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                await this._handleSaveCategoryFromModal();
            }
        });

        // Tag Modal Triggers
        document.getElementById('btn-open-add-tag')?.addEventListener('click', () => {
            this._openAddTagModal();
        });
        document.getElementById('btn-close-edit-tag')?.addEventListener('click', () => {
            this._closeEditTagModal();
        });
        document.getElementById('btn-cancel-edit-tag')?.addEventListener('click', () => {
            this._closeEditTagModal();
        });
        document.getElementById('btn-save-edit-tag')?.addEventListener('click', async () => {
            await this._handleSaveTagFromModal();
        });
        document.getElementById('input-modal-tag-name')?.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                await this._handleSaveTagFromModal();
            }
        });

        // Edit metadata from viewer (Single unified edit button, or click title, or click badge/add-button)
        const handleOpenViewerMetadataEdit = async () => {
            const cur = this._currentViewedSession;
            if (!cur || cur.isLegacy) {
                this._showToast('Không thể sửa thông tin cuộc họp định dạng cũ', 'info');
                return;
            }
            try {
                const res = await invoke('read_session', { id: cur.id });
                await this._editSessionMetadata({
                    id: cur.id,
                    title: res.json?.title || cur.title,
                    customer_id: res.json?.customer_id || null,
                    project_id: res.json?.project_id || null,
                    category: res.json?.category || null,
                    tags: res.json?.tags || [],
                });
            } catch (err) {
                console.error('[App] Failed to read session for edit:', err);
                this._showToast(`Lỗi đọc thông tin: ${err}`, 'error');
            }
        };

        document.getElementById('btn-session-edit-metadata')?.addEventListener('click', handleOpenViewerMetadataEdit);
        document.getElementById('btn-session-add-metadata')?.addEventListener('click', handleOpenViewerMetadataEdit);
        document.getElementById('session-viewer-title')?.addEventListener('click', handleOpenViewerMetadataEdit);
        document.getElementById('session-viewer-badges')?.addEventListener('click', (e) => {
            if (e.target.closest('.session-customer-badge, .session-project-badge, .session-category-badge, .session-tag-badge, .scope-badge-work, .scope-badge-personal')) {
                handleOpenViewerMetadataEdit();
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
            const title = this._currentSessionJson?.title || document.getElementById('session-viewer-title')?.textContent || cur.id;
            const agreed = await this._promptConfirmDelete({
                title: 'Xác nhận xoá log',
                message: `Bạn có chắc chắn muốn xoá vĩnh viễn log "${title}"? Hành động này không thể hoàn tác.`,
                confirmText: 'Xoá'
            });
            if (!agreed) return;
            try {
                await invoke('delete_session', { id: cur.id });
                this._selectedSessionIds?.delete(cur.id);
                this._showToast('Đã xóa log', 'success');
                document.getElementById('sessions-list-panel').style.display = '';
                document.getElementById('session-viewer').style.display = 'none';
                await this._showSessions();
            } catch (err) {
                this._showToast(`Xóa thất bại: ${err}`, 'error');
            }
        });

        this._initSessionViewerTabs();

        // Export session
        document.getElementById('btn-session-retranscript')?.addEventListener('click', () => this._retranscribeCurrentSession());
        document.getElementById('btn-session-export-srt')?.addEventListener('click', () => this._exportCurrentSession('srt'));
        document.getElementById('btn-session-export-txt')?.addEventListener('click', () => this._exportCurrentSession('txt'));

        // Import audio controls
        document.getElementById('btn-open-import-audio')?.addEventListener('click', () => this._handleOpenImportAudio());
        document.getElementById('btn-close-import-audio')?.addEventListener('click', () => this._closeImportAudioModal());
        document.getElementById('btn-cancel-import-audio')?.addEventListener('click', () => this._closeImportAudioModal());
        document.getElementById('btn-import-browse-file')?.addEventListener('click', () => this._browseAudioFileForImport());
        document.getElementById('btn-confirm-import-audio')?.addEventListener('click', () => this._confirmImportAudio());
        this._initImportAudioDropZone();

        // Re-transcript modal & background controls
        document.getElementById('btn-retranscript-minimize')?.addEventListener('click', () => this._minimizeRetranscript());
        document.getElementById('btn-retranscript-run-bg')?.addEventListener('click', () => this._minimizeRetranscript());
        document.getElementById('btn-retranscript-cancel')?.addEventListener('click', () => this._closeRetranscriptNotice());
        document.getElementById('btn-retranscript-abort')?.addEventListener('click', () => this._closeRetranscriptNotice());
        document.getElementById('btn-copy-retranscript-error')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._copyRetranscriptError();
        });
        document.getElementById('btn-retranscript-expand')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._expandRetranscript();
        });
        document.getElementById('btn-retranscript-floating-click')?.addEventListener('click', async () => {
            if (this._activeRetranscribe) {
                this._expandRetranscript();
            } else if (this._lastCompletedRetranscribeId) {
                const targetId = this._lastCompletedRetranscribeId;
                this._hideRetranscriptProgress();
                setActivity('library');
                await this._openSession(targetId);
                this._switchSessionTab('logs');
            }
        });
        document.getElementById('btn-retranscript-floating-cancel')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._activeRetranscribe) {
                this._cancelActiveRetranscript();
            } else {
                this._hideRetranscriptProgress();
            }
        });

        // Meeting minutes floating bar controls
        const handleOpenMinutesFromFloating = async (e) => {
            if (e?.target?.closest('#btn-minutes-floating-close')) {
                return;
            }
            const active = this._activeMinutesGeneration || this._lastCompletedMinutes;
            if (!active?.id) return;

            const targetId = active.id;
            const targetLang = active.lang || this._activeMinutesLang || 'ja';

            if (!this._activeMinutesGeneration) {
                this._hideMinutesProgress();
            }

            if (getActivity() !== 'library') {
                this._suppressNextShowSessions = true;
                setActivity('library');
            }

            await this._openSession(targetId);
            this._switchSessionTab('minutes');
            if (targetLang) {
                this._switchMinutesSubtab(targetLang);
            }

            const editorEl = document.getElementById('session-minutes-editor-container');
            if (editorEl && editorEl.style.display !== 'none') {
                editorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        };

        document.getElementById('minutes-floating-bar')?.addEventListener('click', handleOpenMinutesFromFloating);

        document.getElementById('btn-minutes-floating-close')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._hideMinutesProgress();
        });

        // macOS Traffic Light Window Controls
        document.getElementById('btn-win-close')?.addEventListener('click', async () => {
            this._immediateCloseRequested = true;
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
            this._immediateCloseRequested = true;
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

        // Meeting title is editable directly from the Take Note bar. Keep it
        // in the live session store and let the short note autosave debounce
        // persist it without blocking typing.
        const liveTitleInput = document.getElementById('input-live-meeting-title');
        liveTitleInput?.addEventListener('input', () => {
            sessionStore.updateTitleDraft(liveTitleInput.value);
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
            if (this._isStopConfirmationOpen || this._isStoppingSession) return;
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

        // Optional Git backup. Git itself, the repository and credentials are
        // configured by the user; Meet Minder only manages its own data paths.
        document.getElementById('check-git-backup-enabled')?.addEventListener('change', async (e) => {
            await this._saveGitBackupSettings({ git_backup_enabled: e.target.checked });
        });
        document.getElementById('check-git-auto-push')?.addEventListener('change', async (e) => {
            await this._saveGitBackupSettings({ git_backup_auto_push: e.target.checked });
        });
        document.getElementById('check-git-auto-commit')?.addEventListener('change', async (e) => {
            await this._saveGitBackupSettings({ git_backup_auto_commit: e.target.checked });
        });
        document.getElementById('select-git-commit-interval')?.addEventListener('change', async (e) => {
            await this._saveGitBackupSettings({ git_backup_commit_interval_min: Number(e.target.value) || 30 });
        });
        document.getElementById('select-git-push-interval')?.addEventListener('change', async (e) => {
            await this._saveGitBackupSettings({ git_backup_push_interval_min: Number(e.target.value) || 60 });
        });
        document.getElementById('input-git-backup-repo')?.addEventListener('change', async (e) => {
            await this._saveGitBackupSettings({ git_backup_repo_path: e.target.value.trim() });
            this._renderGitBackupStatus();
        });
        document.getElementById('btn-select-git-backup-repo')?.addEventListener('click', async () => {
            try {
                const path = await invoke('select_git_backup_dir');
                if (path) {
                    await this._saveGitBackupSettings({ git_backup_repo_path: path });
                    this._showToast('Đã chọn Git repository ✓', 'success');
                    await this._renderGitBackupStatus();
                }
            } catch (err) {
                this._showToast(`Chọn Git repository thất bại: ${err}`, 'error');
            }
        });
        document.getElementById('btn-git-backup-now')?.addEventListener('click', async () => {
            await this._runGitBackup({ manual: true, push: settingsManager.get().git_backup_auto_push === true });
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
        document.getElementById('select-translation-mode')?.addEventListener('change', async (e) => {
            const newMode = e.target.value;
            this._updateModeUI(newMode);
            this.translationMode = newMode;
            await this._autoSaveSettingsFromForm();
            if (this.isRunning) {
                await this._hotSwapToEngine(newMode);
            }
        });

        // Translation timing (configured in Settings, not the compact toolbar)
        document.getElementById('select-translation-timing')?.addEventListener('change', async (e) => {
            await this._setTranslationTiming(e.target.value);
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
                this._selectEngineClass(btn.dataset.engineClass);
            });
        });

        // Audio Source radio change
        document.querySelectorAll('input[name="audio-source"]').forEach(r => {
            r.addEventListener('change', () => this._autoSaveSettingsFromForm());
        });

        // Stepper buttons (+/-) setup
        document.querySelectorAll('.btn-stepper').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.target;
                const input = document.getElementById(targetId);
                if (!input) return;
                const min = parseInt(input.min, 10) || 0;
                const max = parseInt(input.max, 10) || 999;
                const step = parseInt(input.step, 10) || 1;
                let val = parseInt(input.value, 10);
                if (isNaN(val)) val = min;
                if (btn.classList.contains('btn-stepper-inc')) {
                    val = Math.min(max, val + step);
                } else if (btn.classList.contains('btn-stepper-dec')) {
                    val = Math.max(min, val - step);
                }
                input.value = val;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                this._autoSaveSettingsFromForm();
            });
        });

        // Stepper input fields live updates & clamping
        const syncMenuLivePreview = () => {
            const familyKey = document.getElementById('select-menu-font-family')?.value || 'system';
            const weightKey = document.getElementById('select-menu-font-weight')?.value || 'medium';
            const sizeVal = parseInt(document.getElementById('input-menu-font-size')?.value || '12', 10);
            const menuFamilies = {
                system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                roboto: "'Roboto', 'Google Sans', -apple-system, sans-serif",
                segoe: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
                arial: "Arial, -apple-system, sans-serif",
                monospace: "ui-monospace, SFMono-Regular, Menlo, monospace",
            };
            const weightMap = { normal: '400', medium: '500', semibold: '700' };
            const boldWeightMap = { normal: '600', medium: '700', semibold: '800' };
            document.documentElement.style.setProperty('--menu-font-family', menuFamilies[familyKey] || menuFamilies.system);
            document.documentElement.style.setProperty('--menu-font-size', `${sizeVal}px`);
            document.documentElement.style.setProperty('--menu-font-weight', weightMap[weightKey] || '500');
            document.documentElement.style.setProperty('--menu-font-weight-bold', boldWeightMap[weightKey] || '700');
        };

        const syncTableLivePreview = () => {
            const familyKey = document.getElementById('select-table-font-family')?.value || 'system';
            const weightKey = document.getElementById('select-table-font-weight')?.value || 'medium';
            const sizeVal = parseInt(document.getElementById('input-table-font-size')?.value || '13', 10);
            const menuFamilies = {
                system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                roboto: "'Roboto', 'Google Sans', -apple-system, sans-serif",
                segoe: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
                arial: "Arial, -apple-system, sans-serif",
                monospace: "ui-monospace, SFMono-Regular, Menlo, monospace",
            };
            const weightMap = { normal: '400', medium: '500', semibold: '700' };
            const boldWeightMap = { normal: '600', medium: '700', semibold: '800' };
            document.documentElement.style.setProperty('--table-font-family', menuFamilies[familyKey] || menuFamilies.system);
            document.documentElement.style.setProperty('--table-font-size', `${sizeVal}px`);
            document.documentElement.style.setProperty('--table-font-weight', weightMap[weightKey] || '500');
            document.documentElement.style.setProperty('--table-font-weight-bold', boldWeightMap[weightKey] || '700');
            document.documentElement.style.setProperty('--table-title-weight', boldWeightMap[weightKey] || '700');
        };

        const syncTranscriptLivePreview = () => {
            const familyKey = document.getElementById('select-font-family')?.value || 'system';
            const sizeVal = parseInt(document.getElementById('input-font-size')?.value || '16', 10);
            const colorVal = document.getElementById('input-font-color')?.value || '#ffffff';
            const transcriptFamilies = {
                system: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
                inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                arial: "Arial, -apple-system, sans-serif",
                georgia: "Georgia, serif",
                monospace: "ui-monospace, SFMono-Regular, Menlo, monospace",
            };
            document.documentElement.style.setProperty('--transcript-font-family', transcriptFamilies[familyKey] || transcriptFamilies.system);
            document.documentElement.style.setProperty('--transcript-font-size', `${sizeVal}px`);
            document.documentElement.style.setProperty('--transcript-font-color', colorVal);
        };

        const syncNoteLivePreview = () => {
            const familyKey = document.getElementById('select-note-font-family')?.value || 'system';
            const sizeVal = parseInt(document.getElementById('input-note-font-size')?.value || '14', 10);
            const noteFamilies = {
                system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                roboto: "'Roboto', -apple-system, sans-serif",
                arial: "Arial, -apple-system, sans-serif",
                georgia: "Georgia, serif",
                monospace: "ui-monospace, SFMono-Regular, Menlo, monospace",
            };
            document.documentElement.style.setProperty('--note-font-family', noteFamilies[familyKey] || noteFamilies.system);
            document.documentElement.style.setProperty('--note-font-size', `${sizeVal}px`);
        };

        const setupStepperInput = (id, min, max, defaultVal, onSync) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', () => {
                if (onSync) onSync();
                this._debouncedAutoSave();
            });
            el.addEventListener('change', () => {
                let v = parseInt(el.value, 10);
                if (isNaN(v)) v = defaultVal;
                v = Math.max(min, Math.min(max, v));
                el.value = v;
                if (onSync) onSync();
                this._autoSaveSettingsFromForm();
            });
        };
        setupStepperInput('input-menu-font-size', 10, 18, 12, syncMenuLivePreview);
        setupStepperInput('input-table-font-size', 11, 22, 13, syncTableLivePreview);
        setupStepperInput('input-note-font-size', 12, 36, 14, syncNoteLivePreview);
        setupStepperInput('input-font-size', 12, 36, 16, syncTranscriptLivePreview);
        setupStepperInput('input-max-lines', 2, 15, 5);

        document.getElementById('select-menu-font-family')?.addEventListener('change', () => {
            syncMenuLivePreview();
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('select-menu-font-weight')?.addEventListener('change', () => {
            syncMenuLivePreview();
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('select-table-font-family')?.addEventListener('change', () => {
            syncTableLivePreview();
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('select-table-font-weight')?.addEventListener('change', () => {
            syncTableLivePreview();
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('select-note-font-family')?.addEventListener('change', () => {
            syncNoteLivePreview();
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('input-font-color')?.addEventListener('input', (e) => {
            const valEl = document.getElementById('font-color-value');
            if (valEl) valEl.textContent = e.target.value.toUpperCase();
            syncTranscriptLivePreview();
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('select-font-family')?.addEventListener('change', () => {
            syncTranscriptLivePreview();
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('check-show-original')?.addEventListener('change', () => {
            this._autoSaveSettingsFromForm();
        });

        document.getElementById('select-default-logs-scope')?.addEventListener('change', () => {
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
            if (status === 'connected') {
                this._hideNetworkAlertBanner();
            }
        };

        sonioxClient.onError = (error) => {
            this._showToast(error, 'error');
            if (this.isRunning && (String(error).includes('Reconnect') || String(error).includes('lost') || String(error).includes('timeout') || !navigator.onLine)) {
                this._showNetworkAlertBanner('soniox', error);
            }
        };

        sonioxClient.onConfidence = (avgConfidence) => {
            this.transcriptUI.setConfidence(avgConfidence);
        };
    }

    _bindSettingsForm() {
        // These are handled in _populateSettingsForm and _saveSettingsFromForm
    }

    _bindModalDismissal() {
        const isVisible = (modal) => {
            if (!modal || modal.style.display === 'none') return false;
            return window.getComputedStyle(modal).display !== 'none';
        };

        const getVisibleModal = () => Array.from(document.querySelectorAll('.modal-overlay'))
            .reverse()
            .find(isVisible);

        const dismissModal = (modal) => {
            if (!modal) return false;

            if (modal.id === 'shortcut-sheet') {
                this._toggleShortcutSheet?.(false);
                return true;
            }

            // Prefer an explicit Cancel/Abort action, then fall back to the
            // close icon. Clicking the existing button preserves each modal's
            // cleanup and Promise resolution behavior.
            const cancelButton = modal.querySelector(
                '[id^="btn-cancel-"], [id*="-abort"], [id*="-cancel"], .close-btn'
            );
            if (!cancelButton) return false;
            cancelButton.click();
            return true;
        };

        document.addEventListener('click', (event) => {
            const modal = event.target?.classList?.contains('modal-overlay')
                ? event.target
                : null;
            if (modal) dismissModal(modal);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            const modal = getVisibleModal();
            if (!modal || !dismissModal(modal)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        });
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
                    if (this._isStopConfirmationOpen || this._isStoppingSession) return;
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
        try {
            document.getElementById('overlay-view')?.classList.toggle('active', view === 'overlay');
            document.getElementById('settings-view')?.classList.toggle('active', view === 'settings');

            if (view === 'settings') {
                this._populateSettingsForm();
                this._showSettingsScreen('tab-customers');
            }
            if (view === 'overlay' && typeof getActivity === 'function' && getActivity() === 'read') {
                this._populateReadQuickPick?.();
                this._showReadCapabilityHint?.();
            }
        } catch (err) {
            console.error('[App] _showView error:', err);
        }
    }

    /** Show one settings screen (sidebar item selected) inside the 2-column settings view. */
    async _showSettingsScreen(id) {
        if (!id || (!document.getElementById(id) && id !== 'tab-notes-template')) id = 'tab-customers';
        const targetScreen = id === 'tab-notes-template' ? 'tab-templates' : id;
        this._currentSettingsScreen = targetScreen;

        // Highlight sidebar nav item
        document.querySelectorAll('.settings-nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.screen === targetScreen);
        });

        // Show active content tab
        document.querySelectorAll('.settings-tab-content').forEach(c => {
            c.classList.toggle('active', c.id === targetScreen);
        });

        if (targetScreen === 'tab-customers') {
            this._renderSettingsCustomersTab();
        } else if (targetScreen === 'tab-projects') {
            this._renderSettingsProjectsTab();
        } else if (targetScreen === 'tab-categories') {
            this._renderSettingsCategoriesTab();
        } else if (targetScreen === 'tab-tags') {
            this._renderSettingsTagsTab();
        } else if (targetScreen === 'tab-storage') {
            this._renderSettingsStorageTab();
        } else if (targetScreen === 'tab-templates') {
            if (id === 'tab-notes-template') {
                this._switchTemplatesMainTab('notes');
            } else {
                this._switchTemplatesMainTab(this._activeTemplatesMainTab || 'minutes');
            }
        } else if (targetScreen === 'tab-translation') {
            await this._checkMlxReadiness();
        }

        this._updateSidebarBadges().catch(err => console.error('Failed to update sidebar badges:', err));
        document.querySelector('.settings-content-panel')?.scrollTo(0, 0);
    }

    /** Refresh sidebar badges after registry/sessions are loaded (e.g. app init, logs loaded). */
    async refreshSettingsBadges() {
        await this._updateSidebarBadges();
    }

    /**
     * Jump from a Settings row to Logs (library) with a single fresh filter.
     * Clears all previous log conditions. Scope is inferred from the linked
     * metadata when possible; pass scopeOverride ('work' | 'personal' | 'all')
     * when the source row already knows the correct scope.
     * kind: 'customer' (id) | 'project' (id) | 'category' (name) | 'tag' (name)
     */
    async _jumpToLogsWithFilter(kind, value, scopeOverride) {
        this._activeCustomerFilter = [];
        this._activeProjectFilter = [];
        this._activeCategoryFilter = [];
        this._activeTagFilter = [];
        this._sessionNameQuery = '';
        const searchInput = document.getElementById('input-session-search');
        if (searchInput) searchInput.value = '';
        this._sessionPage = 1;
        if (kind === 'customer' && value) this._activeCustomerFilter = [value];
        else if (kind === 'project' && value) this._activeProjectFilter = [value];
        else if (kind === 'category' && value) this._activeCategoryFilter = [value];
        else if (kind === 'tag' && value) this._activeTagFilter = [value];

        let logsScope = scopeOverride;
        if (!['work', 'personal', 'all'].includes(logsScope)) {
            const registry = this._projectRegistry || {};
            if (kind === 'project') {
                logsScope = (registry.projects || []).find(project => project.id === value)?.scope;
            } else if (kind === 'category') {
                logsScope = (registry.categories || []).find(category => category.name === value || category.id === value)?.scope;
            } else if (kind === 'tag') {
                const matchingSessions = (this._cachedSessions || []).filter(session =>
                    (session.tags || []).some(tag => (tag || '').toLowerCase() === String(value || '').toLowerCase()));
                const hasWork = matchingSessions.some(session => (session.scope || 'work') === 'work');
                const hasPersonal = matchingSessions.some(session => session.scope === 'personal');
                logsScope = hasWork && hasPersonal ? 'all' : (hasPersonal ? 'personal' : 'work');
            } else if (kind === 'customer') {
                // Customers are a work-only concept in the metadata model.
                logsScope = 'work';
            }
        }
        this._activeLogsScopeFilter = ['work', 'personal', 'all'].includes(logsScope) ? logsScope : 'all';
        setActivity('library');
        this._showView('overlay');
        await this._showSessions();
    }

    /** Jump from a Category row to the linked Minutes template setting. */
    _jumpToTemplateSetting(templateId) {
        if (!templateId) return;
        this._showSettingsScreen('tab-templates');
        this._switchTemplatesMainTab('minutes');
        this._switchSettingsTemplatePreset(templateId);
    }

    // ─── Settings: Scope Tabs (Projects, Categories, Tags) ───

    _initSettingsScopeTabs() {
        // Projects scope tabs
        document.querySelectorAll('#projects-scope-tabs .folder-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._projScopeFilter = btn.dataset.scope || '';
                this._renderSettingsProjectsTab();
            });
        });

        // Categories scope tabs
        document.querySelectorAll('#categories-scope-tabs .folder-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._catScopeFilter = btn.dataset.scope || '';
                this._renderSettingsCategoriesTab();
            });
        });

        // Tags scope tabs
        document.querySelectorAll('#tags-scope-tabs .folder-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._tagScopeFilter = btn.dataset.scope || '';
                this._renderSettingsTagsTab();
            });
        });
    }

    // ─── Settings: Templates Manager ─────────────────────────

    _initSettingsTemplatesTab() {
        // Main tabs (Meeting Minutes vs Note Template)
        document.querySelectorAll('#templates-main-tabs .folder-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tmplTab;
                if (tab) this._switchTemplatesMainTab(tab);
            });
        });

        // Presets selector buttons
        document.querySelectorAll('#templates-preset-bar .templates-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                if (preset) this._switchSettingsTemplatePreset(preset);
            });
        });

        // Language subtabs (VI / JA)
        document.querySelectorAll('#templates-lang-subtabs .templates-subtab').forEach(btn => {
            btn.addEventListener('click', () => {
                const lang = btn.dataset.lang;
                if (lang) this._switchSettingsTemplateLang(lang);
            });
        });

        document.getElementById('btn-template-reset')?.addEventListener('click', () => {
            this._resetCurrentSettingsTemplate();
        });

        document.getElementById('btn-template-save')?.addEventListener('click', async () => {
            await this._saveSettingsTemplates();
        });
    }

    _switchTemplatesMainTab(tab) {
        this._activeTemplatesMainTab = tab || 'minutes';
        document.querySelectorAll('#templates-main-tabs .folder-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tmplTab === this._activeTemplatesMainTab);
        });

        const paneMinutes = document.getElementById('pane-template-minutes');
        const paneNotes = document.getElementById('pane-template-notes');
        if (paneMinutes) paneMinutes.style.display = this._activeTemplatesMainTab === 'minutes' ? '' : 'none';
        if (paneNotes) paneNotes.style.display = this._activeTemplatesMainTab === 'notes' ? '' : 'none';

        if (this._activeTemplatesMainTab === 'minutes') {
            this._renderSettingsTemplatesTab();
        } else {
            this._renderSettingsNotesTemplateTab();
        }
    }

    _getCurrentTemplateKey() {
        return `${this._activeTemplatePreset}_${this._activeTemplateLang}`;
    }

    _renderSettingsTemplatesTab() {
        const s = settingsManager.get();
        if (this._templateDrafts.standard_vi === undefined) {
            this._templateDrafts = {
                standard_vi: (s.template_minutes_vi !== undefined && s.template_minutes_vi !== null && s.template_minutes_vi !== '') ? s.template_minutes_vi : DEFAULT_TEMPLATE_MINUTES_VI,
                standard_ja: (s.template_minutes_ja !== undefined && s.template_minutes_ja !== null && s.template_minutes_ja !== '') ? s.template_minutes_ja : DEFAULT_TEMPLATE_MINUTES_JA,
                tech_vi: (s.template_minutes_tech_vi !== undefined && s.template_minutes_tech_vi !== null && s.template_minutes_tech_vi !== '') ? s.template_minutes_tech_vi : PRESET_TEMPLATE_TECH_VI,
                tech_ja: (s.template_minutes_tech_ja !== undefined && s.template_minutes_tech_ja !== null && s.template_minutes_tech_ja !== '') ? s.template_minutes_tech_ja : PRESET_TEMPLATE_TECH_JA,
                one_on_one_vi: (s.template_minutes_1on1_vi !== undefined && s.template_minutes_1on1_vi !== null && s.template_minutes_1on1_vi !== '') ? s.template_minutes_1on1_vi : PRESET_TEMPLATE_1ON1_VI,
                one_on_one_ja: (s.template_minutes_1on1_ja !== undefined && s.template_minutes_1on1_ja !== null && s.template_minutes_1on1_ja !== '') ? s.template_minutes_1on1_ja : PRESET_TEMPLATE_1ON1_JA,
                personal_vi: (s.template_minutes_personal_vi !== undefined && s.template_minutes_personal_vi !== null && s.template_minutes_personal_vi !== '') ? s.template_minutes_personal_vi : PRESET_TEMPLATE_PERSONAL_VI,
                personal_ja: (s.template_minutes_personal_ja !== undefined && s.template_minutes_personal_ja !== null && s.template_minutes_personal_ja !== '') ? s.template_minutes_personal_ja : PRESET_TEMPLATE_PERSONAL_JA,
            };
        }

        const currentKey = this._getCurrentTemplateKey();
        const container = document.getElementById('template-codemirror-container');
        if (container && !this._templateEditor) {
            this._templateEditor = new NotesEditor();
            this._templateEditor.mount(container, {
                initialContent: this._templateDrafts[currentKey] || '',
                placeholderText: 'Nhập cấu trúc mẫu markdown...',
                onChange: (content) => {
                    this._templateDrafts[this._getCurrentTemplateKey()] = content;
                },
                onSave: () => {
                    this._saveSettingsTemplates();
                },
            });
        }

        this._updateSettingsTemplateUI();
    }

    _switchSettingsTemplatePreset(presetKey) {
        if (this._templateEditor) {
            this._templateDrafts[this._getCurrentTemplateKey()] = this._templateEditor.getContent();
        }
        this._activeTemplatePreset = presetKey;
        this._updateSettingsTemplateUI();
    }

    _switchSettingsTemplateLang(lang) {
        if (this._templateEditor) {
            this._templateDrafts[this._getCurrentTemplateKey()] = this._templateEditor.getContent();
        }
        this._activeTemplateLang = lang;
        this._updateSettingsTemplateUI();
    }

    _updateSettingsTemplateUI() {
        const currentKey = this._getCurrentTemplateKey();

        // Update preset button active states
        document.querySelectorAll('#templates-preset-bar .templates-preset-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.preset === this._activeTemplatePreset);
        });

        // Update language subtab active states
        document.querySelectorAll('#templates-lang-subtabs .templates-subtab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === this._activeTemplateLang);
        });

        // Update hint text
        const hintEl = document.getElementById('template-editor-hint');
        if (hintEl) {
            hintEl.innerHTML = 'Biến tự động: <code>{{title}}</code>, <code>{{date}}</code>, <code>{{duration}}</code>, <code>{{participants}}</code>';
        }

        // Update editor content
        if (this._templateEditor) {
            this._templateEditor.setContent(this._templateDrafts[currentKey] || '');
        }
    }

    _resetCurrentSettingsTemplate() {
        const key = this._getCurrentTemplateKey();
        let def = '';
        if (key === 'standard_vi') def = DEFAULT_TEMPLATE_MINUTES_VI;
        else if (key === 'standard_ja') def = DEFAULT_TEMPLATE_MINUTES_JA;
        else if (key === 'tech_vi') def = PRESET_TEMPLATE_TECH_VI;
        else if (key === 'tech_ja') def = PRESET_TEMPLATE_TECH_JA;
        else if (key === 'one_on_one_vi') def = PRESET_TEMPLATE_1ON1_VI;
        else if (key === 'one_on_one_ja') def = PRESET_TEMPLATE_1ON1_JA;
        else if (key === 'personal_vi') def = PRESET_TEMPLATE_PERSONAL_VI;
        else if (key === 'personal_ja') def = PRESET_TEMPLATE_PERSONAL_JA;

        this._templateDrafts[key] = def;
        if (this._templateEditor) {
            this._templateEditor.setContent(def);
        }
        this._showToast('Đã khôi phục mẫu mặc định ✓', 'info');
    }

    async _saveSettingsTemplates() {
        if (this._templateEditor) {
            this._templateDrafts[this._getCurrentTemplateKey()] = this._templateEditor.getContent();
        }
        try {
            await settingsManager.save({
                template_minutes_vi: this._templateDrafts.standard_vi,
                template_minutes_ja: this._templateDrafts.standard_ja,
                template_minutes_tech_vi: this._templateDrafts.tech_vi,
                template_minutes_tech_ja: this._templateDrafts.tech_ja,
                template_minutes_1on1_vi: this._templateDrafts.one_on_one_vi,
                template_minutes_1on1_ja: this._templateDrafts.one_on_one_ja,
                template_minutes_personal_vi: this._templateDrafts.personal_vi,
                template_minutes_personal_ja: this._templateDrafts.personal_ja,
            });
            this._showToast('Đã lưu mẫu văn bản ✓', 'success');
        } catch (err) {
            this._showToast(`Lỗi lưu mẫu: ${err}`, 'error');
        }
    }

    // ─── Settings: Note Template (standalone tab) ──────────

    _initSettingsNotesTemplateTab() {
        document.getElementById('btn-notes-template-reset')?.addEventListener('click', () => {
            this._resetNotesTemplate();
        });

        document.getElementById('btn-notes-template-save')?.addEventListener('click', async () => {
            await this._saveSettingsNotesTemplate();
        });
    }

    _renderSettingsNotesTemplateTab() {
        const container = document.getElementById('notes-template-codemirror-container');
        if (container && !this._notesTemplateEditor) {
            const s = settingsManager.get();
            const initial = (s.template_notes !== undefined && s.template_notes !== null && s.template_notes !== '')
                ? s.template_notes
                : DEFAULT_TEMPLATE_NOTES;
            this._notesTemplateEditor = new NotesEditor();
            this._notesTemplateEditor.mount(container, {
                initialContent: initial,
                placeholderText: 'Nhập cấu trúc mẫu ghi chú markdown...',
                onSave: () => {
                    this._saveSettingsNotesTemplate();
                },
            });
        }
    }

    _resetNotesTemplate() {
        if (this._notesTemplateEditor) {
            this._notesTemplateEditor.setContent(DEFAULT_TEMPLATE_NOTES);
        }
        this._showToast('Đã khôi phục mẫu ghi chú mặc định ✓', 'info');
    }

    async _saveSettingsNotesTemplate() {
        try {
            const content = this._notesTemplateEditor
                ? this._notesTemplateEditor.getContent()
                : DEFAULT_TEMPLATE_NOTES;
            await settingsManager.save({ template_notes: content });
            this._showToast('Đã lưu mẫu ghi chú ✓', 'success');
        } catch (err) {
            this._showToast(`Lỗi lưu mẫu ghi chú: ${err}`, 'error');
        }
    }

    // ─── Settings Form ─────────────────────────────────────

    _populateSettingsForm() {
        try {
            const s = settingsManager.get();

            const sonioxKeyInput = document.getElementById('input-api-key');
            if (sonioxKeyInput) sonioxKeyInput.value = s.soniox_api_key || '';
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
        const selectTiming = document.getElementById('select-translation-timing');
        if (selectTiming) selectTiming.value = s.translation_timing || 'on_pause';
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
        const menuFontFam = document.getElementById('select-menu-font-family');
        if (menuFontFam) menuFontFam.value = s.menu_font_family || 'system';

        const menuFontSize = document.getElementById('input-menu-font-size');
        if (menuFontSize) menuFontSize.value = s.menu_font_size || 12;

        const menuFontWeight = document.getElementById('select-menu-font-weight');
        if (menuFontWeight) menuFontWeight.value = s.menu_font_weight || 'medium';

        const tableFontFam = document.getElementById('select-table-font-family');
        if (tableFontFam) tableFontFam.value = s.table_font_family || 'system';

        const tableFontSize = document.getElementById('input-table-font-size');
        if (tableFontSize) tableFontSize.value = s.table_font_size || 13;

        const tableFontWeight = document.getElementById('select-table-font-weight');
        if (tableFontWeight) tableFontWeight.value = s.table_font_weight || 'medium';

        const noteFontInput = document.getElementById('input-note-font-size');
        if (noteFontInput) noteFontInput.value = s.note_font_size || 14;

        const noteFontFam = document.getElementById('select-note-font-family');
        if (noteFontFam) noteFontFam.value = s.note_font_family || 'system';

        const fontSizeInput = document.getElementById('input-font-size');
        if (fontSizeInput) fontSizeInput.value = s.font_size || 16;

        const fontColor = s.font_color || '#ffffff';
        const fontColorInput = document.getElementById('input-font-color');
        if (fontColorInput) fontColorInput.value = fontColor;
        const fontColorVal = document.getElementById('font-color-value');
        if (fontColorVal) fontColorVal.textContent = fontColor.toUpperCase();
        const fontFamSelect = document.getElementById('select-font-family');
        if (fontFamSelect) fontFamSelect.value = s.font_family || 'system';

        const maxLinesInput = document.getElementById('input-max-lines');
        if (maxLinesInput) maxLinesInput.value = s.max_lines || 5;

        const checkShowOrig = document.getElementById('check-show-original');
        if (checkShowOrig) checkShowOrig.checked = s.show_original !== false;

        const defLogsScopeSelect = document.getElementById('select-default-logs-scope');
        if (defLogsScopeSelect) defLogsScopeSelect.value = s.default_logs_scope || 'work';

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
        } catch (err) {
            console.error('[App] _populateSettingsForm error:', err);
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
            translation_timing: document.getElementById('select-translation-timing')?.value || settingsManager.get().translation_timing || 'on_pause',
            inactivity_timeout_min: parseInt(document.getElementById('select-inactivity-timeout')?.value || '10', 10),
            translation_type: 'one_way',
            language_a: 'ja',
            language_b: 'vi',
            language_hints_strict: document.getElementById('check-strict-lang')?.checked || false,
            endpoint_delay: parseInt(document.getElementById('range-endpoint-delay')?.value || settingsManager.get().endpoint_delay || 3000),
            audio_source: document.querySelector('input[name="audio-source"]:checked')?.value || 'system',
            overlay_opacity: settingsManager.get().overlay_opacity ?? 0.85,
            font_size: parseInt(document.getElementById('input-font-size')?.value || 16),
            note_font_size: parseInt(document.getElementById('input-note-font-size')?.value || 14),
            note_font_family: document.getElementById('select-note-font-family')?.value || 'system',
            menu_font_family: document.getElementById('select-menu-font-family')?.value || 'system',
            menu_font_size: parseInt(document.getElementById('input-menu-font-size')?.value || 12),
            menu_font_weight: document.getElementById('select-menu-font-weight')?.value || 'medium',
            table_font_family: document.getElementById('select-table-font-family')?.value || 'system',
            table_font_size: parseInt(document.getElementById('input-table-font-size')?.value || 13),
            table_font_weight: document.getElementById('select-table-font-weight')?.value || 'medium',
            font_color: document.getElementById('input-font-color')?.value || '#ffffff',
            font_family: document.getElementById('select-font-family')?.value || 'system',
            max_lines: parseInt(document.getElementById('input-max-lines')?.value || 5),
            show_original: document.getElementById('check-show-original')?.checked !== false,
            default_logs_scope: document.getElementById('select-default-logs-scope')?.value || 'work',
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
        // Update menu & UI font settings
        const menuFamilies = {
            system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            roboto: "'Roboto', 'Google Sans', -apple-system, sans-serif",
            segoe: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
            arial: "Arial, -apple-system, sans-serif",
            monospace: "ui-monospace, SFMono-Regular, Menlo, monospace",
        };
        const noteFamilies = {
            system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            roboto: "'Roboto', -apple-system, sans-serif",
            arial: "Arial, -apple-system, sans-serif",
            georgia: "Georgia, serif",
            monospace: "ui-monospace, SFMono-Regular, Menlo, monospace",
        };
        const weightMap = {
            normal: '400',
            medium: '500',
            semibold: '700',
        };

        const boldWeightMap = {
            normal: '600',
            medium: '700',
            semibold: '800',
        };

        const menuFontFam = menuFamilies[settings.menu_font_family] || menuFamilies.system;
        const menuFontSize = settings.menu_font_size || 12;
        const menuFontWeight = weightMap[settings.menu_font_weight] || '500';
        const menuFontWeightBold = boldWeightMap[settings.menu_font_weight] || '700';
        const noteFontFam = noteFamilies[settings.note_font_family] || noteFamilies.system;

        const tableFontFam = menuFamilies[settings.table_font_family] || menuFamilies.system;
        const tableFontSize = settings.table_font_size || 13;
        const tableFontWeight = weightMap[settings.table_font_weight] || '500';
        const tableFontWeightBold = boldWeightMap[settings.table_font_weight] || '700';
        const tableTitleWeight = boldWeightMap[settings.table_font_weight] || '700';

        document.documentElement.style.setProperty('--menu-font-family', menuFontFam);
        document.documentElement.style.setProperty('--menu-font-size', `${menuFontSize}px`);
        document.documentElement.style.setProperty('--menu-font-weight', menuFontWeight);
        document.documentElement.style.setProperty('--menu-font-weight-bold', menuFontWeightBold);
        document.documentElement.style.setProperty('--note-font-family', noteFontFam);
        document.documentElement.style.setProperty('--table-font-family', tableFontFam);
        document.documentElement.style.setProperty('--table-font-size', `${tableFontSize}px`);
        document.documentElement.style.setProperty('--table-font-weight', tableFontWeight);
        document.documentElement.style.setProperty('--table-font-weight-bold', tableFontWeightBold);
        document.documentElement.style.setProperty('--table-title-weight', tableTitleWeight);

        // Update note editor font size
        const noteFontSize = settings.note_font_size || 14;
        document.documentElement.style.setProperty('--note-font-size', `${noteFontSize}px`);

        // Update transcript font variables
        const transcriptFamilies = {
            system: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
            inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            arial: "Arial, -apple-system, sans-serif",
            georgia: "Georgia, serif",
            monospace: "ui-monospace, SFMono-Regular, Menlo, monospace",
        };
        const transcriptFontFam = transcriptFamilies[settings.font_family] || transcriptFamilies.system;
        const transcriptFontSize = settings.font_size || 16;
        const transcriptFontColor = settings.font_color || '#ffffff';

        document.documentElement.style.setProperty('--transcript-font-family', transcriptFontFam);
        document.documentElement.style.setProperty('--transcript-font-size', `${transcriptFontSize}px`);
        document.documentElement.style.setProperty('--transcript-font-color', transcriptFontColor);

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

        // Keep translationMode and mode UI synced with settings
        if (settings.translation_mode) {
            this.translationMode = settings.translation_mode;
            const selectMode = document.getElementById('select-translation-mode');
            if (selectMode && selectMode.value !== settings.translation_mode) {
                selectMode.value = settings.translation_mode;
            }
            this._updateModeUI(settings.translation_mode);
        }

        // Update quick language and timing in toolbar
        const quickSrc = document.getElementById('quick-select-source-lang');
        const quickTgt = document.getElementById('quick-select-target-lang');
        if (quickSrc) {
            const validSrcs = ['auto', 'vi', 'ja', 'en'];
            quickSrc.value = validSrcs.includes(settings.source_language) ? settings.source_language : 'auto';
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

        if (settings.default_logs_scope) {
            this._activeLogsScopeFilter = settings.default_logs_scope;
        }
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
        if (this._suppressNextShowSessions) {
            this._suppressNextShowSessions = false;
            return;
        }
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

        this.translationMode = nextMode;
        settingsManager.save({ translation_mode: nextMode });
        const select = document.getElementById('select-translation-mode');
        if (select) select.value = nextMode;
        this._updateModeUI(nextMode);

        if (this.isRunning) {
            this._hotSwapToEngine(nextMode);
        }
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
                this._updateTranslationTypeUI?.('one_way');
            }
        }

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
        const sonioxKey = document.getElementById('input-api-key')?.value?.trim() || '';
        const openaiKey = document.getElementById('input-openai-key')?.value?.trim() || '';
        const geminiKey = document.getElementById('input-gemini-key')?.value?.trim() || '';

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
        this._hideNetworkAlertBanner();
        if (!this.sessionStartTime) {
            this._hadNetworkIssueInSession = false;
        }
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
            if (state === 'ready') {
                this._updateStatus('connected');
                this._hideNetworkAlertBanner();
            } else if (state === 'connecting') {
                this._updateStatus('connecting');
            }
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
            if (this.isRunning) {
                this._showNetworkAlertBanner('openai', err);
            }
        };
        this.openAiClient.onClosed = (reason) => {
            console.warn('[OpenAI Realtime] closed:', reason);
            if (this.isRunning) {
                this._showToast('OpenAI session closed — reconnecting…', 'success');
                this._showNetworkAlertBanner('openai', reason);
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
            if (state === 'ready') {
                this._updateStatus('connected');
                this._hideNetworkAlertBanner();
            } else if (state === 'connecting') {
                this._updateStatus('connecting');
            }
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
            // Suppress rapid consecutive duplicate of identical text (< 2500ms)
            const segs = this.transcriptUI.segments;
            const lastSeg = segs.length > 0 ? segs[segs.length - 1] : null;
            if (lastSeg && lastSeg.original === source && (!lastSeg.createdAt || Date.now() - lastSeg.createdAt < 2500)) {
                console.log('[Gemini Realtime] Suppressed consecutive duplicate source segment:', source);
                if (pendingId !== null && lastSeg.pendingId === null) {
                    lastSeg.pendingId = pendingId;
                    sessionStore.bindPendingSegmentId(source, pendingId);
                }
                return;
            }
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
            if (this.translationMode !== 'gemini') return;
            const msgStr = String(msg || '');
            if ((code === 'connect_failed' || code === 'session_failed') && (msgStr.includes('API key') || msgStr.includes('PERMISSION_DENIED'))) {
                this._showToast(`Gemini: ${msgStr || code}`, 'error');
                this._updateStatus('error');
                this.pause();
            } else if (this.isRunning) {
                this._showNetworkAlertBanner('gemini', msgStr || code);
                if (navigator.onLine) {
                    this._scheduleGeminiReconnect(2500);
                }
            }
        };
        this.geminiClient.onClosed = (reason) => {
            console.warn('[Gemini Realtime] closed:', reason);
            if (this.translationMode !== 'gemini') return;
            if (this.isRunning) {
                this._showNetworkAlertBanner('gemini', reason);
                if (navigator.onLine) {
                    this._scheduleGeminiReconnect(2500);
                }
            }
        };

        // 1. Ensure audio capture is running FIRST so meeting recording (.wav) continues 100% uninterrupted
        // and the macOS microphone privacy indicator remains steadily active without any flickering.
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
                return;
            }
        }

        // 2. Connect to Gemini Realtime WebSocket
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
                console.log('[Gemini Realtime] Connection failed, showing network banner...');
                this._showNetworkAlertBanner('gemini', errStr);
                if (navigator.onLine) {
                    this._scheduleGeminiReconnect(3000);
                }
            }
            return;
        }
    }

    _scheduleGeminiReconnect(delayMs = 2500) {
        if (!this.isRunning || this.translationMode !== 'gemini') return;
        if (!navigator.onLine) {
            console.log('[Gemini Realtime] Network offline, skipping auto-reconnect loop');
            return;
        }
        if (this._geminiReconnectTimer) {
            clearTimeout(this._geminiReconnectTimer);
            this._geminiReconnectTimer = null;
        }
        console.log(`[Gemini Realtime] Scheduling auto-reconnect in ${delayMs}ms...`);
        this._geminiReconnectTimer = setTimeout(async () => {
            this._geminiReconnectTimer = null;
            if (!this.isRunning || this.translationMode !== 'gemini' || !navigator.onLine) return;
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
            if (state === 'ready') {
                this._updateStatus('connected');
                this._hideNetworkAlertBanner();
            } else if (state === 'connecting') {
                this._updateStatus('connecting');
            }
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
            if (this.isRunning) {
                this._showNetworkAlertBanner('qwen', msg || code);
            }
        };
        this.qwenClient.onClosed = (reason) => {
            console.warn('[Qwen Realtime] closed:', reason);
            if (this.isRunning) {
                this._showToast('Qwen session closed — reconnecting…', 'success');
                this._showNetworkAlertBanner('qwen', reason);
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

        // Step 0: Check audio permission
        if (!await this._ensureMicrophonePermission()) {
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
                if (!navigator.onLine) {
                    this._showToast('Mô hình Local MLX chưa tải và máy đang mất mạng.', 'error');
                    this.transcriptUI.showStatusMessage('Chưa có mô hình offline. Cần có internet để tải mô hình lần đầu.');
                    this._updateStatus('error');
                    this.isRunning = false;
                    this._updateStartButton();
                    return;
                }
                this._showToast('Setting up MLX models (one-time, ~5GB)...', 'success');
                this.transcriptUI.showStatusMessage('Downloading MLX models (one-time setup)...');
                await this._runMlxSetup();
            }
        } catch (err) {
            console.warn('[App] MLX check failed (proceeding anyway):', err);
        }

        console.log('[App] MLX check passed, starting pipeline...');

        // Step 2: Start pipeline FIRST (independent of audio)
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

        // Step 3: Start audio capture
        try {
            const audioChannel = new window.__TAURI__.core.Channel();
            let audioChunkCount = 0;

            audioChannel.onmessage = async (pcmData) => {
                audioChunkCount++;
                if (audioChunkCount <= 3 || audioChunkCount % 50 === 0) {
                    console.log(`[Local] Audio batch #${audioChunkCount}, size:`, pcmData?.length || 0);
                }
                this._updateAudioMeter(pcmData);
                // Do NOT send audio chunks into pipe until models are loaded
                if (!this.localPipelineReady) return;
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
            this._audioCaptureActive = true;
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

    async _stopTranslationEngine({ preserveFinalResults = false } = {}) {
        this._audioCaptureActive = false;
        // Stop audio capture
        try {
            await invoke('stop_capture');
        } catch (err) {
            console.error('Failed to stop audio capture:', err);
        }

        // Cleanly detach and disconnect all live engines & cancel reconnect timers
        await this._disconnectLiveEngine({ preserveFinalResults });

        // Ensure local pipeline is stopped if active
        try {
            await invoke('stop_local_pipeline');
        } catch (err) {
            console.error('Failed to stop local pipeline:', err);
        }
        this.localPipelineReady = false;
        this.localPipelineChannel = null;
        this.transcriptUI.removeStatusMessage();
        this._updateStatus('disconnected');

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
        this._hideNetworkAlertBanner();
        await this._stopTranslationEngine({ preserveFinalResults: true });

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

    async _getAllKnownTags(scope = null) {
        try {
            const reg = await this._loadProjectRegistry();
            const regTags = reg.tags || [];
            let sessionTags = [];
            if (this._cachedSessions && this._cachedSessions.length > 0) {
                sessionTags = this._cachedSessions.flatMap(sess => sess.tags || []);
            } else {
                try {
                    const sessions = await invoke('list_sessions');
                    this._cachedSessions = sessions || [];
                    sessionTags = (this._cachedSessions || []).flatMap(sess => sess.tags || []);
                } catch (_) {
                    // Ignore
                }
            }
            const tagSet = new Set();
            for (const t of [...regTags, ...sessionTags]) {
                if (typeof t === 'string' && t.trim()) {
                    tagSet.add(t.trim().replace(/^#+/, '').toLowerCase());
                }
            }
            if (scope === 'work' || scope === 'personal') {
                return this._getKnownTagsForScope(scope, false);
            }
            return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
        } catch (err) {
            console.error('Failed to get known tags:', err);
            return [];
        }
    }

    // Shared tags remain available in the live note editor; edit-session
    // metadata passes includeShared=false to keep the selected scope isolated.
    _getKnownTagsForScope(scope = 'work', includeShared = true) {
        const reg = this._projectRegistry || { tags: [], tag_scopes: {} };
        const sessions = this._cachedSessions || [];
        const tagScopes = reg.tag_scopes || {};
        const allTagNames = new Set();

        const normalizeTag = (value) => String(value || '').trim().replace(/^#+/, '').toLowerCase();
        for (const tag of reg.tags || []) {
            const cleanTag = normalizeTag(tag);
            if (cleanTag) allTagNames.add(cleanTag);
        }
        for (const session of sessions) {
            for (const tag of session.tags || []) {
                const cleanTag = normalizeTag(tag);
                if (cleanTag) allTagNames.add(cleanTag);
            }
        }

        return Array.from(allTagNames)
            .filter((tag) => {
                const declaredScope = tagScopes[tag] || tagScopes[`#${tag}`];
                if (declaredScope === 'all') return includeShared;
                if (declaredScope === 'work' || declaredScope === 'personal') {
                    return declaredScope === scope;
                }

                const matchingSessions = sessions.filter((session) =>
                    (session.tags || []).some((sessionTag) => normalizeTag(sessionTag) === tag)
                );
                if (matchingSessions.length === 0) return scope === 'work';
                return matchingSessions.some((session) =>
                    (session.scope || 'work') === scope
                );
            })
            .sort((a, b) => a.localeCompare(b));
    }

    _setupTagAutocomplete(inputEl, suggestionsBoxEl, knownTags = []) {
        if (!inputEl) return () => {};

        // Ẩn box gợi ý tĩnh cũ nếu có
        if (suggestionsBoxEl) {
            suggestionsBoxEl.style.display = 'none';
            suggestionsBoxEl.innerHTML = '';
        }

        const uniqueKnownTags = Array.from(
            new Set(knownTags.map(t => String(t || '').trim().replace(/^#+/, '').toLowerCase()).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));

        // Lấy danh sách tag đã được chọn sẵn từ input
        let selectedTags = (inputEl.value || '')
            .split(',')
            .map(t => t.trim().replace(/^#+/, '').toLowerCase())
            .filter(Boolean);

        // Ẩn input ban đầu
        inputEl.style.display = 'none';

        // Xóa wrapper cũ nếu đã từng gắn vào input này
        const existingWrap = inputEl.parentNode?.querySelector(`.tag-tokenize-wrap[data-for="${CSS.escape(inputEl.id || '')}"]`);
        if (existingWrap) existingWrap.remove();

        // Tạo cấu trúc Tokenize2
        const wrap = document.createElement('div');
        wrap.className = 'tag-tokenize-wrap';
        if (inputEl.id) wrap.dataset.for = inputEl.id;

        const box = document.createElement('div');
        box.className = 'tag-tokenize-box';

        const chipsWrap = document.createElement('div');
        chipsWrap.className = 'tag-tokenize-chips';

        const inlineInput = document.createElement('input');
        inlineInput.type = 'text';
        inlineInput.className = 'tag-tokenize-input';
        inlineInput.autocomplete = 'off';
        inlineInput.spellcheck = false;
        inlineInput.setAttribute('aria-label', inputEl.getAttribute('aria-label') || 'Chọn tag');

        box.appendChild(chipsWrap);
        box.appendChild(inlineInput);
        wrap.appendChild(box);

        const dropdown = document.createElement('div');
        dropdown.className = 'tag-tokenize-dropdown';
        dropdown.style.display = 'none';
        const isLiveNoteAutocomplete = inputEl.id === 'input-note-tags';
        if (isLiveNoteAutocomplete) {
            // The live Take Note bar sits at the bottom of the window and its
            // toolbar scroll container clips an upward-opening dropdown. A
            // body-level portal keeps the suggestions visible above that
            // container while retaining the same keyboard/mouse behavior.
            dropdown.classList.add('is-portal');
            document.body.appendChild(dropdown);
        } else {
            wrap.appendChild(dropdown);
        }

        // Chèn wrapper ngay sau inputEl
        inputEl.parentNode.insertBefore(wrap, inputEl.nextSibling);

        let highlightedIndex = -1;
        let isDropdownOpen = false;
        let currentSuggestions = [];

        const syncToHiddenInput = () => {
            inputEl.value = selectedTags.map(t => `#${t}`).join(', ');
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        };

        const renderChips = () => {
            chipsWrap.innerHTML = '';
            for (let i = 0; i < selectedTags.length; i++) {
                const tag = selectedTags[i];
                const chip = document.createElement('span');
                chip.className = 'tag-chip';
                chip.dataset.tag = tag;

                const label = document.createElement('span');
                label.className = 'tag-chip-label';
                label.textContent = `#${tag}`;

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'tag-chip-remove';
                removeBtn.title = 'Xoá thẻ';
                removeBtn.tabIndex = -1;
                removeBtn.innerHTML = '×';
                removeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectedTags.splice(i, 1);
                    syncToHiddenInput();
                    renderChips();
                    if (isDropdownOpen) renderDropdown();
                    inlineInput.focus();
                });

                chip.appendChild(label);
                chip.appendChild(removeBtn);
                chipsWrap.appendChild(chip);
            }

            inlineInput.placeholder = 'Tag';
        };

        const highlightMatch = (text, query) => {
            if (!query) return this._esc(text);
            const idx = text.toLowerCase().indexOf(query.toLowerCase());
            if (idx === -1) return this._esc(text);
            const before = text.slice(0, idx);
            const match = text.slice(idx, idx + query.length);
            const after = text.slice(idx + query.length);
            return `${this._esc(before)}<mark>${this._esc(match)}</mark>${this._esc(after)}`;
        };

        const repositionDropdown = () => {
            if (!isLiveNoteAutocomplete || !isDropdownOpen) return;
            const rect = box.getBoundingClientRect();
            const viewportPadding = 8;
            const width = Math.min(rect.width, Math.max(0, window.innerWidth - viewportPadding * 2));
            const left = Math.min(
                Math.max(viewportPadding, rect.left),
                Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
            );
            const spaceAbove = Math.max(0, rect.top - viewportPadding - 4);
            const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding - 4);
            const openAbove = spaceAbove >= 150 || spaceAbove > spaceBelow;

            dropdown.style.left = `${left}px`;
            dropdown.style.right = 'auto';
            dropdown.style.width = `${width}px`;
            dropdown.style.maxHeight = `${Math.max(80, Math.min(180, openAbove ? spaceAbove : spaceBelow))}px`;
            if (openAbove) {
                dropdown.style.top = 'auto';
                dropdown.style.bottom = `${Math.max(viewportPadding, window.innerHeight - rect.top + 4)}px`;
            } else {
                dropdown.style.bottom = 'auto';
                dropdown.style.top = `${rect.bottom + 4}px`;
            }
        };

        const renderDropdown = () => {
            const rawQuery = inlineInput.value.trim().replace(/^#+/, '').toLowerCase();
            const selectedSet = new Set(selectedTags);

            // Lọc các thẻ có sẵn chưa được chọn
            const availableKnown = uniqueKnownTags.filter(t => !selectedSet.has(t));
            let matches = rawQuery
                ? availableKnown.filter(t => t.includes(rawQuery))
                : availableKnown;

            currentSuggestions = [];
            dropdown.innerHTML = '';

            // Thêm các thẻ khớp
            for (const tag of matches) {
                currentSuggestions.push({ type: 'existing', tag });
            }

            // Nếu người dùng nhập tag mới không trùng với tag nào
            const isExactMatch = matches.some(t => t.toLowerCase() === rawQuery);
            if (rawQuery && !selectedSet.has(rawQuery) && !isExactMatch) {
                currentSuggestions.push({ type: 'create', tag: rawQuery });
            }

            if (currentSuggestions.length === 0) {
                if (selectedTags.length > 0 && availableKnown.length === 0 && !rawQuery) {
                    dropdown.innerHTML = `<div class="tag-tokenize-empty">Đã chọn tất cả thẻ có sẵn</div>`;
                } else if (rawQuery) {
                    dropdown.innerHTML = `<div class="tag-tokenize-empty">Nhấn Enter để thêm thẻ mới "<b>${this._esc(rawQuery)}</b>"</div>`;
                } else {
                    dropdown.innerHTML = `<div class="tag-tokenize-empty">Gõ để tìm hoặc tạo thẻ mới</div>`;
                }
                dropdown.style.display = 'block';
                isDropdownOpen = true;
                repositionDropdown();
                return;
            }

            if (highlightedIndex < 0 || highlightedIndex >= currentSuggestions.length) {
                highlightedIndex = 0;
            }

            currentSuggestions.forEach((item, index) => {
                const itemEl = document.createElement('div');
                itemEl.className = `tag-tokenize-item ${index === highlightedIndex ? 'highlighted' : ''} ${item.type === 'create' ? 'create-item' : ''}`;
                
                if (item.type === 'existing') {
                    itemEl.innerHTML = `<span>#${highlightMatch(item.tag, rawQuery)}</span>`;
                } else {
                    itemEl.innerHTML = `<span>➕ Tạo thẻ mới: <b>#${this._esc(item.tag)}</b></span><span style="font-size:10px;opacity:0.7">Enter</span>`;
                }

                itemEl.addEventListener('mouseenter', () => {
                    highlightedIndex = index;
                    updateHighlighted();
                });

                itemEl.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // Tránh mất focus inline input
                    selectSuggestion(item);
                });

                dropdown.appendChild(itemEl);
            });

            dropdown.style.display = 'block';
            isDropdownOpen = true;
            repositionDropdown();
        };

        const updateHighlighted = () => {
            const items = dropdown.querySelectorAll('.tag-tokenize-item');
            items.forEach((el, idx) => {
                el.classList.toggle('highlighted', idx === highlightedIndex);
                if (idx === highlightedIndex) {
                    el.scrollIntoView({ block: 'nearest' });
                }
            });
        };

        const selectSuggestion = (item) => {
            if (!item || !item.tag) return;
            const cleanTag = item.tag.trim().replace(/^#+/, '').toLowerCase();
            if (cleanTag && !selectedTags.includes(cleanTag)) {
                selectedTags.push(cleanTag);
                syncToHiddenInput();
                renderChips();
            }
            inlineInput.value = '';
            highlightedIndex = 0;
            const remaining = uniqueKnownTags.filter(t => !selectedTags.includes(t));
            if (remaining.length > 0) {
                renderDropdown();
            } else {
                closeDropdown();
            }
            inlineInput.focus();
        };

        const openDropdown = () => {
            highlightedIndex = 0;
            renderDropdown();
        };

        const closeDropdown = () => {
            dropdown.style.display = 'none';
            dropdown.innerHTML = '';
            isDropdownOpen = false;
            highlightedIndex = -1;
            box.classList.remove('is-focused');
        };

        box.addEventListener('click', (e) => {
            if (e.target !== inlineInput) {
                inlineInput.focus();
            }
        });

        inlineInput.addEventListener('focus', () => {
            box.classList.add('is-focused');
            openDropdown();
        });

        inlineInput.addEventListener('input', () => {
            highlightedIndex = 0;
            renderDropdown();
        });

        inlineInput.addEventListener('keydown', (e) => {
            e.stopPropagation(); // Không trigger submit hay close của modal cha

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!isDropdownOpen) {
                    openDropdown();
                } else if (currentSuggestions.length > 0) {
                    highlightedIndex = (highlightedIndex + 1) % currentSuggestions.length;
                    updateHighlighted();
                }
                return;
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (isDropdownOpen && currentSuggestions.length > 0) {
                    highlightedIndex = (highlightedIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
                    updateHighlighted();
                }
                return;
            }

            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                if (isDropdownOpen && highlightedIndex >= 0 && currentSuggestions[highlightedIndex]) {
                    selectSuggestion(currentSuggestions[highlightedIndex]);
                } else {
                    const raw = inlineInput.value.trim().replace(/^#+/, '').toLowerCase();
                    if (raw) {
                        selectSuggestion({ type: 'create', tag: raw });
                    }
                }
                return;
            }

            if (e.key === 'Backspace') {
                if (inlineInput.value === '' && selectedTags.length > 0) {
                    e.preventDefault();
                    selectedTags.pop();
                    syncToHiddenInput();
                    renderChips();
                    if (isDropdownOpen) renderDropdown();
                }
                return;
            }

            if (e.key === 'Escape') {
                if (isDropdownOpen) {
                    e.preventDefault();
                    closeDropdown();
                }
                return;
            }
        });

        const onDocClick = (e) => {
            const clickedPortalDropdown = isLiveNoteAutocomplete && dropdown.contains(e.target);
            if (!wrap.contains(e.target) && !clickedPortalDropdown) {
                closeDropdown();
            }
        };
        document.addEventListener('pointerdown', onDocClick);
        if (isLiveNoteAutocomplete) {
            window.addEventListener('resize', repositionDropdown);
            window.addEventListener('scroll', repositionDropdown, true);
        }

        // Render chips ban đầu
        renderChips();

        return () => {
            document.removeEventListener('pointerdown', onDocClick);
            if (isLiveNoteAutocomplete) {
                window.removeEventListener('resize', repositionDropdown);
                window.removeEventListener('scroll', repositionDropdown, true);
                dropdown.remove();
            }
            wrap.remove();
            inputEl.style.display = '';
        };
    }

    // Stop: pause (if running), finalize the current session file with custom title,
    // then start a fresh session so the next Start writes a new file pair.
    async _promptConfirmStop() {
        const modal = document.getElementById('modal-confirm-stop');
        const input = document.getElementById('input-stop-meeting-title');
        const inputTags = document.getElementById('input-stop-meeting-tags');
        const suggestionsBox = document.getElementById('stop-meeting-tags-suggestions');
        const selectCust = document.getElementById('select-stop-meeting-customer');
        const selectProj = document.getElementById('select-stop-meeting-project');
        const selectCat = document.getElementById('select-stop-meeting-category');
        const defaultTitle = sessionStore.title || this._formatDefaultMeetingTitle(this.sessionStartTime || this.recordingStartTime);

        const [reg, knownTags] = await Promise.all([
            this._loadProjectRegistry(),
            this._getAllKnownTags(),
        ]);
        const activeCustomers = (reg.customers || []).filter(c => c.status === 'active');
        const activeProjects = (reg.projects || []).filter(p => p.status === 'active');

        // Populate customer select
        if (selectCust) {
            let custHtml = '<option value="">(Không chọn KH)</option>';
            for (const c of activeCustomers) {
                custHtml += `<option value="${this._escAttr(c.id)}">🤝 ${this._esc(c.name)}</option>`;
            }
            selectCust.innerHTML = custHtml;
            selectCust.value = sessionStore.customerId || '';
        }

        const stopScope = sessionStore.scope || 'work';
        const workRadio = document.querySelector('input[name="stop-meeting-scope"][value="work"]');
        const personalRadio = document.querySelector('input[name="stop-meeting-scope"][value="personal"]');
        const custWrap = document.getElementById('stop-customer-field-wrap');

        if (stopScope === 'personal') {
            if (personalRadio) personalRadio.checked = true;
            if (workRadio) workRadio.checked = false;
            if (custWrap) custWrap.style.display = 'none';
        } else {
            if (workRadio) workRadio.checked = true;
            if (personalRadio) personalRadio.checked = false;
            if (custWrap) custWrap.style.display = '';
        }
        document.querySelectorAll('#stop-meeting-scope-group .scope-radio-btn').forEach(btn => {
            const rad = btn.querySelector('input[type="radio"]');
            btn.classList.toggle('active', rad && rad.checked);
        });

        const getCurrentChosenScope = () => {
            return document.querySelector('input[name="stop-meeting-scope"]:checked')?.value || 'work';
        };

        // Helper to populate projects filtered by selected scope & customer
        const updateProjectsDropdown = (selectedCustomerId, scope) => {
            if (!selectProj) return;
            let filteredProjs = activeProjects;
            if (scope === 'personal') {
                filteredProjs = activeProjects.filter(p => p.scope === 'personal');
            } else {
                filteredProjs = activeProjects.filter(p => (p.scope || 'work') === 'work');
                if (selectedCustomerId) {
                    filteredProjs = filteredProjs.filter(p => p.customer_id === selectedCustomerId);
                }
            }
            let projHtml = '<option value="">(Không gán dự án)</option>';
            for (const p of filteredProjs) {
                projHtml += `<option value="${this._escAttr(p.id)}">🚀 ${this._esc(p.name)}</option>`;
            }
            selectProj.innerHTML = projHtml;
            if (filteredProjs.some(p => p.id === sessionStore.projectId)) {
                selectProj.value = sessionStore.projectId;
            } else {
                selectProj.value = '';
            }
        };

        updateProjectsDropdown(selectCust?.value || sessionStore.customerId, getCurrentChosenScope());

        const onScopeChange = () => {
            const curScope = getCurrentChosenScope();
            document.querySelectorAll('#stop-meeting-scope-group .scope-radio-btn').forEach(btn => {
                const rad = btn.querySelector('input[type="radio"]');
                btn.classList.toggle('active', rad && rad.checked);
            });
            if (custWrap) {
                custWrap.style.display = curScope === 'personal' ? 'none' : '';
            }
            if (curScope === 'personal' && selectCust) {
                selectCust.value = '';
            }
            updateProjectsDropdown(selectCust?.value, curScope);
        };

        const onScopeBtnClick = (e) => {
            const label = e.currentTarget;
            const rad = label.querySelector('input[type="radio"]');
            if (rad && !rad.checked) {
                rad.checked = true;
                onScopeChange();
            }
        };

        document.querySelectorAll('#stop-meeting-scope-group .scope-radio-btn').forEach(btn => {
            btn.addEventListener('click', onScopeBtnClick);
        });

        document.querySelectorAll('input[name="stop-meeting-scope"]').forEach(r => {
            r.addEventListener('change', onScopeChange);
        });

        const onCustChange = () => {
            updateProjectsDropdown(selectCust?.value, getCurrentChosenScope());
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
            let catHtml = '<option value="">(Không chọn category)</option>';
            for (const c of (reg.categories || [])) {
                catHtml += `<option value="${this._escAttr(c.name)}">🗂️ ${this._esc(c.name)}</option>`;
            }
            selectCat.innerHTML = catHtml;
            selectCat.value = sessionStore.category || '';
        }

        const chkAutoRetranscript = document.getElementById('chk-stop-auto-retranscript');
        const savedAutoRetranscript = localStorage.getItem('meet_minder_auto_retranscript');
        if (chkAutoRetranscript) {
            if (this._hadNetworkIssueInSession) {
                chkAutoRetranscript.checked = true;
            } else {
                chkAutoRetranscript.checked = savedAutoRetranscript !== 'false';
            }
        }

        const onAutoRetranscriptChange = () => {
            if (!chkAutoRetranscript) return;
            localStorage.setItem('meet_minder_auto_retranscript', chkAutoRetranscript.checked ? 'true' : 'false');
        };
        chkAutoRetranscript?.addEventListener('change', onAutoRetranscriptChange);

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

        const chkAutoRetranscriptLabel = document.getElementById('chk-stop-auto-retranscript-label');
        if (chkAutoRetranscriptLabel) {
            if (this._hadNetworkIssueInSession) {
                chkAutoRetranscriptLabel.innerHTML = '🔄 Re-transcript để tối ưu nội dung <span style="color:#f59e0b;font-size:11px;font-weight:normal;margin-left:4px;">(Khuyên dùng vì có đoạn mạng gián đoạn)</span>';
            } else {
                chkAutoRetranscriptLabel.textContent = '🔄 Re-transcript để tối ưu nội dung';
            }
        }

        const chkAutoMinutesLabel = document.getElementById('chk-stop-auto-minutes-label');
        const chkAutoMinutesHint = document.getElementById('chk-stop-auto-minutes-hint');
        if (chkAutoMinutesLabel) {
            chkAutoMinutesLabel.textContent = '✨ Tạo Meeting Minutes sau khi lưu';
        }
        if (chkAutoMinutesHint) {
            chkAutoMinutesHint.textContent = 'Tóm tắt theo template có sẵn';
        }

        const currentSettings = settingsManager.get();
        const autoMinutesLang = currentSettings.meeting_minutes_lang || 'vi';

        if (!modal) {
            const entered = prompt('Nhập tên cuộc họp để kết thúc & lưu:', defaultTitle);
            return entered !== null ? {
                title: entered.trim() || defaultTitle,
                tags: sessionStore.tags || [],
                customerId: sessionStore.customerId,
                projectId: sessionStore.projectId,
                category: sessionStore.category,
                scope: sessionStore.scope || 'work',
                autoRetranscript: chkAutoRetranscript ? chkAutoRetranscript.checked : (savedAutoRetranscript !== 'false'),
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
        const cleanupTags = this._setupTagAutocomplete(inputTags, suggestionsBox, knownTags);
        this._isStopConfirmationOpen = true;
        modal.style.display = 'flex';
        if (input) {
            input.focus();
            input.select();
        }

        return new Promise((resolve) => {
            const onConfirm = () => {
                try {
                    cleanup();
                    const chosenTitle = (input ? input.value.trim() : '') || defaultTitle;
                    const chosenTags = (inputTags ? inputTags.value : '')
                        .split(',')
                        .map(t => t.trim().replace(/^#/, '').toLowerCase())
                        .filter(Boolean);
                    const chosenScope = getCurrentChosenScope();
                    const chosenCustomerId = chosenScope === 'personal' ? null : (selectCust?.value || null);
                    const chosenProjectId = selectProj?.value || null;
                    const chosenCategory = selectCat?.value || null;
                    const autoRetranscript = chkAutoRetranscript ? chkAutoRetranscript.checked : false;
                    const autoGenerateMinutes = chkAutoMinutes ? chkAutoMinutes.checked : false;
                    modal.style.display = 'none';
                    resolve({
                        title: chosenTitle,
                        tags: chosenTags,
                        customerId: chosenCustomerId,
                        projectId: chosenProjectId,
                        category: chosenCategory,
                        scope: chosenScope,
                        autoRetranscript,
                        autoGenerateMinutes,
                        minutesLang: autoMinutesLang,
                        discard: false,
                    });
                } catch (err) {
                    console.error('[App] onConfirm error:', err);
                    cleanup();
                    modal.style.display = 'none';
                    resolve(null);
                }
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
                cleanupTags?.();
                document.querySelectorAll('#stop-meeting-scope-group .scope-radio-btn').forEach(btn => {
                    btn.removeEventListener('click', onScopeBtnClick);
                });
                document.querySelectorAll('input[name="stop-meeting-scope"]').forEach(r => {
                    r.removeEventListener('change', onScopeChange);
                });
                selectCust?.removeEventListener('change', onCustChange);
                selectProj?.removeEventListener('change', onProjChange);
                chkAutoRetranscript?.removeEventListener('change', onAutoRetranscriptChange);
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
            document.getElementById('btn-cancel-confirm-stop')?.removeEventListener('click', onCancel);
            document.getElementById('btn-close-confirm-stop')?.removeEventListener('click', onCancel);
            input?.addEventListener('keydown', onKeyDown);
            inputTags?.addEventListener('keydown', onKeyDown);
            window.addEventListener('keydown', onKeyDown);
        });
    }

    async stopSession(chosenTitle = null, chosenTags = null, chosenCustomerId = null, chosenProjectId = null, chosenCategory = null, chosenScope = null) {
        if (this.isRunning) await this.pause();

        const hasSegments = !sessionStore.isEmpty() && sessionStore.totalSegmentCount() > 0;
        const hasNotes = Boolean(sessionStore.notes && sessionStore.notes.trim());
        const hadData = hasSegments || hasNotes;
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
        if (chosenScope !== undefined && chosenScope !== null) {
            sessionStore.scope = chosenScope || 'work';
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
        this._hideNetworkAlertBanner();
        this._hadNetworkIssueInSession = false;
        this.sessionStartTime = null;
        this.recordingStartTime = null;
        this._stopLiveDurationTimer();
        this._clearInactivityTimer();
        this._updateLiveDurationDisplay();

        // Clear transcript UI back to fresh empty placeholder screen
        if (this.transcriptUI) {
            this.transcriptUI.clear();
            this.transcriptUI.showPlaceholder();
        }
        this._updateStatus('idle');

        // Reset live notes to template and clear metadata selectors (keep drawer open by default)
        if (this._liveNotesEditor) {
            const template = this._getNoteTemplate();
            this._suppressLiveNoteDraft = true;
            this._liveNotesEditor.setContent(template);
            this._suppressLiveNoteDraft = false;
            sessionStore.notes = template;
        }
        this._resetNoteMetadataSelectors();

        const settings = settingsManager.get();
        sessionStore.init({
            engine: settings.translation_mode || 'gemini',
            sourceLang: settings.source_language || 'ja',
            targetLang: settings.target_language || 'vi',
        });
        this._syncLiveMeetingTitleInput();
        this._updateStartButton();

        return hadData ? savedSessionId : null;
    }

    async _handleStopSessionAction(stopAction) {
        if (!stopAction) return;
        if (this._isStoppingSession) return;
        this._isStoppingSession = true;
        const btnStop = document.getElementById('btn-stop');
        if (btnStop) {
            btnStop.classList.add('disabled');
            btnStop.style.pointerEvents = 'none';
            btnStop.style.opacity = '0.5';
        }
        try {
            if (stopAction.discard) {
                await this.discardSession();
            } else {
                const savedId = await this.stopSession(
                    stopAction.title,
                    stopAction.tags,
                    stopAction.customerId,
                    stopAction.projectId,
                    stopAction.category,
                    stopAction.scope
                );

                if (savedId) {
                    // A completed meeting is the most useful backup boundary;
                    // the scheduler will also handle later note edits.
                    this._runGitBackup({ push: false }).catch(err => console.warn('[Git backup] post-meeting backup failed:', err));
                    if (stopAction.autoRetranscript) {
                        setActivity('library');
                        await this._openSession(savedId);

                        const settings = settingsManager.get();
                        const apiKey = settings.gemini_api_key?.trim();

                        if (!apiKey) {
                            this._showToast('Không thể tự động re-transcript: Cần Gemini API Key trong Cài đặt', 'warning');
                            if (stopAction.autoGenerateMinutes) {
                                this._switchSessionTab('minutes');
                                await this._generateMeetingMinutesForSession(savedId, stopAction.minutesLang || 'vi');
                            }
                        } else {
                            this._retranscribeSession(savedId, false, {
                                generateMinutes: stopAction.autoGenerateMinutes,
                                minutesLang: null,
                                customTitle: 'Re-transcript để tối ưu nội dung'
                            }).catch(err => {
                                console.error('[App] Auto retranscript error:', err);
                            });
                        }
                    } else if (stopAction.autoGenerateMinutes) {
                        setActivity('library');
                        await this._openSession(savedId);
                        this._switchSessionTab('minutes');
                        try {
                            const res = await invoke('read_session', { id: savedId });
                            const mLangs = this._getMinutesLangsForSession(res?.json || {});
                            for (const mLang of mLangs) {
                                await this._generateMeetingMinutesForSession(savedId, mLang);
                            }
                        } catch (minErr) {
                            console.error('[App] Error creating minutes on stop:', minErr);
                            await this._generateMeetingMinutesForSession(savedId, 'ja');
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[App] Stop session error:', err);
            this._showToast(`Lỗi kết thúc: ${err}`, 'error');
        } finally {
            this._isStoppingSession = false;
            if (btnStop) {
                btnStop.classList.remove('disabled');
                btnStop.style.pointerEvents = '';
                btnStop.style.opacity = '';
            }
            if (this._pendingUpdateReadyBanner) {
                const pendingVer = this._pendingUpdateReadyBanner;
                this._pendingUpdateReadyBanner = null;
                setTimeout(() => this._showUpdateReadyBanner(pendingVer), 1200);
            }
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
            this._suppressLiveNoteDraft = true;
            this._liveNotesEditor.setContent(template);
            this._suppressLiveNoteDraft = false;
            sessionStore.notes = template;
        }
        this._resetNoteMetadataSelectors();

        const settings = settingsManager.get();
        sessionStore.init({
            engine: settings.translation_mode || 'gemini',
            sourceLang: settings.source_language || 'ja',
            targetLang: settings.target_language || 'vi',
        });
        this._syncLiveMeetingTitleInput();
        this._updateStatus('idle');
        this._updateStartButton();
        if (this._pendingUpdateReadyBanner) {
            const pendingVer = this._pendingUpdateReadyBanner;
            this._pendingUpdateReadyBanner = null;
            setTimeout(() => this._showUpdateReadyBanner(pendingVer), 1200);
        }
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
        try { await this._runGitBackup({ push: false }); } catch (e) { console.warn('[Git backup] exit backup failed:', e); }
    }

    // Two close routes, one flush:
    //  • window ✕ / appWindow.close() → onCloseRequested (frontend)
    //  • Cmd+Q / Dock quit → Rust RunEvent::ExitRequested emits 'app-exit-requested'
    // Both flush (raced against a 3s deadline so a hung engine can't wedge the
    // app) then exit_app, which force-exits the process cleanly in Rust.
    async _bindCloseHooks() {
        // macOS normally consumes Cmd+Q before WebView receives it, but keep a
        // capture-phase guard for environments where the shortcut is delivered
        // to the frontend (including the Dev app's WebView inspector).
        window.addEventListener('keydown', async (event) => {
            if (!event.metaKey || event.key.toLowerCase() !== 'q') return;

            event.preventDefault();
            event.stopImmediatePropagation();
            if (this._closing) return;

            const now = Date.now();
            const confirmed = this._lastQuitShortcutAt
                && now - this._lastQuitShortcutAt <= 2000;
            this._lastQuitShortcutAt = now;
            if (!confirmed) {
                this._showToast('Nhấn ⌘Q lần nữa trong 2 giây để thoát', 'warning');
                return;
            }

            this._closing = true;
            await Promise.race([this._flushOnExit(), this._sleep(3000)]);
            try { await invoke('exit_app'); } catch {}
        }, true);

        await this.appWindow.onCloseRequested(async (event) => {
            if (this._closing) return;

            // Cmd+Q can arrive as a window close request on macOS. Mirror the
            // native ExitRequested guard here as well so that route cannot
            // bypass the double-press protection.
            if (!this._immediateCloseRequested) {
                const now = Date.now();
                const confirmed = this._lastCloseRequestAt
                    && now - this._lastCloseRequestAt <= 2000;
                this._lastCloseRequestAt = now;
                if (!confirmed) {
                    event.preventDefault();
                    this._showToast('Nhấn ⌘Q lần nữa trong 2 giây để thoát', 'warning');
                    return;
                }
            } else {
                this._immediateCloseRequested = false;
            }

            this._closing = true;
            event.preventDefault();
            await Promise.race([this._flushOnExit(), this._sleep(3000)]);
            try {
                await invoke('exit_app');
            } catch {
                try { await this.appWindow.destroy(); } catch {}
            }
        });

        await this.appWindow.listen('app-quit-confirmation-needed', () => {
            this._showToast('Nhấn ⌘Q lần nữa trong 2 giây để thoát', 'warning');
        });

        await this.appWindow.listen('app-exit-requested', async () => {
            if (this._closing) return;
            this._closing = true;
            await Promise.race([this._flushOnExit(), this._sleep(3000)]);
            try { await invoke('exit_app'); } catch {}
        });
    }

    async _bindAudioTranscriptProgressEvents() {
        await this.appWindow.listen('audio-transcript-progress', ({ payload }) => {
            const active = this._activeRetranscribe;
            if (!active || !payload || payload.id !== active.id) return;

            const validStages = ['upload', 'transcribe', 'save', 'minutes'];
            const stage = validStages.includes(payload.stage) ? payload.stage : active.stage;
            const percent = Number.isFinite(Number(payload.percent))
                ? Math.max(0, Math.min(98, Number(payload.percent)))
                : active.percent;
            const message = String(payload.message || active.text || 'Đang xử lý file ghi âm...');
            active.backendProgress = true;
            active.progressBaseText = message;
            this._setRetranscriptProgress(stage, message, percent, active.customTitle);
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
                if (labelStop) labelStop.innerHTML = 'Save & S<u>t</u>op';
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
                if (labelStop) labelStop.innerHTML = 'Save & S<u>t</u>op';
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
     * capture alive. Reconnects detach old callbacks immediately; Pause/Save
     * keeps Gemini callbacks until already accepted translations are drained.
     */
    async _disconnectLiveEngine({ preserveFinalResults = false } = {}) {
        if (this._geminiReconnectTimer) {
            clearTimeout(this._geminiReconnectTimer);
            this._geminiReconnectTimer = null;
        }
        if (this.geminiClient) {
            const client = this.geminiClient;
            this.geminiClient = null;
            const detachCallbacks = () => {
                client.onStatusChange = () => {};
                client.onSegment = () => {};
                client.onSourceFinal = () => {};
                client.onTranslationFailed = () => {};
                client.onProvisional = () => {};
                client.onError = () => {};
                client.onClosed = () => {};
            };
            // Pause/Save keeps callbacks alive while the backend drains already
            // accepted translations. Reconnect/hot-swap detaches immediately
            // so an old provider cannot write into the next chunk.
            if (!preserveFinalResults) detachCallbacks();
            try { await client.disconnect(); } catch (err) {
                console.warn('[Gemini Realtime] Error stopping old client:', err);
            }
            if (preserveFinalResults) detachCallbacks();
        }
        if (this.openAiClient) {
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
        }
        if (this.qwenClient) {
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
        }
        try {
            sonioxClient.disconnect();
            if (this._sonioxOriginalQueue) {
                for (const pending of this._sonioxOriginalQueue) {
                    this.transcriptUI.addTranslation('', pending.pendingId);
                }
                this._sonioxOriginalQueue.length = 0;
            }
        } catch {}

        try {
            await invoke('stop_local_pipeline');
        } catch {}
        this.localPipelineReady = false;
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
                const settings = settingsManager.get();

                // A language change starts a new persisted chunk. This keeps
                // the old transcript visible and prevents its language from
                // being misrepresented by the new session-level setting.
                sessionStore.endChunk();
                await sessionStore.persist();
                sessionStore.beginChunk({
                    engine: this.translationMode,
                    sourceLang: settings.source_language || this.sessionSourceLang || 'auto',
                    targetLang: settings.target_language || this.sessionTargetLang || 'none',
                });
                if (this.translationMode === 'local') {
                    // Local MLX needs Python process and its audio capture restarted
                    await this._stopTranslationEngine();
                } else {
                    // For cloud realtime engines (Gemini, Soniox, OpenAI, Qwen),
                    // only disconnect and reconnect the network socket.
                    // DO NOT stop audio capture! Keeping CoreAudio active ensures:
                    // 1. Meeting audio recording (.wav) continues 100% uninterrupted.
                    // 2. The macOS microphone privacy indicator never flickers on/off.
                    await this._disconnectLiveEngine();
                }
                if (!this.isRunning || generation !== this._liveEngineGeneration) return;
                await this._startTranslationEngine(settings);
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
        this._showToast(timing === 'realtime' ? '⚡ Kiểu dịch: Dịch ngay lập tức' : '⏳ Kiểu dịch: Dịch khi hết câu', 'info');
    }

    _adjustFontSize(delta) {
        const current = this.transcriptUI.fontSize || 16;
        const newSize = Math.max(12, Math.min(140, current + delta));
        this.transcriptUI.configure({ fontSize: newSize });

        // Update display
        const display = document.getElementById('font-size-display');
        if (display) display.textContent = newSize;

        // Sync with settings input
        const fontSizeInput = document.getElementById('input-font-size') || document.getElementById('range-font-size');
        if (fontSizeInput) fontSizeInput.value = newSize;
    }

    // ─── Toast ─────────────────────────────────────────────

    // ─── Session History ───────────────────────────────────

    // ─── Session History / Meeting Logs ───────────────────

    _updateBatchSelectionUI() {
        if (!this._selectedSessionIds) this._selectedSessionIds = new Set();
        const count = this._selectedSessionIds.size;
        const listEl = document.getElementById('sessions-list');
        if (!listEl) return;
        listEl.classList.toggle('has-selection', count > 0);
        const countEl = listEl.querySelector('[data-selected-count]');
        const batchBtn = listEl.querySelector('[data-batch-delete]');
        const selectAllChk = listEl.querySelector('#chk-select-all-sessions');
        const filteredIds = new Set((this._filteredSessions || []).map(s => s.id));
        const selectedInFiltered = [...this._selectedSessionIds].filter(id => filteredIds.has(id)).length;

        if (countEl) countEl.textContent = `${count} log đã chọn`;
        if (batchBtn) batchBtn.disabled = count === 0;
        if (selectAllChk) {
            selectAllChk.checked = filteredIds.size > 0 && selectedInFiltered === filteredIds.size;
            selectAllChk.indeterminate = selectedInFiltered > 0 && selectedInFiltered < filteredIds.size;
        }
    }

    _selectedValues(select) {
        return Array.from(select?.selectedOptions || []).map(option => option.value).filter(Boolean);
    }

    async _deleteSelectedSessions() {
        if (this._selectedSessionIds.size === 0) return;
        const ids = Array.from(this._selectedSessionIds);
        const count = ids.length;

        if (ids.includes(sessionStore.id)) {
            this._showToast('Không thể xoá cuộc họp đang chạy — hãy Dừng trước', 'error');
            return;
        }

        const agreed = await this._promptConfirmDelete({
            title: 'Xác nhận xoá log',
            message: `Bạn có chắc chắn muốn xoá vĩnh viễn ${count} log đã chọn? Hành động này không thể hoàn tác.`,
            confirmText: 'Xoá'
        });
        if (!agreed) return;

        try {
            await invoke('delete_sessions', { ids });
            this._selectedSessionIds.clear();
            this._showToast(`Đã xóa ${count} log`, 'success');
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

            this._setSessionPlayerLoading(id, true);

            // Resolve the recording path without loading the complete file into
            // memory. Large WAV files can be hundreds of MB, and converting one
            // to a Base64 data URL makes WebView playback fail.
            let audioUrl = null;
            let audioInfo = null;
            try {
                audioInfo = await invoke('get_session_audio_info', { id });
                if (audioInfo?.file_path && typeof convertFileSrc === 'function') {
                    audioUrl = convertFileSrc(audioInfo.file_path);
                }
            } catch (audioErr) {
                console.warn('[App] get_session_audio_info failed:', audioErr);
            }

            // Browser-only mock/dev fallback. The packaged app must use the
            // asset URL path above so it never regresses to Base64 playback.
            if (!audioUrl && !window.__TAURI_INTERNALS__) {
                try {
                    audioUrl = await invoke('read_session_audio', { id });
                } catch (audioErr) {
                    console.warn('[App] read_session_audio fallback failed:', audioErr);
                }
            }

            if (!audioUrl) {
                this._showToast('Không có file ghi âm cho cuộc họp này', 'info');
                if (btn) btn.innerHTML = '🔊 Nghe lại';
                return;
            }

            const sizeMb = audioInfo?.file_size ? Math.round(audioInfo.file_size / 1024 / 1024) : null;
            this._showToast(
                sizeMb ? `🔊 Đang tải bản ghi âm (${sizeMb} MB)...` : '🔊 Đang tải bản ghi âm...',
                'info',
            );

            const audio = new Audio();
            audio.preload = 'metadata';
            audio.src = audioUrl;
            this._sessionAudioElement = audio;
            this._sessionAudioId = id;
            audio.onloadedmetadata = () => this._updateSessionPlayerUI(audio);
            audio.ontimeupdate = () => this._updateSessionPlayerUI(audio);
            audio.onpause = () => this._setSessionPlayerUI(id, false);
            audio.onplay = () => this._setSessionPlayerUI(id, true);
            audio.onended = () => {
                this._sessionAudioElement = null;
                this._sessionAudioId = null;
                this._resetSessionPlayerUI();
            };
            audio.oncanplay = () => {
                this._showToast('🔊 Đang phát lại bản ghi âm cuộc họp...', 'info');
            };
            audio.onerror = () => {
                const mediaError = audio.error;
                console.error('[App] Audio playback error:', mediaError?.code, mediaError?.message);
                const reason = mediaError?.code === 3
                    ? 'file không thể giải mã hoặc codec không được hỗ trợ'
                    : mediaError?.code === 4
                        ? 'định dạng file không được hỗ trợ'
                        : 'không thể đọc file';
                this._showToast(`Lỗi khi phát file ghi âm: ${reason}.`, 'error', {
                    label: 'Thử lại',
                    onClick: () => this._playSessionTTS(id, false),
                });
                this._sessionAudioElement = null;
                this._sessionAudioId = null;
                this._resetSessionPlayerUI();
            };
            await audio.play();
            this._setSessionPlayerUI(id, true);
        } catch (err) {
            this._showToast(`Lỗi phát âm thanh: ${err}`, 'error');
            this._resetSessionPlayerUI();
        } finally {
            this._setSessionPlayerLoading(id, false);
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

    _setSessionPlayerLoading(id, loading) {
        this._sessionPlayerElements().forEach(player => {
            if (player.dataset.playerId !== id) return;
            player.classList.toggle('is-loading', loading);
            const toggle = player.querySelector('[data-player-toggle]');
            const timeline = player.querySelector('[data-player-timeline]');
            if (toggle) {
                toggle.disabled = loading;
                if (loading) {
                    toggle.textContent = '…';
                    toggle.title = 'Đang tải bản ghi âm';
                }
            }
            if (timeline) timeline.disabled = loading;
        });
        const detailBtn = document.getElementById('btn-session-tts-play');
        if (detailBtn && this._currentViewedSession?.id === id) {
            detailBtn.disabled = loading;
            if (loading) detailBtn.innerHTML = '⏳ Đang tải...';
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
            player.classList.remove('is-loading');
            player.dataset.playerId = '';
            const toggle = player.querySelector('[data-player-toggle]');
            const timeline = player.querySelector('[data-player-timeline]');
            const disabled = player.dataset.legacy === '1';
            if (toggle) {
                toggle.textContent = '▶';
                toggle.title = 'Phát bản ghi âm';
                toggle.disabled = disabled;
            }
            if (timeline) {
                timeline.value = 0;
                timeline.max = 0;
                timeline.disabled = disabled;
                timeline.style.setProperty('--player-progress', '0%');
            }
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
            this._projectRegistry = { customers: [], projects: [], categories: [], tags: [] };
        }
        this._populateNoteMetadataSelectors?.();
        return this._projectRegistry;
    }

    _renderCustomerFilterBar() {
        const select = document.getElementById('select-session-customer-filter');
        if (!select) return;
        const customers = this._projectRegistry?.customers || [];
        let html = '<option value="" disabled>🤝 Khách hàng</option>';
        for (const c of customers) {
            const statusIcon = c.status === 'active' ? '🟢' : '⚪';
            const selected = this._activeCustomerFilter.includes(c.id) ? 'selected' : '';
            html += `<option value="${this._escAttr(c.id)}" ${selected}>${statusIcon} ${this._esc(c.name)}</option>`;
        }
        select.innerHTML = html;
    }

    _renderProjectFilterBar() {
        const select = document.getElementById('select-session-project-filter');
        if (!select) return;
        const projects = this._projectRegistry?.projects || [];
        let html = '<option value="" disabled>🚀 Dự án</option>';
        for (const p of projects) {
            const statusIcon = p.status === 'active' ? '🟢' : '⚪';
            const selected = this._activeProjectFilter.includes(p.id) ? 'selected' : '';
            html += `<option value="${this._escAttr(p.id)}" ${selected}>${statusIcon} ${this._esc(p.name)}</option>`;
        }
        select.innerHTML = html;
    }

    _renderCategoryFilterSelect() {
        const select = document.getElementById('select-session-category-filter');
        if (!select) return;
        const categories = this._projectRegistry?.categories || [];
        let html = '<option value="" disabled>🗂️ Category</option>';
        for (const c of categories) {
            const selected = this._activeCategoryFilter.includes(c.name) ? 'selected' : '';
            html += `<option value="${this._escAttr(c.name)}" ${selected}>🗂️ ${this._esc(c.name)}</option>`;
        }
        select.innerHTML = html;
    }

    _renderTagFilterSelect() {
        const select = document.getElementById('select-session-tag-filter');
        if (!select) return;
        const sessionTags = (this._cachedSessions || []).flatMap(s => s.tags || []);
        const regTags = this._projectRegistry?.tags || [];
        const allTags = Array.from(new Set([...regTags, ...sessionTags])).filter(Boolean);
        let html = '<option value="" disabled>🏷️ Tag</option>';
        for (const tag of allTags) {
            const tagKey = (tag || '').toLowerCase();
            const count = (this._cachedSessions || []).filter(s => (s.tags || []).some(x => (x || '').toLowerCase() === tagKey)).length;
            const selected = this._activeTagFilter.includes(tag) ? 'selected' : '';
            html += `<option value="${this._escAttr(tag)}" ${selected}>#${this._esc(tag)} (${count})</option>`;
        }
        select.innerHTML = html;
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
            const sessions = await invoke('list_sessions');
            this._cachedSessions = sessions || [];

            this._renderCustomerFilterBar();
            this._renderProjectFilterBar();
            this._renderCategoryFilterSelect();
            this._renderTagFilterSelect();

            if (this._cachedSessions.length === 0) {
                listEl.innerHTML = '<div class="sessions-empty">Chưa có meeting log nào được lưu.<br><button type="button" class="btn-primary small" id="btn-empty-import-audio" style="margin-top:12px;">📥 Import file ghi âm</button></div>';
                document.getElementById('btn-empty-import-audio')?.addEventListener('click', () => this._handleOpenImportAudio());
                this._updateBatchSelectionUI();
                return;
            }

            // Ensure newest first sorting
            this._cachedSessions.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

            this._renderFilteredSessions();
            // Sessions cache changed → tag badge + session counts depend on it
            this._updateSidebarBadges().catch(err => console.error('Failed to update sidebar badges:', err));
        } catch (err) {
            listEl.innerHTML = `<div class="sessions-empty">Error: ${err}</div>`;
        }
    }

    _renderFilteredSessions() {
        const listEl = document.getElementById('sessions-list');
        if (!listEl) return;
        if (!this._selectedSessionIds) this._selectedSessionIds = new Set();

        const workCount = (this._cachedSessions || []).filter(s => (s.scope || 'work') === 'work').length;
        const personalCount = (this._cachedSessions || []).filter(s => s.scope === 'personal').length;
        const allCount = (this._cachedSessions || []).length;
        const countWorkEl = document.getElementById('scope-count-work');
        if (countWorkEl) countWorkEl.textContent = workCount;
        const countPersonalEl = document.getElementById('scope-count-personal');
        if (countPersonalEl) countPersonalEl.textContent = personalCount;
        const countAllEl = document.getElementById('scope-count-all');
        if (countAllEl) countAllEl.textContent = allCount;

        const activeScope = this._activeLogsScopeFilter || 'work';
        const isPersonalScope = activeScope === 'personal';
        const isAllScope = activeScope === 'all';

        document.querySelectorAll('.logs-scope-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.scope === activeScope);
        });

        const custSelect = document.getElementById('select-session-customer-filter');
        if (custSelect) {
            custSelect.style.display = isPersonalScope ? 'none' : '';
        }

        const nameQuery = this._sessionNameQuery.trim().toLocaleLowerCase();
        const lowerTagFilter = (this._activeTagFilter || []).map(f => (f || '').toLowerCase());
        let filtered = (this._cachedSessions || []).filter(session => {
            const sessScope = session.scope || 'work';
            const scopeMatches = isAllScope || sessScope === activeScope;
            const titleMatches = !nameQuery || (session.title || '').toLocaleLowerCase().includes(nameQuery);
            const customerMatches = isPersonalScope || !this._activeCustomerFilter.length || this._activeCustomerFilter.includes(session.customer_id);
            const projectMatches = !this._activeProjectFilter.length || this._activeProjectFilter.includes(session.project_id);
            const categoryMatches = !this._activeCategoryFilter.length || this._activeCategoryFilter.includes(session.category);
            const tagMatches = !lowerTagFilter.length || (session.tags || []).some(tag => lowerTagFilter.includes((tag || '').toLowerCase()));
            return scopeMatches && titleMatches && customerMatches && projectMatches && categoryMatches && tagMatches;
        });
        this._filteredSessions = filtered;

        const valueForSort = (session, field) => {
            if (field === 'created_at') return session.created_at || '';
            if (field === 'tags') return (session.tags || []).join(', ');
            return session[field] || '';
        };
        filtered = [...filtered].sort((a, b) => {
            const av = String(valueForSort(a, this._sessionSort.field)).toLocaleLowerCase();
            const bv = String(valueForSort(b, this._sessionSort.field)).toLocaleLowerCase();
            return av.localeCompare(bv, undefined, { numeric: true }) * (this._sessionSort.dir === 'asc' ? 1 : -1);
        });

        const totalPages = Math.max(1, Math.ceil(filtered.length / this._sessionPageSize));
        this._sessionPage = Math.min(Math.max(1, this._sessionPage), totalPages);
        const pageStart = (this._sessionPage - 1) * this._sessionPageSize;
        const pageItems = filtered.slice(pageStart, pageStart + this._sessionPageSize);
        const selectedCount = this._selectedSessionIds.size;
        const selectedInFiltered = filtered.filter(session => this._selectedSessionIds.has(session.id)).length;
        const allFilteredSelected = filtered.length > 0 && selectedInFiltered === filtered.length;
        const sortIcon = (field) => this._sessionSort.field === field
            ? (this._sessionSort.dir === 'asc' ? '▲' : '▼')
            : '⇅';
        const sortHeaderClass = (field) => `sortable ${this._sessionSort.field === field ? 'active-sort' : ''}`;

        const rows = pageItems.length
            ? pageItems.map((session, index) => this._renderSessionTableRow(session, pageStart + index + 1, isPersonalScope, isAllScope)).join('')
            : `<tr><td class="logs-table-empty" colspan="${isPersonalScope ? 8 : 9}">Không tìm thấy log nào phù hợp bộ lọc.</td></tr>`;

        const existingTable = listEl.querySelector('.logs-table');
        if (existingTable && existingTable.dataset.scope === activeScope) {
            // Update table body rows without destroying filter inputs (preserves input focus!)
            const tbody = existingTable.querySelector('tbody');
            if (tbody) tbody.innerHTML = rows;

            // Update select-all checkbox state
            const selectAllCheckbox = listEl.querySelector('#chk-select-all-sessions');
            if (selectAllCheckbox) {
                selectAllCheckbox.checked = allFilteredSelected;
                selectAllCheckbox.indeterminate = selectedInFiltered > 0 && !allFilteredSelected;
            }

            // Update batch delete button next to log name filter
            const batchDeleteBtn = listEl.querySelector('[data-batch-delete]');
            if (batchDeleteBtn) {
                batchDeleteBtn.classList.toggle('is-visible', selectedCount > 0);
                batchDeleteBtn.disabled = selectedCount === 0;
                batchDeleteBtn.textContent = `🗑 Xoá (${selectedCount})`;
            }

            // Update sort indicators in table header
            existingTable.querySelectorAll('.logs-column-header th.sortable').forEach(th => {
                const field = th.dataset.sort;
                const span = th.querySelector('.sort-icon');
                if (span) span.textContent = sortIcon(field);
                th.classList.toggle('active-sort', this._sessionSort.field === field);
            });

            // Update pagination text and button disabled states
            const totalCountEl = listEl.querySelector('.session-pagination-count');
            if (totalCountEl) totalCountEl.textContent = `${filtered.length} log`;
            const pageTextEl = listEl.querySelector('.session-pagination-page-text');
            if (pageTextEl) pageTextEl.textContent = `${this._sessionPage} / ${totalPages}`;
            const prevBtn = listEl.querySelector('[data-page-prev]');
            if (prevBtn) prevBtn.disabled = this._sessionPage <= 1;
            const nextBtn = listEl.querySelector('[data-page-next]');
            if (nextBtn) nextBtn.disabled = this._sessionPage >= totalPages;

            // Rebind row action events on the updated rows
            this._bindSessionRowEvents(existingTable);
            return;
        }

        // Full initial render: build registry & session metadata option lists
        const customerMap = new Map();
        (this._projectRegistry?.customers || []).forEach(c => {
            if (c.id) customerMap.set(c.id, { id: c.id, name: c.name || c.id, status: c.status });
        });
        (this._cachedSessions || []).forEach(s => {
            if (s.customer_id && !customerMap.has(s.customer_id)) {
                customerMap.set(s.customer_id, { id: s.customer_id, name: s.customer_name || s.customer_id });
            }
        });
        const customers = Array.from(customerMap.values());

        const projectMap = new Map();
        (this._projectRegistry?.projects || []).forEach(p => {
            if (p.id) projectMap.set(p.id, { id: p.id, name: p.name || p.id, customer_id: p.customer_id, scope: p.scope || 'work' });
        });
        (this._cachedSessions || []).forEach(s => {
            if (s.project_id && !projectMap.has(s.project_id)) {
                projectMap.set(s.project_id, { id: s.project_id, name: s.project_name || s.project_id, customer_id: s.customer_id, scope: s.scope || 'work' });
            }
        });
        const projects = Array.from(projectMap.values());

        let relevantProjects = projects;
        if (isPersonalScope) {
            relevantProjects = projects.filter(p => p.scope === 'personal');
        } else if (!isAllScope) {
            relevantProjects = projects.filter(p => (p.scope || 'work') === 'work');
        }

        const categorySet = new Set();
        (this._projectRegistry?.categories || []).forEach(c => { if (c.name) categorySet.add(c.name); });
        (this._cachedSessions || []).forEach(s => { if (s.category) categorySet.add(s.category); });
        const categories = Array.from(categorySet).sort();

        const tagSet = new Set();
        (this._projectRegistry?.tags || []).forEach(t => { if (t) tagSet.add(t); });
        (this._cachedSessions || []).forEach(s => { (s.tags || []).forEach(t => { if (t) tagSet.add(t); }); });
        const tags = Array.from(tagSet).sort();

        const renderSelectOptions = (items, selectedVal, allLabel, formatFn) => {
            let html = `<option value="">Tất cả ${allLabel}</option>`;
            for (const item of items) {
                const val = typeof item === 'string' ? item : item.id;
                const label = formatFn ? formatFn(item) : (typeof item === 'string' ? item : item.name);
                const isSelected = selectedVal === val ? 'selected' : '';
                html += `<option value="${this._escAttr(val)}" ${isSelected}>${this._esc(label)}</option>`;
            }
            return html;
        };

        const activeCustomer = this._activeCustomerFilter[0] || '';
        const activeProject = this._activeProjectFilter[0] || '';
        const activeCategory = this._activeCategoryFilter[0] || '';
        const activeTag = this._activeTagFilter[0] || '';

        const customerHeader = isPersonalScope ? '' : `<th class="${sortHeaderClass('customer_name')}" data-sort="customer_name">Khách hàng <span class="sort-icon">${sortIcon('customer_name')}</span></th>`;
        const projectHeaderTitle = isPersonalScope ? 'Dự án cá nhân' : 'Dự án';
        const customerFilterCell = isPersonalScope ? '' : `<td><select class="logs-filter-select" data-filter-select="customer">${renderSelectOptions(customers, activeCustomer, 'khách hàng', c => (c.status === 'active' ? '🟢 ' : (c.status === 'archived' ? '⚪ ' : '')) + c.name)}</select></td>`;

        const header = `<tr class="logs-column-header">
                <th class="logs-check-column"><input id="chk-select-all-sessions" type="checkbox" title="Chọn tất cả log đang lọc"></th>
                <th>#</th>
                <th class="${sortHeaderClass('title')}" data-sort="title">Tên log <span class="sort-icon">${sortIcon('title')}</span></th>
                <th class="${sortHeaderClass('created_at')}" data-sort="created_at">Ngày <span class="sort-icon">${sortIcon('created_at')}</span></th>
                ${customerHeader}
                <th class="${sortHeaderClass('project_name')}" data-sort="project_name">${projectHeaderTitle} <span class="sort-icon">${sortIcon('project_name')}</span></th>
                <th class="${sortHeaderClass('category')}" data-sort="category">Category <span class="sort-icon">${sortIcon('category')}</span></th>
                <th class="${sortHeaderClass('tags')}" data-sort="tags">Tag <span class="sort-icon">${sortIcon('tags')}</span></th>
                <th class="logs-col-actions-header">Actions</th>
            </tr>
            <tr class="logs-filter-row">
                <td colspan="2" class="logs-filter-actions-cell">
                    <button type="button" class="btn-danger-small logs-delete-selected ${selectedCount ? 'is-visible' : ''}" data-batch-delete ${selectedCount ? '' : 'disabled'} title="Xóa các log đã chọn">🗑 Xoá (${selectedCount})</button>
                </td>
                <td><input type="search" class="logs-filter-input" data-filter-name value="${this._escAttr(this._sessionNameQuery)}" placeholder="Lọc tên log"></td>
                <td></td>
                ${customerFilterCell}
                <td><select class="logs-filter-select" data-filter-select="project">${renderSelectOptions(relevantProjects, activeProject, isPersonalScope ? 'dự án cá nhân' : 'dự án')}</select></td>
                <td><select class="logs-filter-select" data-filter-select="category">${renderSelectOptions(categories, activeCategory, 'category')}</select></td>
                <td><select class="logs-filter-select" data-filter-select="tag">${renderSelectOptions(tags, activeTag, 'tag', t => {
                    const tKey = (t || '').toLowerCase();
                    const count = (this._cachedSessions || []).filter(s => (s.tags || []).some(x => (x || '').toLowerCase() === tKey)).length;
                    return `#${t} (${count})`;
                })}</select></td>
                <td><button type="button" class="logs-reset-filters" data-clear-filters title="Xoá toàn bộ điều kiện lọc">↺ Clear</button></td>
            </tr>`;

        const colGroup = isPersonalScope
            ? `<colgroup><col class="logs-col-check"><col class="logs-col-index"><col class="logs-col-title"><col class="logs-col-date"><col class="logs-col-project"><col class="logs-col-category"><col class="logs-col-tag"><col class="logs-col-actions"></colgroup>`
            : `<colgroup><col class="logs-col-check"><col class="logs-col-index"><col class="logs-col-title"><col class="logs-col-date"><col class="logs-col-customer"><col class="logs-col-project"><col class="logs-col-category"><col class="logs-col-tag"><col class="logs-col-actions"></colgroup>`;

        listEl.innerHTML = `<div class="logs-table-container"><table class="logs-table" data-scope="${activeScope}">${colGroup}<thead>${header}</thead><tbody>${rows}</tbody></table></div>
            <div class="session-pagination">
                <span class="session-pagination-count">${filtered.length} log</span>
                <label>Hiển thị <select data-page-size><option value="10" ${this._sessionPageSize === 10 ? 'selected' : ''}>10</option><option value="20" ${this._sessionPageSize === 20 ? 'selected' : ''}>20</option><option value="50" ${this._sessionPageSize === 50 ? 'selected' : ''}>50</option></select> / trang</label>
                <div class="session-pagination-actions"><button type="button" data-page-prev ${this._sessionPage === 1 ? 'disabled' : ''}>‹</button><span class="session-pagination-page-text">${this._sessionPage} / ${totalPages}</span><button type="button" data-page-next ${this._sessionPage === totalPages ? 'disabled' : ''}>›</button></div>
            </div>`;

        this._bindLogsTableEvents(listEl, filtered, totalPages, { customers, projects, categories, tags, renderSelectOptions, isPersonalScope, isAllScope });
        const selectAllCheckbox = listEl.querySelector('#chk-select-all-sessions');
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = allFilteredSelected;
            selectAllCheckbox.indeterminate = selectedInFiltered > 0 && !allFilteredSelected;
        }
    }

    _formatSessionDate(iso) {
        // Display session created_at (ISO UTC) as local dd/MM/yyyy HH:mm.
        // Falls back to the raw value when parsing fails.
        try {
            if (!iso) return '<span class="logs-empty-value">—</span>';
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return this._esc(String(iso).slice(0, 16));
            const p = n => String(n).padStart(2, '0');
            return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
        } catch (_) {
            return this._esc(String(iso || '').slice(0, 16));
        }
    }

    _renderSessionTableRow(session, number, isPersonalScope = false, isAllScope = false) {
        const sessionTags = session.tags || [];
        const tags = sessionTags.map(tag => `<button type="button" class="session-tag-badge" data-tag="${this._escAttr(tag)}" title="Lọc Logs theo #${this._escAttr(tag)}">#${this._esc(tag)}</button>`).join('') || '<span class="logs-empty-value">—</span>';
        const tagsTitle = sessionTags.map(tag => `#${tag}`).join(', ');
        const customer = session.customer_name ? `<button type="button" class="session-customer-badge" data-customer-id="${this._escAttr(session.customer_id || '')}" title="Lọc Logs theo khách hàng ${this._escAttr(session.customer_name)}">${this._esc(session.customer_name)}</button>` : '<span class="logs-empty-value">—</span>';
        const project = session.project_name ? `<button type="button" class="session-project-badge" data-project-id="${this._escAttr(session.project_id || '')}" title="Lọc Logs theo dự án ${this._escAttr(session.project_name)}">${this._esc(session.project_name)}</button>` : '<span class="logs-empty-value">—</span>';
        const category = session.category ? `<button type="button" class="session-category-badge" data-category="${this._escAttr(session.category)}" title="Lọc Logs theo category ${this._escAttr(session.category)}">${this._esc(session.category)}</button>` : '<span class="logs-empty-value">—</span>';
        const retranscriptButton = session.has_legacy_only ? '' : `<button type="button" class="session-btn-action" data-retranscript-session="${this._escAttr(session.id)}" title="Dùng file ghi âm để Gemini tạo lại Logs">🔄</button>`;
        const editButton = session.has_legacy_only ? '' : `<button type="button" class="session-btn-action" data-edit-session="${this._escAttr(session.id)}" title="Sửa thông tin">${PENCIL_YELLOW_ICON}</button>`;

        const scopeBadge = isAllScope
            ? (session.scope === 'personal'
                ? '<span class="scope-badge-personal" style="margin-right:6px; font-size:10px;">👤 Cá nhân</span>'
                : '<span class="scope-badge-work" style="margin-right:6px; font-size:10px;">💼 Công việc</span>')
            : '';

        const customerTd = isPersonalScope ? '' : `<td>${customer}</td>`;

        return `<tr data-session-id="${this._escAttr(session.id)}" data-legacy="${session.has_legacy_only ? '1' : '0'}">
            <td class="logs-check-column"><input type="checkbox" data-session-check="${this._escAttr(session.id)}" ${this._selectedSessionIds.has(session.id) ? 'checked' : ''}></td>
            <td class="logs-index">${number}</td>
            <td class="logs-title-cell"><button type="button" class="logs-title-link" data-open-session="${this._escAttr(session.id)}">${scopeBadge}${this._esc(session.title || 'Cuộc họp chưa đặt tên')}</button></td>
            <td class="logs-date">${this._formatSessionDate(session.created_at)}</td>
            ${customerTd}<td>${project}</td><td>${category}</td><td><div class="logs-tags" title="${this._escAttr(tagsTitle)}">${tags}</div></td>
            <td><div class="logs-actions">${retranscriptButton}${editButton}<button type="button" class="session-btn-action" data-copy-session="${this._escAttr(session.id)}" title="Copy nội dung">⧉</button><button type="button" class="session-delete-btn" data-delete-session="${this._escAttr(session.id)}" title="Xoá log">×</button></div></td>
        </tr>`;
    }

    _bindLogsTableEvents(listEl, filtered, totalPages, optionsContext) {
        const toggleAll = (checked) => {
            (this._filteredSessions || []).forEach(session => checked ? this._selectedSessionIds.add(session.id) : this._selectedSessionIds.delete(session.id));
            this._renderFilteredSessions();
        };

        const updateProjectSelect = (custId) => {
            if (!optionsContext) return;
            const projectSelect = listEl.querySelector('[data-filter-select="project"]');
            if (!projectSelect) return;
            let availableProjects = optionsContext.projects;
            if (optionsContext.isPersonalScope) {
                availableProjects = availableProjects.filter(p => p.scope === 'personal');
            } else if (!optionsContext.isAllScope) {
                availableProjects = availableProjects.filter(p => (p.scope || 'work') === 'work');
                if (custId) {
                    availableProjects = availableProjects.filter(p => !p.customer_id || p.customer_id === custId);
                }
            } else if (custId) {
                availableProjects = availableProjects.filter(p => !p.customer_id || p.customer_id === custId);
            }
            projectSelect.innerHTML = optionsContext.renderSelectOptions(availableProjects, this._activeProjectFilter[0] || '', optionsContext.isPersonalScope ? 'dự án cá nhân' : 'dự án');
        };

        const applyFilter = (kind, select) => {
            const val = select.value;
            const normalizedValues = val ? [val] : [];
            if (kind === 'customer') {
                this._activeCustomerFilter = normalizedValues;
                const custId = normalizedValues[0];
                if (custId && this._activeProjectFilter.length && optionsContext) {
                    const curr = optionsContext.projects.find(p => p.id === this._activeProjectFilter[0]);
                    if (curr && curr.customer_id && curr.customer_id !== custId) {
                        this._activeProjectFilter = [];
                    }
                }
                updateProjectSelect(custId);
            }
            if (kind === 'project') this._activeProjectFilter = normalizedValues;
            if (kind === 'category') this._activeCategoryFilter = normalizedValues;
            if (kind === 'tag') this._activeTagFilter = normalizedValues;
            this._sessionPage = 1;
            this._renderFilteredSessions();
        };

        listEl.querySelectorAll('[data-select-all-sessions], #chk-select-all-sessions').forEach(check => {
            check.addEventListener('change', () => toggleAll(check.checked));
        });

        const nameFilter = listEl.querySelector('[data-filter-name]');
        if (nameFilter) {
            let inputTimer;
            nameFilter.addEventListener('input', () => {
                clearTimeout(inputTimer);
                inputTimer = setTimeout(() => {
                    this._sessionNameQuery = nameFilter.value;
                    this._sessionPage = 1;
                    this._renderFilteredSessions();
                }, 150);
            });
            nameFilter.addEventListener('search', () => {
                clearTimeout(inputTimer);
                this._sessionNameQuery = nameFilter.value;
                this._sessionPage = 1;
                this._renderFilteredSessions();
            });
            nameFilter.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(inputTimer);
                    this._sessionNameQuery = nameFilter.value;
                    this._sessionPage = 1;
                    this._renderFilteredSessions();
                }
            });
        }

        listEl.querySelectorAll('[data-filter-select]').forEach(select => {
            select.addEventListener('change', () => applyFilter(select.dataset.filterSelect, select));
        });

        listEl.querySelector('[data-clear-filters]')?.addEventListener('click', () => {
            this._sessionNameQuery = '';
            this._activeCustomerFilter = [];
            this._activeProjectFilter = [];
            this._activeCategoryFilter = [];
            this._activeTagFilter = [];
            this._sessionPage = 1;
            const nameInput = listEl.querySelector('[data-filter-name]');
            if (nameInput) nameInput.value = '';
            listEl.querySelectorAll('[data-filter-select]').forEach(s => { s.value = ''; });
            updateProjectSelect(null);
            this._renderFilteredSessions();
        });

        listEl.querySelector('[data-batch-delete]')?.addEventListener('click', () => this._deleteSelectedSessions());

        listEl.querySelectorAll('[data-sort]').forEach(header => header.addEventListener('click', () => {
            const field = header.dataset.sort;
            this._sessionSort = this._sessionSort.field === field
                ? { field, dir: this._sessionSort.dir === 'asc' ? 'desc' : 'asc' }
                : { field, dir: 'asc' };
            try { localStorage.setItem('meet_minder_logs_sort', JSON.stringify(this._sessionSort)); } catch (_) {}
            this._sessionPage = 1;
            this._renderFilteredSessions();
        }));

        listEl.querySelector('[data-page-size]')?.addEventListener('change', (event) => {
            this._sessionPageSize = Number(event.target.value);
            this._sessionPage = 1;
            try { localStorage.setItem('meet_minder_logs_page_size', String(this._sessionPageSize)); } catch (_) {}
            this._renderFilteredSessions();
        });

        listEl.querySelector('[data-page-prev]')?.addEventListener('click', () => { this._sessionPage--; this._renderFilteredSessions(); });
        listEl.querySelector('[data-page-next]')?.addEventListener('click', () => { this._sessionPage++; this._renderFilteredSessions(); });

        this._bindSessionRowEvents(listEl);
    }

    _bindSessionRowEvents(tableContainer) {
        if (!this._selectedSessionIds) this._selectedSessionIds = new Set();

        const sessionScopeForBadge = (badge) => {
            const sessionId = badge.closest('[data-session-id]')?.dataset.sessionId;
            const session = (this._cachedSessions || []).find(item => item.id === sessionId);
            return session?.scope === 'personal' ? 'personal' : 'work';
        };
        tableContainer.querySelectorAll('.session-customer-badge[data-customer-id]').forEach(badge => {
            badge.addEventListener('click', (event) => {
                event.stopPropagation();
                if (badge.dataset.customerId) this._jumpToLogsWithFilter('customer', badge.dataset.customerId, sessionScopeForBadge(badge));
            });
        });
        tableContainer.querySelectorAll('.session-project-badge[data-project-id]').forEach(badge => {
            badge.addEventListener('click', (event) => {
                event.stopPropagation();
                if (badge.dataset.projectId) this._jumpToLogsWithFilter('project', badge.dataset.projectId, sessionScopeForBadge(badge));
            });
        });
        tableContainer.querySelectorAll('.session-category-badge[data-category]').forEach(badge => {
            badge.addEventListener('click', (event) => {
                event.stopPropagation();
                if (badge.dataset.category) this._jumpToLogsWithFilter('category', badge.dataset.category, sessionScopeForBadge(badge));
            });
        });
        tableContainer.querySelectorAll('.session-tag-badge[data-tag]').forEach(badge => {
            badge.addEventListener('click', (event) => {
                event.stopPropagation();
                if (badge.dataset.tag) this._jumpToLogsWithFilter('tag', badge.dataset.tag, sessionScopeForBadge(badge));
            });
        });

        tableContainer.querySelectorAll('[data-session-check]').forEach(check => {
            check.addEventListener('change', () => {
                check.checked ? this._selectedSessionIds.add(check.dataset.sessionCheck) : this._selectedSessionIds.delete(check.dataset.sessionCheck);
                this._renderFilteredSessions();
            });
        });
        tableContainer.querySelectorAll('[data-open-session]').forEach(button => button.addEventListener('click', () => this._openSession(button.dataset.openSession, button.closest('tr').dataset.legacy === '1')));
        tableContainer.querySelectorAll('[data-retranscript-session]').forEach(button => button.addEventListener('click', () => this._retranscribeSession(button.dataset.retranscriptSession)));
        tableContainer.querySelectorAll('[data-edit-session]').forEach(button => button.addEventListener('click', () => {
            const session = this._cachedSessions.find(item => item.id === button.dataset.editSession);
            if (session) this._editSessionMetadata(session);
        }));
        tableContainer.querySelectorAll('[data-copy-session]').forEach(button => button.addEventListener('click', () => this._copySession(button.dataset.copySession, button.closest('tr').dataset.legacy === '1')));
        tableContainer.querySelectorAll('[data-delete-session]').forEach(button => button.addEventListener('click', () => this._deleteSessionFromTable(button.dataset.deleteSession)));
    }

    async _copySession(id, isLegacy) {
        try {
            const text = isLegacy ? await invoke('read_legacy_session', { id }) : (await invoke('read_session', { id })).md;
            if (text) {
                await navigator.clipboard.writeText(text);
                this._showToast('Đã copy nội dung log ✓', 'success');
            }
        } catch (err) {
            this._showToast(`Lỗi copy: ${err}`, 'error');
        }
    }

    async _deleteSessionFromTable(id) {
        if (id === sessionStore.id) {
            this._showToast('Không thể xoá cuộc họp đang chạy — hãy Dừng trước', 'error');
            return;
        }
        const sess = (this._cachedSessions || []).find(s => s.id === id);
        const title = sess?.title || id;
        const agreed = await this._promptConfirmDelete({
            title: 'Xác nhận xoá log',
            message: `Bạn có chắc chắn muốn xoá vĩnh viễn log "${title}"? Hành động này không thể hoàn tác.`,
            confirmText: 'Xoá'
        });
        if (!agreed) return;

        try {
            await invoke('delete_session', { id });
            this._selectedSessionIds.delete(id);
            this._showToast('Đã xóa log', 'success');
            await this._showSessions();
        } catch (err) {
            this._showToast(`Xóa thất bại: ${err}`, 'error');
        }
    }

    _renderLegacySessionCards() {
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

        // Edit session metadata & rename combined
        listEl.querySelectorAll('.session-btn-action.retranscript').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._retranscribeSession(btn.dataset.id);
            });
        });

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
                const sess = (this._cachedSessions || []).find(s => s.id === id);
                const title = sess?.title || id;
                const agreed = await this._promptConfirmDelete({
                    title: 'Xác nhận xoá log',
                    message: `Bạn có chắc chắn muốn xoá vĩnh viễn log "${title}"? Hành động này không thể hoàn tác.`,
                    confirmText: 'Xoá'
                });
                if (!agreed) return;
                try {
                    await invoke('delete_session', { id });
                    this._selectedSessionIds.delete(id);
                    await this._showSessions();
                    this._showToast('Đã xóa log', 'success');
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
            ? `<span class="session-customer-badge" data-customer-id="${this._escAttr(s.customer_id || '')}" style="border-color:${this._escAttr(s.customer_color || '#431A46')}44; color:${this._escAttr(s.customer_color || '#D9B0DE')}; background:${this._escAttr(s.customer_color || '#431A46')}1a;" title="Khách hàng: ${this._escAttr(s.customer_name)}">🤝 ${this._esc(s.customer_name)}</span>`
            : '';

        // Project badge
        const projectBadge = (!s.has_legacy_only && s.project_name)
            ? `<span class="session-project-badge ${s.project_status === 'archived' ? 'archived' : ''}" data-project-id="${this._escAttr(s.project_id || '')}" style="border-color:${this._escAttr(s.project_color || '#431A46')}44; color:${this._escAttr(s.project_color || '#D9B0DE')}; background:${this._escAttr(s.project_color || '#431A46')}1a;" title="Dự án: ${this._escAttr(s.project_name)}${s.project_status === 'archived' ? ' (Đã dừng)' : ''}">🚀 ${this._esc(s.project_name)}</span>`
            : '';

        // Category badge
        const categoryBadge = (!s.has_legacy_only && s.category)
            ? `<span class="session-category-badge" data-category="${this._escAttr(s.category)}" title="Category: ${this._escAttr(s.category)}">🗂️ ${this._esc(s.category)}</span>`
            : '';

        // Tags
        const tagsHtml = (!s.has_legacy_only && s.tags && s.tags.length > 0)
            ? s.tags.map(t => `<span class="session-tag-badge" data-tag="${this._escAttr(t)}" title="Lọc theo #${this._escAttr(t)}">#${this._esc(t)}</span>`).join('')
            : '';

        const retranscriptBtn = !s.has_legacy_only
            ? `<button type="button" class="session-btn-action retranscript" data-id="${this._escAttr(s.id)}" title="Dùng file ghi âm để Gemini tạo lại Logs">🔄 Re-transcript</button>`
            : '';
        const editBtn = !s.has_legacy_only
            ? `<button type="button" class="session-btn-action edit-meta" data-id="${this._escAttr(s.id)}" title="Sửa thông tin / Đổi tên / Dự án / Category / Thẻ">${PENCIL_YELLOW_ICON}Sửa</button>`
            : '';

        const minutesBadge = s.has_meeting_minutes
            ? `<span class="session-badge" style="background:#10b98126;color:#34d399;border:1px solid #10b9814d;" title="Đã có biên bản Meeting Minutes">📋 Minutes</span>`
            : '';

        return `<div class="session-item" data-id="${this._escAttr(s.id)}" data-legacy="${s.has_legacy_only ? '1' : '0'}">
            <div class="session-item-row1">
                <input type="checkbox" class="session-item-chk" data-id="${this._escAttr(s.id)}" ${isChecked ? 'checked' : ''} />
                <span class="session-item-title">${title}</span>
                <div class="session-actions-inline">
                    ${retranscriptBtn}
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
        const suggestionsBox = document.getElementById('edit-session-tags-suggestions');
        if (!modal) return;

        const id = sess.id;
        const currentTitle = sess.title || '';
        const currentCustomerId = sess.customer_id || '';
        const currentProjectId = sess.project_id || '';
        const currentCategory = sess.category || '';
        const currentTags = Array.isArray(sess.tags) ? sess.tags : [];
        const currentScope = sess.scope || 'work';

        const [reg, knownTags] = await Promise.all([
            this._loadProjectRegistry(),
            this._getAllKnownTags(currentScope),
        ]);

        if (inputTitle) inputTitle.value = currentTitle;
        if (inputTags) inputTags.value = currentTags.map(t => `#${t}`).join(', ');
        let cleanupTags = this._setupTagAutocomplete(inputTags, suggestionsBox, knownTags);

        const allCustomers = reg.customers || [];
        const allProjects = reg.projects || [];

        // Populate customer select
        if (selectCust) {
            let custHtml = '<option value="">(Không chọn KH)</option>';
            for (const c of allCustomers) {
                const statusSuffix = c.status === 'archived' ? ' (Đã dừng)' : '';
                custHtml += `<option value="${this._escAttr(c.id)}">🤝 ${this._esc(c.name)}${statusSuffix}</option>`;
            }
            selectCust.innerHTML = custHtml;
            selectCust.value = currentCustomerId;
        }

        const workRadio = document.querySelector('input[name="edit-session-scope"][value="work"]');
        const personalRadio = document.querySelector('input[name="edit-session-scope"][value="personal"]');
        const custWrap = document.getElementById('edit-customer-field-wrap');

        if (currentScope === 'personal') {
            if (personalRadio) personalRadio.checked = true;
            if (workRadio) workRadio.checked = false;
            if (custWrap) custWrap.style.display = 'none';
        } else {
            if (workRadio) workRadio.checked = true;
            if (personalRadio) personalRadio.checked = false;
            if (custWrap) custWrap.style.display = '';
        }
        document.querySelectorAll('#edit-session-scope-group .scope-radio-btn').forEach(btn => {
            const rad = btn.querySelector('input[type="radio"]');
            btn.classList.toggle('active', rad && rad.checked);
        });

        const getCurrentChosenEditScope = () => {
            return document.querySelector('input[name="edit-session-scope"]:checked')?.value || 'work';
        };

        const updateCategoriesDropdown = (scope, selectedValue = selectCat?.value || '') => {
            if (!selectCat) return;
            const availableCategories = (reg.categories || []).filter(category => {
                const categoryScope = category.scope || 'work';
                return categoryScope === scope;
            });
            let catHtml = '<option value="">(Không chọn category)</option>';
            for (const category of availableCategories) {
                catHtml += `<option value="${this._escAttr(category.name)}">🗂️ ${this._esc(category.name)}</option>`;
            }
            selectCat.innerHTML = catHtml;
            selectCat.value = availableCategories.some(category => category.name === selectedValue) ? selectedValue : '';
        };

        const refreshTagAutocomplete = (scope) => {
            if (!inputTags) return;
            cleanupTags?.();
            cleanupTags = this._setupTagAutocomplete(inputTags, suggestionsBox, this._getKnownTagsForScope(scope, false));
        };

        // Helper to populate projects
        const updateProjectsDropdown = (selectedCustomerId, scope) => {
            if (!selectProj) return;
            let filteredProjs = allProjects;
            if (scope === 'personal') {
                filteredProjs = allProjects.filter(p => p.scope === 'personal' || p.id === currentProjectId);
            } else {
                filteredProjs = allProjects.filter(p => (p.scope || 'work') === 'work' || p.id === currentProjectId);
                if (selectedCustomerId) {
                    filteredProjs = filteredProjs.filter(p => p.customer_id === selectedCustomerId || p.id === currentProjectId);
                }
            }
            let projHtml = '<option value="">(Không gán dự án)</option>';
            for (const p of filteredProjs) {
                const statusSuffix = p.status === 'archived' ? ' (Đã dừng)' : '';
                projHtml += `<option value="${this._escAttr(p.id)}">🚀 ${this._esc(p.name)}${statusSuffix}</option>`;
            }
            selectProj.innerHTML = projHtml;
            if (filteredProjs.some(p => p.id === currentProjectId)) {
                selectProj.value = currentProjectId;
            } else {
                selectProj.value = '';
            }
        };

        updateProjectsDropdown(currentCustomerId, getCurrentChosenEditScope());

        const onScopeChange = () => {
            const curScope = getCurrentChosenEditScope();
            document.querySelectorAll('#edit-session-scope-group .scope-radio-btn').forEach(btn => {
                const rad = btn.querySelector('input[type="radio"]');
                btn.classList.toggle('active', rad && rad.checked);
            });
            if (custWrap) {
                custWrap.style.display = curScope === 'personal' ? 'none' : '';
            }
            if (curScope === 'personal' && selectCust) {
                selectCust.value = '';
            }
            updateProjectsDropdown(selectCust?.value, curScope);
            updateCategoriesDropdown(curScope);
            refreshTagAutocomplete(curScope);
        };

        const onScopeBtnClick = (e) => {
            const label = e.currentTarget;
            const rad = label.querySelector('input[type="radio"]');
            if (rad && !rad.checked) {
                rad.checked = true;
                onScopeChange();
            }
        };

        document.querySelectorAll('#edit-session-scope-group .scope-radio-btn').forEach(btn => {
            btn.addEventListener('click', onScopeBtnClick);
        });

        document.querySelectorAll('input[name="edit-session-scope"]').forEach(r => {
            r.addEventListener('change', onScopeChange);
        });

        const onCustChange = () => {
            updateProjectsDropdown(selectCust?.value, getCurrentChosenEditScope());
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

        updateCategoriesDropdown(currentScope, currentCategory);

        modal.style.display = 'flex';
        inputTitle?.focus();

        return new Promise((resolve) => {
            const onConfirm = async () => {
                cleanup();
                modal.style.display = 'none';
                const newTitle = inputTitle?.value.trim() || currentTitle;
                const newScope = getCurrentChosenEditScope();
                const newCustomerId = newScope === 'personal' ? null : (selectCust?.value || null);
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
                        scope: newScope,
                    });
                    sess.scope = newScope;
                    if (sessionStore.id === id) {
                        sessionStore.title = newTitle;
                        sessionStore.customerId = newCustomerId;
                        sessionStore.projectId = newProjectId;
                        sessionStore.category = newCategory;
                        sessionStore.tags = cleanTags;
                        sessionStore.scope = newScope;
                    }
                    if (this._currentViewedSession && this._currentViewedSession.id === id) {
                        try {
                            const refreshed = await invoke('read_session', { id });
                            this._currentSessionJson = refreshed.json;
                            const titleEl = document.getElementById('session-viewer-title');
                            if (titleEl) titleEl.textContent = refreshed.json?.title || id;
                            await this._renderSessionViewerMetadata(refreshed.json);
                        } catch (refErr) {
                            console.warn('[App] Failed to refresh viewer after metadata edit:', refErr);
                        }
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
                cleanupTags?.();
                document.querySelectorAll('#edit-session-scope-group .scope-radio-btn').forEach(btn => {
                    btn.removeEventListener('click', onScopeBtnClick);
                });
                document.querySelectorAll('input[name="edit-session-scope"]').forEach(r => {
                    r.removeEventListener('change', onScopeChange);
                });
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

            const onKeyDown = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    onAgree();
                }
            };

            const cleanup = () => {
                modal.style.display = 'none';
                agreeBtn?.removeEventListener('click', onAgree);
                cancelBtn?.removeEventListener('click', onCancel);
                closeBtn?.removeEventListener('click', onCancel);
                modal.removeEventListener('click', onBackdrop);
                window.removeEventListener('keydown', onKeyDown);
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
            window.addEventListener('keydown', onKeyDown);

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

        if (titleEl) titleEl.textContent = '🤝 Thêm Khách hàng mới';
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

        if (titleEl) titleEl.textContent = `🤝 Chi tiết: ${customer.name}`;
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
            this._renderSettingsCustomersTab();
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
        const idInput = document.getElementById('input-modal-proj-id');
        const nameInput = document.getElementById('input-modal-proj-name');
        const colorInput = document.getElementById('input-modal-proj-color');
        const descInput = document.getElementById('input-modal-proj-desc');
        const titleEl = document.getElementById('modal-proj-title');
        const saveBtn = document.getElementById('btn-save-add-project');

        if (titleEl) titleEl.textContent = '🚀 Thêm Dự án mới';
        if (saveBtn) saveBtn.textContent = '+ Tạo Dự án';
        if (idInput) idInput.value = '';

        const defaultScope = this._projScopeFilter === 'personal' ? 'personal' : 'work';
        const workRadio = document.querySelector('input[name="modal-proj-scope"][value="work"]');
        const personalRadio = document.querySelector('input[name="modal-proj-scope"][value="personal"]');
        const custWrap = document.getElementById('modal-proj-customer-wrap');

        if (defaultScope === 'personal') {
            if (personalRadio) personalRadio.checked = true;
            if (workRadio) workRadio.checked = false;
            if (custWrap) custWrap.style.display = 'none';
        } else {
            if (workRadio) workRadio.checked = true;
            if (personalRadio) personalRadio.checked = false;
            if (custWrap) custWrap.style.display = '';
        }
        document.querySelectorAll('#modal-proj-scope-group .scope-radio-btn').forEach(btn => {
            const rad = btn.querySelector('input[type="radio"]');
            btn.classList.toggle('active', rad && rad.checked);
        });

        if (custSelect) {
            let html = '<option value="">(Không chọn KH / Dự án nội bộ)</option>';
            for (const c of customers) {
                html += `<option value="${this._escAttr(c.id)}">🤝 ${this._esc(c.name)}</option>`;
            }
            custSelect.innerHTML = html;
            const activeFilter = this._projFilters?.customer_id;
            if (activeFilter) custSelect.value = activeFilter;
        }

        if (nameInput) nameInput.value = '';
        if (colorInput) colorInput.value = '#431A46';
        if (descInput) descInput.value = '';
        modal.style.display = 'flex';
        setTimeout(() => nameInput?.focus(), 50);
    }

    async _openEditProjectModal(project) {
        if (!project) return;
        const modal = document.getElementById('modal-add-project');
        if (!modal) return;
        const reg = await this._loadProjectRegistry();
        const customers = (reg.customers || []).filter(c => c.status === 'active' || c.id === project.customer_id);
        const custSelect = document.getElementById('select-modal-proj-customer');
        const idInput = document.getElementById('input-modal-proj-id');
        const nameInput = document.getElementById('input-modal-proj-name');
        const colorInput = document.getElementById('input-modal-proj-color');
        const descInput = document.getElementById('input-modal-proj-desc');
        const titleEl = document.getElementById('modal-proj-title');
        const saveBtn = document.getElementById('btn-save-add-project');

        if (titleEl) titleEl.textContent = `🚀 Chỉnh sửa: ${project.name}`;
        if (saveBtn) saveBtn.textContent = 'Lưu thay đổi';
        if (idInput) idInput.value = project.id || '';
        if (nameInput) nameInput.value = project.name || '';
        if (colorInput) colorInput.value = project.color || '#431A46';
        if (descInput) descInput.value = project.description || '';

        const pScope = project.scope || 'work';
        const workRadio = document.querySelector('input[name="modal-proj-scope"][value="work"]');
        const personalRadio = document.querySelector('input[name="modal-proj-scope"][value="personal"]');
        const custWrap = document.getElementById('modal-proj-customer-wrap');

        if (pScope === 'personal') {
            if (personalRadio) personalRadio.checked = true;
            if (workRadio) workRadio.checked = false;
            if (custWrap) custWrap.style.display = 'none';
        } else {
            if (workRadio) workRadio.checked = true;
            if (personalRadio) personalRadio.checked = false;
            if (custWrap) custWrap.style.display = '';
        }
        document.querySelectorAll('#modal-proj-scope-group .scope-radio-btn').forEach(btn => {
            const rad = btn.querySelector('input[type="radio"]');
            btn.classList.toggle('active', rad && rad.checked);
        });

        if (custSelect) {
            let html = '<option value="">(Không chọn KH / Dự án nội bộ)</option>';
            for (const c of customers) {
                const sel = project.customer_id === c.id ? 'selected' : '';
                html += `<option value="${this._escAttr(c.id)}" ${sel}>🤝 ${this._esc(c.name)}</option>`;
            }
            custSelect.innerHTML = html;
        }

        modal.style.display = 'flex';
        setTimeout(() => nameInput?.focus(), 50);
    }

    _closeAddProjectModal() {
        const modal = document.getElementById('modal-add-project');
        if (modal) modal.style.display = 'none';
    }

    async _handleSaveProjectFromModal() {
        const custSelect = document.getElementById('select-modal-proj-customer');
        const idInput = document.getElementById('input-modal-proj-id');
        const nameInput = document.getElementById('input-modal-proj-name');
        const colorInput = document.getElementById('input-modal-proj-color');
        const descInput = document.getElementById('input-modal-proj-desc');
        const name = nameInput?.value.trim();
        if (!name) {
            this._showToast('Vui lòng nhập tên dự án', 'error');
            return;
        }
        const id = idInput?.value.trim() || '';
        const scope = document.querySelector('input[name="modal-proj-scope"]:checked')?.value || 'work';
        const customer_id = scope === 'personal' ? null : (custSelect?.value || null);
        const color = colorInput?.value || '#431A46';
        const description = descInput?.value.trim() || '';
        try {
            await invoke('save_project', {
                project: {
                    id,
                    name,
                    customer_id,
                    description,
                    color,
                    status: 'active',
                    created_at: '',
                    updated_at: '',
                    scope,
                }
            });
            this._closeAddProjectModal();
            this._showToast(id ? `Đã cập nhật dự án "${name}" ✓` : `Đã tạo dự án "${name}" ✓`, 'success');
            await this._loadProjectRegistry();
            this._renderSettingsProjectsTab();
            this._renderProjectFilterBar();
            this._updateSidebarBadges();
            await this._showSessions();
        } catch (err) {
            this._showToast(`Lưu dự án thất bại: ${err}`, 'error');
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
            for (const bid of ['badge-nav-customers', 'badge-nav-projects', 'badge-nav-categories', 'badge-nav-tags']) {
                const el = document.getElementById(bid);
                if (el && el.textContent === '0') el.textContent = '–';
            }
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
        this._renderGitBackupSettingsUI();
        this._renderGitBackupStatus();
    }

    _renderGitBackupSettingsUI() {
        const s = settingsManager.get();
        const enabled = document.getElementById('check-git-backup-enabled');
        const details = document.getElementById('git-backup-details');
        const repo = document.getElementById('input-git-backup-repo');
        const commit = document.getElementById('select-git-commit-interval');
        const push = document.getElementById('select-git-push-interval');
        const autoCommit = document.getElementById('check-git-auto-commit');
        const autoPush = document.getElementById('check-git-auto-push');
        if (!enabled) return;
        enabled.checked = s.git_backup_enabled === true;
        enabled.setAttribute('aria-expanded', String(enabled.checked));
        if (details) details.style.display = enabled.checked ? 'block' : 'none';
        if (repo) repo.value = s.git_backup_repo_path || '';
        if (commit) commit.value = String(s.git_backup_commit_interval_min || 30);
        if (push) push.value = String(s.git_backup_push_interval_min || 60);
        if (autoCommit) autoCommit.checked = s.git_backup_auto_commit !== false;
        if (commit) commit.disabled = s.git_backup_auto_commit === false;
        if (autoPush) autoPush.checked = s.git_backup_auto_push === true;
        if (push) push.disabled = s.git_backup_auto_push !== true;
    }

    async _renderGitBackupStatus() {
        const statusEl = document.getElementById('git-backup-status');
        if (!statusEl) return;
        const s = settingsManager.get();
        if (!s.git_backup_enabled) {
            statusEl.classList.remove('is-error');
            statusEl.textContent = 'Backup qua Git đang tắt.';
            return;
        }
        statusEl.textContent = 'Đang kiểm tra Git...';
        try {
            const info = await invoke('git_backup_status', { repoPath: s.git_backup_repo_path || '' });
            statusEl.classList.toggle('is-error', Boolean(info.error));
            if (info.error) {
                statusEl.textContent = info.error;
                return;
            }
            if (s.git_backup_auto_push === true && !info.remote) {
                statusEl.classList.add('is-error');
                statusEl.textContent = 'Đã bật tự động push nhưng repository chưa có remote origin.';
                return;
            }
            const commit = String(info.last_commit || '').split('\0');
            const lastCommit = commit[0] ? new Date(commit[0]).toLocaleString() : 'Chưa có';
            const remote = info.remote ? ` · Remote: ${this._esc(info.remote)}` : ' · Chưa cấu hình remote';
            statusEl.innerHTML = `✓ Repository hợp lệ · Nhánh: <b>${this._esc(info.branch || 'detached')}</b>${remote}<br>`
                + `Thay đổi đang chờ: <b>${Number(info.dirty_files || 0)}</b> · Commit gần nhất: ${this._esc(lastCommit)}`;
        } catch (err) {
            statusEl.classList.add('is-error');
            statusEl.textContent = `Không kiểm tra được Git: ${err}`;
        }
    }

    async _saveGitBackupSettings(changes) {
        try {
            await settingsManager.save(changes);
            this._renderGitBackupSettingsUI();
            this._configureGitBackupScheduler(settingsManager.get());
            await this._renderGitBackupStatus();
        } catch (err) {
            this._showToast(`Lưu cài đặt Git thất bại: ${err}`, 'error');
        }
    }

    _gitBackupStorageKey(repoPath, suffix) {
        return `git-backup:${repoPath}:${suffix}`;
    }

    _configureGitBackupScheduler(settings) {
        if (this._gitBackupTimer) {
            clearInterval(this._gitBackupTimer);
            this._gitBackupTimer = null;
        }
        if (!settings?.git_backup_enabled || !settings.git_backup_repo_path) return;
        this._gitBackupTimer = setInterval(() => this._runGitBackupScheduled(), 60 * 1000);
    }

    async _runGitBackupScheduled() {
        const s = settingsManager.get();
        if (!s.git_backup_enabled || !s.git_backup_repo_path || this._gitBackupBusy) return;
        const now = Date.now();
        const repo = s.git_backup_repo_path;
        const lastCommit = Number(localStorage.getItem(this._gitBackupStorageKey(repo, 'commit')) || 0);
        const lastPush = Number(localStorage.getItem(this._gitBackupStorageKey(repo, 'push')) || 0);
        const commitDue = s.git_backup_auto_commit && now - lastCommit >= (Number(s.git_backup_commit_interval_min) || 30) * 60 * 1000;
        const pushDue = s.git_backup_auto_push && now - lastPush >= (Number(s.git_backup_push_interval_min) || 60) * 60 * 1000;
        if (commitDue) await this._runGitBackup({ push: false });
        if (pushDue && !this._gitBackupBusy) await this._runGitPush();
    }

    async _runGitBackup({ manual = false, push = false } = {}) {
        const s = settingsManager.get();
        if (!s.git_backup_enabled || !s.git_backup_repo_path) {
            if (manual) this._showToast('Hãy bật backup Git và chọn repository trước', 'warning');
            return;
        }
        if (!manual && !s.git_backup_auto_commit) return;
        if (this._gitBackupBusy) return;
        this._gitBackupBusy = true;
        const btn = document.getElementById('btn-git-backup-now');
        if (btn) btn.disabled = true;
        try {
            const result = await invoke('git_backup_now', {
                repoPath: s.git_backup_repo_path,
                push: Boolean(push),
            });
            const now = Date.now();
            if (result.committed) localStorage.setItem(this._gitBackupStorageKey(s.git_backup_repo_path, 'commit'), String(now));
            if (result.pushed) localStorage.setItem(this._gitBackupStorageKey(s.git_backup_repo_path, 'push'), String(now));
            if (manual) this._showToast(result.message, result.warning ? 'warning' : 'success');
            await this._renderGitBackupStatus();
        } catch (err) {
            if (manual) this._showToast(`Backup Git thất bại: ${err}`, 'error');
            const statusEl = document.getElementById('git-backup-status');
            if (statusEl) {
                statusEl.classList.add('is-error');
                statusEl.textContent = `Backup thất bại: ${err}`;
            }
        } finally {
            this._gitBackupBusy = false;
            if (btn) btn.disabled = false;
        }
    }

    async _runGitPush() {
        const s = settingsManager.get();
        if (!s.git_backup_enabled || !s.git_backup_repo_path || this._gitBackupBusy) return;
        this._gitBackupBusy = true;
        try {
            await invoke('git_backup_push', { repoPath: s.git_backup_repo_path });
            localStorage.setItem(this._gitBackupStorageKey(s.git_backup_repo_path, 'push'), String(Date.now()));
            await this._renderGitBackupStatus();
        } catch (err) {
            const statusEl = document.getElementById('git-backup-status');
            if (statusEl) {
                statusEl.classList.add('is-error');
                statusEl.textContent = `Push thất bại: ${err}`;
            }
        } finally {
            this._gitBackupBusy = false;
        }
    }

    async _renderSettingsCustomersTab() {
        const listEl = document.getElementById('settings-customers-list');
        if (!listEl) return;
        const reg = await this._loadProjectRegistry();
        const allCustomers = reg.customers || [];
        const projects = reg.projects || [];
        const sessions = this._cachedSessions || [];

        // Apply per-column filters
        let filtered = allCustomers;
        const nameQ = (this._custFilters.name || '').trim().toLowerCase();
        if (nameQ) {
            filtered = filtered.filter(c => (c.name || '').toLowerCase().includes(nameQ) || (c.code || '').toLowerCase().includes(nameQ));
        }
        const descQ = (this._custFilters.description || '').trim().toLowerCase();
        if (descQ) {
            filtered = filtered.filter(c => (c.description || '').toLowerCase().includes(descQ));
        }
        if (this._custFilters.status) {
            filtered = filtered.filter(c => (c.status || 'active') === this._custFilters.status);
        }

        // Sort items
        const sortedCustomers = this._sortItems(filtered, this._custSort, (c, field) => {
            if (field === 'name') return c.name || '';
            if (field === 'description') return c.description || '';
            if (field === 'status') return c.status || 'active';
            if (field === 'projects') return projects.filter(p => p.customer_id === c.id).length;
            if (field === 'sessions') return sessions.filter(s => s.customer_id === c.id).length;
            return 0;
        });

        const sort = this._custSort;
        let rowsHtml = '';
        if (sortedCustomers.length === 0) {
            rowsHtml = `<tr><td colspan="7" style="text-align:center; padding: 24px; color: var(--md-sys-color-on-surface-variant); font-size:12px;">Không tìm thấy khách hàng nào phù hợp.</td></tr>`;
        } else {
            sortedCustomers.forEach((c, idx) => {
                const isActive = c.status === 'active';
                const projCount = projects.filter(p => p.customer_id === c.id).length;
                const sessCount = sessions.filter(s => s.customer_id === c.id).length;
                rowsHtml += `
                  <tr>
                    <td style="text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 11px;">${idx + 1}</td>
                    <td>
                      <div style="display:flex; align-items:center; gap:8px; font-weight:600;">
                        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${this._escAttr(c.color || '#431A46')}; flex-shrink:0;"></span>
                        <button type="button" class="settings-metadata-link btn-jump-to-cust-logs" data-id="${this._escAttr(c.id)}" title="Mở Logs lọc theo khách hàng ${this._escAttr(c.name)}">${this._esc(c.name)}</button>
                      </div>
                    </td>
                    <td style="color: var(--md-sys-color-on-surface-variant); font-size:11px; max-width: 220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${this._escAttr(c.description || '')}">
                      ${c.description ? this._esc(c.description) : '<span style="opacity:0.3;">—</span>'}
                    </td>
                    <td>
                      <span class="status-pill ${isActive ? 'active' : 'archived'}">${isActive ? '🟢 Đang chạy' : '⚪ Đã dừng'}</span>
                    </td>
                    <td style="text-align: center; font-weight:600;">
                      ${projCount > 0 ? `<button type="button" class="btn-jump-to-cust-projects" data-id="${this._escAttr(c.id)}" style="background:none; border:none; cursor:pointer; color:inherit; text-decoration:underline; font-weight:600;">${projCount} dự án</button>` : '<span style="opacity:0.4; font-weight:normal;">0</span>'}
                    </td>
                    <td style="text-align: center; font-weight:600; color: var(--md-sys-color-primary);">
                      ${sessCount > 0 ? `<button type="button" class="btn-jump-to-cust-logs" data-id="${this._escAttr(c.id)}" style="background:none; border:none; cursor:pointer; color:inherit; text-decoration:underline; font-weight:600;" title="Mở Logs lọc theo khách hàng ${this._escAttr(c.name)}">${sessCount} cuộc họp</button>` : '<span style="opacity:0.4; font-weight:normal;">0</span>'}
                    </td>
                    <td style="text-align: center;">
                      <div class="mgr-item-actions" style="justify-content: center; gap: 4px;">
                        <button type="button" class="btn-secondary-small btn-edit-cust" data-id="${this._escAttr(c.id)}" title="Sửa thông tin khách hàng" style="padding: 4px 8px; font-size: 12px; line-height: 1;">
                          ✏️
                        </button>
                        <button type="button" class="btn-secondary-small btn-toggle-cust" data-id="${this._escAttr(c.id)}" title="${isActive ? 'Tạm dừng khách hàng' : 'Kích hoạt khách hàng'}" style="padding: 4px 8px; font-size: 12px; line-height: 1;">
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
        }

        const html = `
        <div class="mgr-table-container">
          <table class="mgr-table">
            <thead>
              <tr>
                <th class="sortable ${sort.field === 'index' ? 'active-sort' : ''}" data-sort="index" style="width: 45px; text-align: center;"># ${this._getSortIcon(sort, 'index')}</th>
                <th class="sortable ${sort.field === 'name' ? 'active-sort' : ''}" data-sort="name">Tên khách hàng ${this._getSortIcon(sort, 'name')}</th>
                <th class="sortable ${sort.field === 'description' ? 'active-sort' : ''}" data-sort="description">Ghi chú ${this._getSortIcon(sort, 'description')}</th>
                <th class="sortable ${sort.field === 'status' ? 'active-sort' : ''}" data-sort="status" style="width: 120px;">Trạng thái ${this._getSortIcon(sort, 'status')}</th>
                <th class="sortable ${sort.field === 'projects' ? 'active-sort' : ''}" data-sort="projects" style="width: 100px; text-align: center;">Số dự án ${this._getSortIcon(sort, 'projects')}</th>
                <th class="sortable ${sort.field === 'sessions' ? 'active-sort' : ''}" data-sort="sessions" style="width: 100px; text-align: center;">Số cuộc họp ${this._getSortIcon(sort, 'sessions')}</th>
                <th style="width: 100px; text-align: center;">Thao tác</th>
              </tr>
              <tr class="mgr-filter-row">
                <td></td>
                <td><input type="search" class="mgr-filter-input" data-filter="name" value="${this._escAttr(this._custFilters.name)}" placeholder="Lọc tên..."></td>
                <td><input type="search" class="mgr-filter-input" data-filter="description" value="${this._escAttr(this._custFilters.description)}" placeholder="Lọc ghi chú..."></td>
                <td>
                  <select class="mgr-filter-select" data-filter="status">
                    <option value="">Tất cả</option>
                    <option value="active" ${this._custFilters.status === 'active' ? 'selected' : ''}>🟢 Đang chạy</option>
                    <option value="archived" ${this._custFilters.status === 'archived' ? 'selected' : ''}>⚪ Đã dừng</option>
                  </select>
                </td>
                <td></td>
                <td></td>
                <td><button type="button" class="mgr-reset-filters" data-clear-filters title="Xoá toàn bộ điều kiện lọc">↺ Clear</button></td>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
        `;

        // Preserve active filter focus
        const focusedEl = listEl.querySelector('.mgr-filter-row :focus');
        const activeFilterKey = focusedEl?.dataset?.filter;
        const selStart = focusedEl?.selectionStart;
        const selEnd = focusedEl?.selectionEnd;

        listEl.innerHTML = html;

        // Restore focus
        if (activeFilterKey) {
            const restoredEl = listEl.querySelector(`.mgr-filter-row [data-filter="${activeFilterKey}"]`);
            if (restoredEl) {
                restoredEl.focus();
                if (typeof selStart === 'number' && typeof selEnd === 'number') {
                    try { restoredEl.setSelectionRange(selStart, selEnd); } catch (_) {}
                }
            }
        }

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
                this._renderSettingsCustomersTab();
            });
        });

        // Filter inputs & selects
        let inputTimer;
        listEl.querySelectorAll('.mgr-filter-row .mgr-filter-input').forEach(input => {
            input.addEventListener('input', () => {
                clearTimeout(inputTimer);
                inputTimer = setTimeout(() => {
                    this._custFilters[input.dataset.filter] = input.value;
                    this._renderSettingsCustomersTab();
                }, 150);
            });
            input.addEventListener('search', () => {
                clearTimeout(inputTimer);
                this._custFilters[input.dataset.filter] = input.value;
                this._renderSettingsCustomersTab();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(inputTimer);
                    this._custFilters[input.dataset.filter] = input.value;
                    this._renderSettingsCustomersTab();
                }
            });
        });

        listEl.querySelectorAll('.mgr-filter-row .mgr-filter-select').forEach(sel => {
            sel.addEventListener('change', () => {
                this._custFilters[sel.dataset.filter] = sel.value;
                this._renderSettingsCustomersTab();
            });
        });

        listEl.querySelector('.mgr-filter-row [data-clear-filters]')?.addEventListener('click', () => {
            this._custFilters = { name: '', description: '', status: '' };
            this._renderSettingsCustomersTab();
        });

        // Edit customer button
        listEl.querySelectorAll('.btn-edit-cust').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const cust = allCustomers.find(c => c.id === id);
                if (cust) this._openEditCustomerModal(cust);
            });
        });

        // Jump to customer's projects in Tab Projects
        listEl.querySelectorAll('.btn-jump-to-cust-projects').forEach(el => {
            el.addEventListener('click', () => {
                const cid = el.dataset.id;
                this._projFilters.customer_id = cid;
                this._projScopeFilter = 'work';
                this._showSettingsScreen('tab-projects');
            });
        });

        // Jump to Logs filtered by this customer
        listEl.querySelectorAll('.btn-jump-to-cust-logs').forEach(el => {
            el.addEventListener('click', () => {
                this._jumpToLogsWithFilter('customer', el.dataset.id);
            });
        });

        // Toggle customer status
        listEl.querySelectorAll('.btn-toggle-cust').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                try {
                    const newStatus = await invoke('toggle_customer_status', { id });
                    this._showToast(`Đã chuyển khách hàng sang: ${newStatus === 'active' ? 'Đang chạy' : 'Đã dừng'}`, 'success');
                    await this._loadProjectRegistry();
                    this._renderSettingsCustomersTab();
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
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const name = btn.dataset.name || 'khách hàng';
                const agreed = await this._promptConfirmDelete({
                    title: 'Xoá khách hàng',
                    message: `Bạn có chắc muốn xoá khách hàng "${name}"?\nCác dự án liên kết sẽ được huỷ gán khách hàng này. Meeting log đã ghi được giữ nguyên.`,
                    confirmText: 'Xoá khách hàng'
                });
                if (!agreed) return;
                try {
                    await invoke('delete_customer', { id });
                    this._showToast('Đã xóa khách hàng', 'success');
                    await this._loadProjectRegistry();
                    this._renderSettingsCustomersTab();
                    this._renderCustomerFilterBar();
                    this._updateSidebarBadges();
                    await this._showSessions();
                } catch (err) {
                    this._showToast(`Lỗi: ${err}`, 'error');
                }
            });
        });
    }

    async _renderSettingsProjectsTab() {
        const listEl = document.getElementById('settings-projects-list');
        if (!listEl) return;

        const reg = await this._loadProjectRegistry();
        const customers = reg.customers || [];
        const allProjects = reg.projects || [];
        const sessions = this._cachedSessions || [];

        // Update scope counts
        const workCount = allProjects.filter(p => (p.scope || 'work') === 'work').length;
        const personalCount = allProjects.filter(p => p.scope === 'personal').length;
        const allCount = allProjects.length;

        const countWorkEl = document.getElementById('proj-scope-count-work');
        if (countWorkEl) countWorkEl.textContent = workCount;
        const countPersonalEl = document.getElementById('proj-scope-count-personal');
        if (countPersonalEl) countPersonalEl.textContent = personalCount;
        const countAllEl = document.getElementById('proj-scope-count-all');
        if (countAllEl) countAllEl.textContent = allCount;

        // Update active tab state
        document.querySelectorAll('#projects-scope-tabs .folder-tab-btn').forEach(btn => {
            btn.classList.toggle('active', (btn.dataset.scope || '') === (this._projScopeFilter || ''));
        });

        const isAllScopeTab = !this._projScopeFilter;
        const isPersonalScopeTab = this._projScopeFilter === 'personal';

        // Filter projects by active scope tab
        let projects = allProjects;
        if (this._projScopeFilter === 'work') {
            projects = projects.filter(p => (p.scope || 'work') === 'work');
        } else if (this._projScopeFilter === 'personal') {
            projects = projects.filter(p => p.scope === 'personal');
        }

        // Apply per-column filters
        const nameQ = (this._projFilters.name || '').trim().toLowerCase();
        if (nameQ) {
            projects = projects.filter(p => (p.name || '').toLowerCase().includes(nameQ));
        }
        if (isAllScopeTab && this._projFilters.scope) {
            projects = projects.filter(p => (p.scope || 'work') === this._projFilters.scope);
        }
        if (!isPersonalScopeTab && this._projFilters.customer_id) {
            projects = projects.filter(p => p.customer_id === this._projFilters.customer_id);
        }
        const descQ = (this._projFilters.description || '').trim().toLowerCase();
        if (descQ) {
            projects = projects.filter(p => (p.description || '').toLowerCase().includes(descQ));
        }
        if (this._projFilters.status) {
            projects = projects.filter(p => (p.status || 'active') === this._projFilters.status);
        }

        // Sort items
        const sortedProjects = this._sortItems(projects, this._projSort, (p, field) => {
            if (field === 'name') return p.name || '';
            if (field === 'scope') return p.scope || 'work';
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
        const colCount = 4 + (isAllScopeTab ? 1 : 0) + (!isPersonalScopeTab ? 1 : 0) + 2;

        let rowsHtml = '';
        if (sortedProjects.length === 0) {
            rowsHtml = `<tr><td colspan="${colCount}" style="text-align:center; padding: 24px; color: var(--md-sys-color-on-surface-variant); font-size:12px;">Không tìm thấy dự án nào phù hợp.</td></tr>`;
        } else {
            sortedProjects.forEach((p, idx) => {
                const isActive = p.status === 'active';
                const pScope = p.scope || 'work';
                const cust = customers.find(c => c.id === p.customer_id);
                const sessCount = sessions.filter(s => s.project_id === p.id).length;

                const scopeBadge = pScope === 'personal'
                    ? '<span class="scope-badge-personal" style="font-size:10px;">👤 Cá nhân</span>'
                    : '<span class="scope-badge-work" style="font-size:10px;">💼 Công việc</span>';

                const custBadge = pScope === 'personal'
                    ? '<span style="font-size:11px; opacity:0.3;">—</span>'
                    : (cust
                        ? `<button type="button" class="session-customer-badge btn-jump-to-customer" data-cust-id="${this._escAttr(cust.id)}" style="border-color:${this._escAttr(cust.color || '#431A46')}44; color:${this._escAttr(cust.color || '#D9B0DE')}; background:${this._escAttr(cust.color || '#431A46')}1a; cursor:pointer;" title="Mở Logs lọc theo khách hàng ${this._escAttr(cust.name)}">🤝 ${this._esc(cust.name)} ↗</button>`
                        : `<span style="font-size:11px; opacity:0.4;">(Chưa gán KH)</span>`);

                rowsHtml += `
                  <tr>
                    <td style="text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 11px;">${idx + 1}</td>
                    <td>
                      <div style="display:flex; align-items:center; gap:8px; font-weight:600;">
                        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${this._escAttr(p.color || '#431A46')}; flex-shrink:0;"></span>
                        <button type="button" class="settings-metadata-link btn-jump-to-proj-logs" data-id="${this._escAttr(p.id)}" data-scope="${this._escAttr(pScope)}" title="Mở Logs lọc theo dự án ${this._escAttr(p.name)}">${this._esc(p.name)}</button>
                      </div>
                    </td>
                    ${isAllScopeTab ? `<td style="text-align: center;">${scopeBadge}</td>` : ''}
                    ${!isPersonalScopeTab ? `<td>${custBadge}</td>` : ''}
                    <td style="color: var(--md-sys-color-on-surface-variant); font-size:11px; max-width: 220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${this._escAttr(p.description || '')}">
                      ${p.description ? this._esc(p.description) : '<span style="opacity:0.3;">-</span>'}
                    </td>
                    <td>
                      <span class="status-pill ${isActive ? 'active' : 'archived'}">${isActive ? '🟢 Đang chạy' : '⚪ Đã dừng'}</span>
                    </td>
                    <td style="text-align: center; font-weight:600; color: var(--md-sys-color-primary);">
                      ${sessCount > 0 ? `<button type="button" class="btn-jump-to-proj-logs" data-id="${this._escAttr(p.id)}" style="background:none; border:none; cursor:pointer; color:inherit; text-decoration:underline; font-weight:600;" title="Mở Logs lọc theo dự án ${this._escAttr(p.name)}">${sessCount} cuộc họp</button>` : '<span style="opacity:0.4; font-weight:normal;">0</span>'}
                    </td>
                    <td style="text-align: center;">
                      <div class="mgr-item-actions" style="justify-content: center; gap: 4px;">
                        <button type="button" class="btn-secondary-small btn-edit-proj" data-id="${this._escAttr(p.id)}" title="Chỉnh sửa dự án" style="padding: 4px 8px; font-size: 12px; line-height: 1;">
                          ✏️
                        </button>
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
        }

        const custOptionsHtml = `<option value="">🤝 Tất cả khách hàng</option>` + customers.map(c => `<option value="${this._escAttr(c.id)}" ${this._projFilters.customer_id === c.id ? 'selected' : ''}>🤝 ${this._esc(c.name)}</option>`).join('');

        const html = `
        <div class="mgr-table-container">
          <table class="mgr-table">
            <thead>
              <tr>
                <th class="sortable ${sort.field === 'index' ? 'active-sort' : ''}" data-sort="index" style="width: 45px; text-align: center;"># ${this._getSortIcon(sort, 'index')}</th>
                <th class="sortable ${sort.field === 'name' ? 'active-sort' : ''}" data-sort="name">Tên dự án ${this._getSortIcon(sort, 'name')}</th>
                ${isAllScopeTab ? `<th class="sortable ${sort.field === 'scope' ? 'active-sort' : ''}" data-sort="scope" style="width: 110px; text-align: center;">Phạm vi ${this._getSortIcon(sort, 'scope')}</th>` : ''}
                ${!isPersonalScopeTab ? `<th class="sortable ${sort.field === 'customer' ? 'active-sort' : ''}" data-sort="customer" style="width: 170px;">Khách hàng ${this._getSortIcon(sort, 'customer')}</th>` : ''}
                <th class="sortable ${sort.field === 'description' ? 'active-sort' : ''}" data-sort="description">Mô tả ${this._getSortIcon(sort, 'description')}</th>
                <th class="sortable ${sort.field === 'status' ? 'active-sort' : ''}" data-sort="status" style="width: 110px;">Trạng thái ${this._getSortIcon(sort, 'status')}</th>
                <th class="sortable ${sort.field === 'sessions' ? 'active-sort' : ''}" data-sort="sessions" style="width: 100px; text-align: center;">Số cuộc họp ${this._getSortIcon(sort, 'sessions')}</th>
                <th style="width: 90px; text-align: center;">Thao tác</th>
              </tr>
              <tr class="mgr-filter-row">
                <td></td>
                <td><input type="search" class="mgr-filter-input" data-filter="name" value="${this._escAttr(this._projFilters.name)}" placeholder="Lọc tên dự án..."></td>
                ${isAllScopeTab ? `
                  <td>
                    <select class="mgr-filter-select" data-filter="scope">
                      <option value="">Tất cả</option>
                      <option value="work" ${this._projFilters.scope === 'work' ? 'selected' : ''}>💼 Công việc</option>
                      <option value="personal" ${this._projFilters.scope === 'personal' ? 'selected' : ''}>👤 Cá nhân</option>
                    </select>
                  </td>
                ` : ''}
                ${!isPersonalScopeTab ? `
                  <td>
                    <select class="mgr-filter-select" data-filter="customer_id">
                      ${custOptionsHtml}
                    </select>
                  </td>
                ` : ''}
                <td><input type="search" class="mgr-filter-input" data-filter="description" value="${this._escAttr(this._projFilters.description)}" placeholder="Lọc mô tả..."></td>
                <td>
                  <select class="mgr-filter-select" data-filter="status">
                    <option value="">Tất cả</option>
                    <option value="active" ${this._projFilters.status === 'active' ? 'selected' : ''}>🟢 Đang chạy</option>
                    <option value="archived" ${this._projFilters.status === 'archived' ? 'selected' : ''}>⚪ Đã dừng</option>
                  </select>
                </td>
                <td></td>
                <td><button type="button" class="mgr-reset-filters" data-clear-filters title="Xoá toàn bộ điều kiện lọc">↺ Clear</button></td>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
        `;

        // Preserve focus
        const focusedEl = listEl.querySelector('.mgr-filter-row :focus');
        const activeFilterKey = focusedEl?.dataset?.filter;
        const selStart = focusedEl?.selectionStart;
        const selEnd = focusedEl?.selectionEnd;

        listEl.innerHTML = html;

        // Restore focus
        if (activeFilterKey) {
            const restoredEl = listEl.querySelector(`.mgr-filter-row [data-filter="${activeFilterKey}"]`);
            if (restoredEl) {
                restoredEl.focus();
                if (typeof selStart === 'number' && typeof selEnd === 'number') {
                    try { restoredEl.setSelectionRange(selStart, selEnd); } catch (_) {}
                }
            }
        }

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
                this._renderSettingsProjectsTab();
            });
        });

        // Filter inputs & selects
        let inputTimer;
        listEl.querySelectorAll('.mgr-filter-row .mgr-filter-input').forEach(input => {
            input.addEventListener('input', () => {
                clearTimeout(inputTimer);
                inputTimer = setTimeout(() => {
                    this._projFilters[input.dataset.filter] = input.value;
                    this._renderSettingsProjectsTab();
                }, 150);
            });
            input.addEventListener('search', () => {
                clearTimeout(inputTimer);
                this._projFilters[input.dataset.filter] = input.value;
                this._renderSettingsProjectsTab();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(inputTimer);
                    this._projFilters[input.dataset.filter] = input.value;
                    this._renderSettingsProjectsTab();
                }
            });
        });

        listEl.querySelectorAll('.mgr-filter-row .mgr-filter-select').forEach(sel => {
            sel.addEventListener('change', () => {
                this._projFilters[sel.dataset.filter] = sel.value;
                this._renderSettingsProjectsTab();
            });
        });

        listEl.querySelector('.mgr-filter-row [data-clear-filters]')?.addEventListener('click', () => {
            this._projFilters = { name: '', scope: '', customer_id: '', description: '', status: '' };
            this._renderSettingsProjectsTab();
        });

        // Edit project
        listEl.querySelectorAll('.btn-edit-proj').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const reg = await this._loadProjectRegistry();
                const targetProj = (reg.projects || []).find(p => p.id === id);
                if (targetProj) {
                    this._openEditProjectModal(targetProj);
                }
            });
        });

        // Click customer badge in project table opens Logs filtered by customer.
        listEl.querySelectorAll('.btn-jump-to-customer').forEach(badge => {
            badge.addEventListener('click', () => {
                const custId = badge.dataset.custId;
                if (custId) this._jumpToLogsWithFilter('customer', custId, 'work');
            });
        });

        // Jump to Logs filtered by this project
        listEl.querySelectorAll('.btn-jump-to-proj-logs').forEach(btn => {
            btn.addEventListener('click', () => {
                this._jumpToLogsWithFilter('project', btn.dataset.id);
            });
        });

        // Toggle project status
        listEl.querySelectorAll('.btn-toggle-proj').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                try {
                    const newStatus = await invoke('toggle_project_status', { id });
                    this._showToast(`Đã chuyển dự án sang: ${newStatus === 'active' ? 'Đang chạy' : 'Đã dừng'}`, 'success');
                    await this._loadProjectRegistry();
                    this._renderSettingsProjectsTab();
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
                    this._renderSettingsProjectsTab();
                    this._renderProjectFilterBar();
                    this._updateSidebarBadges();
                    await this._showSessions();
                } catch (err) {
                    this._showToast(`Lỗi: ${err}`, 'error');
                }
            });
        });
    }

    _openAddCategoryModal() {
        const modal = document.getElementById('modal-edit-category');
        if (!modal) return;
        const idInput = document.getElementById('input-modal-cat-id');
        const nameInput = document.getElementById('input-modal-cat-name');
        const colorInput = document.getElementById('input-modal-cat-color');
        const scopeSelect = document.getElementById('select-modal-cat-scope');
        const tmplSelect = document.getElementById('select-modal-cat-template');
        const titleEl = document.getElementById('modal-cat-title');

        if (titleEl) titleEl.textContent = '🗂️ Thêm Category mới';
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';
        if (colorInput) colorInput.value = '#10b981';
        if (scopeSelect) scopeSelect.value = (this._catScopeFilter && this._catScopeFilter !== 'all') ? this._catScopeFilter : 'work';
        if (tmplSelect) tmplSelect.value = 'standard';

        modal.style.display = 'flex';
        setTimeout(() => nameInput?.focus(), 50);
    }

    _openEditCategoryModal(category) {
        if (!category) return;
        const modal = document.getElementById('modal-edit-category');
        if (!modal) return;
        const idInput = document.getElementById('input-modal-cat-id');
        const nameInput = document.getElementById('input-modal-cat-name');
        const colorInput = document.getElementById('input-modal-cat-color');
        const scopeSelect = document.getElementById('select-modal-cat-scope');
        const tmplSelect = document.getElementById('select-modal-cat-template');
        const titleEl = document.getElementById('modal-cat-title');

        if (titleEl) titleEl.textContent = `🗂️ Chỉnh sửa: ${category.name}`;
        if (idInput) idInput.value = category.id || '';
        if (nameInput) nameInput.value = category.name || '';
        if (colorInput) colorInput.value = category.color || '#10b981';
        if (scopeSelect) scopeSelect.value = category.scope || 'work';
        if (tmplSelect) tmplSelect.value = category.template_id || 'standard';

        modal.style.display = 'flex';
        setTimeout(() => nameInput?.focus(), 50);
    }

    _closeEditCategoryModal() {
        const modal = document.getElementById('modal-edit-category');
        if (modal) modal.style.display = 'none';
    }

    async _handleSaveCategoryFromModal() {
        const idInput = document.getElementById('input-modal-cat-id');
        const nameInput = document.getElementById('input-modal-cat-name');
        const colorInput = document.getElementById('input-modal-cat-color');
        const scopeSelect = document.getElementById('select-modal-cat-scope');
        const tmplSelect = document.getElementById('select-modal-cat-template');
        const name = nameInput?.value.trim();
        if (!name) {
            this._showToast('Vui lòng nhập tên category', 'error');
            return;
        }
        const id = idInput?.value.trim() || '';
        const color = colorInput?.value || '#10b981';
        const scope = scopeSelect?.value || 'work';
        const template_id = tmplSelect?.value || null;

        try {
            await invoke('save_category', {
                category: {
                    id,
                    name,
                    color,
                    scope,
                    template_id,
                }
            });
            this._closeEditCategoryModal();
            this._showToast(id ? `Đã cập nhật category "${name}" ✓` : `Đã thêm category "${name}" ✓`, 'success');
            await this._loadProjectRegistry();
            this._renderSettingsCategoriesTab();
            this._renderCategoryFilterSelect();
            this._updateSidebarBadges();
            await this._showSessions();
        } catch (err) {
            this._showToast(`Lưu category thất bại: ${err}`, 'error');
        }
    }

    async _renderSettingsCategoriesTab() {
        const listEl = document.getElementById('settings-categories-list');
        if (!listEl) return;
        const reg = await this._loadProjectRegistry();
        const allCategories = reg.categories || [];
        const sessions = this._cachedSessions || [];

        // Update scope counts
        const workCount = allCategories.filter(c => (c.scope || 'work') === 'work' || c.scope === 'all').length;
        const personalCount = allCategories.filter(c => c.scope === 'personal' || c.scope === 'all').length;
        const allCount = allCategories.length;

        const countWorkEl = document.getElementById('cat-scope-count-work');
        if (countWorkEl) countWorkEl.textContent = workCount;
        const countPersonalEl = document.getElementById('cat-scope-count-personal');
        if (countPersonalEl) countPersonalEl.textContent = personalCount;
        const countAllEl = document.getElementById('cat-scope-count-all');
        if (countAllEl) countAllEl.textContent = allCount;

        // Update active tab state
        document.querySelectorAll('#categories-scope-tabs .folder-tab-btn').forEach(btn => {
            btn.classList.toggle('active', (btn.dataset.scope || '') === (this._catScopeFilter || ''));
        });

        const isAllCatTab = !this._catScopeFilter;

        // Filter categories according to active tab
        let categories = allCategories;
        if (this._catScopeFilter === 'work') {
            categories = allCategories.filter(c => (c.scope || 'work') === 'work' || c.scope === 'all');
        } else if (this._catScopeFilter === 'personal') {
            categories = allCategories.filter(c => c.scope === 'personal' || c.scope === 'all');
        }

        // Apply per-column filters
        const nameQ = (this._catFilters.name || '').trim().toLowerCase();
        if (nameQ) {
            categories = categories.filter(c => (c.name || '').toLowerCase().includes(nameQ));
        }
        if (isAllCatTab && this._catFilters.scope) {
            categories = categories.filter(c => (c.scope || 'work') === this._catFilters.scope);
        }
        if (this._catFilters.template_id) {
            categories = categories.filter(c => (c.template_id || 'standard') === this._catFilters.template_id);
        }

        const templateLabels = {
            standard: '🤝 Tiêu chuẩn',
            tech: '💻 Kỹ thuật',
            one_on_one: '👥 1-on-1',
            personal: '👤 Cá nhân',
        };

        // Sort categories
        const sortedCategories = this._sortItems(categories, this._catSort, (c, field) => {
            if (field === 'name') return c.name || '';
            if (field === 'scope') return c.scope || 'work';
            if (field === 'template') return templateLabels[c.template_id] || 'Mặc định';
            if (field === 'sessions') return sessions.filter(s => s.category === c.name || s.category === c.id).length;
            return 0;
        });

        const sort = this._catSort;
        const colCount = 4 + (isAllCatTab ? 1 : 0) + 1;

        let rowsHtml = '';
        if (sortedCategories.length === 0) {
            rowsHtml = `<tr><td colspan="${colCount}" style="text-align:center; padding: 24px; color: var(--md-sys-color-on-surface-variant); font-size:12px;">Không tìm thấy category nào phù hợp.</td></tr>`;
        } else {
            sortedCategories.forEach((c, idx) => {
                const sessCount = sessions.filter(s => s.category === c.name || s.category === c.id).length;
                const scopeBadge = c.scope === 'personal'
                    ? '<span class="scope-badge-personal">👤 Cá nhân</span>'
                    : (c.scope === 'work' ? '<span class="scope-badge-work">💼 Công việc</span>' : '<span style="font-size:11px; opacity:0.6;">🌐 Cả hai</span>');
                const tmplBadge = c.template_id && templateLabels[c.template_id]
                    ? `<button type="button" class="template-badge-pill btn-jump-to-template" data-template="${this._escAttr(c.template_id)}" style="cursor:pointer; font:inherit;" title="Mở cài đặt mẫu ${this._escAttr(templateLabels[c.template_id])}">${templateLabels[c.template_id]} ↗</button>`
                    : '<span style="font-size:11px; opacity:0.4;">(Mặc định)</span>';

                rowsHtml += `
                  <tr>
                    <td style="text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 11px;">${idx + 1}</td>
                    <td>
                      <div style="display:flex; align-items:center; gap:8px; font-weight:600;">
                        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${this._escAttr(c.color || '#431A46')}; flex-shrink:0;"></span>
                        <button type="button" class="settings-metadata-link btn-jump-to-cat-logs" data-cat="${this._escAttr(c.name)}" data-scope="${this._escAttr(c.scope || 'work')}" title="Mở Logs lọc theo category ${this._escAttr(c.name)}">${this._esc(c.name)}</button>
                      </div>
                    </td>
                    ${isAllCatTab ? `<td style="text-align: center;">${scopeBadge}</td>` : ''}
                    <td style="text-align: center;">${tmplBadge}</td>
                    <td style="text-align: center; font-weight:600; color: var(--md-sys-color-primary);">
                      ${sessCount > 0 ? `<button type="button" class="btn-jump-to-cat-logs" data-cat="${this._escAttr(c.name)}" style="background:none; border:none; cursor:pointer; color:inherit; text-decoration:underline; font-weight:600;" title="Mở Logs lọc theo category ${this._escAttr(c.name)}">${sessCount} cuộc họp</button>` : '<span style="opacity:0.4; font-weight:normal;">0</span>'}
                    </td>
                    <td style="text-align: center;">
                      <div class="mgr-item-actions" style="justify-content: center; gap: 4px;">
                        <button type="button" class="btn-secondary-small btn-edit-cat" data-id="${this._escAttr(c.id)}" title="Chỉnh sửa category" style="padding: 4px 8px; font-size: 12px; line-height: 1;">
                          ✏️
                        </button>
                        <button type="button" class="btn-danger-small btn-del-cat" data-id="${this._escAttr(c.id)}" data-name="${this._escAttr(c.name)}" title="Xoá category" style="padding: 4px 8px; font-size: 12px; line-height: 1;">
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
            });
        }

        const html = `
        <div class="mgr-table-container">
          <table class="mgr-table">
            <thead>
              <tr>
                <th class="sortable ${sort.field === 'index' ? 'active-sort' : ''}" data-sort="index" style="width: 45px; text-align: center;"># ${this._getSortIcon(sort, 'index')}</th>
                <th class="sortable ${sort.field === 'name' ? 'active-sort' : ''}" data-sort="name">Tên category cuộc họp ${this._getSortIcon(sort, 'name')}</th>
                ${isAllCatTab ? `<th class="sortable ${sort.field === 'scope' ? 'active-sort' : ''}" data-sort="scope" style="width: 120px; text-align: center;">Phạm vi ${this._getSortIcon(sort, 'scope')}</th>` : ''}
                <th class="sortable ${sort.field === 'template' ? 'active-sort' : ''}" data-sort="template" style="width: 160px; text-align: center;">Template ${this._getSortIcon(sort, 'template')}</th>
                <th class="sortable ${sort.field === 'sessions' ? 'active-sort' : ''}" data-sort="sessions" style="width: 120px; text-align: center;">Số cuộc họp gắn ${this._getSortIcon(sort, 'sessions')}</th>
                <th style="width: 90px; text-align: center;">Thao tác</th>
              </tr>
              <tr class="mgr-filter-row">
                <td></td>
                <td><input type="search" class="mgr-filter-input" data-filter="name" value="${this._escAttr(this._catFilters.name)}" placeholder="Lọc category..."></td>
                ${isAllCatTab ? `
                  <td>
                    <select class="mgr-filter-select" data-filter="scope">
                      <option value="">Tất cả</option>
                      <option value="work" ${this._catFilters.scope === 'work' ? 'selected' : ''}>💼 Công việc</option>
                      <option value="personal" ${this._catFilters.scope === 'personal' ? 'selected' : ''}>👤 Cá nhân</option>
                      <option value="all" ${this._catFilters.scope === 'all' ? 'selected' : ''}>🌐 Cả hai</option>
                    </select>
                  </td>
                ` : ''}
                <td>
                  <select class="mgr-filter-select" data-filter="template_id">
                    <option value="">Tất cả template</option>
                    <option value="standard" ${this._catFilters.template_id === 'standard' ? 'selected' : ''}>🤝 Tiêu chuẩn</option>
                    <option value="tech" ${this._catFilters.template_id === 'tech' ? 'selected' : ''}>💻 Kỹ thuật</option>
                    <option value="one_on_one" ${this._catFilters.template_id === 'one_on_one' ? 'selected' : ''}>👥 1-on-1</option>
                    <option value="personal" ${this._catFilters.template_id === 'personal' ? 'selected' : ''}>👤 Cá nhân</option>
                  </select>
                </td>
                <td></td>
                <td><button type="button" class="mgr-reset-filters" data-clear-filters title="Xoá toàn bộ điều kiện lọc">↺ Clear</button></td>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
        `;

        // Preserve focus
        const focusedEl = listEl.querySelector('.mgr-filter-row :focus');
        const activeFilterKey = focusedEl?.dataset?.filter;
        const selStart = focusedEl?.selectionStart;
        const selEnd = focusedEl?.selectionEnd;

        listEl.innerHTML = html;

        // Restore focus
        if (activeFilterKey) {
            const restoredEl = listEl.querySelector(`.mgr-filter-row [data-filter="${activeFilterKey}"]`);
            if (restoredEl) {
                restoredEl.focus();
                if (typeof selStart === 'number' && typeof selEnd === 'number') {
                    try { restoredEl.setSelectionRange(selStart, selEnd); } catch (_) {}
                }
            }
        }

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

        // Filter inputs & selects
        let inputTimer;
        listEl.querySelectorAll('.mgr-filter-row .mgr-filter-input').forEach(input => {
            input.addEventListener('input', () => {
                clearTimeout(inputTimer);
                inputTimer = setTimeout(() => {
                    this._catFilters[input.dataset.filter] = input.value;
                    this._renderSettingsCategoriesTab();
                }, 150);
            });
            input.addEventListener('search', () => {
                clearTimeout(inputTimer);
                this._catFilters[input.dataset.filter] = input.value;
                this._renderSettingsCategoriesTab();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(inputTimer);
                    this._catFilters[input.dataset.filter] = input.value;
                    this._renderSettingsCategoriesTab();
                }
            });
        });

        listEl.querySelectorAll('.mgr-filter-row .mgr-filter-select').forEach(sel => {
            sel.addEventListener('change', () => {
                this._catFilters[sel.dataset.filter] = sel.value;
                this._renderSettingsCategoriesTab();
            });
        });

        listEl.querySelector('.mgr-filter-row [data-clear-filters]')?.addEventListener('click', () => {
            this._catFilters = { name: '', scope: '', template_id: '' };
            this._renderSettingsCategoriesTab();
        });

        // Edit category
        listEl.querySelectorAll('.btn-edit-cat').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const reg = await this._loadProjectRegistry();
                const targetCat = (reg.categories || []).find(c => c.id === id);
                if (targetCat) {
                    this._openEditCategoryModal(targetCat);
                }
            });
        });

        // Jump to linked Minutes template setting
        listEl.querySelectorAll('.btn-jump-to-template').forEach(btn => {
            btn.addEventListener('click', () => {
                this._jumpToTemplateSetting(btn.dataset.template);
            });
        });

        // Jump to Logs filtered by this category
        listEl.querySelectorAll('.btn-jump-to-cat-logs').forEach(btn => {
            btn.addEventListener('click', () => {
                this._jumpToLogsWithFilter('category', btn.dataset.cat, btn.dataset.scope);
            });
        });

        // Delete category
        listEl.querySelectorAll('.btn-del-cat').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const name = btn.dataset.name || 'category';
                const agreed = await this._promptConfirmDelete({
                    title: 'Xoá category',
                    message: `Bạn có chắc muốn xoá category "${name}" khỏi hệ thống?`,
                    confirmText: 'Xoá category'
                });
                if (!agreed) return;
                try {
                    await invoke('delete_category', { id });
                    this._showToast('Đã xóa category', 'success');
                    await this._loadProjectRegistry();
                    this._renderSettingsCategoriesTab();
                    this._renderCategoryFilterSelect();
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

        const tagScopes = reg.tag_scopes || {};
        const getTagScope = (t) => {
            const key = t.toLowerCase();
            if (tagScopes[key]) return tagScopes[key];
            if (tagScopes[t]) return tagScopes[t];
            const matchingSessions = sessions.filter(s => (s.tags || []).map(x => x.toLowerCase()).includes(key));
            if (matchingSessions.length === 0) return 'work';
            const hasWork = matchingSessions.some(s => (s.scope || 'work') === 'work');
            const hasPersonal = matchingSessions.some(s => s.scope === 'personal');
            if (hasWork && hasPersonal) return 'all';
            if (hasPersonal) return 'personal';
            return 'work';
        };

        const allTagObjects = allTags.map(t => {
            const sc = getTagScope(t);
            const count = sessions.filter(s => (s.tags || []).map(x => x.toLowerCase()).includes(t.toLowerCase())).length;
            return {
                name: t,
                scope: sc,
                count
            };
        });

        // Update badge counts on folder tabs
        const workCount = allTagObjects.filter(t => t.scope === 'work' || t.scope === 'all').length;
        const personalCount = allTagObjects.filter(t => t.scope === 'personal' || t.scope === 'all').length;
        const allCount = allTagObjects.length;

        const countWorkEl = document.getElementById('tag-scope-count-work');
        const countPersEl = document.getElementById('tag-scope-count-personal');
        const countAllEl = document.getElementById('tag-scope-count-all');
        if (countWorkEl) countWorkEl.textContent = workCount;
        if (countPersEl) countPersEl.textContent = personalCount;
        if (countAllEl) countAllEl.textContent = allCount;

        // Toggle active folder tab
        document.querySelectorAll('#tags-scope-tabs .folder-tab-btn').forEach(btn => {
            btn.classList.toggle('active', (btn.dataset.scope || '') === (this._tagScopeFilter || ''));
        });

        const isAllTagTab = !this._tagScopeFilter;

        // Filter tags according to active tab
        let filteredTags = allTagObjects;
        if (this._tagScopeFilter === 'work') {
            filteredTags = allTagObjects.filter(t => t.scope === 'work' || t.scope === 'all');
        } else if (this._tagScopeFilter === 'personal') {
            filteredTags = allTagObjects.filter(t => t.scope === 'personal' || t.scope === 'all');
        }

        // Apply per-column filters
        const nameQ = (this._tagFilters.name || '').trim().toLowerCase();
        if (nameQ) {
            filteredTags = filteredTags.filter(t => (t.name || '').toLowerCase().includes(nameQ));
        }
        if (isAllTagTab && this._tagFilters.scope) {
            filteredTags = filteredTags.filter(t => (t.scope || 'work') === this._tagFilters.scope);
        }

        const sortedTags = this._sortItems(filteredTags, this._tagSort, (t, field) => {
            if (field === 'name') return t.name || '';
            if (field === 'scope') return t.scope || 'work';
            if (field === 'sessions') return t.count;
            return 0;
        });

        const sort = this._tagSort;
        const colCount = 3 + (isAllTagTab ? 1 : 0) + 1;

        let rowsHtml = '';
        if (sortedTags.length === 0) {
            rowsHtml = `<tr><td colspan="${colCount}" style="text-align:center; padding: 24px; color: var(--md-sys-color-on-surface-variant); font-size:12px;">Không tìm thấy tag nào phù hợp.</td></tr>`;
        } else {
            sortedTags.forEach((t, idx) => {
                const scopeBadge = t.scope === 'personal'
                    ? '<span class="scope-badge-personal">👤 Cá nhân</span>'
                    : (t.scope === 'work' ? '<span class="scope-badge-work">💼 Công việc</span>' : '<span style="font-size:11px; opacity:0.6;">🌐 Cả hai</span>');

                rowsHtml += `
                  <tr>
                    <td style="text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 11px;">${idx + 1}</td>
                    <td>
                      <button type="button" class="mgr-tag-chip settings-metadata-link btn-jump-to-tag-logs" data-tag="${this._escAttr(t.name)}" data-scope="${this._escAttr(t.scope || 'work')}" style="font-size:12px; font-weight:600;" title="Mở Logs lọc theo tag #${this._escAttr(t.name)}">#${this._esc(t.name)}</button>
                    </td>
                    ${isAllTagTab ? `<td style="text-align: center;">${scopeBadge}</td>` : ''}
                    <td style="text-align: center; font-weight:600; color: var(--md-sys-color-primary);">
                      ${t.count > 0 ? `<button type="button" class="btn-jump-to-tag-logs" data-tag="${this._escAttr(t.name)}" data-scope="${this._escAttr(t.scope || 'work')}" style="background:none; border:none; cursor:pointer; color:inherit; text-decoration:underline; font-weight:600;" title="Mở Logs lọc theo tag #${this._escAttr(t.name)}">${t.count} cuộc họp</button>` : '<span style="opacity:0.4; font-weight:normal;">0</span>'}
                    </td>
                    <td style="text-align: center;">
                      <div class="mgr-item-actions" style="justify-content: center; gap: 4px;">
                        <button type="button" class="btn-secondary-small btn-edit-tag" data-tag="${this._escAttr(t.name)}" data-scope="${this._escAttr(t.scope || 'work')}" title="Chỉnh sửa tag" style="padding: 4px 8px; font-size: 12px; line-height: 1;">
                          ✏️
                        </button>
                        <button type="button" class="btn-danger-small btn-del-tag-tbl" data-tag="${this._escAttr(t.name)}" title="Xoá tag" style="padding: 4px 8px; font-size: 12px; line-height: 1;">
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
            });
        }

        const html = `
        <div class="mgr-table-container">
          <table class="mgr-table">
            <thead>
              <tr>
                <th class="sortable ${sort.field === 'index' ? 'active-sort' : ''}" data-sort="index" style="width: 45px; text-align: center;"># ${this._getSortIcon(sort, 'index')}</th>
                <th class="sortable ${sort.field === 'name' ? 'active-sort' : ''}" data-sort="name">Tên tag ${this._getSortIcon(sort, 'name')}</th>
                ${isAllTagTab ? `<th class="sortable ${sort.field === 'scope' ? 'active-sort' : ''}" data-sort="scope" style="width: 130px; text-align: center;">Phạm vi ${this._getSortIcon(sort, 'scope')}</th>` : ''}
                <th class="sortable ${sort.field === 'sessions' ? 'active-sort' : ''}" data-sort="sessions" style="width: 140px; text-align: center;">Số cuộc họp gắn ${this._getSortIcon(sort, 'sessions')}</th>
                <th style="width: 90px; text-align: center;">Thao tác</th>
              </tr>
              <tr class="mgr-filter-row">
                <td></td>
                <td><input type="search" class="mgr-filter-input" data-filter="name" value="${this._escAttr(this._tagFilters.name)}" placeholder="Lọc tag..."></td>
                ${isAllTagTab ? `
                  <td>
                    <select class="mgr-filter-select" data-filter="scope">
                      <option value="">Tất cả</option>
                      <option value="work" ${this._tagFilters.scope === 'work' ? 'selected' : ''}>💼 Công việc</option>
                      <option value="personal" ${this._tagFilters.scope === 'personal' ? 'selected' : ''}>👤 Cá nhân</option>
                      <option value="all" ${this._tagFilters.scope === 'all' ? 'selected' : ''}>🌐 Cả hai</option>
                    </select>
                  </td>
                ` : ''}
                <td></td>
                <td><button type="button" class="mgr-reset-filters" data-clear-filters title="Xoá toàn bộ điều kiện lọc">↺ Clear</button></td>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
        `;

        // Preserve focus
        const focusedEl = listEl.querySelector('.mgr-filter-row :focus');
        const activeFilterKey = focusedEl?.dataset?.filter;
        const selStart = focusedEl?.selectionStart;
        const selEnd = focusedEl?.selectionEnd;

        listEl.innerHTML = html;

        // Restore focus
        if (activeFilterKey) {
            const restoredEl = listEl.querySelector(`.mgr-filter-row [data-filter="${activeFilterKey}"]`);
            if (restoredEl) {
                restoredEl.focus();
                if (typeof selStart === 'number' && typeof selEnd === 'number') {
                    try { restoredEl.setSelectionRange(selStart, selEnd); } catch (_) {}
                }
            }
        }

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

        // Filter inputs & selects
        let inputTimer;
        listEl.querySelectorAll('.mgr-filter-row .mgr-filter-input').forEach(input => {
            input.addEventListener('input', () => {
                clearTimeout(inputTimer);
                inputTimer = setTimeout(() => {
                    this._tagFilters[input.dataset.filter] = input.value;
                    this._renderSettingsTagsTab();
                }, 150);
            });
            input.addEventListener('search', () => {
                clearTimeout(inputTimer);
                this._tagFilters[input.dataset.filter] = input.value;
                this._renderSettingsTagsTab();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(inputTimer);
                    this._tagFilters[input.dataset.filter] = input.value;
                    this._renderSettingsTagsTab();
                }
            });
        });

        listEl.querySelectorAll('.mgr-filter-row .mgr-filter-select').forEach(sel => {
            sel.addEventListener('change', () => {
                this._tagFilters[sel.dataset.filter] = sel.value;
                this._renderSettingsTagsTab();
            });
        });

        listEl.querySelector('.mgr-filter-row [data-clear-filters]')?.addEventListener('click', () => {
            this._tagFilters = { name: '', scope: '' };
            this._renderSettingsTagsTab();
        });

        // Edit tag
        listEl.querySelectorAll('.btn-edit-tag').forEach(btn => {
            btn.addEventListener('click', () => {
                const tag = btn.dataset.tag;
                const scope = btn.dataset.scope || 'work';
                this._openEditTagModal(tag, scope);
            });
        });

        // Jump to Logs filtered by this tag
        listEl.querySelectorAll('.btn-jump-to-tag-logs').forEach(btn => {
            btn.addEventListener('click', () => {
                const tagName = btn.dataset.tag || '';
                const key = tagName.toLowerCase();
                const matched = (this._cachedSessions || []).filter(s =>
                    (s.tags || []).some(t => (t || '').toLowerCase() === key));
                const hasWork = matched.some(s => (s.scope || 'work') === 'work');
                const hasPersonal = matched.some(s => s.scope === 'personal');
                let logsScope = 'all';
                if (hasWork && !hasPersonal) logsScope = 'work';
                else if (hasPersonal && !hasWork) logsScope = 'personal';
                if (logsScope === 'all') {
                    const fallback = btn.dataset.scope || '';
                    if (fallback === 'work' || fallback === 'personal') logsScope = fallback;
                }
                this._jumpToLogsWithFilter('tag', tagName, logsScope);
            });
        });

        // Delete tag
        listEl.querySelectorAll('.btn-del-tag-tbl').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tag = btn.dataset.tag;
                const agreed = await this._promptConfirmDelete({
                    title: 'Xoá tag',
                    message: `Bạn có chắc muốn xoá tag #${tag} khỏi hệ thống?`,
                    confirmText: 'Xoá tag'
                });
                if (!agreed) return;
                try {
                    await invoke('delete_tag', { tag });
                    this._showToast(`Đã xóa tag #${tag}`, 'success');
                    await this._loadProjectRegistry();
                    this._renderSettingsTagsTab();
                    this._renderTagFilterSelect();
                    this._updateSidebarBadges();
                    await this._showSessions();
                } catch (err) {
                    this._showToast(`Lỗi: ${err}`, 'error');
                }
            });
        });
    }

    _openAddTagModal() {
        const modal = document.getElementById('modal-edit-tag');
        if (!modal) return;
        const oldNameInput = document.getElementById('input-modal-tag-old-name');
        const nameInput = document.getElementById('input-modal-tag-name');
        const scopeSelect = document.getElementById('select-modal-tag-scope');
        const titleEl = document.getElementById('modal-tag-title');

        if (titleEl) titleEl.textContent = '🏷️ Thêm Tag mới';
        if (oldNameInput) oldNameInput.value = '';
        if (nameInput) nameInput.value = '';
        if (scopeSelect) scopeSelect.value = this._tagScopeFilter || 'work';

        modal.style.display = 'flex';
        setTimeout(() => nameInput?.focus(), 50);
    }

    _openEditTagModal(tag, scope) {
        const modal = document.getElementById('modal-edit-tag');
        if (!modal) return;
        const oldNameInput = document.getElementById('input-modal-tag-old-name');
        const nameInput = document.getElementById('input-modal-tag-name');
        const scopeSelect = document.getElementById('select-modal-tag-scope');
        const titleEl = document.getElementById('modal-tag-title');

        if (titleEl) titleEl.textContent = `🏷️ Chỉnh sửa thẻ: #${tag}`;
        if (oldNameInput) oldNameInput.value = tag;
        if (nameInput) nameInput.value = tag;
        if (scopeSelect) scopeSelect.value = scope || 'work';

        modal.style.display = 'flex';
        setTimeout(() => nameInput?.focus(), 50);
    }

    _closeEditTagModal() {
        const modal = document.getElementById('modal-edit-tag');
        if (modal) modal.style.display = 'none';
    }

    async _handleSaveTagFromModal() {
        const oldNameInput = document.getElementById('input-modal-tag-old-name');
        const nameInput = document.getElementById('input-modal-tag-name');
        const scopeSelect = document.getElementById('select-modal-tag-scope');
        const oldTag = oldNameInput?.value.trim().replace(/^#+/, '');
        const newTag = nameInput?.value.trim().replace(/^#+/, '');
        const scope = scopeSelect?.value || 'work';

        if (!newTag) {
            this._showToast('Vui lòng nhập tên tag', 'error');
            return;
        }

        try {
            if (oldTag && oldTag.toLowerCase() !== newTag.toLowerCase()) {
                await invoke('delete_tag', { tag: oldTag });
            }
            await invoke('save_tag', { tag: newTag, scope });
            this._closeEditTagModal();
            this._showToast(oldTag ? `Đã cập nhật tag #${newTag} ✓` : `Đã thêm tag #${newTag} ✓`, 'success');
            await this._loadProjectRegistry();
            this._renderSettingsTagsTab();
            this._renderTagFilterSelect();
            this._updateSidebarBadges();
            await this._showSessions();
        } catch (err) {
            this._showToast(`Cập nhật tag thất bại: ${err}`, 'error');
        }
    }

    async _handleCreateCategory() {
        const nameInput = document.getElementById('input-new-cat-name');
        const colorInput = document.getElementById('input-new-cat-color');
        const scopeSelect = document.getElementById('select-new-cat-scope');
        const templateSelect = document.getElementById('select-new-cat-template');
        const name = nameInput?.value.trim();
        if (!name) {
            this._showToast('Vui lòng nhập tên category', 'error');
            return;
        }
        const color = colorInput?.value || '#10b981';
        const scope = scopeSelect?.value || null;
        const template_id = templateSelect?.value || null;
        try {
            await invoke('save_category', {
                category: {
                    id: '',
                    name,
                    color,
                    scope,
                    template_id,
                }
            });
            if (nameInput) nameInput.value = '';
            if (scopeSelect) scopeSelect.value = '';
            if (templateSelect) templateSelect.value = '';
            this._showToast(`Đã thêm category "${name}" ✓`, 'success');
            await this._loadProjectRegistry();
            this._renderSettingsCategoriesTab();
            this._renderCategoryFilterSelect();
            this._updateSidebarBadges();
            await this._showSessions();
        } catch (err) {
            this._showToast(`Thêm category thất bại: ${err}`, 'error');
        }
    }

    async _handleCreateTag() {
        const tagInput = document.getElementById('input-new-tag-name');
        const scopeSelect = document.getElementById('select-new-tag-scope');
        const tag = tagInput?.value.trim().replace(/^#+/, '');
        if (!tag) {
            this._showToast('Vui lòng nhập tên tag', 'error');
            return;
        }
        const scope = scopeSelect?.value || this._tagScopeFilter || 'work';
        try {
            await invoke('save_tag', { tag, scope });
            if (tagInput) tagInput.value = '';
            this._showToast(`Đã thêm tag #${tag} ✓`, 'success');
            await this._loadProjectRegistry();
            this._renderSettingsTagsTab();
            this._renderTagFilterSelect();
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
        document.getElementById('subtab-btn-minutes-en')?.addEventListener('click', () => this._switchMinutesSubtab('en'));
        document.getElementById('btn-session-edit-langs')?.addEventListener('click', () => this._handleEditSessionLangs());

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
                // Force layout recalculation in WebKit/Tauri after display change
                if (t === tab) panel.getBoundingClientRect();
            }
        });
    }

    _minutesLangName(lang) {
        return lang === 'ja' ? 'Tiếng Nhật' : (lang === 'en' ? 'English' : 'Tiếng Việt');
    }

    _switchMinutesSubtab(lang) {
        this._activeMinutesLang = lang || 'ja';
        const subtabs = ['ja', 'vi', 'en'];
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

        if (this._activeMinutesGeneration && this._activeMinutesGeneration.id === this._currentViewedSession?.id && this._activeMinutesGeneration.lang === lang) {
            if (loadingEl) loadingEl.style.display = 'flex';
            if (emptyEl) emptyEl.style.display = 'none';
            if (editorContainer) editorContainer.style.display = 'none';
            const regenBtn = document.getElementById('btn-minutes-regenerate');
            if (regenBtn) {
                regenBtn.disabled = true;
                regenBtn.innerHTML = '<span class="spinner-ring button-spinner-inline"></span> Đang tạo...';
            }
            return;
        }

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
                    : (lang === 'en'
                        ? 'No English Meeting Minutes for this meeting yet'
                        : 'Chưa có Meeting Minutes tiếng Việt cho cuộc họp này');
            }
            if (emptyBtn) {
                emptyBtn.textContent = lang === 'ja'
                    ? '✨ Tạo Meeting Minutes (Tiếng Nhật 🇯🇵)'
                    : (lang === 'en'
                        ? '✨ Create Meeting Minutes (English 🇬🇧)'
                        : '✨ Tạo Meeting Minutes (Tiếng Việt 🇻🇳)');
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
        const hasEn = !!(this._loadedMinutes && this._loadedMinutes.en && this._loadedMinutes.en.trim());

        const badgeJa = document.getElementById('subtab-badge-minutes-ja');
        if (badgeJa) badgeJa.style.display = hasJa ? 'inline-block' : 'none';

        const badgeVi = document.getElementById('subtab-badge-minutes-vi');
        if (badgeVi) badgeVi.style.display = hasVi ? 'inline-block' : 'none';

        const badgeEn = document.getElementById('subtab-badge-minutes-en');
        if (badgeEn) badgeEn.style.display = hasEn ? 'inline-block' : 'none';

        const badgeMain = document.getElementById('tab-badge-minutes');
        if (badgeMain) badgeMain.style.display = (hasJa || hasVi || hasEn) ? 'inline-block' : 'none';
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
                imageAssets: [],
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

        // Logs are rendered as the same single/dual transcript layout as Live,
        // rather than as a Markdown editor.
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

    _sessionHasTranslation(json) {
        return !!json?.target_lang && json.target_lang !== 'none' && json.target_lang !== 'off'
            && json.target_lang !== json.source_lang
            && (json.chunks || []).some(chunk => (chunk.segments || []).some(segment => (segment.tgt || '').trim()));
    }

    _updateRetranscriptStatus(json) {
        const btn = document.getElementById('btn-session-retranscript');
        const status = document.getElementById('session-retranscript-status');
        if (!status) return;

        // Nếu cuộc họp này ĐANG trong tiến trình Re-transcript
        if (this._activeRetranscribe && this._activeRetranscribe.id === json?.id) {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="retranscript-spinner-inline"></span> Đang transcript...';
            }
            status.textContent = `⏳ Đang Re-transcript: ${this._activeRetranscribe.text || 'Đang xử lý...'} (${this._activeRetranscribe.percent || 15}%)`;
            status.style.display = '';
            status.classList.add('is-running');
            return;
        }

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '🔄 Re-transcript';
        }
        status.classList.remove('is-running');

        if (!json?.retranscribed_at) {
            status.textContent = '';
            status.style.display = 'none';
            return;
        }
        const date = new Date(json.retranscribed_at);
        let formatted = '';
        if (Number.isNaN(date.getTime())) {
            formatted = json.retranscribed_at;
        } else {
            const p = n => String(n).padStart(2, '0');
            formatted = `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()} ${p(date.getHours())}:${p(date.getMinutes())}`;
        }
        status.textContent = `Đã Re-transcript vào ${formatted}`;
        status.style.display = '';
    }

    _renderSessionLogs(json) {
        const container = document.getElementById('session-logs-editor-container');
        if (!container) return;

        const hasTranslation = this._sessionHasTranslation(json);
        const segments = (json?.chunks || []).flatMap(chunk => chunk.segments || [])
            .filter(segment => (segment.src || '').trim() || (hasTranslation && (segment.tgt || '').trim()));
        const sourceName = this._getQuickLangName(json?.source_lang || 'auto');
        const targetName = this._getQuickLangName(json?.target_lang || '');
        const esc = (value) => this._esc(value || '');
        const copyButton = (kind, title, extraClass = '') => `<button type="button" class="panel-copy-btn ${extraClass}" data-copy-session-log="${kind}" title="${title}"><svg class="icon-copy-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>`;
        const singleRow = (segment, text) => `<div class="session-log-line"><span class="session-log-time">${esc(segment.ts || '')}</span><span>${esc(text)}</span></div>`;
        const dualRow = (index, text) => `<div class="session-log-line session-log-dual-line" data-segment-index="${index}">${esc(text)}</div>`;
        const timelineRow = (index, segment) => `<button type="button" class="session-log-timeline-row" data-segment-index="${index}" title="Nhấp để cuộn tới câu tương ứng">${esc(segment.ts || '--:--')}</button>`;

        if (!segments.length) {
            container.innerHTML = '<div class="session-logs-empty">Chưa có nội dung transcript.</div>';
            return;
        }

        const jumpBottomButton = `<button type="button" class="live-jump-bottom-btn session-log-scroll-bottom" aria-label="Cuộn xuống đoạn mới nhất" title="Cuộn xuống đoạn mới nhất"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="4" x2="12" y2="19"></line><polyline points="19 13 12 20 5 13"></polyline></svg><span>Mới nhất</span></button>`;

        if (!hasTranslation) {
            container.innerHTML = `<div class="session-logs-live session-logs-single"><section class="session-log-column"><header class="panel-column-header"><span class="panel-header-title">📝 ${esc(sourceName)}</span>${copyButton('source', 'Copy toàn bộ bản gốc', 'btn-copy-source')}</header><div class="session-log-scroll">${segments.map(segment => singleRow(segment, segment.src)).join('')}</div></section>${jumpBottomButton}</div>`;
            const singleScroll = container.querySelector('.session-log-scroll');
            const scrollBottom = container.querySelector('.session-log-scroll-bottom');
            const updateScrollButton = () => {
                if (!singleScroll || !scrollBottom) return;
                const isAwayFromBottom = singleScroll.scrollHeight - singleScroll.scrollTop - singleScroll.clientHeight > 120;
                scrollBottom.classList.toggle('is-visible', isAwayFromBottom);
            };
            singleScroll?.addEventListener('scroll', updateScrollButton, { passive: true });
            scrollBottom?.addEventListener('click', () => {
                singleScroll?.scrollTo({ top: singleScroll.scrollHeight, behavior: 'smooth' });
            });
            this._bindSessionLogCopy(container, segments, false);
            updateScrollButton();
            return;
        }

        container.innerHTML = `<div class="session-logs-live session-logs-dual">
            <section class="session-log-column" data-log-panel="source"><header class="panel-column-header"><span class="panel-header-title">📝 ${esc(sourceName)}</span>${copyButton('source', 'Copy toàn bộ bản gốc', 'btn-copy-source')}</header><div class="session-log-scroll">${segments.map((segment, index) => dualRow(index, segment.src)).join('')}</div></section>
            <div class="session-log-timeline-wrap">
              <div class="session-log-timeline" data-log-panel="timeline"><header class="panel-column-header panel-time-header"><span class="panel-header-title">Timeline</span></header>${segments.map((segment, index) => timelineRow(index, segment)).join('')}</div>
            </div>
            <section class="session-log-column" data-log-panel="translation"><header class="panel-column-header"><span class="panel-header-title">🌐 ${esc(targetName)}</span>${copyButton('translation', 'Copy toàn bộ bản dịch', 'btn-copy-translation')}</header><div class="session-log-scroll">${segments.map((segment, index) => dualRow(index, segment.tgt || '—')).join('')}</div></section>
            ${jumpBottomButton}
        </div>`;

        const sourceScroll = container.querySelector('[data-log-panel="source"] .session-log-scroll');
        const targetScroll = container.querySelector('[data-log-panel="translation"] .session-log-scroll');
        const timeline = container.querySelector('[data-log-panel="timeline"]');
        const scrollBottom = container.querySelector('.session-log-scroll-bottom');
        const scrollToSegment = (index) => {
            const selector = `[data-segment-index="${index}"]`;
            const sourceLine = sourceScroll?.querySelector(selector);
            const targetLine = targetScroll?.querySelector(selector);
            const timeLine = timeline?.querySelector(selector);
            [sourceLine, targetLine, timeLine].forEach(line => line?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            container.querySelectorAll('.session-log-line-active, .session-log-timeline-active').forEach(line => {
                line.classList.remove('session-log-line-active', 'session-log-timeline-active');
            });
            sourceLine?.classList.add('session-log-line-active');
            targetLine?.classList.add('session-log-line-active');
            timeLine?.classList.add('session-log-timeline-active');
            setTimeout(() => {
                sourceLine?.classList.remove('session-log-line-active');
                targetLine?.classList.remove('session-log-line-active');
                timeLine?.classList.remove('session-log-timeline-active');
            }, 2500);
        };
        timeline?.addEventListener('click', (event) => {
            const item = event.target.closest('[data-segment-index]');
            if (item) scrollToSegment(item.dataset.segmentIndex);
        });
        const updateScrollButton = () => {
            if (!scrollBottom) return;
            const ref = timeline || sourceScroll;
            if (!ref) return;
            const isAwayFromBottom = ref.scrollHeight - ref.scrollTop - ref.clientHeight > 120;
            scrollBottom.classList.toggle('is-visible', isAwayFromBottom);
        };
        [sourceScroll, timeline, targetScroll].forEach(panel => {
            panel?.addEventListener('scroll', updateScrollButton, { passive: true });
        });
        scrollBottom?.addEventListener('click', () => {
            [sourceScroll, timeline, targetScroll].forEach(panel => panel?.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' }));
        });
        this._bindSessionLogCopy(container, segments, true);
        updateScrollButton();
    }

    _bindSessionLogCopy(container, segments, hasTranslation) {
        container.querySelectorAll('[data-copy-session-log]').forEach(button => button.addEventListener('click', async () => {
            const isTranslation = button.dataset.copySessionLog === 'translation';
            const text = segments.map(segment => (isTranslation ? segment.tgt : segment.src) || '').filter(Boolean).join('\n');
            if (!text) {
                this._showToast(isTranslation ? 'Chưa có bản dịch để copy' : 'Chưa có bản gốc để copy', 'info');
                return;
            }
            try {
                await navigator.clipboard.writeText(text);
                this._showToast(isTranslation ? 'Đã copy bản dịch ✓' : 'Đã copy bản gốc ✓', 'success');
                const orig = button.innerHTML;
                button.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#85e0a3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                setTimeout(() => { if (button) button.innerHTML = orig; }, 1500);
            } catch (err) {
                this._showToast(`Không thể copy: ${err}`, 'error');
            }
        }));
    }

    async _retranscribeCurrentSession() {
        const cur = this._currentViewedSession;
        if (cur) await this._retranscribeSession(cur.id, cur.isLegacy);
    }

    // Sửa cặp ngôn ngữ nguồn → đích của Logs đang xem.
    // Chỉ đổi metadata (giữ nguyên segments), sau đó tự tạo lại Minutes
    // cho các ngôn ngữ trong bộ Nhật/Việt/Anh. Ngôn ngữ ngoài bộ 3 cứ để đó.
    // Dùng modal riêng vì window.prompt() không hoạt động trong Tauri webview.
    _promptSessionLangs(curSrc, curTgt) {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal-edit-session-langs');
            const selectSrc = document.getElementById('select-edit-session-source-lang');
            const selectTgt = document.getElementById('select-edit-session-target-lang');
            const currentEl = document.getElementById('edit-session-langs-current');
            const saveBtn = document.getElementById('btn-save-edit-session-langs');
            const cancelBtn = document.getElementById('btn-cancel-edit-session-langs');
            const closeBtn = document.getElementById('btn-close-edit-session-langs');
            if (!modal || !selectSrc || !selectTgt) {
                resolve(null);
                return;
            }

            const validSrc = ['ja', 'vi', 'en'];
            const validTgt = ['ja', 'vi', 'en', 'none'];
            selectSrc.value = validSrc.includes(curSrc) ? curSrc : 'ja';
            selectTgt.value = validTgt.includes(curTgt) ? curTgt : 'vi';
            if (currentEl) currentEl.textContent = `Hiện tại: ${curSrc} → ${curTgt}`;

            const cleanup = () => {
                modal.style.display = 'none';
                saveBtn?.removeEventListener('click', onSave);
                cancelBtn?.removeEventListener('click', onCancel);
                closeBtn?.removeEventListener('click', onCancel);
                modal.removeEventListener('click', onBackdrop);
                window.removeEventListener('keydown', onKeyDown);
            };
            const onSave = () => {
                const src = selectSrc.value;
                const tgt = selectTgt.value;
                cleanup();
                resolve({ src, tgt });
            };
            const onCancel = () => {
                cleanup();
                resolve(null);
            };
            const onBackdrop = (e) => {
                if (e.target === modal) onCancel();
            };
            const onKeyDown = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    onSave();
                }
            };

            saveBtn?.addEventListener('click', onSave);
            cancelBtn?.addEventListener('click', onCancel);
            closeBtn?.addEventListener('click', onCancel);
            modal.addEventListener('click', onBackdrop);
            window.addEventListener('keydown', onKeyDown);
            modal.style.display = 'flex';
        });
    }

    async _handleEditSessionLangs() {
        const cur = this._currentViewedSession;
        if (!cur || cur.isLegacy) {
            this._showToast('Log định dạng cũ không sửa được ngôn ngữ', 'info');
            return;
        }
        const json = this._currentSessionJson;
        if (!json) return;
        const curSrc = (json.source_lang || 'ja').toLowerCase();
        const curTgt = (json.target_lang || 'vi').toLowerCase();

        const picked = await this._promptSessionLangs(curSrc, curTgt);
        if (!picked) return;
        const { src, tgt } = picked;
        if (src === curSrc && tgt === curTgt) {
            this._showToast('Cặp ngôn ngữ không thay đổi', 'info');
            return;
        }

        const btn = document.getElementById('btn-session-edit-langs');
        const origBtn = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="retranscript-spinner-inline"></span> Đang xử lý...';
        }
        try {
            // Chạy Re-transcript từ file ghi âm theo cặp ngôn ngữ mới.
            // Backend transcript/dịch theo cặp mới và lưu ngôn ngữ + segments + Minutes
            // trong một lần — hủy/lỗi giữa chừng thì dữ liệu cũ còn nguyên.
            await this._retranscribeSession(cur.id, cur.isLegacy, {
                sourceLang: src,
                targetLang: tgt,
                customTitle: 'Đổi ngôn ngữ & Re-transcript',
            });
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origBtn;
            }
        }
    }

    _getSessionLogsPlainText(json) {
        const lines = [];
        for (const chunk of (json?.chunks || [])) {
            for (const segment of (chunk.segments || [])) {
                const time = segment.ts ? `[${segment.ts}] ` : '';
                if ((segment.src || '').trim()) lines.push(`${time}${segment.src.trim()}`);
                if (this._sessionHasTranslation(json) && (segment.tgt || '').trim()) lines.push(`${time}${segment.tgt.trim()}`);
            }
        }
        return lines.join('\n');
    }

    _setRetranscriptProgress(stage, text, percent, customTitle = null) {
        const modal = document.getElementById('retranscript-progress-modal');
        const modalCard = modal?.querySelector('.retranscript-progress-card');
        const floatingBar = document.getElementById('retranscript-floating-bar');
        const progressText = document.getElementById('retranscript-progress-text');
        const status = document.getElementById('retranscript-progress-status');
        const fill = document.getElementById('retranscript-progress-fill');
        const pct = document.getElementById('retranscript-progress-pct');
        const errorCopy = document.getElementById('btn-copy-retranscript-error');
        const modalSpinner = modal?.querySelector('.retranscript-spinner');
        const modalCancel = document.getElementById('btn-retranscript-cancel');
        const modalAbort = document.getElementById('btn-retranscript-abort');
        const modalRunBg = document.getElementById('btn-retranscript-run-bg');

        const floatingSpinner = document.getElementById('retranscript-floating-spinner');
        const floatingCheck = document.getElementById('retranscript-floating-check');
        const floatingTitle = document.getElementById('retranscript-floating-title');
        const floatingStatus = document.getElementById('retranscript-floating-status');
        const floatingFill = document.getElementById('retranscript-floating-progress-fill');
        const floatingPct = document.getElementById('retranscript-floating-pct');
        const floatingExpand = document.getElementById('btn-retranscript-expand');
        const floatingCancel = document.getElementById('btn-retranscript-floating-cancel');

        modalCard?.classList.remove('is-error');
        modalSpinner?.style.removeProperty('display');
        status?.classList.remove('is-error');
        if (errorCopy) errorCopy.style.display = 'none';
        if (modalCancel) {
            modalCancel.title = 'Hủy bỏ';
            modalCancel.textContent = '✕';
        }
        if (modalAbort) {
            modalAbort.style.display = '';
            modalAbort.title = 'Hủy bỏ tiến trình Re-transcript này';
            modalAbort.textContent = '✕ Hủy bỏ';
        }
        if (modalRunBg) modalRunBg.style.display = '';

        if (this._activeRetranscribe) {
            this._activeRetranscribe.stage = stage;
            this._activeRetranscribe.text = text;
            this._activeRetranscribe.percent = percent;
            if (customTitle) this._activeRetranscribe.customTitle = customTitle;
        }

        // Đồng bộ trực tiếp vào Log Details nếu người dùng đang mở xem phiên này
        if (this._currentViewedSession?.id === this._activeRetranscribe?.id) {
            const retranscriptBtn = document.getElementById('btn-session-retranscript');
            const sessionStatus = document.getElementById('session-retranscript-status');
            if (retranscriptBtn) {
                retranscriptBtn.disabled = true;
                retranscriptBtn.innerHTML = '<span class="retranscript-spinner-inline"></span> Đang transcript...';
            }
            if (sessionStatus) {
                sessionStatus.textContent = `⏳ Đang Re-transcript: ${text} (${percent}%)`;
                sessionStatus.style.display = '';
                sessionStatus.classList.add('is-running');
            }
        }

        if (this._activeRetranscribe?.isMinimized) {
            if (floatingBar) floatingBar.style.display = 'flex';
            if (modal) modal.style.display = 'none';
        } else {
            if (modal) modal.style.display = 'flex';
            if (floatingBar) floatingBar.style.display = 'none';
        }
        this._updateFloatingBarsPosition();

        const currentTitle = customTitle || this._activeRetranscribe?.customTitle || (this._activeRetranscribe?.isImport ? 'Import file ghi âm' : 'Re-transcript cuộc họp');
        if (floatingBar) floatingBar.classList.remove('is-completed');
        if (floatingSpinner) floatingSpinner.style.display = '';
        if (floatingCheck) floatingCheck.style.display = 'none';
        if (floatingTitle) floatingTitle.textContent = currentTitle;
        const modalTitle = document.getElementById('retranscript-progress-title');
        if (modalTitle) modalTitle.textContent = this._activeRetranscribe?.isImport ? 'Đang import file ghi âm' : 'Đang re-transcript';
        if (floatingExpand) floatingExpand.style.display = '';
        if (floatingCancel) {
            floatingCancel.title = 'Hủy bỏ';
            floatingCancel.textContent = '✕';
        }

        if (progressText) progressText.textContent = text;
        if (status) status.textContent = text;
        if (fill) fill.style.width = `${percent}%`;
        if (pct) pct.textContent = `${percent}%`;

        if (floatingStatus) floatingStatus.textContent = text;
        if (floatingFill) floatingFill.style.width = `${percent}%`;
        if (floatingPct) floatingPct.textContent = `${percent}%`;

        const order = ['upload', 'transcribe', 'save', 'minutes'];
        document.querySelectorAll('[data-retranscript-step]').forEach(step => {
            const index = order.indexOf(step.dataset.retranscriptStep);
            const activeIndex = order.indexOf(stage);
            step.classList.toggle('active', index === activeIndex);
            step.classList.toggle('done', index < activeIndex);
            step.classList.remove('error');
            const icon = step.querySelector('.step-icon');
            if (icon) icon.textContent = index < activeIndex ? '✓' : (index === activeIndex ? '⏳' : '○');
        });
    }

    _showRetranscriptFailed(error, isImport = false, failedStage = 'transcribe') {
        const modal = document.getElementById('retranscript-progress-modal');
        const modalCard = modal?.querySelector('.retranscript-progress-card');
        const modalSpinner = modal?.querySelector('.retranscript-spinner');
        const modalTitle = document.getElementById('retranscript-progress-title');
        const progressText = document.getElementById('retranscript-progress-text');
        const status = document.getElementById('retranscript-progress-status');
        const fill = document.getElementById('retranscript-progress-fill');
        const pct = document.getElementById('retranscript-progress-pct');
        const errorCopy = document.getElementById('btn-copy-retranscript-error');
        const modalCancel = document.getElementById('btn-retranscript-cancel');
        const modalAbort = document.getElementById('btn-retranscript-abort');
        const modalRunBg = document.getElementById('btn-retranscript-run-bg');
        const floatingBar = document.getElementById('retranscript-floating-bar');

        if (!modal) return;

        if (floatingBar) {
            floatingBar.style.display = 'none';
            floatingBar.classList.remove('is-completed');
        }
        this._updateFloatingBarsPosition();
        modal.style.display = 'flex';
        modalCard?.classList.add('is-error');
        modalSpinner?.style.setProperty('display', 'none');
        if (modalTitle) modalTitle.textContent = isImport ? 'Import file ghi âm thất bại' : 'Re-transcript thất bại';
        if (progressText) progressText.textContent = 'Không thể hoàn tất tác vụ. Vui lòng kiểm tra lỗi bên dưới.';
        if (fill) fill.style.width = '100%';
        if (pct) pct.textContent = 'Lỗi';
        if (status) {
            status.classList.add('is-error');
            status.textContent = this._redactSensitiveError(error || 'Không xác định được nguyên nhân lỗi.');
        }
        if (errorCopy) {
            errorCopy.style.display = 'inline-flex';
            errorCopy.title = 'Copy lỗi';
            errorCopy.setAttribute('aria-label', 'Copy thông báo lỗi');
        }
        if (modalRunBg) modalRunBg.style.display = 'none';
        if (modalCancel) {
            modalCancel.title = 'Đóng thông báo lỗi';
            modalCancel.textContent = '✕';
        }
        if (modalAbort) {
            modalAbort.style.display = '';
            modalAbort.title = 'Đóng thông báo lỗi';
            modalAbort.textContent = 'Đóng';
            setTimeout(() => modalAbort.focus(), 0);
        }

        document.querySelectorAll('[data-retranscript-step]').forEach(step => {
            const isFailed = step.dataset.retranscriptStep === failedStage;
            step.classList.remove('active', 'done');
            step.classList.toggle('error', isFailed);
            const icon = step.querySelector('.step-icon');
            if (icon) icon.textContent = isFailed ? '⚠️' : '○';
        });
    }

    _redactSensitiveError(error) {
        return String(error || '').replace(/([?&]key=)[^&\s)]+/gi, '$1[REDACTED]');
    }

    async _copyRetranscriptError() {
        const status = document.getElementById('retranscript-progress-status');
        const button = document.getElementById('btn-copy-retranscript-error');
        const text = status?.textContent?.trim();
        if (!text || !button) return;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            }
            const original = button.innerHTML;
            button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            button.title = 'Đã copy lỗi';
            button.setAttribute('aria-label', 'Đã copy lỗi');
            setTimeout(() => {
                if (!button.isConnected) return;
                button.innerHTML = original;
                button.title = 'Copy lỗi';
                button.setAttribute('aria-label', 'Copy thông báo lỗi');
            }, 1500);
        } catch (copyError) {
            console.warn('[App] Could not copy retranscript error:', copyError);
        }
    }

    _closeRetranscriptNotice() {
        if (this._activeRetranscribe) {
            this._cancelActiveRetranscript();
            return;
        }
        this._hideRetranscriptProgress();
    }

    _showRetranscriptCompleted(id, titleText = null) {
        const modal = document.getElementById('retranscript-progress-modal');
        const floatingBar = document.getElementById('retranscript-floating-bar');
        const floatingSpinner = document.getElementById('retranscript-floating-spinner');
        const floatingCheck = document.getElementById('retranscript-floating-check');
        const floatingTitle = document.getElementById('retranscript-floating-title');
        const floatingStatus = document.getElementById('retranscript-floating-status');
        const floatingFill = document.getElementById('retranscript-floating-progress-fill');
        const floatingPct = document.getElementById('retranscript-floating-pct');
        const floatingExpand = document.getElementById('btn-retranscript-expand');
        const floatingCancel = document.getElementById('btn-retranscript-floating-cancel');

        if (modal) modal.style.display = 'none';
        if (!floatingBar) return;

        floatingBar.classList.add('is-completed');
        floatingBar.style.display = 'flex';
        this._updateFloatingBarsPosition();

        if (floatingSpinner) floatingSpinner.style.display = 'none';
        if (floatingCheck) floatingCheck.style.display = 'flex';
        if (floatingTitle) floatingTitle.textContent = titleText || 'Hoàn tất Re-transcript & Minutes ✓';
        if (floatingStatus) floatingStatus.textContent = 'Nhấn để xem chi tiết log ➔';
        if (floatingFill) floatingFill.style.width = '100%';
        if (floatingPct) floatingPct.textContent = '100%';
        if (floatingExpand) floatingExpand.style.display = 'none';
        if (floatingCancel) {
            floatingCancel.title = 'Đóng thông báo';
            floatingCancel.textContent = '✕';
        }
    }

    _hideRetranscriptProgress() {
        const modal = document.getElementById('retranscript-progress-modal');
        const modalCard = modal?.querySelector('.retranscript-progress-card');
        const status = document.getElementById('retranscript-progress-status');
        const errorCopy = document.getElementById('btn-copy-retranscript-error');
        const floatingBar = document.getElementById('retranscript-floating-bar');
        if (modal) modal.style.display = 'none';
        modalCard?.classList.remove('is-error');
        status?.classList.remove('is-error');
        if (errorCopy) errorCopy.style.display = 'none';
        document.querySelectorAll('[data-retranscript-step].error').forEach(step => step.classList.remove('error'));
        if (floatingBar) {
            floatingBar.style.display = 'none';
            floatingBar.classList.remove('is-completed');
        }
        this._updateFloatingBarsPosition();
    }

    _minimizeRetranscript() {
        if (!this._activeRetranscribe) return;
        this._activeRetranscribe.isMinimized = true;
        const modal = document.getElementById('retranscript-progress-modal');
        const floatingBar = document.getElementById('retranscript-floating-bar');
        if (modal) modal.style.display = 'none';
        if (floatingBar) floatingBar.style.display = 'flex';
        this._updateFloatingBarsPosition();
    }

    _expandRetranscript() {
        if (!this._activeRetranscribe) return;
        this._activeRetranscribe.isMinimized = false;
        const modal = document.getElementById('retranscript-progress-modal');
        const floatingBar = document.getElementById('retranscript-floating-bar');
        if (floatingBar) floatingBar.style.display = 'none';
        if (modal) modal.style.display = 'flex';
        this._updateFloatingBarsPosition();
    }

    _updateFloatingBarsPosition() {
        const retranscriptBar = document.getElementById('retranscript-floating-bar');
        const minutesBar = document.getElementById('minutes-floating-bar');
        const retranscriptVisible = retranscriptBar && retranscriptBar.style.display !== 'none';
        if (minutesBar) {
            minutesBar.style.bottom = retranscriptVisible ? '96px' : '20px';
        }
    }

    _setMinutesProgress(text, percent, lang = 'ja') {
        const floatingBar = document.getElementById('minutes-floating-bar');
        const floatingSpinner = document.getElementById('minutes-floating-spinner');
        const floatingCheck = document.getElementById('minutes-floating-check');
        const floatingTitle = document.getElementById('minutes-floating-title');
        const floatingStatus = document.getElementById('minutes-floating-status');
        const floatingFill = document.getElementById('minutes-floating-progress-fill');
        const floatingPct = document.getElementById('minutes-floating-pct');

        if (!floatingBar) return;

        floatingBar.classList.remove('is-completed');
        floatingBar.style.display = 'flex';
        this._updateFloatingBarsPosition();

        if (floatingSpinner) floatingSpinner.style.display = '';
        if (floatingCheck) floatingCheck.style.display = 'none';

        const langName = this._minutesLangName(lang);
        if (floatingTitle) floatingTitle.textContent = `Tạo Meeting Minutes (${langName})`;
        if (floatingStatus) floatingStatus.textContent = text;
        if (floatingFill) floatingFill.style.width = `${percent}%`;
        if (floatingPct) floatingPct.textContent = `${percent}%`;
    }

    _showMinutesCompleted(sessionId, lang = 'ja') {
        const floatingBar = document.getElementById('minutes-floating-bar');
        const floatingSpinner = document.getElementById('minutes-floating-spinner');
        const floatingCheck = document.getElementById('minutes-floating-check');
        const floatingTitle = document.getElementById('minutes-floating-title');
        const floatingStatus = document.getElementById('minutes-floating-status');
        const floatingFill = document.getElementById('minutes-floating-progress-fill');
        const floatingPct = document.getElementById('minutes-floating-pct');

        if (!floatingBar) return;

        this._lastCompletedMinutes = { id: sessionId, lang };
        if (this._activeMinutesGeneration) {
            if (this._activeMinutesGeneration.timer) {
                clearInterval(this._activeMinutesGeneration.timer);
            }
            this._activeMinutesGeneration = null;
        }

        floatingBar.classList.add('is-completed');
        floatingBar.style.display = 'flex';
        this._updateFloatingBarsPosition();

        if (floatingSpinner) floatingSpinner.style.display = 'none';
        if (floatingCheck) floatingCheck.style.display = 'flex';

        const langName = this._minutesLangName(lang);
        if (floatingTitle) floatingTitle.textContent = `Hoàn tất Meeting Minutes (${langName}) ✓`;
        if (floatingStatus) floatingStatus.textContent = 'Nhấp để xem chi tiết biên bản ➔';
        if (floatingFill) floatingFill.style.width = '100%';
        if (floatingPct) floatingPct.textContent = '100%';

        clearTimeout(this._minutesDismissTimeout);
        this._minutesDismissTimeout = setTimeout(() => {
            this._hideMinutesProgress();
        }, 7000);
    }

    _hideMinutesProgress() {
        const floatingBar = document.getElementById('minutes-floating-bar');
        if (floatingBar) {
            floatingBar.style.display = 'none';
            floatingBar.classList.remove('is-completed');
        }
        if (this._activeMinutesGeneration?.timer) {
            clearInterval(this._activeMinutesGeneration.timer);
            this._activeMinutesGeneration = null;
        }
        clearTimeout(this._minutesDismissTimeout);
        this._updateFloatingBarsPosition();
    }

    async _cancelActiveRetranscript(isTimeout = false) {
        if (!this._activeRetranscribe) return;
        const { id, isImport, stage } = this._activeRetranscribe;
        this._cleanupActiveRetranscribe();
        try {
            await invoke('cancel_retranscribe_session', { id });
        } catch (e) {
            console.warn('[App] cancel_retranscribe_session warning:', e);
        }
        if (isTimeout) {
            this._showRetranscriptFailed(
                'Quá thời gian xử lý. Tác vụ đã được tự động hủy để tránh nghẽn hệ thống.',
                isImport,
                stage || 'transcribe',
            );
        } else {
            this._showToast(isImport ? 'Đã hủy import file ghi âm' : 'Đã hủy re-transcript', 'info');
        }
    }

    _cleanupActiveRetranscribe() {
        if (this._activeRetranscribe?.progressInterval) {
            clearInterval(this._activeRetranscribe.progressInterval);
        }
        if (this._activeRetranscribe?.timeoutId) {
            clearTimeout(this._activeRetranscribe.timeoutId);
        }
        if (this._activeRetranscribe?.buttonsToDisable) {
            this._activeRetranscribe.buttonsToDisable.forEach((b, i) => {
                b.disabled = false;
                b.innerHTML = this._activeRetranscribe.originalTexts[i];
            });
        }
        const activeId = this._activeRetranscribe?.id;
        this._activeRetranscribe = null;
        this._hideRetranscriptProgress();

        if (this._currentViewedSession?.id === activeId) {
            const btn = document.getElementById('btn-session-retranscript');
            const status = document.getElementById('session-retranscript-status');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '🔄 Re-transcript';
            }
            if (status) {
                status.classList.remove('is-running');
            }
            if (this._currentSessionJson) {
                this._updateRetranscriptStatus(this._currentSessionJson);
            }
        }
    }

    _getMinutesLangsForSession(sessionData) {
        const src = (sessionData?.source_lang || 'vi').toLowerCase();
        const tgt = (sessionData?.target_lang || '').toLowerCase();
        const hasTranslation = !!tgt && tgt !== 'none' && tgt !== 'off' && tgt !== src;

        if (hasTranslation) {
            // Có bản dịch: tạo lại cho cả ngôn ngữ gốc và ngôn ngữ dịch
            const langs = [];
            const mapCode = (c) => (c === 'ja' ? 'ja' : (c === 'vi' ? 'vi' : (c === 'en' ? 'en' : null)));
            const sMapped = mapCode(src);
            const tMapped = mapCode(tgt);
            if (sMapped) langs.push(sMapped);
            if (tMapped && !langs.includes(tMapped)) langs.push(tMapped);
            if (langs.length === 0) langs.push('vi');
            return langs;
        } else {
            // Không có bản dịch: tạo cho ngôn ngữ gốc
            if (src === 'ja' || src === 'en') return [src];
            return ['vi'];
        }
    }

    async _retranscribeSession(id, isLegacy = false, options = {}) {
        if (isLegacy) {
            this._showToast('Log định dạng cũ không có file ghi âm để re-transcript', 'info');
            return;
        }
        if (id === sessionStore.id && (this.isRunning || this.isPaused)) {
            this._showToast('Hãy kết thúc cuộc họp đang ghi trước khi re-transcript', 'info');
            return;
        }
        if (this._activeRetranscribe) {
            this._showToast('Đang có tiến trình re-transcript khác đang chạy', 'info');
            return;
        }
        const settings = settingsManager.get();
        const apiKey = settings.gemini_api_key?.trim();
        if (!apiKey) {
            this._showToast('Cần Gemini API Key trong Cài đặt để re-transcript', 'error');
            return;
        }

        const buttonsToDisable = [
            document.querySelector(`[data-retranscript-session="${CSS.escape(id)}"]`),
            this._currentViewedSession?.id === id ? document.getElementById('btn-session-retranscript') : null,
        ].filter(Boolean);
        const originalTexts = buttonsToDisable.map(b => b.innerHTML);
        buttonsToDisable.forEach(b => {
            b.disabled = true;
            b.innerHTML = '<span class="retranscript-spinner-inline"></span> Đang transcript...';
        });

        const sess = (this._cachedSessions || []).find(s => s.id === id);
        const durationSec = sess?.duration_sec || (this._currentSessionJson?.id === id ? this._currentSessionJson.duration_sec : 0) || 0;
        // File dài cần thời gian upload và Gemini xử lý. Không tự hủy sớm
        // sau 10 phút; giới hạn 60 phút vẫn bảo vệ trường hợp job bị treo.
        const TIMEOUT_MS = Math.min(3_600_000, Math.max(1_800_000, durationSec * 350));
        const timeoutId = setTimeout(() => {
            this._cancelActiveRetranscript(true);
        }, TIMEOUT_MS);

        this._activeRetranscribe = {
            id,
            timeoutId,
            buttonsToDisable,
            originalTexts,
            isMinimized: true,
            progressInterval: null,
            backendProgress: false,
            progressBaseText: 'Đang tải file ghi âm lên Gemini...',
            stage: 'upload',
            text: 'Đang tải file ghi âm lên Gemini...',
            percent: 15,
            options,
            customTitle: options.customTitle || 'Re-transcript cuộc họp',
            startedAt: Date.now(),
        };

        this._setRetranscriptProgress('upload', 'Đang tải file ghi âm lên Gemini...', 15, options.customTitle);

        let currentPct = 15;
        const progressInterval = setInterval(() => {
            if (!this._activeRetranscribe || this._activeRetranscribe.id !== id) {
                clearInterval(progressInterval);
                return;
            }
            if (this._activeRetranscribe.backendProgress) {
                const active = this._activeRetranscribe;
                const elapsedSec = Math.floor((Date.now() - active.startedAt) / 1000);
                const elapsedText = elapsedSec >= 60 ? ` (đã xử lý ${Math.floor(elapsedSec / 60)} phút)` : '';
                const baseText = active.progressBaseText || active.text || 'Gemini đang xử lý file ghi âm...';
                this._setRetranscriptProgress(active.stage, `${baseText}${elapsedText}`, active.percent, active.customTitle);
                return;
            }
            if (currentPct < 88) {
                currentPct += (currentPct < 45 ? 3 : (currentPct < 70 ? 2 : 1));
            }
            let text = 'Đang tải file ghi âm lên Gemini...';
            let stage = 'upload';
            if (currentPct >= 25 && currentPct < 65) {
                stage = 'transcribe';
                text = 'Gemini đang transcript và dịch file ghi âm...';
            } else if (currentPct >= 65 && currentPct < 80) {
                stage = 'transcribe';
                text = 'Gemini đang phân tích và chuẩn hóa văn bản...';
            } else if (currentPct >= 80) {
                stage = 'transcribe';
                text = 'File ghi âm dài, Gemini đang hoàn thiện các đoạn thoại...';
            }
            const elapsedSec = Math.floor((Date.now() - this._activeRetranscribe.startedAt) / 1000);
            const elapsedText = elapsedSec >= 60 ? ` (đã xử lý ${Math.floor(elapsedSec / 60)} phút)` : '';
            this._setRetranscriptProgress(stage, `${text}${elapsedText}`, currentPct);
        }, 1500);
        this._activeRetranscribe.progressInterval = progressInterval;

        try {
            // options.sourceLang/targetLang: cặp ngôn ngữ mới (từ modal sửa ngôn ngữ).
            // Backend áp dụng trước khi build prompt và chỉ lưu khi thành công.
            const result = await invoke('retranscribe_session_with_gemini', {
                id,
                apiKey,
                sourceLang: options.sourceLang || null,
                targetLang: options.targetLang || null,
            });
            clearInterval(progressInterval);
            if (!this._activeRetranscribe || this._activeRetranscribe.id !== id) return;

            this._setRetranscriptProgress('save', 'Đang lưu Logs mới...', 89);
            if (this._currentViewedSession?.id === id) {
                this._renderSessionLogs(result.json);
                this._currentSessionJson = result.json;
                this._updateRetranscriptStatus(result.json);
            }

            const shouldGenerateMinutes = options.generateMinutes !== false;
            if (shouldGenerateMinutes) {
                // Tự động tạo lại Meeting Minutes ở các ngôn ngữ được chọn
                const minutesLangs = options.minutesLang
                    ? [options.minutesLang]
                    : this._getMinutesLangsForSession(result.json);
                const totalLangs = minutesLangs.length;
                for (let i = 0; i < totalLangs; i++) {
                    if (!this._activeRetranscribe || this._activeRetranscribe.id !== id) return;
                    const mLang = minutesLangs[i];
                    const langName = this._minutesLangName(mLang);
                    const stepPct = totalLangs === 1 ? 94 : (i === 0 ? 92 : 96);
                    const stepLabel = totalLangs > 1
                        ? `Đang tạo lại Meeting Minutes (${langName})... (${i + 1}/${totalLangs})`
                        : `Đang tạo lại Meeting Minutes (${langName})...`;

                    this._setRetranscriptProgress('minutes', stepLabel, stepPct);
                    try {
                        await this._generateMinutesCore(id, mLang);
                    } catch (minErr) {
                        console.warn(`[App] Lỗi tạo Meeting Minutes (${mLang}) khi re-transcript:`, minErr);
                    }
                }
                this._setRetranscriptProgress('minutes', 'Hoàn tất Re-transcript & Meeting Minutes ✓', 100);
            } else {
                this._setRetranscriptProgress('save', 'Hoàn tất Re-transcript ✓', 100);
            }

            if (this._activeRetranscribe?.buttonsToDisable) {
                this._activeRetranscribe.buttonsToDisable.forEach((b, i) => {
                    b.disabled = false;
                    b.innerHTML = this._activeRetranscribe.originalTexts[i];
                });
            }
            if (this._activeRetranscribe?.timeoutId) {
                clearTimeout(this._activeRetranscribe.timeoutId);
            }

            this._lastCompletedRetranscribeId = id;
            this._activeRetranscribe = null;

            if (this._currentViewedSession?.id === id) {
                const refreshed = await invoke('read_session', { id });
                this._currentSessionJson = refreshed.json;
                const mmJa = refreshed.json.meeting_minutes_ja || (refreshed.json.meeting_minutes_lang === 'ja' ? refreshed.json.meeting_minutes : '') || '';
                const mmVi = refreshed.json.meeting_minutes_vi || (refreshed.json.meeting_minutes_lang === 'vi' ? refreshed.json.meeting_minutes : '') || '';
                const mmEn = refreshed.json.meeting_minutes_en || (refreshed.json.meeting_minutes_lang === 'en' ? refreshed.json.meeting_minutes : '') || '';
                this._loadedMinutes = {
                    ja: mmJa.trim(),
                    vi: mmVi.trim(),
                    en: mmEn.trim(),
                };
                this._updateRetranscriptStatus(refreshed.json);
                this._updateMinutesBadges();
                this._renderCurrentMinutesSubtab();
            }

            const compTitle = shouldGenerateMinutes
                ? 'Hoàn tất Re-transcript & Minutes ✓'
                : 'Hoàn tất Re-transcript ✓';
            this._showRetranscriptCompleted(id, compTitle);

            const toastMsg = shouldGenerateMinutes
                ? 'Đã tạo lại Logs & Meeting Minutes từ file ghi âm ✓'
                : 'Đã tạo lại Logs từ file ghi âm ✓';
            this._showToast(toastMsg, 'success');
            await this._showSessions();
        } catch (err) {
            clearInterval(progressInterval);
            if (this._activeRetranscribe?.id === id) {
                const isCancelled = String(err).includes('hủy') || String(err).includes('cancel');
                const failedStage = this._activeRetranscribe.stage || 'transcribe';
                this._cleanupActiveRetranscribe();
                if (!isCancelled) {
                    console.error('[App] Re-transcript failed:', err);
                    this._showRetranscriptFailed(`Re-transcript thất bại: ${err}`, false, failedStage);
                }
            }
        }
    }

    // ─── Import Audio Recording ─────────────────────────────

    _formatFileSize(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }

    async _handleOpenImportAudio() {
        this._pendingImportFile = null;
        await this._showImportAudioModal(null);
    }

    _initImportAudioDropZone() {
        const dropzone = document.getElementById('import-audio-dropzone');
        if (!dropzone) return;

        const setDragState = (active) => dropzone.classList.toggle('is-dragover', active);
        const openPicker = () => this._browseAudioFileForImport();

        dropzone.addEventListener('click', openPicker);
        dropzone.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openPicker();
            }
        });

        // This fallback is useful in browser-only development and for hosts
        // that expose the dropped path on DataTransfer files.
        dropzone.addEventListener('dragover', (event) => {
            event.preventDefault();
            setDragState(true);
        });
        dropzone.addEventListener('dragleave', () => setDragState(false));
        dropzone.addEventListener('drop', async (event) => {
            event.preventDefault();
            setDragState(false);
            if (window.__TAURI_INTERNALS__) return;
            const file = event.dataTransfer?.files?.[0];
            if (file?.path) await this._inspectDroppedAudioPath(file.path);
            else this._showToast('Không lấy được đường dẫn file. Hãy bấm “Chọn file local”.', 'warning');
        });

        // Tauri's native drag-drop event provides the real local path even
        // when WebView's DataTransfer object intentionally hides it.
        if (typeof this.appWindow?.onDragDropEvent === 'function') {
            this._importAudioDropUnlisten = this.appWindow.onDragDropEvent(async ({ payload }) => {
                const modal = document.getElementById('modal-import-audio');
                if (!modal || modal.style.display === 'none') return;
                if (payload.type === 'enter' || payload.type === 'over') {
                    setDragState(true);
                } else if (payload.type === 'leave') {
                    setDragState(false);
                } else if (payload.type === 'drop') {
                    setDragState(false);
                    const path = payload.paths?.[0];
                    if (path) await this._inspectDroppedAudioPath(path);
                }
            }).catch((err) => console.warn('[App] Import drag-drop listener failed:', err));
        }
    }

    async _inspectDroppedAudioPath(path) {
        try {
            const fileInfo = await invoke('inspect_audio_file', { path });
            if (!fileInfo) return;
            await this._selectImportFileInfo(fileInfo);
            this._showToast(`Đã nhận file ghi âm: ${fileInfo.file_name}`, 'success');
        } catch (err) {
            console.error('[App] inspect dropped audio failed:', err);
            this._showToast(`Không thể nhận file ghi âm: ${err}`, 'error');
        }
    }

    async _browseAudioFileForImport() {
        try {
            const fileInfo = await invoke('select_audio_file');
            if (!fileInfo) return;
            await this._selectImportFileInfo(fileInfo);
        } catch (err) {
            console.error('[App] select_audio_file failed:', err);
            this._showToast(`Lỗi chọn file: ${err}`, 'error');
        }
    }

    async _selectImportFileInfo(fileInfo) {
        this._pendingImportFile = fileInfo;
        await this._showImportAudioModal(fileInfo);
    }

    async _showImportAudioModal(fileInfo) {
        const modal = document.getElementById('modal-import-audio');
        if (!modal) return;

        const fileNameEl = document.getElementById('import-file-name');
        const fileMetaEl = document.getElementById('import-file-meta');
        const inputTitle = document.getElementById('input-import-meeting-title');
        const selectCust = document.getElementById('select-import-meeting-customer');
        const selectProj = document.getElementById('select-import-meeting-project');
        const selectCat = document.getElementById('select-import-meeting-category');
        const inputTags = document.getElementById('input-import-meeting-tags');
        const chkAutoMinutes = document.getElementById('chk-import-auto-minutes');

        if (fileNameEl) fileNameEl.textContent = fileInfo?.file_name || 'Chưa chọn file';
        if (fileMetaEl) {
            if (fileInfo) {
                const sizeStr = this._formatFileSize(fileInfo.file_size);
                const extStr = (fileInfo.extension || '').toUpperCase();
                fileMetaEl.textContent = `${extStr} · ${sizeStr}`;
            } else {
                fileMetaEl.textContent = 'Kéo thả hoặc chọn file local';
            }
        }

        const stem = fileInfo?.file_name?.replace(/\.[^/.]+$/, '') || '';
        if (inputTitle) {
            inputTitle.value = stem;
        }
        if (inputTags) {
            inputTags.value = '';
        }

        const reg = await this._loadProjectRegistry();
        const activeCustomers = (reg.customers || []).filter(c => c.status === 'active');
        const activeProjects = (reg.projects || []).filter(p => p.status === 'active');

        if (selectCust) {
            let custHtml = '<option value="">(Không chọn KH)</option>';
            for (const c of activeCustomers) {
                custHtml += `<option value="${this._escAttr(c.id)}">🤝 ${this._esc(c.name)}</option>`;
            }
            selectCust.innerHTML = custHtml;
            selectCust.value = '';
        }

        const updateProjectsDropdown = (selectedCustomerId) => {
            if (!selectProj) return;
            const filteredProjs = selectedCustomerId
                ? activeProjects.filter(p => p.customer_id === selectedCustomerId)
                : activeProjects;
            let projHtml = '<option value="">(Không gán dự án)</option>';
            for (const p of filteredProjs) {
                projHtml += `<option value="${this._escAttr(p.id)}">🚀 ${this._esc(p.name)}</option>`;
            }
            selectProj.innerHTML = projHtml;
            selectProj.value = '';
        };

        updateProjectsDropdown('');

        selectCust.onchange = () => updateProjectsDropdown(selectCust.value);
        selectProj.onchange = () => {
            const pId = selectProj.value;
            if (pId) {
                const foundProj = activeProjects.find(p => p.id === pId);
                if (foundProj && foundProj.customer_id && selectCust) {
                    selectCust.value = foundProj.customer_id;
                    updateProjectsDropdown(foundProj.customer_id);
                    selectProj.value = pId;
                }
            }
        };

        if (selectCat) {
            let catHtml = '<option value="">(Không chọn category)</option>';
            for (const c of (reg.categories || [])) {
                catHtml += `<option value="${this._escAttr(c.name)}">🗂️ ${this._esc(c.name)}</option>`;
            }
            selectCat.innerHTML = catHtml;
            selectCat.value = '';
        }

        if (chkAutoMinutes) {
            chkAutoMinutes.checked = true;
        }

        modal.style.display = 'flex';
        if (fileInfo) {
            inputTitle?.focus();
            inputTitle?.select();
        } else {
            document.getElementById('import-audio-dropzone')?.focus();
        }
    }

    _closeImportAudioModal() {
        const modal = document.getElementById('modal-import-audio');
        if (modal) modal.style.display = 'none';
        document.getElementById('import-audio-dropzone')?.classList.remove('is-dragover');
        this._pendingImportFile = null;
    }

    async _confirmImportAudio() {
        if (!this._pendingImportFile) {
            this._showToast('Vui lòng chọn file ghi âm trước', 'error');
            return;
        }
        const fileInfo = this._pendingImportFile;
        const inputTitle = document.getElementById('input-import-meeting-title');
        const selectCust = document.getElementById('select-import-meeting-customer');
        const selectProj = document.getElementById('select-import-meeting-project');
        const selectCat = document.getElementById('select-import-meeting-category');
        const inputTags = document.getElementById('input-import-meeting-tags');
        const chkAutoMinutes = document.getElementById('chk-import-auto-minutes');

        const title = (inputTitle?.value || '').trim() || fileInfo.file_name.replace(/\.[^/.]+$/, '');
        const customerId = selectCust?.value || null;
        const projectId = selectProj?.value || null;
        const category = selectCat?.value || null;
        const rawTags = (inputTags?.value || '').trim();
        const tags = rawTags
            ? rawTags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean)
            : [];
        const autoMinutes = chkAutoMinutes ? chkAutoMinutes.checked : true;

        const settings = settingsManager.get();
        const apiKey = settings.gemini_api_key?.trim();
        if (!apiKey) {
            this._showToast('Cần Gemini API Key trong Cài đặt để import và nhận diện file ghi âm', 'error');
            return;
        }

        if (this._activeRetranscribe) {
            this._showToast('Đang có tiến trình xử lý audio khác đang chạy', 'info');
            return;
        }

        this._closeImportAudioModal();
        await this._startAudioImport({ fileInfo, title, customerId, projectId, category, tags, autoMinutes, apiKey });
    }

    async _startAudioImport({ fileInfo, title, customerId, projectId, category, tags, autoMinutes, apiKey }) {
        if (this._activeRetranscribe) {
            this._showToast('Đang có tiến trình xử lý audio khác đang chạy', 'info');
            return;
        }

        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        const id = `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;

        const fileSizeMb = Math.max(1, Number(fileInfo.file_size || 0) / (1024 * 1024));
        // Allow enough time for a large upload plus Gemini processing while
        // still cleaning up a genuinely stuck request after one hour.
        const TIMEOUT_MS = Math.min(3_600_000, Math.max(1_800_000, 600_000 + fileSizeMb * 5_000));
        const timeoutId = setTimeout(() => {
            this._cancelActiveRetranscript(true);
        }, TIMEOUT_MS);

        this._activeRetranscribe = {
            id,
            isImport: true,
            timeoutId,
            buttonsToDisable: [],
            originalTexts: [],
            isMinimized: true,
            progressInterval: null,
            backendProgress: false,
            progressBaseText: 'Đang đọc và tải file ghi âm lên Gemini...',
            stage: 'upload',
            text: 'Đang đọc và tải file ghi âm lên Gemini...',
            percent: 15,
            customTitle: `Import: ${title}`,
            startedAt: Date.now(),
        };

        this._setRetranscriptProgress('upload', 'Đang đọc và tải file ghi âm lên Gemini...', 15, `Import: ${title}`);

        let currentPct = 15;
        const progressInterval = setInterval(() => {
            if (!this._activeRetranscribe || this._activeRetranscribe.id !== id) {
                clearInterval(progressInterval);
                return;
            }
            if (this._activeRetranscribe.backendProgress) {
                const active = this._activeRetranscribe;
                const elapsedSec = Math.floor((Date.now() - active.startedAt) / 1000);
                const elapsedText = elapsedSec >= 60 ? ` (đã xử lý ${Math.floor(elapsedSec / 60)} phút)` : '';
                const baseText = active.progressBaseText || active.text || 'Gemini đang xử lý file ghi âm...';
                this._setRetranscriptProgress(active.stage, `${baseText}${elapsedText}`, active.percent, active.customTitle);
                return;
            }
            if (currentPct < 88) {
                currentPct += (currentPct < 45 ? 3 : (currentPct < 70 ? 2 : 1));
            }
            let text = 'Đang tải file ghi âm lên Gemini...';
            let stage = 'upload';
            if (currentPct >= 25 && currentPct < 55) {
                stage = 'transcribe';
                text = 'Gemini đang nhận diện ngôn ngữ và transcript...';
            } else if (currentPct >= 55 && currentPct < 75) {
                stage = 'transcribe';
                text = 'Gemini đang phân tích và dịch sang Tiếng Việt...';
            } else if (currentPct >= 75) {
                stage = 'transcribe';
                text = 'Gemini đang hoàn thiện các đoạn thoại...';
            }
            const elapsedSec = Math.floor((Date.now() - this._activeRetranscribe.startedAt) / 1000);
            const elapsedText = elapsedSec >= 60 ? ` (đã xử lý ${Math.floor(elapsedSec / 60)} phút)` : '';
            this._setRetranscriptProgress(stage, `${text}${elapsedText}`, currentPct, `Import: ${title}`);
        }, 1500);
        this._activeRetranscribe.progressInterval = progressInterval;

        try {
            const result = await invoke('import_audio_session', {
                id,
                filePath: fileInfo.file_path,
                title,
                customerId,
                projectId,
                category,
                tags,
                apiKey,
            });

            clearInterval(progressInterval);
            if (!this._activeRetranscribe || this._activeRetranscribe.id !== id) return;

            this._setRetranscriptProgress('save', 'Đang lưu Log cuộc họp mới...', 90, `Import: ${title}`);

            if (autoMinutes) {
                const minutesLangs = this._getMinutesLangsForSession(result.json);
                const totalLangs = minutesLangs.length;
                for (let i = 0; i < totalLangs; i++) {
                    if (!this._activeRetranscribe || this._activeRetranscribe.id !== id) return;
                    const mLang = minutesLangs[i];
                    const langName = this._minutesLangName(mLang);
                    const stepPct = totalLangs === 1 ? 95 : (i === 0 ? 93 : 97);
                    const stepLabel = totalLangs > 1
                        ? `Đang tạo Meeting Minutes (${langName})... (${i + 1}/${totalLangs})`
                        : `Đang tạo Meeting Minutes (${langName})...`;
                    this._setRetranscriptProgress('minutes', stepLabel, stepPct, `Import: ${title}`);
                    try {
                        await this._generateMinutesCore(id, mLang);
                    } catch (minErr) {
                        console.warn(`[App] Lỗi tạo Meeting Minutes (${mLang}) khi import:`, minErr);
                    }
                }
            }

            this._setRetranscriptProgress('minutes', 'Hoàn tất import file ghi âm ✓', 100, `Import: ${title}`);

            if (this._activeRetranscribe?.timeoutId) {
                clearTimeout(this._activeRetranscribe.timeoutId);
            }
            this._lastCompletedRetranscribeId = id;
            this._activeRetranscribe = null;

            this._showRetranscriptCompleted(id, `Hoàn tất import "${title}" ✓`);
            this._showToast('Đã import thành công file ghi âm vào Logs ✓', 'success');
            await this._showSessions();
        } catch (err) {
            clearInterval(progressInterval);
            if (this._activeRetranscribe?.id === id) {
                const isCancelled = String(err).includes('hủy') || String(err).includes('cancel');
                const failedStage = this._activeRetranscribe.stage || 'transcribe';
                this._cleanupActiveRetranscribe();
                if (!isCancelled) {
                    console.error('[App] Import audio failed:', err);
                    this._showRetranscriptFailed(`Import file ghi âm thất bại: ${err}`, true, failedStage);
                }
            }
        }
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

    _resolveTemplateForSession(sessionData) {
        if (sessionData.category && this._projectRegistry?.categories) {
            const cat = this._projectRegistry.categories.find(c => c.name === sessionData.category || c.id === sessionData.category);
            if (cat && cat.template_id) {
                return cat.template_id;
            }
        }
        const scope = sessionData.scope || 'work';
        if (scope === 'personal') {
            return 'personal';
        }
        return 'standard';
    }

    _getPresetMinutesTemplate(templateId, lang = 'vi') {
        const s = settingsManager.get();
        if (templateId === 'tech') {
            if (lang === 'ja') return (s.template_minutes_tech_ja && s.template_minutes_tech_ja.trim()) ? s.template_minutes_tech_ja : PRESET_TEMPLATE_TECH_JA;
            return (s.template_minutes_tech_vi && s.template_minutes_tech_vi.trim()) ? s.template_minutes_tech_vi : PRESET_TEMPLATE_TECH_VI;
        }
        if (templateId === 'one_on_one') {
            if (lang === 'ja') return (s.template_minutes_1on1_ja && s.template_minutes_1on1_ja.trim()) ? s.template_minutes_1on1_ja : PRESET_TEMPLATE_1ON1_JA;
            return (s.template_minutes_1on1_vi && s.template_minutes_1on1_vi.trim()) ? s.template_minutes_1on1_vi : PRESET_TEMPLATE_1ON1_VI;
        }
        if (templateId === 'personal') {
            if (lang === 'ja') return (s.template_minutes_personal_ja && s.template_minutes_personal_ja.trim()) ? s.template_minutes_personal_ja : PRESET_TEMPLATE_PERSONAL_JA;
            return (s.template_minutes_personal_vi && s.template_minutes_personal_vi.trim()) ? s.template_minutes_personal_vi : PRESET_TEMPLATE_PERSONAL_VI;
        }
        // default / 'standard'
        if (lang === 'ja') return (s.template_minutes_ja && s.template_minutes_ja.trim()) ? s.template_minutes_ja : DEFAULT_TEMPLATE_MINUTES_JA;
        return (s.template_minutes_vi && s.template_minutes_vi.trim()) ? s.template_minutes_vi : DEFAULT_TEMPLATE_MINUTES_VI;
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

        const templateId = this._resolveTemplateForSession(sessionData);
        let template = this._getPresetMinutesTemplate(templateId, targetLang);

        if (targetLang === 'ja') {
            template = template
                .replace(/\{\{title\}\}/g, title)
                .replace(/\{\{date\}\}/g, createdAt)
                .replace(/\{\{duration\}\}/g, String(durationMin))
                .replace(/\{\{participants\}\}/g, '(発言ログやメモから判明する参加者・発言者、または想定される担当者)');

            let personaJa = 'あなたはプロフェッショナルな議事録作成アシスタントです。\n以下の会議情報、ユーザーの手書きメモ、および会議のリアルタイム発言ログをもとに、クライアントや関係者にそのまま共有・送信できる高品質で正式な「会議議事録（Meeting Minutes）」を日本語のMarkdown形式で作成してください。';
            if (templateId === 'tech') {
                personaJa = 'あなたはシニアITアーキテクト／テクニカルリードのアシスタントです。\n以下の会議情報、エンジニアの手書きメモ、および技術討議の発言ログをもとに、開発チームや関係者にそのまま共有・実装できる高精度な「技術議事録・アーキテクチャ設計メモ（Technical Sync Minutes）」を日本語のMarkdown形式で作成してください。';
            } else if (templateId === 'one_on_one') {
                personaJa = 'あなたはプロフェッショナルなメンター／人事コーチ・マネージャーです。\n以下の面談情報、手書きメモ、および面談の発言ログをもとに、信頼関係を築きメンバーの成長とアクションを促す客観的で温かみのある「1on1面談記録（1-on-1 Notes）」を日本語のMarkdown形式で作成してください。';
            } else if (templateId === 'personal') {
                personaJa = 'あなたは思慮深い自己啓発パートナー兼学習ノート整理アシスタントです。\n以下のセッション情報、個人のメモ、および対話・音声ログをもとに、今後の自己研鑽や行動に活かせる整理された「個人メモ・学習まとめ（Personal Notes）」を日本語のMarkdown形式で作成してください。';
            }

            return `${personaJa}

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

${template}

※客観的かつ簡潔・明瞭なビジネス日本語（「です・ます」調）で作成してください。`;
        }

        if (targetLang === 'en') {
            // English: reuse the Vietnamese template structure, instruct the model
            // to write professional English minutes with translated headings.
            template = template
                .replace(/\{\{title\}\}/g, title)
                .replace(/\{\{date\}\}/g, createdAt)
                .replace(/\{\{duration\}\}/g, String(durationMin))
                .replace(/\{\{participants\}\}/g, '(Participants/speakers identified from the logs or notes)');

            let personaEn = 'You are a professional meeting-minutes assistant.\nBelow is the meeting info, the participant\'s handwritten notes, and the full dialogue/translation log recorded during the meeting:';
            let actionEn = 'Analyze everything thoroughly and draft FORMAL, CONCISE MEETING MINUTES in professional English Markdown, following the STRUCTURE of the TEMPLATE BELOW (translate its headings into natural English):';

            if (templateId === 'tech') {
                personaEn = 'You are a senior IT architect / tech-lead assistant.\nBelow is the technical meeting info, the engineer\'s handwritten notes, and the full architecture/technology discussion log:';
                actionEn = 'Analyze the solutions in depth and draft a formal TECHNICAL SYNC / ARCHITECTURE MINUTES document in professional English Markdown, following the STRUCTURE of the TEMPLATE BELOW (translate its headings into natural English):';
            } else if (templateId === 'one_on_one') {
                personaEn = 'You are an empathetic people manager, mentor and internal coach.\nBelow is the 1-on-1 session info, handwritten notes, and the full dialogue of the meeting:';
                actionEn = 'Summarize objectively and constructively, and draft 1-ON-1 MEETING NOTES in professional English Markdown, following the STRUCTURE of the TEMPLATE BELOW (translate its headings into natural English):';
            } else if (templateId === 'personal') {
                personaEn = 'You are a thoughtful self-development companion and personal knowledge assistant.\nBelow is the personal session info, notes, and the full dialogue content:';
                actionEn = 'Distill the core lessons and draft a concise, practical PERSONAL NOTES & SUMMARY in professional English Markdown, following the STRUCTURE of the TEMPLATE BELOW (translate its headings into natural English):';
            }

            return `${personaEn}

【MEETING INFO】
- Title: ${title}
- Started at: ${createdAt}
- Duration: about ${durationMin} minutes

【HANDWRITTEN NOTES】
${notes}

【DIALOGUE & TRANSLATION LOG】
${transcriptText}

---

${actionEn}

${template}

Note: use a formal, clear, professional business tone.`;
        }

        // Default: Vietnamese
        template = template
            .replace(/\{\{title\}\}/g, title)
            .replace(/\{\{date\}\}/g, createdAt)
            .replace(/\{\{duration\}\}/g, String(durationMin))
            .replace(/\{\{participants\}\}/g, '(Tổng hợp tên người nói hoặc các bên tham gia dựa theo hội thoại/ghi chú)');

        let personaVi = 'Bạn là một trợ lý thư ký cuộc họp chuyên nghiệp và sắc bén.\nDưới đây là thông tin cuộc họp, ghi chú viết tay của người tham gia và toàn bộ dữ liệu đối thoại/bản dịch ghi nhận được trong cuộc họp:';
        let actionVi = 'Hãy phân tích toàn diện và soạn thảo một BẢN BIÊN BẢN CUỘC HỌP (MEETING MINUTES) chuẩn chỉnh, trang trọng và súc tích bằng Tiếng Việt theo ĐÚNG CẤU TRÚC MẪU (TEMPLATE) DƯỚI ĐÂY:';

        if (templateId === 'tech') {
            personaVi = 'Bạn là một trợ lý kỹ thuật / Tech Lead chuyên nghiệp và giàu kinh nghiệm.\nDưới đây là thông tin cuộc họp kỹ thuật, ghi chú viết tay của kỹ sư và toàn bộ đối thoại/bản dịch thảo luận kiến trúc/công nghệ trong cuộc họp:';
            actionVi = 'Hãy phân tích sâu sắc các giải pháp và soạn thảo một BIÊN BẢN HỌP KỸ THUẬT & KIẾN TRÚC (TECHNICAL SYNC) chuẩn chỉnh bằng Tiếng Việt theo ĐÚNG CẤU TRÚC MẪU (TEMPLATE) DƯỚI ĐÂY:';
        } else if (templateId === 'one_on_one') {
            personaVi = 'Bạn là một chuyên gia quản lý nhân sự, mentor và huấn luyện nội bộ giàu thấu cảm.\nDưới đây là thông tin buổi trao đổi 1-on-1, ghi chú viết tay và toàn bộ đối thoại trong buổi gặp:';
            actionVi = 'Hãy tổng hợp khách quan, mang tính xây dựng và soạn thảo một BIÊN BẢN TRAO ĐỔI 1-ON-1 & ĐÁNH GIÁ bằng Tiếng Việt theo ĐÚNG CẤU TRÚC MẪU (TEMPLATE) DƯỚI ĐÂY:';
        } else if (templateId === 'personal') {
            personaVi = 'Bạn là một người bạn đồng hành hỗ trợ phát triển bản thân và hệ thống hóa tri thức cá nhân.\nDưới đây là thông tin cuộc trao đổi/buổi học cá nhân, ghi chú và toàn bộ nội dung đối thoại:';
            actionVi = 'Hãy đúc kết các bài học cốt lõi và soạn thảo một BẢN GHI CHÉP & TÓM TẮT CÁ NHÂN súc tích, thực tế bằng Tiếng Việt theo ĐÚNG CẤU TRÚC MẪU (TEMPLATE) DƯỚI ĐÂY:';
        }

        return `${personaVi}

【THÔNG TIN CUỘC HỌP】
- Tiêu đề: ${title}
- Thời gian bắt đầu: ${createdAt}
- Thời lượng: khoảng ${durationMin} phút

【GHI CHÚ VIẾT TAY (NOTES)】
${notes}

【LỊCH SỬ THOẠI & BẢN DỊCH】
${transcriptText}

---

${actionVi}

${template}

Lưu ý: Văn phong trang trọng, chuẩn mực công việc, rõ ràng, gãy gọn.`;
    }

    async _generateMinutesCore(sessionId, lang = 'ja', onStatusUpdate = null) {
        const settings = settingsManager.get();
        const geminiKey = settings.gemini_api_key?.trim();
        const openaiKey = settings.openai_api_key?.trim();

        if (!geminiKey && !openaiKey) {
            throw new Error('Vui lòng cài đặt Gemini hoặc OpenAI API Key trong Cài đặt (⌘,) để tạo Meeting Minutes');
        }

        const res = await invoke('read_session', { id: sessionId });
        if (!res?.json) {
            throw new Error(`Không tìm thấy dữ liệu phiên ${sessionId}`);
        }

        const prompt = this._buildMeetingMinutesPrompt(res.json, lang);
        let resultText = '';

        if (geminiKey) {
            try {
                resultText = await this._callGeminiAi(geminiKey, prompt, onStatusUpdate);
            } catch (geminiErr) {
                if (openaiKey) {
                    console.warn('[App] Gemini không khả dụng, tự động chuyển sang OpenAI...', geminiErr);
                    if (onStatusUpdate) onStatusUpdate('Gemini quá tải, đang chuyển sang OpenAI gpt-4o-mini...');
                    resultText = await this._callOpenAi(openaiKey, prompt);
                } else {
                    throw geminiErr;
                }
            }
        } else {
            resultText = await this._callOpenAi(openaiKey, prompt);
        }

        if (resultText && resultText.trim()) {
            await invoke('update_session_meeting_minutes', {
                id: sessionId,
                minutes: resultText,
                lang,
            });

            if (this._currentViewedSession?.id === sessionId) {
                if (!this._loadedMinutes) this._loadedMinutes = {};
                this._loadedMinutes[lang] = resultText;
                this._updateMinutesBadges();
                if (this._activeMinutesLang === lang) {
                    this._renderCurrentMinutesSubtab();
                }
            }
        }

        return resultText;
    }

    async _generateMeetingMinutesForSession(sessionId, targetLang = null) {
        const lang = targetLang || this._activeMinutesLang || 'ja';
        const loadingEl = document.getElementById('minutes-loading');
        const emptyEl = document.getElementById('minutes-empty');
        const editorContainer = document.getElementById('session-minutes-editor-container');
        const loadingText = document.getElementById('minutes-loading-text');
        const regenBtn = document.getElementById('btn-minutes-regenerate');
        const emptyBtn = document.getElementById('btn-minutes-generate-empty');

        if (this._currentViewedSession?.id === sessionId) {
            if (loadingEl) loadingEl.style.display = 'flex';
            if (emptyEl) emptyEl.style.display = 'none';
            if (editorContainer) editorContainer.style.display = 'none';
            if (loadingText) loadingText.textContent = `Đang phân tích & soạn thảo Meeting Minutes (${this._minutesLangName(lang)})...`;
            if (regenBtn) {
                regenBtn.disabled = true;
                regenBtn.innerHTML = '<span class="retranscript-spinner-inline"></span> Đang tạo...';
            }
            if (emptyBtn) {
                emptyBtn.disabled = true;
                emptyBtn.innerHTML = '<span class="retranscript-spinner-inline"></span> Đang tạo...';
            }
        }

        const settings = settingsManager.get();
        const geminiKey = settings.gemini_api_key?.trim();
        const openaiKey = settings.openai_api_key?.trim();

        if (!geminiKey && !openaiKey) {
            if (loadingEl) loadingEl.style.display = 'none';
            if (regenBtn) {
                regenBtn.disabled = false;
                regenBtn.innerHTML = '🔄 Tạo lại (AI)';
            }
            if (emptyBtn) {
                emptyBtn.disabled = false;
                emptyBtn.innerHTML = '✨ Tạo Meeting Minutes ngay';
            }
            this._renderCurrentMinutesSubtab();
            this._showToast('Vui lòng cài đặt Gemini hoặc OpenAI API Key trong Cài đặt (⌘,) để tạo Meeting Minutes', 'error');
            return;
        }

        // Initialize floating bar
        let currentPct = 15;
        this._activeMinutesGeneration = {
            id: sessionId,
            lang,
            timer: null,
        };
        this._setMinutesProgress('Đang phân tích dữ liệu cuộc họp...', currentPct, lang);

        const progressTimer = setInterval(() => {
            if (currentPct < 90) {
                currentPct += (currentPct < 60 ? 5 : 2);
                this._setMinutesProgress('Đang tổng hợp & soạn thảo biên bản...', currentPct, lang);
            }
        }, 900);
        this._activeMinutesGeneration.timer = progressTimer;

        try {
            const onStatusUpdate = (msg) => {
                if (loadingText) loadingText.textContent = msg;
                this._setMinutesProgress(msg, Math.max(currentPct, 50), lang);
            };

            await this._generateMinutesCore(sessionId, lang, onStatusUpdate);

            clearInterval(progressTimer);
            this._showMinutesCompleted(sessionId, lang);

            if (this._currentViewedSession?.id === sessionId) {
                this._switchMinutesSubtab(lang);
            }
            this._showToast(`Đã tạo Meeting Minutes (${this._minutesLangName(lang)}) thành công ✓`, 'success');
        } catch (err) {
            clearInterval(progressTimer);
            this._hideMinutesProgress();
            console.error('[App] _generateMeetingMinutesForSession error:', err);
            if (loadingEl) loadingEl.style.display = 'none';
            this._renderCurrentMinutesSubtab();
            const errMsg = err.message || String(err);
            if (errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('quá tải')) {
                this._showToast('Máy chủ AI đang quá tải tạm thời. Vui lòng bấm tạo lại sau giây lát.', 'error');
            } else {
                this._showToast(`Lỗi tạo Meeting Minutes: ${errMsg}`, 'error');
            }
        } finally {
            if (regenBtn) {
                regenBtn.disabled = false;
                regenBtn.innerHTML = '🔄 Tạo lại (AI)';
            }
            if (emptyBtn) {
                emptyBtn.disabled = false;
                emptyBtn.innerHTML = '✨ Tạo Meeting Minutes ngay';
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
            this._showToast(`Đã lưu Meeting Minutes (${this._minutesLangName(lang)}) ✓`, 'success');
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
                const logsContainer = document.getElementById('session-logs-editor-container');
                if (logsContainer) {
                    logsContainer.innerHTML = `<div class="session-logs-live session-logs-single"><section class="session-log-column" style="height:100%"><header class="panel-column-header"><span class="panel-header-title">📜 Bản ghi thô</span><button type="button" class="panel-copy-btn btn-copy-source" data-copy-legacy-log title="Copy toàn bộ bản ghi"><svg class="icon-copy-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></header><pre class="session-logs-legacy">${this._esc(strippedText)}</pre></section></div>`;
                    logsContainer.querySelector('[data-copy-legacy-log]')?.addEventListener('click', async (e) => {
                        const btn = e.currentTarget;
                        try {
                            await navigator.clipboard.writeText(strippedText);
                            this._showToast('Đã copy bản ghi ✓', 'success');
                            const orig = btn.innerHTML;
                            btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#85e0a3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                            setTimeout(() => { if (btn) btn.innerHTML = orig; }, 1500);
                        } catch (err) {
                            this._showToast(`Không thể copy: ${err}`, 'error');
                        }
                    });
                }
                if (title) title.textContent = id;
                if (tabBtnMinutes) tabBtnMinutes.style.display = 'none';
                if (tabBtnNotes) tabBtnNotes.style.display = 'none';
                const metaBar = document.getElementById('session-viewer-meta-bar');
                if (metaBar) metaBar.style.display = 'none';
                const editBtn = document.getElementById('btn-session-edit-metadata');
                if (editBtn) editBtn.style.display = 'none';
                document.getElementById('btn-session-retranscript').style.display = 'none';
                const editLangsBtnLegacy = document.getElementById('btn-session-edit-langs');
                if (editLangsBtnLegacy) editLangsBtnLegacy.style.display = 'none';
                const status = document.getElementById('session-retranscript-status');
                if (status) {
                    status.textContent = '';
                    status.style.display = 'none';
                }
                this._switchSessionTab('logs');
            } else {
                if (tabBtnMinutes) tabBtnMinutes.style.display = '';
                if (tabBtnNotes) tabBtnNotes.style.display = '';
                const metaBar = document.getElementById('session-viewer-meta-bar');
                if (metaBar) metaBar.style.display = '';
                const editBtn = document.getElementById('btn-session-edit-metadata');
                if (editBtn) editBtn.style.display = '';
                document.getElementById('btn-session-retranscript').style.display = '';
                const editLangsBtn = document.getElementById('btn-session-edit-langs');
                if (editLangsBtn) editLangsBtn.style.display = '';

                const result = await invoke('read_session', { id });
                const json = result.json;
                this._currentSessionJson = json;
                this._updateRetranscriptStatus(json);
                if (title) title.textContent = json.title || id;
                await this._renderSessionViewerMetadata(json);

                if (this._activeRetranscribe?.id === id) {
                    const btn = document.getElementById('btn-session-retranscript');
                    if (btn && !this._activeRetranscribe.buttonsToDisable.includes(btn)) {
                        this._activeRetranscribe.buttonsToDisable.push(btn);
                        this._activeRetranscribe.originalTexts.push('🔄 Re-transcript');
                    }
                }

                // 1. Minutes Tab (JA / VI / EN Sub-tabs — luôn hiện cả 3)
                const mmJa = json.meeting_minutes_ja || (json.meeting_minutes_lang === 'ja' ? json.meeting_minutes : '') || '';
                const mmVi = json.meeting_minutes_vi || (json.meeting_minutes_lang === 'vi' ? json.meeting_minutes : '') || '';
                const mmEn = json.meeting_minutes_en || (json.meeting_minutes_lang === 'en' ? json.meeting_minutes : '') || '';
                this._loadedMinutes = {
                    ja: mmJa.trim(),
                    vi: mmVi.trim(),
                    en: mmEn.trim(),
                };

                this._updateMinutesBadges();

                const subtabJa = document.getElementById('subtab-btn-minutes-ja');
                const subtabVi = document.getElementById('subtab-btn-minutes-vi');
                const subtabEn = document.getElementById('subtab-btn-minutes-en');
                if (subtabJa) subtabJa.style.display = '';
                if (subtabVi) subtabVi.style.display = '';
                if (subtabEn) subtabEn.style.display = '';
                const preferredSubtab = this._loadedMinutes.ja ? 'ja' : (this._loadedMinutes.vi ? 'vi' : (this._loadedMinutes.en ? 'en' : 'ja'));
                this._switchMinutesSubtab(preferredSubtab);

                // 2. Notes Tab
                const notesText = json.notes || '';
                if (this._sessionNotesEditor) {
                    this._sessionNotesEditor.setImageAssets(json.note_images || []);
                    this._sessionNotesEditor.setContent(notesText);
                    this._sessionNotesEditor.setReadOnly(true);
                }

                // 3. Logs Tab — same single/dual layout as the Live transcript.
                this._renderSessionLogs(json);

                // Default Tab: if has any minutes -> 'minutes', otherwise -> 'logs'
                if (this._loadedMinutes.ja || this._loadedMinutes.vi || this._loadedMinutes.en) {
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

    _exitSessionEditMode() {
        this._isSessionEditing = false;
    }

    async _renderSessionViewerMetadata(json) {
        const badgesContainer = document.getElementById('session-viewer-badges');
        const addBtn = document.getElementById('btn-session-add-metadata');
        if (!badgesContainer) return;

        if (!json) {
            badgesContainer.innerHTML = '';
            if (addBtn) addBtn.style.display = 'none';
            return;
        }

        const reg = await this._loadProjectRegistry();
        const allCustomers = reg.customers || [];
        const allProjects = reg.projects || [];

        const customer = allCustomers.find(c => c.id === json.customer_id);
        const customerName = customer?.name || json.customer_name || '';

        const project = allProjects.find(p => p.id === json.project_id);
        const projectName = project?.name || json.project_name || '';
        const projectColor = project?.color || json.project_color || '';

        const category = json.category || '';
        const tags = Array.isArray(json.tags) ? json.tags : [];

        let badgesHtml = '';

        const scope = json.scope || (project && project.scope) || 'work';
        const isPersonal = scope === 'personal';
        const scopeBadge = isPersonal
            ? `<span class="scope-badge-personal" title="Cá nhân (Nhấp để sửa)">👤 Cá nhân</span>`
            : `<span class="scope-badge-work" title="Công việc (Nhấp để sửa)">💼 Công việc</span>`;

        badgesHtml += scopeBadge;

        if (customerName) {
            badgesHtml += `<span class="session-customer-badge" title="Khách hàng: ${this._escAttr(customerName)} (Nhấp để sửa)">🤝 ${this._esc(customerName)}</span>`;
        }

        if (projectName) {
            const colorStyle = projectColor
                ? `background:${this._escAttr(projectColor)}1f; border-color:${this._escAttr(projectColor)}55; color:${this._escAttr(projectColor)};`
                : '';
            badgesHtml += `<span class="session-project-badge" title="Dự án: ${this._escAttr(projectName)} (Nhấp để sửa)" style="${colorStyle}">🚀 ${this._esc(projectName)}</span>`;
        }

        if (category) {
            badgesHtml += `<span class="session-category-badge" title="Category: ${this._escAttr(category)} (Nhấp để sửa)">🗂️ ${this._esc(category)}</span>`;
        }

        if (tags.length > 0) {
            badgesHtml += tags.map(tag => `<span class="session-tag-badge" title="Thẻ: #${this._escAttr(tag)} (Nhấp để sửa)">#${this._esc(tag)}</span>`).join('');
        }

        badgesContainer.innerHTML = badgesHtml;

        const hasAnyMeta = Boolean(customerName || projectName || category || tags.length > 0);
        if (addBtn) {
            addBtn.style.display = hasAnyMeta ? 'none' : 'inline-flex';
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
            if (!hasUpdate && !this._pendingUpdateVersion && !this._updateReadyVersion) {
                const statusText = document.getElementById('update-status-text');
                if (statusText) statusText.textContent = '✅ App is up to date';
            }
        };
        // Delay check slightly so app finishes loading first
        setTimeout(() => {
            const statusText = document.getElementById('update-status-text');
            const checkBtn = document.getElementById('btn-check-update');
            if (statusText && !this._updateReadyVersion && !this._isDownloadingUpdate) {
                statusText.textContent = 'Checking for updates...';
            }
            if (checkBtn && !this._updateReadyVersion && !this._isDownloadingUpdate) {
                checkBtn.classList.add('spinning');
            }
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
        if (statusText) statusText.textContent = `🆕 Có bản cập nhật v${version}`;
        if (actions) actions.style.display = '';

        // 3. Tự động tải ngầm bản cập nhật (Phương án 3)
        if (this._updateReadyVersion === version) {
            this._onUpdateReady(version, notes);
        } else if (!this._isDownloadingUpdate) {
            this._startBackgroundUpdateDownload(version, notes);
        }
    }

    async _startBackgroundUpdateDownload(version, notes) {
        if (this._isDownloadingUpdate || this._updateReadyVersion === version) return;
        this._isDownloadingUpdate = true;

        const btnText = document.getElementById('update-btn-text');
        const btn = document.getElementById('btn-do-update');
        const progressDiv = document.getElementById('update-progress');
        const progressFill = document.getElementById('update-progress-fill');
        const progressPct = document.getElementById('update-progress-pct');
        const statusText = document.getElementById('update-status-text');

        if (btn) btn.disabled = true;
        if (btnText) btnText.textContent = 'Đang tải ngầm...';
        if (progressDiv) progressDiv.style.display = '';
        if (statusText) statusText.textContent = `⏳ Đang tải ngầm bản v${version}...`;

        try {
            console.log(`[Updater] Downloading v${version} in background...`);
            await updater.downloadAndInstall((downloaded, total) => {
                if (total > 0) {
                    const pct = Math.round((downloaded / total) * 100);
                    if (progressFill) progressFill.style.width = `${pct}%`;
                    if (progressPct) progressPct.textContent = `${pct}%`;
                    if (btnText && this._isDownloadingUpdate) {
                        btnText.textContent = `Đang tải ${pct}%...`;
                    }
                }
            });

            this._isDownloadingUpdate = false;
            this._updateReadyVersion = version;
            console.log(`[Updater] Update v${version} downloaded and installed successfully!`);
            this._onUpdateReady(version, notes);
        } catch (err) {
            this._isDownloadingUpdate = false;
            console.warn('[Updater] Background download failed:', err);
            if (btn) btn.disabled = false;
            if (btnText) btnText.textContent = 'Tải & Cài đặt lại';
            if (statusText) statusText.textContent = `⚠️ Tải bản cập nhật thất bại: ${err?.message || err}`;
        }
    }

    _onUpdateReady(version, notes) {
        // Cập nhật About tab
        const btnText = document.getElementById('update-btn-text');
        const btn = document.getElementById('btn-do-update');
        const progressDiv = document.getElementById('update-progress');
        const statusText = document.getElementById('update-status-text');

        if (btn) {
            btn.disabled = false;
            btn.classList.add('btn-ready-relaunch');
        }
        if (btnText) btnText.textContent = '🚀 Khởi động lại app';
        if (progressDiv) progressDiv.style.display = 'none';
        if (statusText) statusText.textContent = `✅ Đã tải xong bản v${version} — Khởi động lại để áp dụng`;

        // Nếu người dùng đang họp, hoãn hiển thị banner cho đến khi kết thúc họp
        if (this.isRunning) {
            this._pendingUpdateReadyBanner = version;
            console.log(`[Updater] Session is running, postponing update banner for v${version}`);
            return;
        }

        this._showUpdateReadyBanner(version);
    }

    _showUpdateReadyBanner(version) {
        // Không hiển thị lại nếu người dùng đã đóng thông báo trong phiên này
        if (sessionStorage.getItem(`update_banner_dismissed_${version}`) === 'true') {
            return;
        }

        const existing = document.getElementById('update-ready-banner');
        if (existing) existing.remove();

        const banner = document.createElement('div');
        banner.id = 'update-ready-banner';
        banner.className = 'update-ready-banner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');

        banner.innerHTML = `
          <div class="update-banner-icon">🚀</div>
          <div class="update-banner-content">
            <div class="update-banner-title">Meet Minder v${version} đã sẵn sàng</div>
            <div class="update-banner-subtitle">Khởi động lại app để áp dụng bản cập nhật mới</div>
          </div>
          <div class="update-banner-actions">
            <button id="btn-banner-relaunch" class="btn-update-relaunch" type="button">Khởi động lại</button>
            <button id="btn-banner-later" class="btn-update-later" type="button">Để sau</button>
            <button id="btn-banner-close" class="btn-update-close" title="Đóng thông báo (Esc)" type="button" aria-label="Đóng thông báo">
              <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8m0-8l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>
        `;

        document.body.appendChild(banner);

        document.getElementById('btn-banner-relaunch')?.addEventListener('click', () => {
            this._relaunchApp();
        });

        document.getElementById('btn-banner-later')?.addEventListener('click', () => {
            this._dismissUpdateBanner(version);
        });

        document.getElementById('btn-banner-close')?.addEventListener('click', () => {
            this._dismissUpdateBanner(version);
        });

        // Phím Escape đóng banner theo chuẩn UX Playbook
        if (!this._updateEscapeBound) {
            this._updateEscapeBound = true;
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    const currentBanner = document.getElementById('update-ready-banner');
                    if (currentBanner && !currentBanner.classList.contains('is-closing')) {
                        this._dismissUpdateBanner(this._updateReadyVersion || version);
                    }
                }
            });
        }
    }

    _dismissUpdateBanner(version) {
        if (version) {
            try {
                sessionStorage.setItem(`update_banner_dismissed_${version}`, 'true');
            } catch (_) {}
        }
        const banner = document.getElementById('update-ready-banner');
        if (banner) {
            banner.classList.add('is-closing');
            setTimeout(() => banner.remove(), 250);
        }
    }

    async _relaunchApp() {
        if (this.isRunning) {
            const ok = confirm('Cuộc họp đang diễn ra. Bạn có chắc chắn muốn kết thúc và khởi động lại Meet Minder ngay bây giờ?');
            if (!ok) return;
        }

        const btnText = document.getElementById('update-btn-text');
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
            console.warn('[Update] Restart failed, update is installed:', restartErr);
            if (btnText) btnText.textContent = '✅ Đã cập nhật! Hãy mở lại app';
            const statusText = document.getElementById('update-status-text');
            if (statusText) statusText.textContent = '✅ Bản cập nhật đã sẵn sàng — hãy đóng và mở lại ứng dụng';
            this._showToast('✅ Cập nhật hoàn tất. Vui lòng khởi động lại Meet Minder.', 'success');
        }
    }

    _initAboutTab() {
        // GitHub links
        document.getElementById('link-github')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__?.opener?.openUrl('https://github.com/tuyennq1001/meetminder');
        });
        document.getElementById('link-issues')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__?.opener?.openUrl('https://github.com/tuyennq1001/meetminder/issues');
        });

        // Check for Updates button
        document.getElementById('btn-check-update')?.addEventListener('click', () => {
            this._triggerUpdateCheck();
        });

        // Download & Install / Relaunch button
        document.getElementById('btn-do-update')?.addEventListener('click', async () => {
            if (this._updateReadyVersion) {
                await this._relaunchApp();
                return;
            }
            if (this._pendingUpdateVersion) {
                await this._startBackgroundUpdateDownload(this._pendingUpdateVersion);
            } else {
                this._triggerUpdateCheck();
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
        const btnCopy = document.getElementById('btn-note-copy');
        const editorContainer = document.getElementById('live-note-editor');
        const fmtButtons = document.querySelectorAll('.note-fmt-btn');

        btnToggleNotes?.addEventListener('click', () => {
            this._toggleNotesDrawer();
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
            this._liveNotesEditor = new NotesEditor({
                onImagePasteError: (message) => this._showToast(message, 'warning'),
                onImagePaste: (asset) => {
                    sessionStore.noteImages = [
                        ...(sessionStore.noteImages || []).filter((item) => item.id !== asset.id),
                        asset,
                    ];
                    sessionStore._mutations++;
                    sessionStore._scheduleNotesAutosave();
                },
            });
            this._liveNotesEditor.mount(editorContainer, {
                initialContent: sessionStore.notes || '',
                imageAssets: sessionStore.noteImages || [],
                placeholderText: 'Nhập ghi chú cuộc họp dạng Markdown (Live Preview)...',
                allowImagePaste: true,
                onChange: (val) => {
                    if (this._suppressLiveNoteDraft) {
                        sessionStore.notes = val;
                    } else {
                        sessionStore.updateNotesDraft(val);
                    }
                    const usedImageIds = new Set(
                        Array.from(val.matchAll(/attachment:([a-z0-9_-]+)/gi), (match) => match[1])
                    );
                    sessionStore.noteImages = (sessionStore.noteImages || [])
                        .filter((asset) => usedImageIds.has(asset.id));
                },
            });
        }

        this._syncLiveMeetingTitleInput();

        this._initNotesResize();
        this._initNoteMetadataSelectors();
        this._toggleNotesDrawer(true, false);
    }

    async _initNoteMetadataSelectors() {
        const selectCust = document.getElementById('select-note-customer');
        const selectProj = document.getElementById('select-note-project');
        const selectCat = document.getElementById('select-note-category');
        const inputTags = document.getElementById('input-note-tags');
        const selectScope = document.getElementById('select-note-scope');

        if (!this._projectRegistry) {
            await this._loadProjectRegistry();
        } else {
            this._populateNoteMetadataSelectors();
        }

        selectScope?.addEventListener('change', () => {
            sessionStore.scope = selectScope.value || 'work';
            sessionStore._mutations++;
            const isPersonal = sessionStore.scope === 'personal';
            if (selectScope) {
                selectScope.setAttribute('data-scope', sessionStore.scope);
            }
            // Personal sessions have no customer: clear it and hide the selector
            if (selectCust) {
                if (isPersonal) {
                    selectCust.value = '';
                    selectCust.style.display = 'none';
                    selectCust.classList.remove('has-value');
                    sessionStore.customerId = null;
                } else {
                    selectCust.style.display = '';
                }
            }
            this._updateNoteProjectsDropdown(selectCust?.value || null, sessionStore.projectId, sessionStore.scope);
            if (selectProj && !selectProj.value) {
                sessionStore.projectId = null;
            }
            this._refreshNoteTagsAutocomplete();
        });

        selectCust?.addEventListener('change', () => {
            const custId = selectCust.value || null;
            sessionStore.customerId = custId;
            sessionStore._mutations++;
            selectCust.classList.toggle('has-value', Boolean(custId));
            this._updateNoteProjectsDropdown(custId, null, sessionStore.scope || 'work');
            const curProjId = selectProj?.value || null;
            const regProjs = (this._projectRegistry?.projects || []).filter(p => p.status === 'active');
            if (curProjId) {
                const projObj = regProjs.find(p => p.id === curProjId);
                if (custId && projObj && projObj.customer_id && projObj.customer_id !== custId) {
                    selectProj.value = '';
                    selectProj.classList.remove('has-value');
                    sessionStore.projectId = null;
                }
            }
        });

        selectProj?.addEventListener('change', () => {
            const projId = selectProj.value || null;
            sessionStore.projectId = projId;
            sessionStore._mutations++;
            selectProj.classList.toggle('has-value', Boolean(projId));
            if (projId && selectCust) {
                const regProjs = (this._projectRegistry?.projects || []).filter(p => p.status === 'active');
                const foundProj = regProjs.find(p => p.id === projId);
                if (foundProj && foundProj.customer_id) {
                    selectCust.value = foundProj.customer_id;
                    selectCust.classList.add('has-value');
                    sessionStore.customerId = foundProj.customer_id;
                    this._updateNoteProjectsDropdown(foundProj.customer_id, projId, sessionStore.scope || 'work');
                }
            }
        });

        selectCat?.addEventListener('change', () => {
            sessionStore.category = selectCat.value || null;
            sessionStore._mutations++;
            selectCat.classList.toggle('has-value', Boolean(selectCat.value));
        });

        inputTags?.addEventListener('input', () => {
            const raw = inputTags.value || '';
            sessionStore.tags = raw
                .split(',')
                .map(t => t.trim().replace(/^#/, '').toLowerCase())
                .filter(Boolean);
            sessionStore._mutations++;
            inputTags.classList.toggle('has-value', Boolean(raw.trim()));
        });
    }

    _populateNoteMetadataSelectors() {
        const selectCust = document.getElementById('select-note-customer');
        const selectProj = document.getElementById('select-note-project');
        const selectCat = document.getElementById('select-note-category');
        const inputTags = document.getElementById('input-note-tags');
        const selectScope = document.getElementById('select-note-scope');

        const reg = this._projectRegistry || { customers: [], projects: [], categories: [], tags: [] };
        const activeCustomers = (reg.customers || []).filter(c => c.status === 'active');
        const currentScope = sessionStore.scope || 'work';
        const isPersonal = currentScope === 'personal';

        if (selectScope) {
            selectScope.value = currentScope;
            selectScope.setAttribute('data-scope', currentScope);
        }

        if (selectCust) {
            selectCust.style.display = isPersonal ? 'none' : '';
            const curVal = isPersonal ? '' : (selectCust.value || sessionStore.customerId || '');
            let html = '<option value="">🤝 Khách hàng...</option>';
            for (const c of activeCustomers) {
                html += `<option value="${this._escAttr(c.id)}">🤝 ${this._esc(c.name)}</option>`;
            }
            selectCust.innerHTML = html;
            selectCust.value = curVal;
            selectCust.classList.toggle('has-value', Boolean(curVal));
        }

        this._updateNoteProjectsDropdown(selectCust?.value || sessionStore.customerId, sessionStore.projectId);

        if (selectCat) {
            const curCat = selectCat.value || sessionStore.category || '';
            let catHtml = '<option value="">🗂️ Category...</option>';
            for (const c of (reg.categories || [])) {
                catHtml += `<option value="${this._escAttr(c.name)}">🗂️ ${this._esc(c.name)}</option>`;
            }
            selectCat.innerHTML = catHtml;
            selectCat.value = curCat;
            selectCat.classList.toggle('has-value', Boolean(curCat));
        }

        if (inputTags) {
            if (!inputTags.value && sessionStore.tags && sessionStore.tags.length > 0) {
                inputTags.value = sessionStore.tags.map(t => `#${t}`).join(', ');
            }
            inputTags.classList.toggle('has-value', Boolean(inputTags.value.trim()));
        }

        this._refreshNoteTagsAutocomplete();
    }

    _refreshNoteTagsAutocomplete() {
        const inputTags = document.getElementById('input-note-tags');
        if (!inputTags) return;

        this._cleanupNoteTagsAutocomplete?.();
        this._cleanupNoteTagsAutocomplete = this._setupTagAutocomplete(
            inputTags,
            null,
            this._getKnownTagsForScope(sessionStore.scope || 'work')
        );
    }

    _updateNoteProjectsDropdown(selectedCustomerId = null, targetProjectId = null, scope = null) {
        const selectProj = document.getElementById('select-note-project');
        if (!selectProj) return;
        const reg = this._projectRegistry || { projects: [] };
        const activeProjects = (reg.projects || []).filter(p => p.status === 'active');
        // Filter by scope first (same rule as stop-meeting modal):
        // personal → only personal projects; work → only work projects + customer.
        const effectiveScope = scope || sessionStore.scope || 'work';
        const scopedProjs = effectiveScope === 'personal'
            ? activeProjects.filter(p => p.scope === 'personal')
            : activeProjects.filter(p => (p.scope || 'work') === 'work');
        const filteredProjs = (effectiveScope === 'work' && selectedCustomerId)
            ? scopedProjs.filter(p => p.customer_id === selectedCustomerId)
            : scopedProjs;

        let projHtml = '<option value="">🚀 Dự án...</option>';
        for (const p of filteredProjs) {
            projHtml += `<option value="${this._escAttr(p.id)}">🚀 ${this._esc(p.name)}</option>`;
        }
        selectProj.innerHTML = projHtml;

        const desired = targetProjectId || sessionStore.projectId || selectProj.value;
        if (desired && filteredProjs.some(p => p.id === desired)) {
            selectProj.value = desired;
        } else {
            selectProj.value = '';
        }
        selectProj.classList.toggle('has-value', Boolean(selectProj.value));
    }

    _resetNoteMetadataSelectors() {
        const selectCust = document.getElementById('select-note-customer');
        const selectProj = document.getElementById('select-note-project');
        const selectCat = document.getElementById('select-note-category');
        const inputTags = document.getElementById('input-note-tags');
        const selectScope = document.getElementById('select-note-scope');

        if (selectScope) {
            selectScope.value = 'work';
            selectScope.setAttribute('data-scope', 'work');
        }
        if (selectCust) {
            selectCust.style.display = '';
            selectCust.value = '';
            selectCust.classList.remove('has-value');
        }
        if (selectProj) {
            this._updateNoteProjectsDropdown(null, null, 'work');
            selectProj.value = '';
            selectProj.classList.remove('has-value');
        }
        if (selectCat) {
            selectCat.value = '';
            selectCat.classList.remove('has-value');
        }
        if (inputTags) {
            inputTags.value = '';
            inputTags.classList.remove('has-value');
        }
        this._refreshNoteTagsAutocomplete();
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
            .replace(/\{\{title\}\}/g, sessionStore.title || 'MTG Title');
    }

    _syncLiveMeetingTitleInput() {
        const input = document.getElementById('input-live-meeting-title');
        if (!input) return;
        input.value = sessionStore.title || '';
    }

    _toggleNotesDrawer(forceOpen = null, shouldFocus = true) {
        const drawer = document.getElementById('live-notes-drawer');
        const btnToggleNotes = document.getElementById('btn-toggle-notes');
        if (!drawer) return;

        const isOpen = !drawer.classList.contains('is-collapsed');
        const shouldOpen = forceOpen !== null ? forceOpen : !isOpen;

        if (shouldOpen) {
            drawer.classList.remove('is-collapsed');
            if (btnToggleNotes) btnToggleNotes.classList.add('active');
            this._populateNoteMetadataSelectors?.();

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
                    this._suppressLiveNoteDraft = true;
                    try {
                        this._liveNotesEditor.setContent(template);
                    } finally {
                        this._suppressLiveNoteDraft = false;
                    }
                    sessionStore.notes = template;
                }
                if (shouldFocus) {
                    this._liveNotesEditor.focus();
                }
            }
        } else {
            drawer.classList.add('is-collapsed');
            if (btnToggleNotes) btnToggleNotes.classList.remove('active');
        }

        if (btnToggleNotes) {
            btnToggleNotes.setAttribute('aria-pressed', String(shouldOpen));
            btnToggleNotes.setAttribute('aria-expanded', String(shouldOpen));
            btnToggleNotes.title = `${shouldOpen ? 'Thu gọn' : 'Mở'} ghi chú cuộc họp (⌘N)`;
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

    _showToast(message, type = 'success', action = null) {
        // Remove existing toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const msgSpan = document.createElement('span');
        msgSpan.className = 'toast-msg';
        msgSpan.textContent = message;
        toast.appendChild(msgSpan);

        if (action?.label && typeof action.onClick === 'function') {
            const actionBtn = document.createElement('button');
            actionBtn.type = 'button';
            actionBtn.className = 'toast-action-btn';
            actionBtn.textContent = action.label;
            actionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                action.onClick();
            });
            toast.appendChild(actionBtn);
        }

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

    _speakIfEnabled(text) {}
    _saveSessionEdit() {}
    _populateReadQuickPick() {}
    _showReadCapabilityHint() {}
    _updateTranslationTypeUI(type) {}
    _updateSettingsCards() {}
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
