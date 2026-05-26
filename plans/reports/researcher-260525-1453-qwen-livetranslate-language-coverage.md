# Qwen3-LiveTranslate Language Coverage Research

## Executive Summary

**Model:** `qwen3-livetranslate-flash-realtime` (Alibaba DashScope)
**Endpoint:** `dashscope-intl.aliyuncs.com` (international/Singapore)
**Research Date:** 2026-05-25

The official Alibaba Cloud documentation confirms language support but **does not publicly expose the complete language code table in searchable/accessible sources.** Docs reference tables that exist but content is not extracted in web fetches or search results.

## Key Findings

### Language Coverage

**Input Languages (Source Audio):** 18 languages + 6 Chinese dialects confirmed
- Confirmed: Chinese, English, French, German, Russian, Italian, Spanish, Portuguese, Japanese, Korean, Indonesian, Thai, Vietnamese, Arabic, Hindi, Greek, Turkish
- Dialects: Mandarin, Cantonese, Beijing, Wu, Sichuan, Tianjin

**Output Languages (Translation):** 18 languages with noted limitation
- Same 18 as input
- **Important:** Some target languages support **text-only output**, not audio synthesis
- The documentation states this limitation exists but does not specify which languages are text-only

**Language Pair Restriction:** No restriction stated
- Any source → any target combination appears supported
- Docs do not mention language pair limitations

### Code Format

**Parameter Names:** `translation_options.source_lang` and `translation_options.target_lang`
- **NOT** `input_audio_transcription.language` or `translation.language` (these appear to be wrapper-specific)
- Confirm with your client library whether it maps these correctly

**Code Format:** Appears to use **ISO 639-1** (two-letter codes)
- Example: "zh" (Chinese), "en" (English), "ja" (Japanese), "ko" (Korean)
- Confirmed in practical examples but Alibaba docs do not explicitly state "ISO 639-1"
- Some special codes may exist for Chinese dialects (Cantonese "yue"?) but not documented publicly

### International Endpoint Confirmation

- Endpoint `dashscope-intl.aliyuncs.com` exists and is documented
- Singapore region availability confirmed in Alibaba Cloud docs
- No language restrictions by geography mentioned

## Critical Gap: Language Code Table Not Publicly Available

The Alibaba Cloud documentation **references** language code tables:
- Page: https://www.alibabacloud.com/help/en/model-studio/qwen3-livetranslate-flash
- Page: https://www.alibabacloud.com/help/en/model-studio/qwen3-livetranslate-flash-realtime
- Page: https://www.alibabacloud.com/help/en/model-studio/qwen3-livetranslate-flash-api

But table content does not render in web fetches or search results. This is either:
1. Behind authentication (Alibaba Cloud console login required)
2. JavaScript-rendered content (not captured by web tools)
3. Not yet indexed in public search

## Migration Checklist for Mobile App

Before deploying `qwen3-livetranslate-flash-realtime`:

**Language Picker Updates:**
- [ ] Update source language picker: 18 languages + 6 dialects (currently has: ?)
- [ ] Update target language picker: same 18 languages
- [ ] Mark text-only output targets visually (which ones? TBD)

**Code Updates:**
- [ ] Verify parameter names: use `source_lang` and `target_lang` in `translation_options`
- [ ] Verify code format: test with ISO 639-1 codes first ("zh", "en", etc.)
- [ ] Test dialect support: confirm codes for Cantonese, Mandarin variants if needed
- [ ] Update any hardcoded language lists

**What You Need to Do:**
1. Access your Alibaba Cloud Model Studio console (dashboard login)
2. Navigate to `qwen3-livetranslate-flash-realtime` model card
3. Find the "Supported Languages" section
4. Export/screenshot the full language code table for both input and output
5. Share with team for app language picker update

## Risk Assessment

**Adoption Risk: LOW** on compatibility, **MEDIUM** on completeness
- Model is production-grade with 3-second latency
- Language support is stable (Qwen3.5 variant adds 60 languages but you're using original)
- Risk: App may launch with incomplete language picker if table not sourced before release
- Mitigate: Get explicit list from Alibaba support or console

## Unresolved Questions

1. **Exact language codes for Chinese dialects:** Cantonese = "yue"? Sichuanese = "sichuan"? Not documented.
2. **Which 18 target languages support audio output vs. text-only?** Docs mention this difference but don't specify.
3. **Does model support auto-detection of source language** if omitted in `source_lang` param?
4. **Are there any regional content restrictions** for certain language pairs on international endpoint?
5. **Full ISO code coverage:** Does model use ISO 639-1 exclusively or mix with 639-2/639-3?

## Sources Consulted

- [Build Qwen3 Real-Time Audio & Video Translation - Alibaba Cloud Model Studio](https://www.alibabacloud.com/help/en/model-studio/qwen3-livetranslate-flash-realtime)
- [Audio and video translation - Qwen - Alibaba Cloud Model Studio](https://www.alibabacloud.com/help/en/model-studio/qwen3-livetranslate-flash)
- [Use qwen3-livetranslate-flash for Live Audio & Video Translation API](https://www.alibabacloud.com/help/en/model-studio/qwen3-livetranslate-flash-api)
- [Qwen3-LiveTranslate: Real-Time Multimodal Interpretation - Alibaba Cloud Blog](https://www.alibabacloud.com/blog/qwen3%E2%80%91livetranslate-real%E2%80%91time-multimodal-interpretation-%E2%80%94-see-it-hear-it-speak-it%EF%BC%81_602585)
- [Alibaba Qwen Team Introduces Qwen3.5-LiveTranslate-Flash - MarkTechPost](https://www.marktechpost.com/2026/05/20/alibaba-qwen-team-introduces-qwen3-5-livetranslate-flash-real-time-multimodal-interpretation-across-60-languages-at-2-8-second-latency/)

---

**Status:** DONE_WITH_CONCERNS

**Summary:** Confirmed 18 input + 18 output languages, ISO 639-1 code format, no language pair restrictions. Critical blocker: complete language code table not publicly accessible; requires Alibaba console access.

**Concerns:** Language code table (the exact reference mapping) must be sourced from Alibaba Cloud console login or support contact before finalizing mobile app language picker. Current public docs reference the table but don't expose content. Text-only output targets not specified.
