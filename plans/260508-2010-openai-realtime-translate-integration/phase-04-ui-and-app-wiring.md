# Phase 4 — UI + app.js Wiring

**Status:** ☑ Done
**Estimate:** 2h
**Owner:** Frontend
**Depends on:** phases 2 & 3

## Overview

Surface the new provider in Settings UI (provider selector + API key input + cost warning), then add a third branch in `app.js` `start()` alongside Soniox and Local — `_startOpenAiMode()`. Also handle provider-specific UI gating: force-disable TTS toggle, gate two-way mode off, restrict target language to the 13 supported.

## Related code files

- MODIFY: [src/index.html](../../src/index.html) — add provider radio/select group + OpenAI key input row
- MODIFY: [src/js/app.js](../../src/js/app.js) — start branch, settings form populate/save, language list gating
- MODIFY: [src/js/settings.js](../../src/js/settings.js) — surface `openai_api_key` field
- MODIFY: [src/css/styles.css](../../src/css/styles.css) — cost warning style (yellow callout)

## Implementation

### 1. `index.html` — Settings panel

Find the existing translation mode group (currently "Soniox / Local"). Replace with a 3-option radio:

```html
<fieldset class="settings-group">
    <legend>Translation provider</legend>

    <label class="provider-option">
        <input type="radio" name="translation-mode" value="soniox" checked>
        <span class="title">Soniox cloud</span>
        <span class="hint">~$0.12/hr · 70+ languages · 2-3s latency</span>
    </label>

    <label class="provider-option">
        <input type="radio" name="translation-mode" value="local">
        <span class="title">Local MLX (Apple Silicon)</span>
        <span class="hint">Free · offline · ~5s latency</span>
    </label>

    <label class="provider-option">
        <input type="radio" name="translation-mode" value="openai">
        <span class="title">OpenAI Realtime <span class="new-badge">NEW</span></span>
        <span class="hint">Lower latency, voice output included · 13 output langs</span>
    </label>

    <div id="openai-cost-warning" class="cost-warning" hidden>
        ⚠️ OpenAI Realtime costs <strong>$0.034/min</strong> (~$2/hr) — about 17× Soniox. Charged to your OpenAI account.
    </div>
</fieldset>

<div id="openai-key-row" class="settings-row" hidden>
    <label for="openai-api-key">OpenAI API key</label>
    <input type="password" id="openai-api-key" placeholder="sk-..." autocomplete="off">
    <button type="button" class="toggle-visibility" data-target="openai-api-key">👁</button>
</div>
```

### 2. `app.js` — populate / save / toggle visibility

Add to `_populateSettingsForm()`:

```js
// Provider radios
const mode = settings.translation_mode || 'soniox';
document.querySelector(`input[name="translation-mode"][value="${mode}"]`).checked = true;

// OpenAI key
document.getElementById('openai-api-key').value = settings.openai_api_key || '';

this._updateProviderUI(mode);

// Listen for changes
document.querySelectorAll('input[name="translation-mode"]').forEach(r => {
    r.addEventListener('change', (e) => this._updateProviderUI(e.target.value));
});
```

Add helper:

```js
_updateProviderUI(mode) {
    document.getElementById('openai-cost-warning').hidden = mode !== 'openai';
    document.getElementById('openai-key-row').hidden = mode !== 'openai';

    // Two-way mode is incompatible with OpenAI in v1
    const twoWayRadio = document.querySelector('input[name="translation-type"][value="two_way"]');
    if (twoWayRadio) {
        twoWayRadio.disabled = (mode === 'openai');
        if (mode === 'openai' && twoWayRadio.checked) {
            document.querySelector('input[name="translation-type"][value="one_way"]').checked = true;
        }
    }

    // Target language list — restrict to 13 when OpenAI selected
    this._refreshTargetLangList(mode);

    // TTS provider — disable toggle when OpenAI (audio is built-in)
    const ttsToggle = document.getElementById('toggle-tts');
    if (ttsToggle) {
        ttsToggle.disabled = (mode === 'openai');
        if (mode === 'openai') ttsToggle.checked = false;
    }
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
        select.innerHTML = OPENAI_LANGS
            .map(([c,n]) => `<option value="${c}">${n}</option>`).join('');
        if (OPENAI_LANGS.some(([c]) => c === current)) select.value = current;
        else select.value = 'vi';
    } else {
        // Restore full Soniox list — call existing populate routine if present
        this._populateFullLangList(select);
        select.value = current || 'vi';
    }
}
```

Save side:

```js
_saveSettingsFromForm() {
    // ... existing ...
    const mode = document.querySelector('input[name="translation-mode"]:checked')?.value || 'soniox';
    settings.translation_mode = mode;
    settings.openai_api_key = document.getElementById('openai-api-key').value.trim();
    // ...
}
```

### 3. `app.js` — start() branch

Existing in `start()`:

