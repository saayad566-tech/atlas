#!/usr/bin/env bash
# Node needs a real address space for WASM (vite/vitest) and native bindings.
# The sandbox caps `ulimit -v`; lift it for this process only.
ulimit -v unlimited 2>/dev/null || true
ulimit -d unlimited 2>/dev/null || true
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=2048"
exec "$@"
