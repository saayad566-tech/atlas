// Multi-market self-update: every market grows, and none contaminates another.
// Live network required; skips cleanly when offline.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas } = require('../dist/gateway');
const { openDatabase } = require('../dist/finance/core/db');
const { YahooClient } = require('../dist/finance/core/yahoo');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  try { const c = new YahooClient(); const r = await c.screenExchange('gb','LSE',0,5); if (!r.symbols.length) throw new Error('offline'); }
  catch { console.log('  SKIP  network unavailable — multi-market checks not run'); console.log('\nMULTI-MARKET CHECKS SKIPPED'); process.exit(0); }

  const home=fs.mkdtempSync(path.join(os.tmpdir(),'mmk-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'});
  await post('/api/refresh/config',{intervalMs:30000,batch:1,maintenanceEvery:1});

  console.log('=== EVERY MARKET GROWS ===');
  const grown=new Map(); const markets=new Set();
  for (let i=0;i<4;i++) {
    const r=await post('/api/refresh/now').then(x=>x.json());
    const m=r.lastMaintenance;
    if (m?.market) { markets.add(m.market); grown.set(m.market, m.newSymbols); }
  }
  ok('maintenance visits different markets', markets.size>=3, [...markets].join(','));
  ok('at least two markets discovered symbols', [...grown.values()].filter(v=>v>0).length>=2, [...grown].map(([k,v])=>`${k}:${v}`).join(' '));

  console.log('\n=== ENRICHMENT (full company data) ===');
  const status=await fetch(`${B}/api/refresh/status`).then(r=>r.json());
  ok('maintenance reports enrichment count', typeof status.lastMaintenance?.enriched === 'number', `last enriched ${status.lastMaintenance?.enriched}`);

  console.log('\n=== NO CROSS CONTAMINATION ===');
  let contaminated=[]; let totalSymbols=0;
  for (const mk of ['IN','US','GB','JP','DE','SG','HK','AU','CA']) {
    const f=path.join(home,'markets',mk+'.db');
    if(!fs.existsSync(f)) continue;
    const db=openDatabase(f);
    const own=db.db.prepare('SELECT COUNT(*) n FROM universe_symbols WHERE market=?').get(mk).n;
    const foreign=db.db.prepare('SELECT COUNT(*) n FROM universe_symbols WHERE market<>?').get(mk).n;
    const foreignCompanies=db.db.prepare(`SELECT COUNT(*) n FROM companies WHERE symbol NOT LIKE ? AND symbol NOT LIKE ?`).get('%','%').n;
    totalSymbols+=own;
    if(foreign>0) contaminated.push(`${mk}:${foreign}`);
  }
  ok('no market database holds another market\'s symbols', contaminated.length===0, contaminated.join(',')||'clean');
  ok('symbols were actually collected', totalSymbols>0, `${totalSymbols} across markets`);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nMULTI-MARKET CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
