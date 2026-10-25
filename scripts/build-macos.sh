#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.cargo/bin:$PATH"
# Keep an unavailable git proxy from being inherited by Cargo's HTTP client.
export CARGO_HTTP_PROXY="${CARGO_HTTP_PROXY-}"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) NODE_ARCH=arm64; NODE_SHA=c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428 ;;
  *) echo 'This local build script currently targets Apple Silicon only.' >&2; exit 1 ;;
esac
NODE_VERSION=22.23.4
ARCHIVE="node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
mkdir -p .runtime artifacts
if [ ! -f ".runtime/$ARCHIVE" ]; then
  curl -fL --connect-timeout 15 --max-time 600 "https://nodejs.org/dist/v${NODE_VERSION}/$ARCHIVE" -o ".runtime/$ARCHIVE"
fi
printf '%s  %s\n' "$NODE_SHA" ".runtime/$ARCHIVE" | shasum -a 256 -c -
tar -xzf ".runtime/$ARCHIVE" -C .runtime
RUNTIME="$ROOT/apps/desktop/src-tauri/broker-runtime"
mkdir -p "$RUNTIME/services" "$RUNTIME/protocol"
cp ".runtime/node-v${NODE_VERSION}-darwin-${NODE_ARCH}/bin/node" "$RUNTIME/node"
cp ".runtime/node-v${NODE_VERSION}-darwin-${NODE_ARCH}/LICENSE" "$RUNTIME/NODE-LICENSE"
cp package.json package-lock.json "$RUNTIME/"
cp -R services/broker "$RUNTIME/services/"
cp protocol/index.cjs "$RUNTIME/protocol/"
npm ci --omit=dev --prefix "$RUNTIME"
# Sign nested executable before Tauri seals the app bundle.
codesign --force --sign - "$RUNTIME/node"
if [ "${1-}" = "--prepare-only" ]; then exit 0; fi
npm --prefix apps/desktop run tauri build -- --bundles app --config src-tauri/tauri.macos.conf.json
APP="$ROOT/apps/desktop/src-tauri/target/release/bundle/macos/TIEZ Plus.app"
codesign --verify --deep --strict "$APP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ROOT/artifacts/TIEZ-Plus-0.1.0-macos-arm64.zip"
shasum -a 256 "$ROOT/artifacts/TIEZ-Plus-0.1.0-macos-arm64.zip" > "$ROOT/artifacts/SHA256SUMS-macos.txt"
echo "Built: $APP"