```js
if (this.translationMode === 'local') {
    await this._startLocalMode();
} else {
    await this._startSonioxMode();
}
```

Replace with:

```js
switch (this.translationMode) {
    case 'local':   await this._startLocalMode(); break;
    case 'openai':  await this._startOpenAiMode(); break;
    default:        await this._startSonioxMode();
}
```

Add `_startOpenAiMode()` modeled on `_startSonioxMode()`:

```js
async _startOpenAiMode() {
    if (!this.settings.openai_api_key) {
        this._setStatus('error', 'OpenAI API key required');
        return;
    }

    // Lazy-init client + output queue once per session
    const { OpenAiRealtimeClient } = await import('./openai-realtime-client.js');
    const { OpenAiAudioOutputQueue } = await import('./openai-audio-output-queue.js');

    this.openAiOutputQueue = new OpenAiAudioOutputQueue();
    this.openAiClient = new OpenAiRealtimeClient();

    this.openAiClient.onStatusChange = (state, msg) => {
        if (state === 'ready') this._setStatus('listening');
        else if (state === 'connecting') this._setStatus('connecting');
    };
    this.openAiClient.onProvisional = (text) => this.ui.setProvisionalTranslation(text);
    this.openAiClient.onTranslation = (text) => {
        this.ui.addTranslation(text);
        // Note: NO _speakIfEnabled() — audio comes via output queue
    };
    this.openAiClient.onError = (code, msg) => {
        this._setStatus('error', `${code}: ${msg}`);
    };
    this.openAiClient.onClosed = (reason) => {
        if (reason === 'user_stop') return;
        // Auto-reconnect on 1006 / 60-min limit
        console.warn('[OpenAI] closed:', reason, '— auto-reconnect in 1s');
        setTimeout(() => this._startOpenAiMode(), 1000);
    };

    await this.openAiClient.connect({
        apiKey: this.settings.openai_api_key,
        sourceLanguage: this.settings.source_language || 'auto',
        targetLanguage: this.settings.target_language,
    }, this.openAiOutputQueue);

    // Hook audio capture: same channel, but route to OpenAI client
    const channel = new window.__TAURI__.core.Channel();
    channel.onmessage = (pcmData) => {
        const buf = new Uint8Array(pcmData).buffer;
        this.openAiClient.sendAudio(buf);
    };
    await window.__TAURI__.core.invoke('start_capture', {
        source: this.audioSource,
        channel,
    });
}
```

Add corresponding stop logic in `stop()`:

```js
if (this.openAiClient) {
    await this.openAiClient.disconnect();
    this.openAiClient = null;
}
if (this.openAiOutputQueue) {
    this.openAiOutputQueue.close();
    this.openAiOutputQueue = null;
}
```

### 4. CSS — cost warning callout

In `src/css/styles.css`:

```css
.cost-warning {
    margin-top: 0.5rem;
    padding: 0.6rem 0.8rem;
    background: #fff8e1;
    border-left: 3px solid #f5a623;
    border-radius: 4px;
    font-size: 0.85rem;
    color: #5b4400;
}
.cost-warning strong { color: #c47800; }

.new-badge {
    display: inline-block;
    margin-left: 0.3rem;
    padding: 1px 5px;
    background: #4caf50;
    color: white;
    font-size: 0.65rem;
    font-weight: bold;
    border-radius: 3px;
    vertical-align: middle;
}
```

## Todo list

- [ ] HTML: provider radio group + OpenAI key row + cost warning
- [ ] CSS: `.cost-warning`, `.new-badge`, `.provider-option` styles
- [ ] `_populateSettingsForm`: load mode + key, attach radio change listener
- [ ] `_saveSettingsFromForm`: persist mode + key
- [ ] `_updateProviderUI`: gate two-way, TTS toggle, target lang list
- [ ] `_refreshTargetLangList`: switch between Soniox full list and OpenAI 13
- [ ] Replace if/else with switch in `start()`
- [ ] Implement `_startOpenAiMode()`
- [ ] Update `stop()` to clean up OpenAI client + queue
- [ ] Smoke test: pick OpenAI in Settings, save, restart, hit Start with valid key

## Success criteria

- Picking "OpenAI Realtime" in Settings shows the cost warning + key input.
- Saving with empty key blocks Start with clear error.
- With valid key, Start triggers connection; transcript view shows translated text live; speakers play translated audio.
- Switching back to Soniox restores full language list and re-enables TTS toggle / two-way mode.
- No console errors during provider switch.

## Risks

- **Existing populate-language-list function name unknown** — may need to grep for it (likely `_populateLangSelect` or similar) and refactor minimally to take a select element + mode.
- **TTS toggle id `toggle-tts`** — verify against current HTML; adjust selector if different.
- **Audio capture command name `start_capture`** — verify against `commands/audio.rs`. Same channel pattern as Soniox today.

## Next steps

→ Phase 5: end-to-end test, docs, changelog, version bump.
