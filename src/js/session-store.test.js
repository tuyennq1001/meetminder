import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = {
    __TAURI__: {
        core: {
            invoke: async () => null,
        },
    },
};

const { SessionStore } = await import('./session-store.js');

test('memo drafts stay associated with their selected minutes template', () => {
    const store = new SessionStore();
    let autosaveCount = 0;
    store._scheduleNotesAutosave = () => { autosaveCount++; };
    store.meetingMinutesTemplateId = 'standard';
    store.meetingMinutesTemplateLanguage = 'en';
    store.notes = 'Standard memo draft';
    store.notesByMinutesTemplate['standard::en'] = store.notes;

    assert.equal(
        store.switchMinutesTemplateDraft('interview', store.notes, 'Interview memo outline', 'en'),
        'Interview memo outline',
    );
    assert.equal(autosaveCount, 0, 'switching a template alone should not save a blank meeting');
    store.updateNotesDraft('Interview-specific memo', 'interview', 'en');
    assert.equal(autosaveCount, 1, 'editing Memo should schedule its normal autosave');

    assert.equal(
        store.switchMinutesTemplateDraft('standard', store.notes, 'Standard memo outline', 'en'),
        'Standard memo draft',
    );
    assert.equal(
        store.switchMinutesTemplateDraft('interview', store.notes, 'Interview memo outline', 'en'),
        'Interview-specific memo',
    );

    store.updateNotesDraft('', 'interview', 'en');
    store.switchMinutesTemplateDraft('standard', store.notes, 'Standard memo outline', 'en');
    assert.equal(
        store.switchMinutesTemplateDraft('interview', store.notes, 'Interview memo outline', 'en'),
        '',
        'an intentionally cleared draft must remain empty instead of being reset to the outline',
    );
});

test('memo drafts are restored independently for each application template language', () => {
    const store = new SessionStore();
    store.meetingMinutesTemplateId = 'standard';
    store.meetingMinutesTemplateLanguage = 'en';
    store.notes = 'English draft';
    store.notesByMinutesTemplate['standard::en'] = store.notes;

    assert.equal(
        store.switchMinutesTemplateDraft('standard', store.notes, 'Vietnamese outline', 'vi'),
        'Vietnamese outline',
    );
    store.updateNotesDraft('Vietnamese edited draft', 'standard', 'vi');

    assert.equal(
        store.switchMinutesTemplateDraft('standard', store.notes, 'English outline', 'en'),
        'English draft',
    );
    assert.equal(
        store.switchMinutesTemplateDraft('standard', store.notes, 'Vietnamese outline', 'vi'),
        'Vietnamese edited draft',
    );
});

test('legacy template-only drafts migrate to the first application language used', () => {
    const store = new SessionStore();
    store.meetingMinutesTemplateId = 'standard';
    store.notes = 'Saved legacy draft';
    store.notesByMinutesTemplate.standard = 'Saved legacy draft';

    assert.equal(
        store.switchMinutesTemplateDraft('standard', store.notes, 'Japanese outline', 'ja'),
        'Saved legacy draft',
    );
    assert.equal(store.notesByMinutesTemplate['standard::ja'], 'Saved legacy draft');
    assert.equal(Object.hasOwn(store.notesByMinutesTemplate, 'standard'), false);
});

test('pre-assigned draft is retained when switching templates', () => {
    const store = new SessionStore();
    store.meetingMinutesTemplateId = 'standard';
    store.meetingMinutesTemplateLanguage = 'vi';
    store.notes = 'Cuộc họp thảo luận kiến trúc hệ thống';
    store.notesByMinutesTemplate['standard::vi'] = store.notes;

    // Simulate preserving notes during stopSession category switch to 'tech'
    const targetKey = store.minutesTemplateDraftKey('tech', 'vi');
    store.notesByMinutesTemplate[targetKey] = store.notes;

    const next = store.switchMinutesTemplateDraft('tech', store.notes, 'Tech outline', 'vi');
    assert.equal(next, 'Cuộc họp thảo luận kiến trúc hệ thống');
    assert.equal(store.notes, 'Cuộc họp thảo luận kiến trúc hệ thống');
    assert.equal(store.meetingMinutesTemplateId, 'tech');
});
