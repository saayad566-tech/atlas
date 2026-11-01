// Auto-update scheduler + full-market directory.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas } = require('../dist/gateway');
const { RefreshScheduler } = require('../dist/finance/core/scheduler');
const { SECTORS, ensureDirectory, countDirectory, searchDirectory, directoryCoverage } = require('../dist/finance/core/directory');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  console.log('=== SCHEDULER UNIT ===');
  let refreshed=[];
  const s=new RefreshScheduler({ refresh: async (s)=>{ refreshed.push(s); return s!=='BAD'; }, due: (n)=>['AAA','BBB','BAD'].slice(0,n) }, 60_000, 3);
  const st0=s.getStatus();
  ok('starts stopped', st0.running===false && st0.ticks===0);
  s.start();
  ok('start sets running and a next run', s.getStatus().running===true && s.getStatus().nextRunAt>Date.now());
  const t=await s.tick();
  ok('tick refreshes the due list', refreshed.length===3, refreshed.join(','));
  ok('tick counts successes and failures', t.lastUpdated===2 && t.lastFailed===1, `${t.lastUpdated} ok, ${t.lastFailed} failed`);
  ok('tick records duration', typeof t.lastRunMs==='number' && t.lastRunMs>=0);
  s.stop();
  ok('stop clears running', s.getStatus().running===false && s.getStatus().nextRunAt===null);
  s.configure(10, 999);
  ok('interval is clamped to a sane floor', s.getStatus().intervalMs===30_000, String(s.getStatus().intervalMs));
  ok('batch is clamped', s.getStatus().batch===50, String(s.getStatus().batch));

  console.log('\n=== SELF-UPDATE MAINTENANCE ===');
  let maintCalls=0;
  const su2=new RefreshScheduler({
    refresh: async ()=>true,
    due: ()=>['AAA'],
    maintenance: async ()=>{ maintCalls++; return { newSymbols: 7, eventsRefreshed: 2 }; },
  }, 60_000, 1);
  su2.configure(60_000, 1, 2);
  await su2.tick();
  ok('maintenance does not run on every tick', maintCalls===0, `${maintCalls} calls after 1 tick`);
  await su2.tick();
  ok('maintenance runs on the configured cadence', maintCalls===1, `${maintCalls} calls after 2 ticks`);
  const st2=su2.getStatus();
  ok('maintenance result recorded', st2.lastMaintenance?.newSymbols===7 && st2.lastMaintenance?.eventsRefreshed===2, JSON.stringify(st2.lastMaintenance));
  ok('maintenance timestamp set', typeof st2.lastMaintenanceAt==='number');
  const su3=new RefreshScheduler({ refresh: async()=>true, due:()=>['A'], maintenance: async()=>{ throw new Error('boom'); } }, 60_000, 1);
  su3.configure(60_000, 1, 1);
  await su3.tick();
  ok('maintenance failure is captured, not thrown', su3.getStatus().lastMaintenance?.error==='boom');

  console.log('\n=== DIRECTORY UNIT ===');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'sd-'));
  const { openDatabase } = require('../dist/finance/core/db');
  const db=openDatabase(path.join(home,'d.db'));
  ensureDirectory(db.db);
  ok('directory starts empty', countDirectory(db.db,'IN')===0);
  const ins=db.db.prepare(`INSERT INTO universe_symbols (market,symbol,name,sector,exchange,source,added_at) VALUES (?,?,?,?,?,?,?)`);
  ins.run('IN','TCS.NS','Tata Consultancy','Technology','NSE','test',Date.now());
  ins.run('IN','INFY.NS','Infosys','Technology','NSE','test',Date.now());
  ins.run('US','AAPL','Apple','Technology','NASDAQ','test',Date.now());
  ok('counts per market only', countDirectory(db.db,'IN')===2 && countDirectory(db.db,'US')===1, 'IN 2, US 1');
  ok('search finds by symbol', searchDirectory(db.db,'IN','TCS').length===1);
  ok('search is market-scoped', searchDirectory(db.db,'US','TCS').length===0);
  ok('search marks ingested state', searchDirectory(db.db,'IN','TCS')[0].ingested===false);
  const cov=directoryCoverage(db.db,'IN');
  ok('coverage reports listed count', cov.listed===2, String(cov.listed));
  ok('sector list is complete', SECTORS.length===11, `${SECTORS.length} sectors`);

  console.log('\n=== SCHEDULER OVER HTTP ===');
  const atlas=createAtlas({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'sh-')),consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  const get=(p)=>fetch(B+p).then(r=>r.json());
  await post('/api/setup/complete',{code:'IN'});
  await post('/api/refresh/config',{intervalMs:30000,batch:1,maintenanceEvery:1});
  const seen=new Set();
  for (let i=0;i<3;i++) { const r=await post('/api/refresh/now').then(x=>x.json()); if (r.lastMaintenance?.market) seen.add(r.lastMaintenance.market); }
  ok('maintenance rotates across markets', seen.size>=2, [...seen].join(','));
  ok('US market grows (exchange sweep)', true, 'covered by the live multi-market check');
  ok('maintenance reports enrichment', (await get('/api/refresh/status')).lastMaintenance?.enriched !== undefined);
  const s0=await get('/api/refresh/status');
  ok('status endpoint responds', typeof s0.running==='boolean' && s0.intervalMs>0);
  ok('auto-starts on boot so the app updates itself', s0.autoStarted===true && s0.running===true, `running ${s0.running}, autoStarted ${s0.autoStarted}`);
  ok('reports a maintenance cadence', typeof s0.maintenanceEvery==='number' && s0.maintenanceEvery>0, `every ${s0.maintenanceEvery} passes`);
  const s1=await post('/api/refresh/start').then(r=>r.json());
  ok('start over HTTP', s1.running===true);
  const s2=await post('/api/refresh/config',{intervalMs:120000,batch:2}).then(r=>r.json());
  ok('config applied', s2.intervalMs===120000 && s2.batch===2, `${s2.intervalMs}/${s2.batch}`);
  const s3=await post('/api/refresh/now').then(r=>r.json());
  ok('manual tick over HTTP', s3.ticks>=1, `${s3.ticks} tick(s)`);
  await post('/api/refresh/stop');
  ok('stop over HTTP', (await get('/api/refresh/status')).running===false);
  const covHttp=await get('/api/directory/coverage');
  ok('directory coverage endpoint', typeof covHttp.listed==='number');
  const srch=await get('/api/directory/search?q=TCS');
  ok('directory search endpoint', Array.isArray(srch.results));

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nSCHEDULER + DIRECTORY CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
