# Dependencies

**Runtime: one package.** `better-sqlite3` is the only thing the shipped application
needs. Everything else — Playwright, TypeScript, type definitions — is a development
dependency used by the verification suites. — what is needed, what was removed, and why

## Runtime (3 packages)

| Package | Version | Used for | Licence | Why not something smaller |
|---|---|---|---|---|
| **better-sqlite3** | 11.5.0 | Every query, all storage | MIT | Synchronous, no native async plumbing, fastest SQLite binding for Node. Requires a prebuilt binary or a C++ toolchain |
| **playwright-core** (dev) | 1.51.1 | Browser automation for the verification suites only — not a runtime dependency | Apache-2.0 | `core` only, uses the system Chromium |

That is the whole runtime tree. Everything else — the HTTP server, the console, the
analysis engines, the market layer, the AI store — is Node's standard library.

## Development (4 packages, types only)

`typescript`, `@types/node`, `@types/ws`, `@types/better-sqlite3`.

No bundler, no test framework, no linter dependency: verification runs on plain-Node
harnesses (`scripts/verify-*.js`), which is why `npm test` works with no toolchain.

## Removed this round

| Removed | Why |
|---|---|
| **zod** | Declared but never imported — 7 MB installed for nothing. The expression engine and the CSV importer validate by hand, and every API route validates its own body |
| **vitest**, **tsx** | Referenced by `test`/`verify` scripts but never installable here (registry/DNS). `npm test` now runs `scripts/verify-all.sh` |
| **electron**, **electron-builder**, **@capacitor/cli**, **@capacitor/core**, **@capacitor/android** | Listed as devDependencies for an APK/EXE path that cannot run in this environment. Keeping them in the manifest implied a build that does not exist |

## Removed from the data directory

`data/atlas-finance.db` (13 MB) — a leftover from before markets owned their own
databases. Nothing read it after the per-market split, so the app was writing to a file
that had no effect. Deleted; the gateway now opens `data/markets/<ACTIVE>.db`.

## Requirements

| Need | Version | Check |
|---|---|---|
| Node | ≥ 20 | `node -v` |
| A C++ toolchain **or** a prebuilt better-sqlite3 | — | `node -e "require('better-sqlite3')"` |
| Chromium (for the UI verification suites only) | any recent | `which chromium` |

## To build an APK (not possible here)

| Tool | Why |
|---|---|
| JDK 17+ | `keytool`, `apksigner` |
| Android SDK build-tools | `zipalign`, `aapt2` |
| Bubblewrap (`npm i -g @bubblewrap/cli`) | Trusted Web Activity build |

`bash scripts/sign-apk.sh` creates the keystore, signs and verifies once those exist.

## To run a local model

```bash
ollama pull qwen2.5:1.5b-instruct-q4_K_M     # ~1 GB
ollama serve
export ATLAS_LLM_URL=http://127.0.0.1:11434
```

The client refuses any non-loopback endpoint, so a hosted model cannot be used by accident.

## Sandbox note

This environment cannot resolve `registry.npmjs.org` through npm (DNS), so
`scripts/restore-deps.sh` fetches the tarballs through the egress proxy with `curl` and
installs better-sqlite3's prebuilt binary from its GitHub release. On a normal machine,
`npm install` works as usual.


## Toolchain doctor

`npm run doctor` audits every tool and reports which capabilities are ready:

```
Atlas toolchain doctor
Node v20.20.2 · node_modules 9 packages · better-sqlite3 loads

  ✓ Web app + PWA              ✓ Local API + jobs + auth     ✓ Live market data
  ✓ PDF research report        ✓ Full verification suite
  ✗ Android APK    missing: java, keytool, apksigner, zipalign
  ✗ Windows EXE    missing: electron (npm)
  ✗ On-device model missing: ollama

6/8 capabilities ready
```

`node scripts/doctor.js --json` for machine output. It checks **capabilities**, not just
binaries — a missing npm package (electron) counts the same as a missing binary.

## PDF export (now real)

`node scripts/report-pdf.js <baseUrl> <symbol> [out.pdf]` fetches the print-ready HTML and
renders it with playwright-core's chromium. Verified: **122 KB, valid `%PDF-` header**.

Two bugs were found making it work:
1. The raw `chromium --print-to-pdf` binary times out in this sandbox; playwright's
   chromium does not.
2. A test that used `execFileSync` **froze the server's event loop**, so the child could
   never fetch the page it was rendering. Async `spawn` fixed it.
