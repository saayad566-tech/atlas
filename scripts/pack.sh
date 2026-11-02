#!/usr/bin/env bash
# Build both archives, flat (no wrapper folder), ready for web-to-APK packagers.
set -e
cd "$(dirname "$0")/.."
OUT="${1:-/scratch/output}"
node node_modules/typescript/bin/tsc -p tsconfig.json
node scripts/copy-assets.mjs
mkdir -p "$OUT"
rm -f "$OUT/atlas-platform.zip" "$OUT/atlas-pwa.zip"
# Full project: files at the archive root
zip -rq "$OUT/atlas-platform.zip" . \
  -x 'node_modules/*' 'data/*' '*.log' '.git/*' '*.tgz' 'screenshot*.png' 'package-lock.json' \
     'build/*' 'models/*' 'toolchain/*'
# PWA shell only: directly consumable by PWABuilder / web-to-APK zip upload
(cd dist/console && zip -rq "$OUT/atlas-pwa.zip" .)
node scripts/verify-zip.js
echo "packed: $OUT/atlas-platform.zip  $OUT/atlas-pwa.zip"
