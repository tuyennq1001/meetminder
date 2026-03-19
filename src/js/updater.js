/**
 * Auto-updater module
 * Checks for updates on app launch using Tauri updater plugin
 */

let check, relaunch;

try {
    // Dynamic import — only works in Tauri context
    const updaterModule = await import('@tauri-apps/plugin-updater');
    check = updaterModule.check;
    // relaunch via Tauri process API
    const processModule = await import('@tauri-apps/api/core');
    relaunch = processModule.relaunch;
} catch (e) {
    console.log('[Updater] Plugin not available (dev mode?)');
}

class Updater {
    constructor() {
        this.updateAvailable = null;
        this.onUpdateFound = null; // callback(version, notes)
    }

    /**
     * Check for updates silently on app launch
     * Shows a non-intrusive notification if update found
     */
    async checkForUpdates() {
        if (!check) {
            console.log('[Updater] Skipped — plugin not loaded');
            return;
        }

        try {
            console.log('[Updater] Checking for updates...');
            const update = await check();

            if (update) {
                console.log(`[Updater] Update found: v${update.version}`);
                this.updateAvailable = update;

                if (this.onUpdateFound) {
                    this.onUpdateFound(update.version, update.body || '');
                }
            } else {
                console.log('[Updater] App is up to date');
            }
        } catch (err) {
            // Silently fail — don't interrupt user
            console.warn('[Updater] Check failed:', err.message || err);
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
            // App will restart automatically after install
        } catch (err) {
            console.error('[Updater] Install failed:', err);
            throw err;
        }
    }
}

export const updater = new Updater();
