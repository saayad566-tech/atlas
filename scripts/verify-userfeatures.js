// User features: portfolio P&L, freshness, sector drill-down, exports, bulk actions, explain.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas } = require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
(async()=>{
  const h=fs.mkdtempSync(path.join(os.tmpdir(),'ufs-'));
  const a=createAtlas({dataDir:h,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>a.server.listen(0,r));
  const B=`http://127.0.0.1:${a.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  const get=(p)=>fetch(B+p);
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:30});
  const rows=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:5})).json()).rows;
  const sym=rows[0].symbol;

  const pnl=await (await get('/api/portfolio/pnl')).json();
  ok('portfolio P&L endpoint', Array.isArray(pnl.holdings), `${pnl.holdings.length} holdings, total ${pnl.totalValue}`);

  const fr=await (await get(`/api/company/${sym}/freshness`)).json();
  ok('data freshness per source', Array.isArray(fr.sources) && fr.sources.length>=4, `${fr.sources.length} sources`);
  ok('freshness flags staleness', fr.sources.every(s=>typeof s.stale==='boolean'));

  const bulk=await (await post('/api/watchlist/bulk',{symbols:rows.map(r=>r.symbol)})).json();
  ok('bulk watchlist add', bulk.added===rows.length, `added ${bulk.added}, already ${bulk.already}`);

  const csv=await (await get('/api/export/watchlist.csv')).text();
  ok('watchlist CSV export', csv.split('\n').length===rows.length+1 && csv.includes('symbol'), `${csv.split('\n').length} lines`);

  const sec=await (await get(`/api/sector/${encodeURIComponent(rows[0].sector)}/companies`)).json();
  ok('sector drill-down', sec.count>0, `${sec.count} companies in ${sec.sector}`);

  const ex=await (await post('/api/screen/explain',{expression:'Market Cap > 0',symbols:[sym]})).json();
  ok('screen explanation', ex.explanations.length===1 && ex.explanations[0].matched.length>0, ex.explanations[0]?.matched?.[0]);

  const pnlCsv=await (await get('/api/export/portfolio.csv')).text();
  ok('portfolio CSV export responds', typeof pnlCsv==='string', `${pnlCsv.length} bytes`);

  await a.close(); fs.rmSync(h,{recursive:true,force:true});
  console.log(fails===0?'\nUSER FEATURE CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
