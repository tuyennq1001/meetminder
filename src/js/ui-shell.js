/**
 * UI Shell — activity-first navigation for the main overlay window.
 *
 * Owns WHICH activity panel (live | read | library) is visible and the
 * top-bar switcher state. Side effects of entering/leaving an activity
 * (pausing the live session, draining TTS, rendering the session list)
 * stay in app.js, which listens for the `activity-changed` CustomEvent
 * dispatched from here.
 */

import { t } from './i18n.js';

const ACTIVITIES = ['live', 'library'];

let currentActivity = 'live';

export function getActivity() {
    return currentActivity;
}

export function setActivity(id) {
    if (!ACTIVITIES.includes(id) || id === currentActivity) return;
    const previous = currentActivity;
    currentActivity = id;

    document.querySelectorAll('.activity-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.activity === id);
    });
    document.querySelectorAll('.activity-panel').forEach((p) => {
        p.classList.toggle('active', p.dataset.activity === id);
    });
    // Body class lets CSS adapt shared chrome (e.g. hide floating controls
    // outside Live) without JS touching each element.
    ACTIVITIES.forEach((a) => document.body.classList.toggle(`activity-${a}`, a === id));

    document.dispatchEvent(new CustomEvent('activity-changed', {
        detail: { activity: id, previous },
    }));
}

/** Dynamic status badge on Live tab: 'waiting' (orange blink) | 'listening' (green pulse) | 'error' (red) */
export function setLiveBadge(status) {
    const badge = document.getElementById('live-tab-badge');
    if (!badge) return;
    badge.className = 'live-tab-badge';
    if (status === 'connected' || status === 'listening' || status === true) {
        badge.classList.add('state-listening');
    } else if (status === 'error') {
        badge.classList.add('state-error');
    } else {
        badge.classList.add('state-waiting');
    }
}

export function initShell() {
    document.querySelectorAll('.activity-tab').forEach((btn) => {
        btn.addEventListener('click', () => setActivity(btn.dataset.activity));
    });
    document.body.classList.add('activity-live');
    setLiveBadge('waiting');
}

/**
 * Wire a trigger button to a dropdown/menu element: click toggles, click
 * outside or Esc closes. Returns { close } so callers can close programmatically.
 */
export function bindMenu(triggerId, menuId) {
    const trigger = document.getElementById(triggerId);
    const menu = document.getElementById(menuId);
    if (!trigger || !menu) return { close: () => {} };

    const close = () => { menu.style.display = 'none'; };
    const isOpen = () => menu.style.display !== 'none';

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.style.display = isOpen() ? 'none' : '';
    });
    document.addEventListener('click', (e) => {
        if (isOpen() && !menu.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) close();
    });
    return { close };
}



/* ── Window modes: overlay (small, floating) ↔ expanded (comfortable) ──
 * Sizes persist per-mode in localStorage (same store the app already uses
 * for window_state), so no backend settings round-trip is needed. */

const EXPANDED_DEFAULT = { w: 900, h: 640 };

let appWindowRef = null;
let windowMode = 'overlay';
let applyingMode = false; // guard: programmatic setSize must not overwrite saved sizes
let resizeSaveTimer = null;

export function getWindowMode() {
    return windowMode;
}

async function currentLogicalSize() {
    const factor = await appWindowRef.scaleFactor();
    const size = await appWindowRef.innerSize();
    return { w: Math.round(size.width / factor), h: Math.round(size.height / factor) };
}

async function saveSizeForMode(mode) {
    try {
        localStorage.setItem(`win_size_${mode}`, JSON.stringify(await currentLogicalSize()));
    } catch { /* size save is best-effort */ }
}

export async function applyWindowMode(mode) {
    if (!appWindowRef || (mode !== 'overlay' && mode !== 'expanded')) return;
    const { LogicalSize } = window.__TAURI__.window;

    if (mode !== windowMode) await saveSizeForMode(windowMode); // remember size we leave behind
    windowMode = mode;
    localStorage.setItem('window_mode', mode);
    document.body.classList.toggle('expanded', mode === 'expanded');

    let target = null;
    try { target = JSON.parse(localStorage.getItem(`win_size_${mode}`) || 'null'); } catch { }
    if (!target && mode === 'expanded') target = EXPANDED_DEFAULT;
    if (target) {
        applyingMode = true;
        try { await appWindowRef.setSize(new LogicalSize(target.w, target.h)); } catch { }
        applyingMode = false;
    }
    const btn = document.getElementById('btn-window-mode');
    if (btn) btn.title = mode === 'expanded' ? t('window.collapseOverlay') : t('window.expandWindow');
}

export async function toggleWindowMode() {
    await applyWindowMode(windowMode === 'expanded' ? 'overlay' : 'expanded');
}

export async function initWindowModes(appWindow) {
    appWindowRef = appWindow;
    document.getElementById('btn-window-mode')?.addEventListener('click', () => toggleWindowMode());

    // User resizes update the remembered size of the CURRENT mode (debounced).
    try {
        await appWindow.onResized(() => {
            if (applyingMode) return;
            clearTimeout(resizeSaveTimer);
            resizeSaveTimer = setTimeout(() => saveSizeForMode(windowMode), 500);
        });
    } catch { /* onResized unavailable — sizes just won't persist */ }

    const saved = localStorage.getItem('window_mode');
    if (saved === 'expanded') await applyWindowMode('expanded');
}
