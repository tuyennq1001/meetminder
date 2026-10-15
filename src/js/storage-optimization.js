import { getCurrentLocale } from './i18n.js';

const COPY = {
    vi: {
        title: 'Tối ưu dung lượng',
        description: 'Xóa ghi âm cũ để giải phóng dung lượng; log, transcript và ghi chú vẫn được giữ.',
        retentionLabel: 'Giữ ghi âm trong', week: '1 tuần gần nhất', month: '1 tháng gần nhất',
        threeMonths: '3 tháng gần nhất', sixMonths: '6 tháng gần nhất', button: 'Xem trước và dọn ghi âm',
        scanning: 'Đang kiểm tra các ghi âm cũ...', deleting: 'Đang xóa ghi âm cũ...',
        preview: 'Sẽ xóa {{count}} file ({{size}}): {{linkedCount}} file gắn với log ({{linkedSize}}) và {{orphanCount}} file không còn log ({{orphanSize}}). Log, transcript và ghi chú sẽ được giữ. Tiếp tục?',
        noFiles: 'Không tìm thấy ghi âm cũ cần dọn.', unknownDates: 'Giữ lại {{count}} file vì không xác định được ngày.',
        success: 'Đã xóa {{count}} file ghi âm, giải phóng {{size}}.',
        partial: 'Đã xóa {{count}} file, giải phóng {{size}}. Không xóa được {{failed}} file: {{errors}}',
        failed: 'Không thể dọn ghi âm: {{error}}',
    },
    en: {
        title: 'Optimize storage',
        description: 'Delete old recordings to free disk space. Meeting logs, transcripts, and notes are kept.',
        retentionLabel: 'Keep recordings for', week: 'Last week', month: 'Last month',
        threeMonths: 'Last 3 months', sixMonths: 'Last 6 months', button: 'Preview and clean recordings',
        scanning: 'Checking old recordings...', deleting: 'Deleting old recordings...',
        preview: 'This will delete {{count}} files ({{size}}): {{linkedCount}} linked to logs ({{linkedSize}}) and {{orphanCount}} without logs ({{orphanSize}}). Logs, transcripts, and notes will be kept. Continue?',
        noFiles: 'No old recordings need cleanup.', unknownDates: 'Keeping {{count}} files because their dates could not be determined.',
        success: 'Deleted {{count}} recordings, freeing {{size}}.',
        partial: 'Deleted {{count}} files, freeing {{size}}. Could not delete {{failed}} files: {{errors}}',
        failed: 'Could not clean recordings: {{error}}',
    },
    ja: {
        title: 'ストレージを最適化',
        description: '古い録音を削除して空き容量を増やします。ログ、文字起こし、メモは保持されます。',
        retentionLabel: '録音の保存期間', week: '直近1週間', month: '直近1か月',
        threeMonths: '直近3か月', sixMonths: '直近6か月', button: '録音を確認して整理',
        scanning: '古い録音を確認中...', deleting: '古い録音を削除中...',
        preview: '{{count}}個のファイル（{{size}}）を削除します。内訳: ログに紐づく録音 {{linkedCount}}個（{{linkedSize}}）、ログのない録音 {{orphanCount}}個（{{orphanSize}}）。ログ、文字起こし、メモは保持されます。続行しますか？',
        noFiles: '削除対象の古い録音はありません。', unknownDates: '日付を特定できない{{count}}個のファイルは保持します。',
        success: '録音{{count}}個を削除し、{{size}}の空き容量を確保しました。',
        partial: '{{count}}個のファイルを削除し、{{size}}を確保しました。{{failed}}個を削除できませんでした: {{errors}}',
        failed: '録音を整理できませんでした: {{error}}',
    },
};

function localizedText(key, values = {}) {
    const locale = getCurrentLocale();
    const template = COPY[locale]?.[key] || COPY.en[key] || key;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? ''));
}

function localizeControls() {
    document.querySelectorAll('[data-storage-optimize-copy]').forEach((element) => {
        element.textContent = localizedText(element.dataset.storageOptimizeCopy);
    });
    document.querySelectorAll('[data-storage-optimize-aria]').forEach((element) => {
        element.setAttribute('aria-label', localizedText(element.dataset.storageOptimizeAria));
    });
}

let localeObserver;

export function bindStorageOptimization({ invoke, promptConfirmDelete, showToast, formatBytes, onComplete }) {
    const button = document.getElementById('btn-optimize-storage');
    const retentionSelect = document.getElementById('select-audio-retention');
    const statusEl = document.getElementById('storage-optimization-status');
    if (!button || !retentionSelect || !statusEl) return;

    const setStatus = (message, isError = false) => {
        statusEl.style.display = message ? 'block' : 'none';
        statusEl.classList.toggle('is-error', isError);
        statusEl.textContent = message || '';
    };
    localizeControls();
    if (!localeObserver && typeof MutationObserver !== 'undefined') {
        localeObserver = new MutationObserver(localizeControls);
        localeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    }

    button.addEventListener('click', async () => {
        if (button.disabled) return;
        const retention = retentionSelect.value || '1m';
        button.disabled = true;
        retentionSelect.disabled = true;
        setStatus(localizedText('scanning'));
        try {
            const preview = await invoke('preview_audio_cleanup', { retention });
            const unknownNote = Number(preview.unknown_date_files) > 0
                ? ` ${localizedText('unknownDates', { count: preview.unknown_date_files })}` : '';
            if (!preview.total_files) {
                setStatus(`${localizedText('noFiles')}${unknownNote}`);
                return;
            }
            const message = localizedText('preview', {
                count: preview.total_files, size: formatBytes(preview.total_size_bytes),
                linkedCount: preview.linked_files, linkedSize: formatBytes(preview.linked_size_bytes),
                orphanCount: preview.orphan_files, orphanSize: formatBytes(preview.orphan_size_bytes),
            });
            const agreed = await promptConfirmDelete({
                title: localizedText('title'), message: `${message}${unknownNote}`,
                confirmText: localizedText('button'),
            });
            if (!agreed) { setStatus(''); return; }

            setStatus(localizedText('deleting'));
            const result = await invoke('cleanup_old_audio', { retention });
            const deleted = Number(result.deleted_files) || 0;
            const freed = formatBytes(result.deleted_size_bytes);
            const failures = result.failed_files || [];
            if (failures.length) {
                const shownErrors = failures.slice(0, 3).join('; ');
                const extra = failures.length > 3 ? ` (+${failures.length - 3})` : '';
                setStatus(`${localizedText('partial', {
                    count: deleted, size: freed, failed: failures.length, errors: `${shownErrors}${extra}`,
                })}${unknownNote}`, true);
            } else {
                const success = `${localizedText('success', { count: deleted, size: freed })}${unknownNote}`;
                setStatus(success);
                showToast(success, 'success');
            }
            await onComplete?.();
        } catch (error) {
            const message = localizedText('failed', { error: String(error) });
            setStatus(message, true);
            showToast(message, 'error');
        } finally {
            button.disabled = false;
            retentionSelect.disabled = false;
        }
    });
}
