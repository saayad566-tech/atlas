// Plain-node UI verification against the compiled app (no test framework).
const fs = require('fs'); const os = require('os'); const path = require('path');
const { chromium } = require('playwright-core');
const { createAtlas } = require('../dist/gateway');

let fails = 0;
const check = (name, cond, detail) => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vui-'));
  const atlas = createAtlas({ dataDir: home, consoleDir: path.join(process.cwd(), 'dist', 'console') });
  await new Promise((r) => atlas.server.listen(0, r));
  const port = atlas.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  await fetch(`${base}/api/fin/api/seed`, { method: 'POST', body: JSON.stringify({ companies: 40 }) });

  const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox'] });
  // bypassCSP is a HARNESS setting: our CSP forbids eval, which Playwright's
  // in-page evaluation uses. The app itself never calls eval.
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, bypassCSP: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('#result-body tr').length > 3, null, { timeout: 20000 });
    check('screener renders', true);
    await page.click('#result-body tr:first-child');
    await page.waitForSelector('#view-company.active', { timeout: 10000 });
    await page.waitForSelector('#co-deep2 .scorecard', { timeout: 20000 });
    await page.waitForFunction(() => /ROIC/.test((document.querySelector('#co-deep2') || {}).innerText || ''), null, { timeout: 20000 });
    const deep = await page.locator('#co-deep2').innerText();
    check('capital-efficiency panel renders', /ROIC/.test(deep) && /EVA/.test(deep), deep.split('\n')[1] || '');
    await page.waitForSelector('#co-market .scorecard', { timeout: 20000 });
    const market = await page.locator('#co-market').innerText();
    check('market & analysts panel renders', /analysts/i.test(market) && /dividends/i.test(market) && /ownership/i.test(market), market.split('\n')[0]);
    await page.click('#btn-audit');
    await page.waitForFunction(() => /passing/i.test((document.querySelector('#co-audit') || {}).innerText || ''), null, { timeout: 20000 });
    const audit = await page.locator('#co-audit').innerText();
    const m = audit.match(/(\d+)\/(\d+) passing/i);
    check('feature audit runs and reports', !!m && Number(m[1]) === Number(m[2]), m ? m[0] : audit.slice(0, 60));
    await page.screenshot({ path: path.join(process.cwd(), 'screenshot-audit.png') });
    check('screenshot captured', fs.existsSync(path.join(process.cwd(), 'screenshot-audit.png')));
    check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
    await atlas.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(fails === 0 ? '\nUI CHECKS PASSED' : `\n${fails} UI CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
