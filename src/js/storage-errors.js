import {getCurrentLocale, t} from './i18n.js';

const storageErrorPrefix = 'MEET_MINDER_STORAGE_ERROR:';
const targetConflictMessages = {
    vi: 'Thư mục đích có {{count}} file trùng tên nhưng khác nội dung (ví dụ: {{examples}}). Hãy chọn thư mục khác hoặc xử lý thủ công để tránh ghi đè.',
    en: 'The target folder contains {{count}} files with matching names but different contents (for example: {{examples}}). Choose another folder or resolve them manually to avoid overwriting.',
    ja: '保存先フォルダーには、同じ名前で内容が異なるファイルが {{count}} 件あります（例: {{examples}}）。上書きを防ぐため、別のフォルダーを選ぶか手動で解決してください。',
};

const storageLocationChoiceMessages = {
    vi: {
        title: 'Đổi thư mục lưu trữ',
        move: 'Meet Minder sẽ sao chép {{count}} file ({{size}}) sang thư mục mới. File gốc vẫn được giữ lại.',
        moveEmpty: 'Không có dữ liệu hiện tại cần di chuyển.',
        switchOnly: 'Chỉ đổi nơi lưu sẽ đưa các cuộc họp mới vào thư mục mới. Dữ liệu hiện có vẫn nằm trong thư mục cũ.',
        conflicts: ' Không thể di chuyển vì có {{count}} file trùng tên nhưng khác nội dung (ví dụ: {{examples}}).',
        moveLabel: 'Di chuyển dữ liệu',
        moveUnavailable: 'Không thể di chuyển ({{count}} file trùng)',
        switchLabel: 'Chỉ đổi nơi lưu',
        changeOnlySuccess: 'Đã đổi nơi lưu. Dữ liệu hiện có vẫn ở thư mục cũ.',
    },
    en: {
        title: 'Change storage folder',
        move: 'Meet Minder will copy {{count}} files ({{size}}) to the new folder. The original files will remain in place.',
        moveEmpty: 'There is no existing data to move.',
        switchOnly: 'Changing the location only will save new meetings in the new folder. Existing data will stay in the previous folder.',
        conflicts: ' Moving is unavailable because {{count}} files have matching names but different contents (for example: {{examples}}).',
        moveLabel: 'Move existing data',
        moveUnavailable: 'Cannot move ({{count}} conflicts)',
        switchLabel: 'Only change location',
        changeOnlySuccess: 'Storage location changed. Existing data remains in the previous folder.',
    },
    ja: {
        title: '保存先フォルダーを変更',
        move: 'Meet Minder は {{count}} 件のファイル（{{size}}）を新しいフォルダーにコピーします。元のファイルはそのまま残ります。',
        moveEmpty: '移動する既存データはありません。',
        switchOnly: '保存先だけを変更すると、新しい会議は新しいフォルダーに保存されます。既存データは元のフォルダーに残ります。',
        conflicts: ' 内容が異なる同名ファイルが {{count}} 件あるため、データを移動できません（例: {{examples}}）。',
        moveLabel: '既存データを移動',
        moveUnavailable: '移動できません（競合 {{count}} 件）',
        switchLabel: '保存先だけ変更',
        changeOnlySuccess: '保存先を変更しました。既存データは元のフォルダーに残っています。',
    },
};

export function getStorageLocationChoice(preview, sourceSize) {
    const locale = getCurrentLocale();
    const messages = storageLocationChoiceMessages[locale] ?? storageLocationChoiceMessages.en;
    const values = {
        count: Number(preview.source_file_count || 0),
        size: sourceSize,
        examples: (preview.conflict_examples || []).join(', '),
    };
    const moveDescription = values.count > 0
        ? messages.move
        : messages.moveEmpty;
    const conflictDescription = Number(preview.conflict_count || 0) > 0
        ? messages.conflicts.replace(/\{\{(count|examples)\}\}/g, (_, key) => String(
            key === 'count' ? preview.conflict_count : values[key],
        ))
        : '';

    const targetCount = Number(preview.target_file_count || 0);
    return {
        title: messages.title,
        message: [
            moveDescription.replace(/\{\{(count|size)\}\}/g, (_, key) => String(values[key])),
            messages.switchOnly,
            targetCount > 0
                ? t('settings.storage.targetHasFiles', {count: targetCount})
                : t('settings.storage.targetEmpty'),
            `${conflictDescription}\n\n${preview.target_path}`,
        ].join('\n\n'),
        moveLabel: Number(preview.conflict_count || 0) > 0
            ? messages.moveUnavailable.replace('{{count}}', String(preview.conflict_count))
            : messages.moveLabel,
        switchLabel: messages.switchLabel,
        moveDisabled: Number(preview.conflict_count || 0) > 0,
    };
}

export function getStorageLocationSuccess(migrateData) {
    if (migrateData) return t('settings.storage.changeSuccess');
    const locale = getCurrentLocale();
    return storageLocationChoiceMessages[locale]?.changeOnlySuccess
        ?? storageLocationChoiceMessages.en.changeOnlySuccess;
}

export function localizeStorageMigrationError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith(storageErrorPrefix)) return message;

    try {
        const payload = JSON.parse(message.slice(storageErrorPrefix.length));
        if (
            payload.code !== 'target_conflicts'
            || !Number.isInteger(payload.count)
            || !Array.isArray(payload.examples)
            || !payload.examples.every((example) => typeof example === 'string')
        ) {
            return message;
        }

        const template = targetConflictMessages[getCurrentLocale()] ?? targetConflictMessages.en;
        const values = {count: payload.count, examples: payload.examples.join(', ')};
        return template.replace(/\{\{(count|examples)\}\}/g, (_, key) => String(values[key]));
    } catch {
        return message;
    }
}
