import { cpSync, mkdirSync, existsSync } from 'node:fs';
mkdirSync('dist/console/icons', { recursive: true });
for (const f of ['index.html', 'styles.css', 'app.js', 'manifest.json', 'service-worker.js']) {
  cpSync(`src/console/${f}`, `dist/console/${f}`);
}
for (const f of ['icon-192.png', 'icon-512.png']) {
  const src = `src/console/icons/${f}`;
  if (existsSync(src)) cpSync(src, `dist/console/icons/${f}`);
}
console.log('Copied console assets (incl. manifest, service worker, icons) to dist/console');
