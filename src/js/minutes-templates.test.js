import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_TEMPLATE_MINUTES_JA,
    DEFAULT_TEMPLATE_MINUTES_VI,
    DEFAULT_TEMPLATE_MINUTES_EN,
    PRESET_TEMPLATE_TECH_JA,
    PRESET_TEMPLATE_TECH_VI,
    PRESET_TEMPLATE_TECH_EN,
    PRESET_TEMPLATE_1ON1_JA,
    PRESET_TEMPLATE_1ON1_VI,
    PRESET_TEMPLATE_1ON1_EN,
    PRESET_TEMPLATE_PERSONAL_JA,
    PRESET_TEMPLATE_PERSONAL_VI,
    PRESET_TEMPLATE_PERSONAL_EN,
} from './minutes-templates.js';

const templates = [
    DEFAULT_TEMPLATE_MINUTES_JA,
    DEFAULT_TEMPLATE_MINUTES_VI,
    DEFAULT_TEMPLATE_MINUTES_EN,
    PRESET_TEMPLATE_TECH_JA,
    PRESET_TEMPLATE_TECH_VI,
    PRESET_TEMPLATE_TECH_EN,
    PRESET_TEMPLATE_1ON1_JA,
    PRESET_TEMPLATE_1ON1_VI,
    PRESET_TEMPLATE_1ON1_EN,
    PRESET_TEMPLATE_PERSONAL_JA,
    PRESET_TEMPLATE_PERSONAL_VI,
    PRESET_TEMPLATE_PERSONAL_EN,
];

test('all minutes templates keep their metadata placeholders', () => {
    assert.equal(templates.length, 12);

    for (const template of templates) {
        assert.ok(template.trim().length > 0);
        assert.match(template, /\{\{title\}\}/);
        assert.match(template, /\{\{date\}\}/);
        assert.match(template, /\{\{duration\}\}/);
        assert.match(template, /\{\{participants\}\}/);
    }
});

test('minutes templates retain their Japanese, Vietnamese, and English content', () => {
    assert.match(DEFAULT_TEMPLATE_MINUTES_JA, /会議議事録/);
    assert.match(DEFAULT_TEMPLATE_MINUTES_VI, /BIÊN BẢN CUỘC HỌP/);
    assert.match(DEFAULT_TEMPLATE_MINUTES_EN, /MEETING MINUTES/);
});
