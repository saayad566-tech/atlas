// Storage engine, sync recovery, performance metrics, tenant isolation.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
const { openDatabase, withWriteRetry }=require('../dist/finance/core/db');
const { SyncEngine, backoffMs }=require('../dist/finance/core/sync');
const { Perf }=require('../dist/finance/core/perf');
const { Tenants }=require('../dist/finance/core/tenants');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== STORAGE ENGINE ===');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'inf-'));
const db=openDatabase(path.join(tmp,'s.db'));
ok('WAL is on', String(db.db.pragma('journal_mode',{simple:true}))==='wal');
ok('a concurrent writer waits instead of failing', Number(db.db.pragma('busy_timeout',{simple:true}))>=1000);
ok('synchronous is NORMAL', Number(db.db.pragma('synchronous',{simple:true}))===1);
ok('the page cache is sized', Math.abs(Number(db.db.pragma('cache_size',{simple:true})))>=8000);
ok('foreign keys enforced', Number(db.db.pragma('foreign_keys',{simple:true}))===1);
ok('withWriteRetry runs a write', withWriteRetry(()=>1+1)===2);
let threw=false; try { withWriteRetry(()=>{ throw new Error('real bug'); },2,1); } catch { threw=true; }
ok('a non-busy error is not retried', threw);

console.log('\n=== SYNC ENGINE ===');
const sdb=openDatabase(path.join(tmp,'y.db'));
let n=0;
const eng=new SyncEngine(sdb.db, async (k,t)=>{ n++; return t==='good'?{ok:true,detail:'fetched'}:{ok:false,detail:'offline'}; });
ok('backoff grows then caps', backoffMs(0)<backoffMs(2) && backoffMs(9)===backoffMs(4), `${backoffMs(0)/1000}s→${backoffMs(4)/1000}s`);
(async()=>{
  eng.enqueue('quotes','good'); eng.enqueue('quotes','bad');
  const r=await eng.drain(5);
  ok('it drains both jobs', r.processed===2, JSON.stringify(r));
  ok('one succeeded, one failed', r.ok===1 && r.failed===1);
  const st=eng.status();
  ok('every attempt is logged', st.events.length>=5, `${st.events.length} events`);
  ok('the failure reason is recorded', st.events.some(e=>e.state==='failed' && e.detail.length>5));
  ok('failed jobs are retryable', eng.retryFailed()===1);
  ok('re-queueing the same target does not duplicate', (()=>{ eng.enqueue('quotes','good'); eng.enqueue('quotes','good'); return eng.status().jobs.filter(j=>j.target==='good').length===1; })());

  console.log('\n=== PERFORMANCE METRICS ===');
  const p=new Perf();
  for (let i=0;i<40;i++) p.record('/api/x', 20+i, 1024, 200);
  p.record('/api/slow', 1500, 500, 200);
  p.record('/api/bad', 10, 10, 500);
  const snap=p.snapshot();
  ok('percentiles computed', snap.latency.p50!==null && snap.latency.p95>=snap.latency.p50, `p50 ${snap.latency.p50} p95 ${snap.latency.p95}`);
  ok('a slow request raises an alert', snap.alerts.some(a=>a.metric==='latency'), `${snap.alerts.length} alerts`);
  ok('a 500 raises an alert', snap.alerts.some(a=>a.metric==='error'));
  ok('throughput is reported', snap.throughput.bytesPerSec>0, `${snap.throughput.bytesPerSec} B/s`);
  ok('a latency series exists for charting', snap.series.length>10, `${snap.series.length} points`);
  ok('alerts deduplicate by id', new Set(snap.alerts.map(a=>a.id)).size===snap.alerts.length);
  ok('thresholds are configurable', p.setThresholds({latencyWarnMs:50}).latencyWarnMs===50);

  console.log('\n=== TENANT ISOLATION ===');
  const tdb=openDatabase(path.join(tmp,'t.db'));
  const tn=new Tenants(tdb.db);
  const a=tn.create('Alpha', path.join(tmp,'a')), b=tn.create('Beta', path.join(tmp,'b'));
  const k=tn.issueKey(a.id,'laptop',['read','write']);
  ok('a key verifies', tn.verify(k.key)?.tenantId===a.id);
  ok('a wrong key is rejected', tn.verify('atl_nope')===null);
  ok('the plaintext is never stored', !JSON.stringify(tdb.db.prepare('SELECT hash FROM tenant_keys').all()).includes(k.key.slice(4,20)));
  ok('tenants do not see each other\'s keys', tn.listKeys(b.id).length===0);
  ok('revocation takes effect', tn.revoke(k.info.id) && tn.verify(k.key)===null);
  ok('scopes are enforced', tn.hasScope(['read'],'write')===false && tn.hasScope(['admin'],'write')===true);

  console.log('\n=== LIVE ENDPOINTS ===');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'inf2-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  const get=(p)=>fetch(B+p);
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:8});
  for (let i=0;i<4;i++) await get('/api/stats');
  const live=await (await get('/api/perf')).json();
  ok('requests are being measured', live.samples>0, `${live.samples} samples`);
  ok('latency is sub-second on a warm path', live.latency.p50!==null && live.latency.p50<500, `${live.latency.p50}ms`);
  await post('/api/sync/enqueue',{kind:'quotes',target:'X'});
  const run=await (await post('/api/sync/run',{})).json();
  ok('sync runs from the API', run.processed>=1, JSON.stringify(run));
  const sy=await (await get('/api/sync/status')).json();
  ok('sync history is readable', sy.events.length>0, `${sy.events.length} events`);
  const t=await (await post('/api/tenants',{name:'Acme'})).json();
  const kk=await (await post(`/api/tenants/${t.id}/keys`,{label:'ci',scopes:['read']})).json();
  ok('a key can be issued over the API', String(kk.key).startsWith('atl_'));
  ok('it says the key is shown once', /shown once/i.test(kk.note||''));

  console.log('\n=== DOCUMENTATION ===');
  const doc=fs.readFileSync('docs/OPERATIONS.md','utf8');
  for (const s of ['3. Usage and deployment','4. Testing and maintenance','5. Scalability','6. Technical debt']) {
    ok(`section present: ${s.slice(0,2)}`, doc.includes(s));
  }
  ok('technical debt is listed with impact', /Impact/.test(doc) && /LLM inference never executed/.test(doc));

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true}); fs.rmSync(tmp,{recursive:true,force:true});
  console.log(fails===0?'\nINFRASTRUCTURE PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
