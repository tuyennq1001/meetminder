#!/usr/bin/env node
/**
 * Run the Tauri CLI with an optional bundle-identifier override from `.env`.
 *
 * If the repo-root `.env` defines `APP_IDENTIFIER`, it is injected via
 * `--config {"identifier": "..."}` so the dev build can use a distinct id
 * (e.g. `com.meetminder.desktop.dev`). This gives the dev build its OWN macOS
 * Screen-Recording / Microphone permission entry, leaving the installed stable
 * app's permissions untouched. When `.env` has no `APP_IDENTIFIER`, the default
 * identifier from `tauri.conf.json` is used unchanged.
 *
 * Usage: node scripts/tauri-with-env.mjs <dev|build> [extra tauri args...]
 */
import { run } from '@tauri-apps/cli';
import { execFileSync } from 'node:child_process';
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
  // Dev override: distinct id + " Dev" product name + a stable signing identity. The
  // release path (`npm run build` / `npm run tauri build`) does NOT use this wrapper, so it
  // keeps the real identifier, product name, and Developer ID identity from tauri.conf.json.
  const baseName = readConfValue('productName') || 'Meet Minder';
  const devName = baseName.endsWith(' Dev') ? baseName : `${baseName} Dev`;
  // Ad-hoc signatures change on every rebuild, which makes macOS Screen-Recording and
  // Microphone permissions expire. Require an explicit stable certificate instead of
  // silently falling back to ad-hoc signing and creating a permission-reset trap.
  const signingIdentity = process.env.APP_SIGNING_IDENTITY || readEnvValue('APP_SIGNING_IDENTITY');
  if (!signingIdentity) {
    throw new Error(
      '[tauri-with-env] APP_SIGNING_IDENTITY is required for Dev builds. ' +
      'Configure a stable macOS code-signing certificate in .env (for example: Meet Minder Dev).'
    );
  }
  const manualDevSigning = args[0] === 'build';
  const override = {
    identifier,
    productName: devName,
    // Tauri's identity discovery does not find the local macOS identity in this
    // environment, although codesign can use it. Disable Tauri's signing for the
    // Dev bundle and sign the completed app explicitly below.
    bundle: { macOS: { signingIdentity: manualDevSigning ? null : signingIdentity } },
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
  console.log(`[tauri-with-env] override: identifier=${identifier}, productName="${devName}", signing="${signingIdentity}", devtools=on`);

  if (manualDevSigning) {
    // Keep the Dev identity stable across rebuilds so macOS permissions do not
    // reset like they do with ad-hoc signatures.
    const devBundle = join(repoRoot, 'src-tauri', 'target', 'release', 'bundle', 'macos', `${devName}.app`);
    const entitlements = join(repoRoot, 'src-tauri', 'Entitlements.plist');
    const signDevBundle = () => {
      execFileSync('/usr/bin/codesign', [
        '--deep',
        '--force',
        '--options',
        'runtime',
        '--entitlements',
        entitlements,
        '--sign',
        signingIdentity,
        '--verbose',
        devBundle,
      ], { stdio: 'inherit' });
      execFileSync('/usr/bin/codesign', [
        '--verify',
        '--deep',
        '--strict',
        '--verbose=2',
        devBundle,
      ], { stdio: 'inherit' });
      console.log(`[tauri-with-env] manually signed Dev bundle with "${signingIdentity}"`);
    };
    run(args, 'tauri').then(signDevBundle).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else {
    run(args, 'tauri').catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
} else {
  console.log('[tauri-with-env] no APP_IDENTIFIER — using default identifier + name + signing from tauri.conf.json');
  run(args, 'tauri').catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
