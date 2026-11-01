#!/usr/bin/env bash
# Restore node_modules without npm's DNS (the sandbox can reach the registry only
# through the egress proxy, and npm resolves DNS itself and fails).
set -u
P="${HTTPS_PROXY:-http://egress-proxy.sandbox.internal:3128}"
cd "$(dirname "$0")/.." || exit 1
mkdir -p node_modules
fetch() { # name url
  local name="$1" url="$2"
  mkdir -p "node_modules/$name"
  curl -s -x "$P" -m 120 "$url" | tar xz -C "node_modules/$name" --strip-components=1 2>/dev/null \
    && echo "  ok $name" || echo "  FAIL $name"
}
fetch typescript      "https://registry.npmjs.org/typescript/-/typescript-5.6.3.tgz"
fetch ws              "https://registry.npmjs.org/ws/-/ws-8.18.0.tgz"
fetch zod             "https://registry.npmjs.org/zod/-/zod-3.23.8.tgz"
fetch playwright-core "https://registry.npmjs.org/playwright-core/-/playwright-core-1.51.1.tgz"
fetch bindings        "https://registry.npmjs.org/bindings/-/bindings-1.5.0.tgz"
fetch file-uri-to-path "https://registry.npmjs.org/file-uri-to-path/-/file-uri-to-path-1.0.0.tgz"
fetch @types/node     "https://registry.npmjs.org/@types/node/-/node-20.14.15.tgz"
fetch undici-types    "https://registry.npmjs.org/undici-types/-/undici-types-6.19.8.tgz"
fetch @types/ws       "https://registry.npmjs.org/@types/ws/-/ws-8.5.12.tgz"
fetch @types/better-sqlite3 "https://registry.npmjs.org/@types/better-sqlite3/-/better-sqlite3-7.6.11.tgz"
# better-sqlite3 needs its prebuilt native binary (no C++ toolchain here).
mkdir -p node_modules/better-sqlite3
curl -s -x "$P" -m 120 "https://registry.npmjs.org/better-sqlite3/-/better-sqlite3-11.5.0.tgz" | tar xz -C node_modules/better-sqlite3 --strip-components=1 && echo "  ok better-sqlite3"
mkdir -p node_modules/better-sqlite3/build/Release
curl -sL -x "$P" -m 120 -o /tmp/bs3.tgz "https://github.com/WiseLibs/better-sqlite3/releases/download/v11.5.0/better-sqlite3-v11.5.0-node-v115-linux-x64.tar.gz"
tar xzf /tmp/bs3.tgz -C node_modules/better-sqlite3/build/Release --strip-components=1 2>/dev/null
find node_modules/better-sqlite3/build/Release -name '*.node' -exec mv {} node_modules/better-sqlite3/build/Release/ \; 2>/dev/null
rm -rf node_modules/better-sqlite3/build/Release/Release
node -e "require('better-sqlite3');console.log('  better-sqlite3 binary OK')" || echo "  FAIL native binary"
