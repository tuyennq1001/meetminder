import {readFile, readdir} from 'node:fs/promises';
import {join, relative} from 'node:path';

const maxLinesForNewFile = 500;
const baselinePath = 'scripts/quality-baseline/js-lines.json';
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const sourceRoots = ['src/js', 'scripts'];
const excludedDirectories = new Set(['vendor', 'node_modules', 'quality-baseline']);
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

function countLines(source) {
    const lines = source.split(/\r?\n/);
    if (lines.at(-1) === '') {
        lines.pop();
    }
    return lines.length;
}

for (const root of sourceRoots) {
    await collectJavaScriptFiles(root);
}

const violations = [];
for (const path of files.sort()) {
    const lineCount = countLines(await readFile(path, 'utf8'));
    const relativePath = relative('.', path);
    const baselineLineCount = baseline[relativePath];

    if (baselineLineCount === undefined && lineCount > maxLinesForNewFile) {
        violations.push(`${relativePath}: ${lineCount} lines; new files must stay at or below ${maxLinesForNewFile}.`);
    } else if (baselineLineCount !== undefined && lineCount > baselineLineCount) {
        violations.push(`${relativePath}: ${lineCount} lines; legacy baseline is ${baselineLineCount}, so existing files may not grow.`);
    }
}

if (violations.length > 0) {
    process.stderr.write(`Code-size check failed:\n${violations.map((violation) => `- ${violation}`).join('\n')}\n`);
    process.exitCode = 1;
} else {
    process.stdout.write(`Code-size check passed for ${files.length} JavaScript files (new-file limit: ${maxLinesForNewFile} lines).\n`);
}
