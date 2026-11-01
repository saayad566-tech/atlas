// Every feature, every market: prove no data crosses between countries.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas } = require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'iso-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  const get=(p)=>fetch(B+p).then(r=>r.json());

  // Seed two markets with clearly distinct symbol sets.
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:25,seed:11});
  const inRes=await post('/api/screen',{expression:'Market Cap > 0',limit:500}).then(r=>r.json());
  const IN_SYMS=new Set((inRes.rows||[]).map(r=>r.symbol));
  await post('/api/markets/switch',{code:'US'}); await post('/api/seed',{companies:25,seed:77});
  const usRes=await post('/api/screen',{expression:'Market Cap > 0',limit:500}).then(r=>r.json());
  const US_SYMS=new Set((usRes.rows||[]).map(r=>r.symbol));

  console.log(`=== SETUP ===`);
  ok('two markets seeded separately', IN_SYMS.size>0 && US_SYMS.size>0, `IN ${IN_SYMS.size}, US ${US_SYMS.size}`);
  const overlap=[...IN_SYMS].filter(s=>US_SYMS.has(s));
  ok('symbol sets are disjoint', overlap.length===0, `${overlap.length} shared`);

  // Which endpoints return symbol-bearing payloads to scan.
  const ENDPOINTS=[
    ['/api/screen?limit=500','rows'],
    ['/api/search?q=','hits'],
    ['/api/watchlist','watchlist'],
    ['/api/watchlist/table','rows'],
    ['/api/sectors','sectors'],
    ['/api/sectors/summary','sectors'],
    ['/api/movers','gainers'],
    ['/api/sector-breadth','sectors'],
    ['/api/portfolio/pnl','holdings'],
    ['/api/universe/coverage','coverage'],
    ['/api/market/breadth','breadth'],
    ['/api/analytics/sectors','sectors'],
    ['/api/universe/freshness','rows'],
    ['/api/watchlist/calendar','earnings'],
  ];

  function symbolsIn(obj, foreign) {
    const text=JSON.stringify(obj ?? {});
    const found=new Set();
    for (const s of foreign) if (text.includes(s)) found.add(s);
    return [...found];
  }

  for (const [market, foreign, own] of [['IN',US_SYMS,IN_SYMS],['US',IN_SYMS,US_SYMS]]) {
    await post('/api/markets/switch',{code:market});
    console.log(`\n=== MARKET ${market}: foreign symbols must never appear ===`);
    for (const [ep] of ENDPOINTS) {
      let body;
      try { body = await get(ep); } catch (e) { ok(`${ep}`, false, String(e).slice(0,50)); continue; }
      const leaked = symbolsIn(body, foreign);
      ok(`${ep} clean`, leaked.length===0, leaked.length?`leaked ${leaked.slice(0,3).join(',')}`:'no foreign symbols');
    }
    // company-level endpoints: a foreign symbol must 404
    const foreignSym=[...foreign][0];
    const ownSym=[...own][0];
    for (const [label, mk] of [['research',s=>`/api/research/${s}`],['atlas-score',s=>`/api/atlas-score/${s}`],['timeline',s=>`/api/timeline/${s}`],['peers',s=>`/api/peers/${s}`],['company',s=>`/api/company/${s}`]]) {
      const foreignRes=await fetch(B+mk(foreignSym));
      ok(`${label}: foreign symbol not served`, foreignRes.status===404, `HTTP ${foreignRes.status} for ${foreignSym}`);
      const ownRes=await fetch(B+mk(ownSym));
      ok(`${label}: own symbol served`, ownRes.status===200, `HTTP ${ownRes.status} for ${ownSym}`);
    }
  }

  console.log('\n=== DATABASE FILES ===');
  const mdir=path.join(home,'markets');
  const files=fs.readdirSync(mdir).filter(f=>f.endsWith('.db'));
  ok('one database per market', files.length>=2, files.join(','));

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nISOLATION CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
