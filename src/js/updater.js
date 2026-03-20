/**
 * Auto-updater module
 * Checks for updates on app launch using Tauri updater plugin
 * Uses window.__TAURI__ globals (no bundler needed)
 */

class Updater {
    constructor() {
        this.updateAvailable = null;
        this.onUpdateFound = null; // callback(version, notes)
        this.onCheckComplete = null; // callback(hasUpdate)
        this.onError = null; // callback(error)
    }

    /**
     * Check for updates
     */
    async checkForUpdates() {
        try {
            // Try multiple access patterns for the updater
            let check = null;

            if (window.__TAURI__?.updater?.check) {
                check = window.__TAURI__.updater.check;
            } else if (window.__TAURI_INTERNALS__?.plugins?.updater?.check) {
                check = window.__TAURI_INTERNALS__.plugins.updater.check;
            }

            if (!check) {
                console.log('[Updater] Skipped — plugin not available');
                console.log('[Updater] __TAURI__ keys:', Object.keys(window.__TAURI__ || {}));
                if (this.onCheckComplete) this.onCheckComplete(false);
                return;
            }

            console.log('[Updater] Checking for updates...');
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
            console.warn('[Updater] Check failed:', err.message || err);
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

            console.log('[Updater] Update installed, restarting...');
        } catch (err) {
            console.error('[Updater] Install failed:', err);
            throw err;
        }
    }
}

export const updater = new Updater();
