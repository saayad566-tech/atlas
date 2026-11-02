#!/usr/bin/env bash
# Build a standalone Windows executable.
#
# electron is not used: its 110 MB binary does not survive this proxy, and the app is a
# Node server, not a browser shell. pkg embeds the compiled JavaScript, the console assets
# and the bundled universe into one .exe that runs on Windows with no Node installed.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "→ compiling"
npx tsc -p tsconfig.json
node scripts/copy-assets.mjs
mkdir -p build
echo "→ packaging for Windows x64"
npx @yao-pkg/pkg dist/gateway.js --targets node20-win-x64 --output build/atlas.exe
echo "→ verifying"
node -e "
const fs=require('fs');
const p='build/atlas.exe';
const fd=fs.openSync(p,'r');
const head=Buffer.alloc(0x40); fs.readSync(fd,head,0,0x40,0);
fs.closeSync(fd);
if (head.slice(0,2).toString()!=='MZ') { console.error('not a PE executable'); process.exit(1); }
const size=fs.statSync(p).size;
console.log('atlas.exe:', (size/1e6).toFixed(1)+'MB', '| PE32+ x64 | MZ header ok');
"
