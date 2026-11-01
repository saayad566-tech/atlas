#!/usr/bin/env node
// Toolchain doctor: what is installed, what each capability needs, and how to install it.
// Run before blaming the code for something the environment cannot do.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const has = (cmd) => { try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; } };
const run = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

const TOOLS = [
  { id: 'node', need: '>=20', cmd: 'node', version: 'node -v', why: 'runtime' },
  { id: 'npm', cmd: 'npm', version: 'npm -v', why: 'dependency install' },
  { id: 'git', cmd: 'git', version: 'git --version', why: 'version control' },
  { id: 'curl', cmd: 'curl', version: 'curl --version', why: 'proxy-aware downloads' },
  { id: 'zip', cmd: 'zip', why: 'packaging' },
  { id: 'unzip', cmd: 'unzip', why: 'packaging' },
  { id: 'python3', cmd: 'python3', version: 'python3 -V', why: 'skill checkers' },
  { id: 'chromium', cmd: 'chromium', why: 'headless UI tests, PDF rendering' },
  { id: 'java', cmd: 'java', version: 'java -version 2>&1 | head -1', why: 'APK signing' },
  { id: 'keytool', cmd: 'keytool', why: 'keystore creation' },
  { id: 'apksigner', cmd: 'apksigner', why: 'APK signing' },
  { id: 'zipalign', cmd: 'zipalign', why: 'APK alignment' },
  { id: 'gradle', cmd: 'gradle', why: 'Android build' },
  { id: 'ollama', cmd: 'ollama', why: 'on-device model' },
];

const CAPABILITIES = [
  {
    id: 'web', name: 'Web app + PWA', needs: ['node', 'chromium'],
    provides: 'Screener, all views, offline shell, installable PWA',
    install: 'Nothing — ships ready.',
  },
  {
    id: 'api', name: 'Local API + jobs + auth', needs: ['node'],
    provides: 'Every endpoint, market isolation, job queue, PIN auth',
    install: 'Nothing — ships ready.',
  },
  {
    id: 'live-data', name: 'Live market data', needs: ['node'],
    provides: 'Yahoo quotes, statements, analysts, dividends, news, universes',
    install: 'Needs outbound HTTPS. On a proxied network set HTTPS_PROXY.',
  },
  {
    id: 'pdf', name: 'PDF research report', needs: ['chromium'],
    provides: 'Print the research report to PDF',
    install: 'apt install chromium (or set CHROMIUM_PATH)',
  },
  {
    id: 'apk', name: 'Android APK', needs: ['java', 'keytool', 'apksigner', 'zipalign'],
    provides: 'Signed installable app',
    install: 'Install a JDK 17+ and Android build-tools: apt install openjdk-17-jdk; sdkmanager "build-tools;34.0.0"',
  },
  {
    id: 'exe', name: 'Windows EXE', needs: [],
    provides: 'Desktop installer',
    install: 'npm i -D electron electron-builder, then build on a Windows runner (cross-building needs wine).',
    pkg: 'electron',
  },
  {
    id: 'llm', name: 'On-device model', needs: ['ollama'],
    provides: 'Grounded answers from a local quantized model',
    install: 'curl -fsSL https://ollama.com/install.sh | sh && ollama pull qwen2.5:1.5b-instruct-q4_K_M',
  },
  {
    id: 'tests', name: 'Full verification suite', needs: ['node', 'python3', 'chromium'],
    provides: '13 suites incl. headless UI, fuzzing, performance',
    install: 'Nothing beyond the above.',
  },
];

const tools = TOOLS.map((t) => ({ ...t, installed: has(t.cmd), found: t.version ? run(t.version) : null }));
const byId = Object.fromEntries(tools.map((t) => [t.id, t]));
const caps = CAPABILITIES.map((c) => {
  const missing = c.needs.filter((n) => !byId[n] || !byId[n].installed);
  // A capability can also require an npm package, which is not a PATH tool.
  if (c.pkg && !fs.existsSync(path.join(process.cwd(), 'node_modules', c.pkg))) missing.push(`${c.pkg} (npm)`);
  return { ...c, ready: missing.length === 0, missing };
});

// Node dependency check
const nodeModules = path.join(process.cwd(), 'node_modules');
let deps = { installed: false, count: 0, sqlite: false };
if (fs.existsSync(nodeModules)) {
  deps.installed = true;
  deps.count = fs.readdirSync(nodeModules).filter((d) => !d.startsWith('.')).length;
  try { require('better-sqlite3'); deps.sqlite = true; } catch { deps.sqlite = false; }
}

const ready = caps.filter((c) => c.ready).length;
const summary = {
  node: byId['node']?.found ?? null,
  deps,
  tools: tools.map(({ id, installed, found, why }) => ({ id, installed, found, why })),
  capabilities: caps.map(({ id, name, ready: r, missing, provides, install }) => ({ id, name, ready: r, missing, provides, install })),
  score: `${ready}/${caps.length} capabilities ready`,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('Atlas toolchain doctor\n');
  console.log(`Node ${summary.node ?? '?'} · node_modules ${deps.installed ? deps.count + ' packages' : 'MISSING'} · better-sqlite3 ${deps.sqlite ? 'loads' : 'BROKEN'}\n`);
  console.log('Capabilities');
  for (const c of summary.capabilities) {
    console.log(`  ${c.ready ? '✓' : '✗'} ${c.name.padEnd(28)} ${c.ready ? c.provides : `missing: ${c.missing.join(', ')}`}`);
    if (!c.ready) console.log(`      → ${c.install}`);
  }
  console.log(`\n${summary.score}`);
  const missingTools = summary.tools.filter((t) => !t.installed);
  if (missingTools.length) console.log(`Not installed: ${missingTools.map((t) => t.id).join(', ')}`);
}
process.exit(summary.capabilities.find((c) => c.id === 'web').ready ? 0 : 1);
