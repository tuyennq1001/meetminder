// Qwen LiveTranslate Flash language list (60 entries).
//
// Mirrors my-translator-mobile/src/lib/languages.ts → QWEN_LANGS. Source is
// auto-detected by the model but Live Flash requires an explicit hint at
// session.update time — auto-detect stalls after a single segment on real
// mic input (verified iPhone v0.4.2, 2026-05-25). So the picker offers no
// "auto" entry when engine = qwen.
//
// Ordering: common-first (English → Vietnamese → Japanese → …), rest A-Z.

export const QWEN_LANGS = [
    { code: 'en', name: 'English' },
    { code: 'vi', name: 'Vietnamese' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'zh', name: 'Chinese' },
    { code: 'yue', name: 'Cantonese' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'ru', name: 'Russian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'it', name: 'Italian' },
    { code: 'id', name: 'Indonesian' },
    { code: 'ms', name: 'Malay' },
    { code: 'th', name: 'Thai' },
    { code: 'hi', name: 'Hindi' },
    { code: 'ar', name: 'Arabic' },
    { code: 'tr', name: 'Turkish' },
    { code: 'nl', name: 'Dutch' },
    // A-Z rest
    { code: 'af', name: 'Afrikaans' },
    { code: 'ast', name: 'Asturian' },
    { code: 'az', name: 'Azerbaijani' },
    { code: 'be', name: 'Belarusian' },
    { code: 'bg', name: 'Bulgarian' },
    { code: 'bn', name: 'Bengali' },
    { code: 'bs', name: 'Bosnian' },
    { code: 'ca', name: 'Catalan' },
    { code: 'ceb', name: 'Cebuano' },
    { code: 'cs', name: 'Czech' },
    { code: 'da', name: 'Danish' },
    { code: 'el', name: 'Greek' },
    { code: 'et', name: 'Estonian' },
    { code: 'fa', name: 'Persian' },
    { code: 'fi', name: 'Finnish' },
    { code: 'fil', name: 'Filipino' },
    { code: 'gl', name: 'Galician' },
    { code: 'gu', name: 'Gujarati' },
    { code: 'he', name: 'Hebrew' },
    { code: 'hr', name: 'Croatian' },
    { code: 'hu', name: 'Hungarian' },
    { code: 'is', name: 'Icelandic' },
    { code: 'jv', name: 'Javanese' },
    { code: 'kk', name: 'Kazakh' },
    { code: 'kn', name: 'Kannada' },
    { code: 'ky', name: 'Kyrgyz' },
    { code: 'lv', name: 'Latvian' },
    { code: 'mk', name: 'Macedonian' },
    { code: 'ml', name: 'Malayalam' },
    { code: 'mr', name: 'Marathi' },
    { code: 'nb', name: 'Norwegian Bokmål' },
    { code: 'pa', name: 'Punjabi' },
    { code: 'pl', name: 'Polish' },
    { code: 'ro', name: 'Romanian' },
    { code: 'sk', name: 'Slovak' },
    { code: 'sl', name: 'Slovenian' },
    { code: 'sv', name: 'Swedish' },
    { code: 'sw', name: 'Swahili' },
    { code: 'tg', name: 'Tajik' },
    { code: 'uk', name: 'Ukrainian' },
    { code: 'ur', name: 'Urdu' },
];

export const QWEN_LANG_CODES = new Set(QWEN_LANGS.map((l) => l.code));
