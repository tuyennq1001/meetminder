/**
 * Auto-updater module for Tauri v2
 * Uses invoke() directly — no bundler, no npm imports needed
 */

class Updater {
    constructor() {
        this.updateAvailable = null;
        this._updateData = null;
        this.onUpdateFound = null; // callback(version, notes)
        this.onCheckComplete = null; // callback(hasUpdate)
        this.onError = null; // callback(error)
    }

    /**
     * Get the invoke function from Tauri globals
     */
    _invoke() {
        return window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
    }

    /**
     * Check for updates using Tauri invoke
     */
    async checkForUpdates() {
        const invoke = this._invoke();
        if (!invoke) {
            console.log('[Updater] Skipped — Tauri invoke not available');
            console.log('[Updater] __TAURI__ keys:', Object.keys(window.__TAURI__ || {}));
            console.log('[Updater] __TAURI__.core keys:', Object.keys(window.__TAURI__?.core || {}));
            if (this.onCheckComplete) this.onCheckComplete(false);
            return;
        }

        try {
            console.log('[Updater] Checking for updates via invoke...');
            const result = await invoke('plugin:updater|check');
            console.log('[Updater] Check result:', JSON.stringify(result));

            if (result && result.available) {
                const version = result.version || 'unknown';
                const notes = result.body || '';
                console.log(`[Updater] Update found: v${version}`);

                this.updateAvailable = true;
                this._updateData = result;

                if (this.onUpdateFound) {
                    this.onUpdateFound(version, notes);
                }
                if (this.onCheckComplete) this.onCheckComplete(true);
            } else {
                console.log('[Updater] App is up to date');
                if (this.onCheckComplete) this.onCheckComplete(false);
            }
        } catch (err) {
            console.warn('[Updater] Check failed:', err.message || err, err);
            if (this.onError) this.onError(err);
            if (this.onCheckComplete) this.onCheckComplete(false);
        }
    }

    /**
     * Download and install pending update
     * @param {Function} onProgress - callback(downloaded, total)
     */
    async downloadAndInstall(onProgress) {
        const invoke = this._invoke();
        if (!invoke || !this.updateAvailable) {
            console.log('[Updater] Cannot install — no update or no invoke');
            return;
        }

        try {
            console.log('[Updater] Starting download and install...');

            // Create a channel for progress events if available
            let channelId = null;
            if (window.__TAURI__?.core?.Channel) {
                const channel = new window.__TAURI__.core.Channel();
                channel.onmessage = (event) => {
                    console.log('[Updater] Progress event:', event);
                    if (event.event === 'Started') {
                        const total = event.data?.contentLength || 0;
                        console.log(`[Updater] Downloading ${total} bytes...`);
                    } else if (event.event === 'Progress') {
                        // Track progress
                    } else if (event.event === 'Finished') {
                        console.log('[Updater] Download complete');
                    }
                };
                channelId = channel.id;
                await invoke('plugin:updater|download_and_install', {
                    onEvent: channel
                });
            } else {
                // Fallback: just invoke without progress
                await invoke('plugin:updater|download_and_install');
            }

            console.log('[Updater] Update installed, restarting...');
        } catch (err) {
            console.error('[Updater] Install failed:', err);
            throw err;
        }
    }
}

export const updater = new Updater();
