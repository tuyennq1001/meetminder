/**
 * Auto-updater module for Tauri v2
 * Tries multiple access patterns: plugin API, then invoke fallback
 */

class Updater {
    constructor() {
        this.updateAvailable = null;
        this.onUpdateFound = null; // callback(version, notes)
        this.onCheckComplete = null; // callback(hasUpdate)
        this.onError = null; // callback(error)
    }

    /**
     * Check for updates - try plugin API first, then invoke
     */
    async checkForUpdates() {
        // Method 1: Plugin API (this worked in the original toast version)
        const check = window.__TAURI__?.updater?.check;
        if (check) {
            console.log('[Updater] Using plugin API (window.__TAURI__.updater.check)');
            return this._checkViaPlugin(check);
        }

        // Method 2: Invoke
        const invoke = window.__TAURI__?.core?.invoke;
        if (invoke) {
            console.log('[Updater] Using invoke fallback');
            return this._checkViaInvoke(invoke);
        }

        // Debug: log what's available
        console.log('[Updater] No updater API found!');
        console.log('[Updater] __TAURI__ keys:', Object.keys(window.__TAURI__ || {}));
        if (window.__TAURI__) {
            for (const [k, v] of Object.entries(window.__TAURI__)) {
                console.log(`[Updater]   __TAURI__.${k}:`, typeof v, v ? Object.keys(v) : 'null');
            }
        }
        if (this.onCheckComplete) this.onCheckComplete(false);
    }

    async _checkViaPlugin(check) {
        try {
            console.log('[Updater] Checking for updates via plugin API...');
            const update = await check();

            if (update) {
                console.log(`[Updater] Update found: v${update.version}`);
                this.updateAvailable = update;
                if (this.onUpdateFound) {
                    this.onUpdateFound(update.version, update.body || '');
                }
                if (this.onCheckComplete) this.onCheckComplete(true);
            } else {
                console.log('[Updater] App is up to date');
                if (this.onCheckComplete) this.onCheckComplete(false);
            }
        } catch (err) {
            console.warn('[Updater] Plugin check failed:', err.message || err);
            if (this.onError) this.onError(err);
            if (this.onCheckComplete) this.onCheckComplete(false);
        }
    }

    async _checkViaInvoke(invoke) {
        try {
            console.log('[Updater] Checking for updates via invoke...');
            const result = await invoke('plugin:updater|check');
            console.log('[Updater] invoke result:', JSON.stringify(result));

            if (result && result.available) {
                console.log(`[Updater] Update found: v${result.version}`);
                this.updateAvailable = result;
                if (this.onUpdateFound) {
                    this.onUpdateFound(result.version, result.body || '');
                }
                if (this.onCheckComplete) this.onCheckComplete(true);
            } else {
                console.log('[Updater] App is up to date');
                if (this.onCheckComplete) this.onCheckComplete(false);
            }
        } catch (err) {
            console.warn('[Updater] invoke check failed:', err.message || err);
            if (this.onError) this.onError(err);
            if (this.onCheckComplete) this.onCheckComplete(false);
        }
    }

    /**
     * Download and install pending update
     * @param {Function} onProgress - callback(downloaded, total)
     */
    async downloadAndInstall(onProgress) {
        if (!this.updateAvailable) return;

        try {
            // If updateAvailable is the plugin update object (has downloadAndInstall method)
            if (typeof this.updateAvailable.downloadAndInstall === 'function') {
                let downloaded = 0;
                let contentLength = 0;

                await this.updateAvailable.downloadAndInstall((event) => {
                    switch (event.event) {
                        case 'Started':
                            contentLength = event.data.contentLength || 0;
                            console.log(`[Updater] Downloading ${contentLength} bytes...`);
                            break;
                        case 'Progress':
                            downloaded += event.data.chunkLength;
                            if (onProgress) onProgress(downloaded, contentLength);
                            break;
                        case 'Finished':
                            console.log('[Updater] Download complete');
                            break;
                    }
                });
            } else {
                // Invoke fallback
                const invoke = window.__TAURI__?.core?.invoke;
                if (invoke) {
                    await invoke('plugin:updater|download_and_install');
                }
            }

            console.log('[Updater] Update installed, restarting...');
        } catch (err) {
            console.error('[Updater] Install failed:', err);
            throw err;
        }
    }
}

export const updater = new Updater();
