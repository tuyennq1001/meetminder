import test from 'node:test';
import assert from 'node:assert/strict';
import { getMissingEngineApiKey } from './required-api-key.js';

test('returns the matching credential input for a cloud engine with no key', () => {
    assert.deepEqual(getMissingEngineApiKey({ translation_mode: 'gemini' }), {
        setting: 'gemini_api_key', inputId: 'input-gemini-key',
    });
    assert.deepEqual(getMissingEngineApiKey({ translation_mode: 'soniox' }), {
        setting: 'soniox_api_key', inputId: 'input-api-key',
    });
    assert.deepEqual(getMissingEngineApiKey({ translation_mode: 'openai' }), {
        setting: 'openai_api_key', inputId: 'input-openai-key',
    });
    assert.deepEqual(getMissingEngineApiKey({ translation_mode: 'qwen' }), {
        setting: 'qwen_api_key', inputId: 'input-qwen-key',
    });
});

test('does not request a key for Local or when the selected engine already has one', () => {
    assert.equal(getMissingEngineApiKey({ translation_mode: 'local' }), null);
    assert.equal(getMissingEngineApiKey({ translation_mode: 'gemini', gemini_api_key: '  key  ' }), null);
});
