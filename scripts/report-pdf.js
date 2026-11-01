#!/usr/bin/env node
// Render a research report to PDF.
// Fetches the print-ready HTML, then renders it with playwright-core's chromium — the
// same browser the UI tests drive. The raw binary hangs in this sandbox.
// Usage: node scripts/report-pdf.js <baseUrl> <symbol> [out.pdf]
const fs = require('fs');
const path = require('path');
const [base, symbol, out] = process.argv.slice(2);
if (!base || !symbol) { console.error('usage: report-pdf.js <baseUrl> <symbol> [out.pdf]'); process.exit(2); }
const file = out || path.join(process.cwd(), `${symbol.replace(/[^\w.-]/g, '_')}-research.pdf`);
(async () => {
  const url = `${base}/api/fin/api/research/${encodeURIComponent(symbol)}.html`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`report HTML returned HTTP ${res.status}`);
  const html = await res.text();
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: file, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } });
    const size = fs.statSync(file).size;
    if (size < 1000) throw new Error('PDF looks empty');
    console.log(`PDF written: ${file} (${Math.round(size / 1024)} KB)`);
  } finally { await browser.close(); }
})().catch((e) => { console.error(`Could not render PDF: ${e.message}`); process.exit(1); });
