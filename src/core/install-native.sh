#!/bin/sh
set -eu
root=$(CDPATH='' cd "$(dirname "$0")/../.." && pwd -P)
case "$(uname -s):$(uname -m)" in
  Darwin:arm64) platform=darwin-arm64 ;;
  Linux:x86_64) platform=linux-x64 ;;
  *) echo "No compiled build for this platform. Run the npm commands with Bun." >&2; exit 1 ;;
esac
version=$(bun -p 'require(process.argv[1]).version' "$root/package.json")
asset=checks-$platform
url=https://github.com/avi2d/checks/releases/download/v$version
mkdir -p "$root/native"
stage=$(mktemp -d "$root/native/.download.XXXXXXXX")
trap 'rm -rf "$stage"' EXIT
curl --fail --silent --show-error --location "$url/$asset" --output "$stage/$asset"
curl --fail --silent --show-error --location "$url/$asset.sha256" --output "$stage/$asset.sha256"
digest=$(bun -p 'new Bun.CryptoHasher("sha256").update(await Bun.file(process.argv[1]).arrayBuffer()).digest("hex")' "$stage/$asset")
printf '%s  %s\n' "$digest" "$asset" | cmp - "$stage/$asset.sha256"
chmod 755 "$stage/$asset"
mv -f "$stage/$asset" "$root/native/checks-$version-$platform"
