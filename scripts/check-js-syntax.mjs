import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

const sourceRoots = ['src/js', 'scripts'];
const excludedDirectories = new Set(['vendor', 'node_modules']);
const files = [];

async function collectJavaScriptFiles(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
            if (!excludedDirectories.has(entry.name)) {
                await collectJavaScriptFiles(path);
            }
            continue;
        }

        if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) {
            files.push(path);
        }
    }
}

for (const root of sourceRoots) {
    await collectJavaScriptFiles(root);
}

let failed = false;
for (const file of files.sort()) {
    const result = spawnSync(process.execPath, ['--check', file], {stdio: 'inherit'});
    if (result.status !== 0) {
        failed = true;
    }
}

if (failed) {
    process.exitCode = 1;
} else {
    process.stdout.write(`JavaScript syntax passed for ${files.length} files.\n`);
}
