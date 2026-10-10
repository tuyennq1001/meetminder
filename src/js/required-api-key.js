const KEY_FIELDS_BY_ENGINE = Object.freeze({
    gemini: ['gemini_api_key', 'input-gemini-key'],
    soniox: ['soniox_api_key', 'input-api-key'],
    openai: ['openai_api_key', 'input-openai-key'],
    qwen: ['qwen_api_key', 'input-qwen-key'],
});

export function getMissingEngineApiKey(settings) {
    const requiredKey = KEY_FIELDS_BY_ENGINE[settings?.translation_mode];
    if (!requiredKey || String(settings?.[requiredKey[0]] || '').trim()) return null;
    return { setting: requiredKey[0], inputId: requiredKey[1] };
}
