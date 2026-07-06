#!/usr/bin/env node
/**
 * Run the Tauri CLI with an optional bundle-identifier override from `.env`.
 *
 * If the repo-root `.env` defines `APP_IDENTIFIER`, it is injected via
 * `--config {"identifier": "..."}` so the dev build can use a distinct id
 * (e.g. `com.personal.translator.dev`). This gives the dev build its OWN macOS
 * Screen-Recording / Microphone permission entry, leaving the installed stable
 * app's permissions untouched. When `.env` has no `APP_IDENTIFIER`, the default
 * identifier from `tauri.conf.json` is used unchanged.
 *
 * Usage: node scripts/tauri-with-env.mjs <dev|build> [extra tauri args...]
 */
import { run } from '@tauri-apps/cli';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Read a single key from repo-root `.env`; returns undefined if absent. */
function readEnvValue(key) {
  try {
    const content = readFileSync(join(repoRoot, '.env'), 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      if (trimmed.slice(0, eq).trim() !== key) continue;
      return trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
  } catch {
    // no .env — fall through to default
  }
  return undefined;
}

const args = process.argv.slice(2);
const identifier = process.env.APP_IDENTIFIER || readEnvValue('APP_IDENTIFIER');

/** Read a top-level string field from src-tauri/tauri.conf.json. */
function readConfValue(key) {
  try {
    const conf = JSON.parse(readFileSync(join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    return conf[key];
  } catch {
    return undefined;
  }
}

if (identifier) {
  // Dev override: distinct id + " Dev" product name + ad-hoc signing ("-"). Ad-hoc lets a
  // local `build:dev` succeed without the production Developer ID cert in the keychain, and
  // the " Dev" name makes the app distinct in Finder and the macOS permission lists. The
  // release path (`npm run build` / `npm run tauri build`) does NOT use this wrapper, so it
  // keeps the real identifier, product name, and Developer ID identity from tauri.conf.json.
  const baseName = readConfValue('productName') || 'MyTranslator';
  const devName = baseName.endsWith(' Dev') ? baseName : `${baseName} Dev`;
  // Signing identity: ad-hoc "-" by default. Ad-hoc changes on every rebuild, so macOS
  // Screen-Recording permission does NOT persist across rebuilds. Set APP_SIGNING_IDENTITY
  // in .env to a STABLE cert name (e.g. a self-signed "MyTranslator Dev" cert) to make the
  // permission stick across rebuilds.
  const signingIdentity =
    process.env.APP_SIGNING_IDENTITY || readEnvValue('APP_SIGNING_IDENTITY') || '-';
  const override = {
    identifier,
    productName: devName,
    bundle: { macOS: { signingIdentity } },
  };
  args.push('--config', JSON.stringify(override));
  // Enable the WebView inspector (DevTools) so JS/console errors are visible in the dev app.
  if (!args.includes('--features')) {
    args.push('--features', 'devtools');
  }
  // A local dev build only needs the runnable .app — skip the .dmg (distribution-only, and
  // bundle_dmg.sh needs a full signing/mount setup). Only meaningful for `build`.
  if (args[0] === 'build' && !args.includes('--bundles')) {
    args.push('--bundles', 'app');
  }
  const signLabel = signingIdentity === '-' ? 'ad-hoc ("-")' : `"${signingIdentity}"`;
  console.log(`[tauri-with-env] override: identifier=${identifier}, productName="${devName}", signing=${signLabel}, devtools=on`);
} else {
  console.log('[tauri-with-env] no APP_IDENTIFIER — using default identifier + name + signing from tauri.conf.json');
}

run(args, 'tauri').catch((err) => {
  console.error(err);
  process.exit(1);
});
