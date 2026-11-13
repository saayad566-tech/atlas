import { cpSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
mkdirSync('dist/console/icons', { recursive: true });
for (const f of ['index.html', 'styles.css', 'theme-atlas.css', 'app.js', 'manifest.json', 'service-worker.js']) {
  cpSync(`src/console/${f}`, `dist/console/${f}`);
}
for (const f of ['icon-192.png', 'icon-512.png']) {
  const src = `src/console/icons/${f}`;
  if (existsSync(src)) cpSync(src, `dist/console/icons/${f}`);
}
console.log('Copied console assets (incl. manifest, service worker, icons) to dist/console');

// The bundled symbol universe ships with the app.
import fsx from 'node:fs';
const uniSrc = path.join(process.cwd(), 'src', 'finance', 'data', 'universe');
const uniDst = path.join(process.cwd(), 'dist', 'finance', 'data', 'universe');
if (fsx.existsSync(uniSrc)) {
  fsx.mkdirSync(uniDst, { recursive: true });
  for (const f of fsx.readdirSync(uniSrc)) fsx.copyFileSync(path.join(uniSrc, f), path.join(uniDst, f));
  console.log(`universe: ${fsx.readdirSync(uniDst).length} market bundles`);
}
