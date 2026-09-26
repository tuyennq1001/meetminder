#!/usr/bin/env bash
# Build signed + notarized macOS DMG.
#
# Prerequisites:
#   1. Developer ID Application cert installed in the login keychain.
#   2. APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID
#      configured in the ignored .env file or exported in the environment.
#
# Usage:  ./scripts/build-notarized.sh
#
# Reads the app-specific password from your terminal env. If not set, prompts.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Load secrets from .env (gitignored). Format:
#   APPLE_PASSWORD=xxxx-xxxx-xxxx-xxxx
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

for name in APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name is required for a signed and notarized build." >&2
    exit 1
  fi
done

if [[ "$APPLE_SIGNING_IDENTITY" != Developer\ ID\ Application:* ]]; then
  echo "ERROR: APPLE_SIGNING_IDENTITY must be a Developer ID Application identity." >&2
  exit 1
fi

if ! security find-identity -v -p codesigning 2>/dev/null | grep -Fq -- "$APPLE_SIGNING_IDENTITY"; then
  echo "ERROR: The configured Developer ID Application identity is not installed in the Keychain." >&2
  echo "Import the Developer ID .p12 certificate, then retry." >&2
  exit 1
fi

export APPLE_ID APPLE_TEAM_ID APPLE_PASSWORD

echo "Building and notarizing the macOS distribution..."
echo "  APPLE_ID=$APPLE_ID"
echo "  APPLE_TEAM_ID=$APPLE_TEAM_ID"
echo "  APPLE_PASSWORD=*** (${#APPLE_PASSWORD} chars)"
echo

npm run tauri build -- --config src-tauri/tauri.release.conf.json --config "{\"bundle\":{\"macOS\":{\"signingIdentity\":\"${APPLE_SIGNING_IDENTITY}\"}}}"

DMG_PATH="$REPO_ROOT/src-tauri/target/release/bundle/dmg"
shopt -s nullglob
DMGS=("$DMG_PATH"/*.dmg)
if [[ ${#DMGS[@]} -eq 0 ]]; then
  echo "ERROR: Tauri did not produce a DMG in $DMG_PATH" >&2
  exit 1
fi
for dmg in "${DMGS[@]}"; do
  xcrun stapler validate "$dmg"
  spctl --assess --type open --context context:primary-signature --verbose "$dmg"
done
