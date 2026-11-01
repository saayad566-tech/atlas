// Live data: prove real ingestion end to end. Skips (does not fail) when the network is
// unavailable, so the main suite stays green offline while still exercising reality here.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas } = require('../dist/gateway');
const { YahooClient } = require('../dist/finance/core/yahoo');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const probe = new YahooClient();
  let reachable = false;
  try { const c = await probe.chart('RELIANCE.NS','5d','1d'); reachable = !!c && c.points.length > 0; } catch { reachable = false; }
  if (!reachable) { console.log('  SKIP  network unavailable — live checks not run (not a failure)'); console.log('\nLIVE CHECKS SKIPPED'); process.exit(0); }

  const home=fs.mkdtempSync(path.join(os.tmpdir(),'lv-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  const get=(p)=>fetch(B+p).then(r=>r.json());
  await post('/api/setup/complete',{code:'IN'});

  console.log('=== INGESTION ===');
  const t0=Date.now();
  const r=await post('/api/live/fetch',{symbol:'RELIANCE.NS'}).then(x=>x.json());
  const ms=Date.now()-t0;
  ok('fetches a real company', r.created===true || r.companyId>0, `id ${r.companyId} in ${ms} ms`);
  ok('stores price history', r.pricePoints>100, `${r.pricePoints} points`);
  ok('stores annual statements', (r.history?.annual ?? 0)>=3, `${r.history?.annual} annual`);
  ok('stores headlines', (r.news?.stored ?? 0)>0, `${r.news?.stored ?? 0} from ${(r.news?.sources||[]).join(',') || 'none'}`);

  console.log('\n=== REAL VALUES ===');
  const rows=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:5})).json()).rows||[];
  ok('company is screenable', rows.length>0, `${rows.length} row(s)`);
  const row=rows[0]||{};
  ok('price is a real positive number', row.price>0, String(row.price));
  ok('market cap is populated', row.marketCap>0, String(row.marketCap));
  ok('P/E is populated', row.pe>0, String(row.pe));

  console.log('\n=== OHLCV + INDICATORS ON REAL DATA ===');
  const s=row.symbol;
  const ind=await get(`/api/indicators/${encodeURIComponent(s)}?tf=1D&set=sma20,rsi14,atr14,obv`);
  ok('indicator bars returned', (ind.bars||[]).length>100, `${(ind.bars||[]).length} bars`);
  ok('all studies computable on real data', (ind.unavailable||[]).length===0);
  const last=(a)=>(a||[]).filter(v=>v!==null).slice(-1)[0];
  ok('RSI within 0-100', last(ind.indicators.rsi14)>=0 && last(ind.indicators.rsi14)<=100, String(last(ind.indicators.rsi14)));
  ok('ATR positive', last(ind.indicators.atr14)>0, String(last(ind.indicators.atr14)));
  ok('bars carry volume', (ind.bars||[]).some(b=>b.volume>0));

  console.log('\n=== PEERS ===');
  const pr=await post(`/api/live/peers/${encodeURIComponent(s)}?count=4`).then(x=>x.json());
  ok('sector peers discovered', pr.found>=1, `${pr.found} in ${pr.sector}`);
  ok('peers ingested', (pr.added||[]).filter(a=>a.ok).length>=1, `${(pr.added||[]).filter(a=>a.ok).length} stored`);
  const pm=await get(`/api/peers/${encodeURIComponent(s)}`);
  ok('peer list populated for a live company', (pm.peers||[]).length>=1, `${(pm.peers||[]).length} peers`);

  console.log('\n=== CHART + AUDIT ===');
  const ch=await get(`/api/chart/${encodeURIComponent(s)}?days=365`);
  ok('chart series built', (ch.dates||[]).length>100, `${ch.dates.length} sessions`);
  ok('52-week range brackets last price', ch.low52<=ch.last && ch.high52>=ch.last, `${ch.low52}–${ch.high52}`);
  const au=await get(`/api/audit/${encodeURIComponent(s)}`);
  const checks=au.checks||au.rows||[];
  ok('audit passes on live data', au.passed===au.total || checks.every(c=>c.ok), `${au.passed}/${au.total}`);
  const rep=await get(`/api/research/${encodeURIComponent(s)}`);
  ok('research report news section is complete', (rep.sections||[]).some(x=>/news|sentiment/i.test(x.title) && x.status==='complete'));
  ok('research coverage above 70%', (rep.coverage?.pct ?? 0)>=70, `${rep.coverage?.pct}%`);
  ok('competitor section no longer unavailable', (rep.sections||[]).some(x=>/Competitor/i.test(x.title) && x.status!=='unavailable'));
  ok('data source is marked live', checks.some(c=>/yahoo/i.test(c.detail||'')), (checks.find(c=>/yahoo/i.test(c.detail||''))||{}).detail);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nLIVE CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
