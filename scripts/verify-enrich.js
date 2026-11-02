// Bulk enrichment: queue directory symbols, process them, report coverage.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas } = require('../dist/gateway');
const { openDatabase } = require('../dist/finance/core/db');
const { ensureDirectory } = require('../dist/finance/core/directory');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'en-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  const get=(p)=>fetch(B+p).then(r=>r.json());
  await post('/api/setup/complete',{code:'IN'});
  // The bundled universe gives the directory something to enrich even with no network.
  await post('/api/directory/seed',{});

  const db=openDatabase(path.join(home,'markets','IN.db')); ensureDirectory(db.db);
  const ins=db.db.prepare('INSERT OR IGNORE INTO universe_symbols (market,symbol,name,sector,exchange,source,added_at) VALUES (?,?,?,?,?,?,?)');
  ins.run('IN','RELIANCE.NS','Reliance','Energy','NSE','test',Date.now());
  ins.run('IN','TCS.NS','TCS','Technology','NSE','test',Date.now());

  console.log('=== STATUS BEFORE ===');
  const s0=await get('/api/enrich/status');
  // Invariants that hold whether or not a network exists.
  ok('the directory is populated from the bundle', s0.listed>1000, `${s0.listed} listed`);
  ok('enriched never exceeds listed', s0.enriched<=s0.listed, `${s0.enriched}/${s0.listed}`);
  ok('remaining equals listed minus enriched', s0.remaining===s0.listed-s0.enriched, `${s0.remaining}`);
  ok('coverage is consistent with the counts', s0.pct===Math.round((s0.enriched/s0.listed)*100), `${s0.pct}%`);

  console.log('\n=== QUEUE ===');
  const q=await post('/api/enrich/queue',{count:2}).then(r=>r.json());
  ok('queues the requested symbols', q.queued===2, `${q.queued} queued`);
  ok('clamps an oversized request', (await post('/api/enrich/queue',{count:9999}).then(r=>r.json())).requested===500);
  ok('zero/negative is clamped up', (await post('/api/enrich/queue',{count:0}).then(r=>r.json())).requested===1);

  console.log('\n=== PROCESSING (live) ===');
  let done=false;
  for (let i=0;i<24;i++) {
    await new Promise(r=>setTimeout(r,2500));
    const s=await get('/api/enrich/status');
    if (s.queued===0 && s.done>0) { done=true; break; }
  }
  const s1=await get('/api/enrich/status');
  if (!done && s1.done===0) { console.log('  SKIP  network unavailable — enrichment did not complete'); }
  else {
    ok('queue drains', s1.queued===0, `${s1.queued} left`);
    ok('symbols were enriched', s1.enriched>0, `${s1.enriched} of ${s1.listed}`);
    ok('failures are reported, not hidden', typeof s1.failed==='number', `${s1.failed} failed`);
    ok('coverage percentage follows', s1.pct===Math.round((s1.enriched/s1.listed)*100), `${s1.pct}%`);
  }

  console.log('\n=== MARKET SCOPING ===');
  await post('/api/markets/switch',{code:'US'});
  const us=await get('/api/enrich/status');
  ok('status is per-market', us.listed===0 && us.market==='US', `${us.market}: ${us.listed} listed`);
  const usq=await post('/api/enrich/queue',{count:5}).then(r=>r.json());
  ok('does not queue another market\'s symbols', usq.queued===0, `${usq.queued} queued in US`);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nENRICHMENT CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
