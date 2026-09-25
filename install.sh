#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="tuyennq1001/meetminder"
APP_NAME="Meet Minder"

fail() {
  printf 'Meet Minder installer: %s\n' "$1" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "This installer supports macOS only."

case "$(uname -m)" in
  arm64) RELEASE_ARCH="aarch64" ;;
  x86_64) RELEASE_ARCH="x64" ;;
  *) fail "Unsupported Mac architecture: $(uname -m)" ;;
esac

for dependency in curl sed hdiutil ditto; do
  command -v "$dependency" >/dev/null 2>&1 || fail "Required macOS tool not found: $dependency"
done

printf 'Finding the latest Meet Minder release for %s...\n' "$RELEASE_ARCH"
LATEST_RELEASE_URL="$(curl --fail --silent --show-error --location --output /dev/null \
  --write-out '%{url_effective}' "https://github.com/${REPOSITORY}/releases/latest")" \
  || fail "Could not reach GitHub Releases."
RELEASE_TAG="$(printf '%s' "$LATEST_RELEASE_URL" | sed -E 's#^.*/tag/([^/?]+).*$#\1#')"
[[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || fail "Could not determine the latest published version."

DMG_NAME="Meet.Minder_${RELEASE_TAG#v}_${RELEASE_ARCH}.dmg"
DMG_URL="https://github.com/${REPOSITORY}/releases/download/${RELEASE_TAG}/${DMG_NAME}"

TEMP_DIR="$(mktemp -d)"
MOUNT_DIR="${TEMP_DIR}/mounted"
mkdir -p "$MOUNT_DIR"

cleanup() {
  hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

DMG_PATH="${TEMP_DIR}/Meet-Minder.dmg"
printf 'Downloading Meet Minder...\n'
curl --fail --silent --show-error --location "$DMG_URL" --output "$DMG_PATH" \
  || fail "Could not download the installer."

hdiutil attach "$DMG_PATH" -nobrowse -readonly -mountpoint "$MOUNT_DIR" -quiet \
  || fail "Could not open the downloaded DMG."

APP_SOURCE="${MOUNT_DIR}/${APP_NAME}.app"
[[ -d "$APP_SOURCE" ]] || fail "The DMG does not contain ${APP_NAME}.app."

INSTALL_PATH="/Applications/${APP_NAME}.app"
printf 'Installing to /Applications...\n'
if [[ -w /Applications ]]; then
  ditto "$APP_SOURCE" "$INSTALL_PATH"
else
  sudo ditto "$APP_SOURCE" "$INSTALL_PATH"
fi

printf 'Opening Meet Minder...\n'
open "$INSTALL_PATH"
printf 'Meet Minder is installed in /Applications.\n'
