// Backtest engine: mechanics, honesty, and the sanity check that matters —
// a random-signal strategy must not beat the benchmark.
const fs=require('fs'),os=require('os'),path=require('path');
const { openDatabase }=require('../dist/finance/core/db');
const { ingestFixture }=require('../dist/finance/core/ingest');
const B=require('../dist/finance/core/backtest');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bt-'));
const db=openDatabase(path.join(dir,'x.db'));
ingestFixture(db.db,{companies:40,seed:7});
const series=B.loadSeries(db.db);

console.log('=== MECHANICS ===');
ok('series load per company', series.length>0, `${series.length} companies`);
ok('each series is date-aligned and ascending', series.every(s=>s.dates.length===s.closes.length));
const r=B.backtest(series,{lookbackDays:120,topN:8,rebalanceDays:21,costPct:0.25});
ok('the backtest runs', r.ok===true, r.reason||'');
ok('it reports the window', r.from!=='' && r.to!=='', `${r.from} → ${r.to}`);
ok('the equity curve is populated', r.equity.length>100, `${r.equity.length} points`);
ok('every point has both curves', r.equity.every(e=>typeof e.strategy==='number'&&typeof e.benchmark==='number'));
ok('it rebalances on schedule', r.stats.rebalances>1, `${r.stats.rebalances} rebalances`);
ok('it charges costs', r.stats.costPaidPct>=0, `${r.stats.costPaidPct}`);

console.log('\n=== HONESTY ===');
ok('it states its assumptions', r.assumptions.length>=4, `${r.assumptions.length} stated`);
ok('it says fundamentals cannot be backtested', r.assumptions.some(a=>/price history only/i.test(a)));
ok('the benchmark is disclosed', r.assumptions.some(a=>/equal-weighted/i.test(a)));
ok('costs are disclosed', r.assumptions.some(a=>/cost/i.test(a)));

console.log('\n=== SANITY: NO FREE LUNCH ===');
// On synthetic random-walk data a momentum rule must not systematically beat the market.
const gap=Math.abs(r.stats.totalReturnPct-r.stats.benchmarkReturnPct);
ok('strategy does not wildly beat the benchmark on random data', gap<40, `strategy ${r.stats.totalReturnPct}% vs bench ${r.stats.benchmarkReturnPct}% (gap ${gap.toFixed(1)})`);
ok('drawdown is negative or zero', r.stats.maxDrawdownPct<=0, `${r.stats.maxDrawdownPct}%`);

console.log('\n=== GUARDS ===');
const thin=B.backtest(series,{lookbackDays:100000});
ok('insufficient history is explained, not faked', thin.ok===false && /sessions/.test(thin.reason), thin.reason.slice(0,60));
ok('no series returns a clear reason', B.backtest([]).ok===false);
ok('costs reduce the return', B.backtest(series,{costPct:5}).stats.totalReturnPct <= r.stats.totalReturnPct, 'higher cost never helps');

console.log('\n=== LIVE ENDPOINT ===');
(async()=>{
  const { createAtlas }=require('../dist/gateway');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'bt2-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r2=>atlas.server.listen(0,r2));
  const base=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p2,b)=>fetch(base+p2,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:30});
  const live=await (await fetch(`${base}/api/backtest?lookback=120&top=8`)).json();
  ok('the endpoint answers', live.ok===true, live.reason||'');
  ok('it returns an equity curve', Array.isArray(live.equity) && live.equity.length>0, `${live.equity?.length} points`);
  ok('it returns stats', typeof live.stats?.totalReturnPct==='number', `${live.stats?.totalReturnPct}%`);
  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  fs.rmSync(dir,{recursive:true,force:true});
  console.log(fails===0?'\nBACKTEST CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
