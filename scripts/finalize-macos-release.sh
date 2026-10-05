#!/usr/bin/env bash
set -euo pipefail

bundle_dir="${1:?Usage: finalize-macos-release.sh <bundle-directory>}"
signing_identity="${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY is required}"
expected_team="${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"

shopt -s nullglob
apps=("$bundle_dir"/macos/*.app)
dmgs=("$bundle_dir"/dmg/*.dmg)
if [ "${#apps[@]}" -ne 1 ] || [ "${#dmgs[@]}" -ne 1 ]; then
  echo "::error::Expected exactly one app bundle and one DMG in $bundle_dir."
  exit 1
fi

app_path="${apps[0]}"
dmg_path="${dmgs[0]}"
app_name="$(basename "$app_path")"
archive_path="$app_path.tar.gz"

# Tauri creates both release archives during bundling. Re-sign the final app
# after bundling, then regenerate every artifact that contains that app.
codesign \
  --deep \
  --force \
  --options runtime \
  --entitlements "$repo_root/src-tauri/Entitlements.plist" \
  --sign "$signing_identity" \
  --timestamp \
  "$app_path"
codesign --verify --deep --strict --verbose=2 "$app_path"

actual_team="$(codesign -dv --verbose=4 "$app_path" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
if [ "$actual_team" != "$expected_team" ]; then
  echo "::error::Signed app TeamIdentifier '$actual_team' does not match expected team '$expected_team'."
  exit 1
fi

rm -f "$archive_path" "$archive_path.sig"
tar -czf "$archive_path" -C "$(dirname "$app_path")" "$app_name"
npm run tauri -- signer sign "$archive_path"

dmg_root="$(mktemp -d)"
trap 'rm -rf "$dmg_root"' EXIT
ditto "$app_path" "$dmg_root/$app_name"
ln -s /Applications "$dmg_root/Applications"
rm -f "$dmg_path"
hdiutil create \
  -volname "${app_name%.app}" \
  -srcfolder "$dmg_root" \
  -ov \
  -format UDZO \
  "$dmg_path"
