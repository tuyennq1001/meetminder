import assert from 'node:assert/strict';
import test from 'node:test';

import { Updater } from './updater.js';

test('a repeated check keeps the update resource that owns the downloaded package', async () => {
    const updater = new Updater();
    let installed = false;
    let duplicateClosed = false;
    const downloadedUpdate = {
        version: '1.2.3',
        async download() {},
        async install() { installed = true; },
    };
    const duplicateUpdate = {
        version: '1.2.3',
        async close() { duplicateClosed = true; },
    };

    updater.updateAvailable = downloadedUpdate;
    await updater.download();
    await updater._checkViaPlugin(async () => duplicateUpdate);
    await updater.install();

    assert.equal(updater.updateAvailable, downloadedUpdate);
    assert.equal(duplicateClosed, true);
    assert.equal(installed, true);
});

test('a newly found version clears downloaded state from the previous update', async () => {
    const updater = new Updater();
    let previousClosed = false;
    updater.updateAvailable = {
        version: '1.2.3',
        async close() { previousClosed = true; },
    };
    updater.updateDownloaded = true;

    const nextUpdate = { version: '1.2.4' };
    await updater._checkViaPlugin(async () => nextUpdate);

    assert.equal(previousClosed, true);
    assert.equal(updater.updateAvailable, nextUpdate);
    assert.equal(updater.updateDownloaded, false);
});

test('a repeated check during download keeps the resource being downloaded', async () => {
    const updater = new Updater();
    let markDownloadStarted;
    let finishDownload;
    let duplicateClosed = false;
    const downloadStarted = new Promise((resolve) => { markDownloadStarted = resolve; });
    const downloadGate = new Promise((resolve) => { finishDownload = resolve; });
    const downloadingUpdate = {
        version: '1.2.3',
        async download() {
            markDownloadStarted();
            await downloadGate;
        },
    };
    updater.updateAvailable = downloadingUpdate;

    const downloadPromise = updater.download();
    await downloadStarted;
    const duplicateUpdate = {
        version: '1.2.3',
        async close() { duplicateClosed = true; },
    };
    await updater._checkViaPlugin(async () => duplicateUpdate);
    finishDownload();
    await downloadPromise;

    assert.equal(updater.updateAvailable, downloadingUpdate);
    assert.equal(duplicateClosed, true);
    assert.equal(updater.updateDownloaded, true);
});
