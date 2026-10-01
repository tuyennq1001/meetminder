import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.document = {
    documentElement: {dataset: {}},
    querySelectorAll: () => [],
};

const {applyLocale} = await import('./i18n.js');
const {getStorageLocationChoice, getStorageLocationSuccess, localizeStorageMigrationError} = await import('./storage-errors.js');

const conflictError = 'MEET_MINDER_STORAGE_ERROR:{"code":"target_conflicts","count":11,"examples":["records/README.md",".DS_Store","projects.json"]}';

test('storage conflict errors use the active Japanese locale', () => {
    applyLocale('ja');

    const message = localizeStorageMigrationError(conflictError);

    assert.match(message, /同じ名前で内容が異なるファイルが 11 件あります/);
    assert.match(message, /records\/README\.md, \.DS_Store, projects\.json/);
    assert.doesNotMatch(message, /Thư mục|Hãy chọn/);
});

test('storage conflict errors remain localized in Vietnamese and English', () => {
    applyLocale('vi');
    assert.match(localizeStorageMigrationError(conflictError), /Thư mục đích có 11 file/);

    applyLocale('en');
    assert.match(localizeStorageMigrationError(conflictError), /contains 11 files with matching names/);
});

test('storage folder choices explain migration and switch-only behavior in each locale', () => {
    const preview = {
        source_file_count: 11,
        target_file_count: 4,
        target_path: '/tmp/new-meetings',
        conflict_count: 2,
        conflict_examples: ['records/README.md', 'projects.json'],
    };

    applyLocale('ja');
    const japanese = getStorageLocationChoice(preview, '2 MB');
    assert.equal(japanese.moveDisabled, true);
    assert.match(japanese.message, /既存データは元のフォルダーに残ります/);
    assert.match(japanese.message, /内容が異なる同名ファイルが 2 件/);
    assert.ok(japanese.message.includes('/tmp/new-meetings'));
    assert.match(getStorageLocationSuccess(false), /既存データは元のフォルダーに残っています/);

    applyLocale('vi');
    const vietnamese = getStorageLocationChoice(preview, '2 MB');
    assert.match(vietnamese.message, /Chỉ đổi nơi lưu sẽ đưa các cuộc họp mới/);
    assert.match(vietnamese.message, /Không thể di chuyển vì có 2 file/);
    assert.match(getStorageLocationSuccess(false), /Dữ liệu hiện có vẫn ở thư mục cũ/);

    applyLocale('en');
    const english = getStorageLocationChoice({...preview, conflict_count: 0}, '2 MB');
    assert.equal(english.moveDisabled, false);
    assert.match(english.message, /Changing the location only will save new meetings/);
    assert.equal(english.moveLabel, 'Move existing data');
});

test('ordinary storage errors retain their existing display text', () => {
    applyLocale('ja');
    assert.equal(
        localizeStorageMigrationError('permission denied'),
        'permission denied',
    );
});

test('malformed storage error payloads do not hide the original error', () => {
    const message = 'MEET_MINDER_STORAGE_ERROR:{invalid';
    assert.equal(localizeStorageMigrationError(message), message);
});
