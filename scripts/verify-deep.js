// Plain-node verification (no test framework): audit every feature for a demo company
// and for a live-fetched one, then exercise the deep-analysis v2 module.
const fs = require('fs'); const os = require('os'); const path = require('path');
const { openDatabase } = require('../dist/finance/core/db');
const { ingestFixture } = require('../dist/finance/core/ingest');
const { auditCompany } = require('../dist/finance/core/audit');
const { deep2 } = require('../dist/finance/core/deep2');
const { YahooClient } = require('../dist/finance/core/yahoo');
const { upsertLiveCompany, storePrices, ensureLiveTables } = require('../dist/finance/core/live');
const { fetchAndStoreHistory } = require('../dist/finance/core/fundamentals');

let fails = 0;
const ok = (name, cond, detail) => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-'));
  const db = openDatabase(path.join(home, 'd.db'));
  ensureLiveTables(db.db);
  ingestFixture(db.db, { companies: 40, seed: 21 });
  const demoSym = db.db.prepare(`SELECT symbol FROM companies ORDER BY id LIMIT 1`).get().symbol;

  console.log('\n=== AUDIT: demo company (' + demoSym + ') ===');
  const a1 = auditCompany(db.db, demoSym);
  for (const r of a1.rows) console.log(`  ${r.ok ? 'PASS' : 'SKIP'}  ${r.feature.padEnd(24)} ${r.detail}`);
  ok('demo audit: every feature produced data', a1.passed === a1.total, `${a1.passed}/${a1.total}`);

  console.log('\n=== DEEP2: demo company ===');
  const d1 = deep2(db.db, demoSym);
  ok('roic computed', d1.roic !== null, `ROIC ${d1.roic}%`);
  ok('eva computed', d1.eva !== null, `EVA ₹${d1.eva} Cr`);
  ok('dupont trend has 5 points', d1.dupontTrend.length === 5);
  ok('trends populated', d1.cashConversionTrend.length === 5 && d1.wcDaysTrend.length === 5);
  ok('data quality scored', d1.dataQuality.score >= 0 && d1.dataQuality.score <= 100, `${d1.dataQuality.score}/100`);
  ok('scorecard graded', ['A','B','C','D'].includes(d1.scorecard.grade), `${d1.scorecard.score} (${d1.scorecard.grade})`);
  ok('quarterly series present', d1.quarterlyYoY.length > 0 || d1.quarterlyQoQ.length > 0);

  // ---- live company ----
  console.log('\n=== LIVE FETCH: RELIANCE.NS ===');
  const y = new YahooClient();
  const sum = await y.summary('RELIANCE.NS');
  if (!sum) { console.log('  SKIP  live source unreachable'); }
  else {
    upsertLiveCompany(db.db, sum);
    const chart = await y.chart('RELIANCE.NS', '1y');
    if (chart) storePrices(db.db, 'RELIANCE.NS', chart.points);
    const h = await fetchAndStoreHistory(db.db, y, 'RELIANCE.NS', sum.price || (chart ? chart.price : 0));
    console.log(`  history: ${h.annual} annual / ${h.quarterly} quarterly, ${chart ? chart.points.length : 0} prices`);

    console.log('\n=== AUDIT: live company (RELIANCE.NS) ===');
    const a2 = auditCompany(db.db, 'RELIANCE.NS');
    for (const r of a2.rows) console.log(`  ${r.ok ? 'PASS' : 'SKIP'}  ${r.feature.padEnd(24)} ${r.detail}`);
    // Peers need same-sector companies in the local universe; that is legitimately empty.
    const noPeer = a2.rows.find((r) => r.feature === 'Peer matrix');
    ok('live audit: every feature except peer matrix works', a2.passed === a2.total - (noPeer && !noPeer.ok ? 1 : 0), `${a2.passed}/${a2.total}`);

    const d2 = deep2(db.db, 'RELIANCE.NS');
    ok('live roic computed', d2.roic !== null, `ROIC ${d2.roic}%`);
    ok('live eva computed', d2.eva !== null, `EVA ₹${d2.eva} Cr`);
    ok('live data quality', d2.dataQuality.score > 0, `${d2.dataQuality.score}/100`);
    ok('live scorecard', ['A','B','C','D'].includes(d2.scorecard.grade), `${d2.scorecard.score} (${d2.scorecard.grade})`);
  }

  console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
  process.exit(fails === 0 ? 0 : 1);
})();
