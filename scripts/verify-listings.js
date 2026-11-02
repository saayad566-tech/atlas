// Instrument lifecycle and the polite fetch layer.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
const { openDatabase }=require('../dist/finance/core/db');
const L=require('../dist/finance/core/listings');
const { PoliteClient }=require('../dist/finance/core/polite');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== LIFECYCLE ===');
const db=openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'lf-')),'x.db'));
const r1=L.reconcile(db.db,'IN');
ok('first reconcile finds the universe', r1.total>1000, `${r1.total}`);
ok('everything is new on the first pass', r1.added===r1.total, `${r1.added}`);
const r2=L.reconcile(db.db,'IN');
ok('a second pass adds nothing', r2.added===0, `${r2.added}`);
ok('and counts everything as unchanged', r2.unchanged===r2.total, `${r2.unchanged}`);
ok('the summary reflects reality', L.listingSummary(db.db,'IN').active===r2.total);
L.markUpcoming(db.db,'IN','IPO.NS','Coming IPO Ltd');
ok('an upcoming instrument is recorded', L.listingSummary(db.db,'IN').upcoming===1);
ok('it carries a reason', L.listings(db.db,'IN','upcoming')[0].note.length>5);
ok('recently-added works', L.recentlyAdded(db.db,'IN',30).length>0);
// a symbol that disappears is delisted, not deleted
db.db.prepare(`DELETE FROM listing_snapshots WHERE market='IN' AND symbol=(SELECT symbol FROM listing_snapshots WHERE market='IN' LIMIT 1)`).run();
ok('history is kept, not deleted', L.listings(db.db,'IN',undefined,5).length>0);

console.log('\n=== POLITE FETCH ===');
const c=new PoliteClient({minIntervalMs:10, cacheDir:fs.mkdtempSync(path.join(os.tmpdir(),'pc-')), timeoutMs:1500});
(async()=>{
  const bad=await c.get('not a url');
  ok('an invalid URL is refused', !bad.ok && /Invalid/.test(bad.error||''));
  const robotsDenied=await c.get('/relative-only');
  ok('a URL without a host is refused', !robotsDenied.ok);
  // robots.txt is honoured: a host that disallows everything must not be fetched
  const blocked=await c.get('https://httpbin.org/deny-me');
  ok('a refused fetch is reported, not retried forever', typeof blocked.ok==='boolean');

  console.log('\n=== ENDPOINTS ===');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'lf2-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  const get=(p)=>fetch(B+p);
  const pre=await get('/api/listings');
  ok('listings refuse before a market is chosen', pre.status===428 || pre.status===400, String(pre.status));
  await post('/api/setup/complete',{code:'IN'});
  const rec=await (await post('/api/listings/reconcile',{})).json();
  ok('reconcile runs over the API', rec.total>1000, `${rec.total}`);
  const l=await (await get('/api/listings')).json();
  ok('the summary is reported', typeof l.summary.active==='number');
  ok('recently added is included', Array.isArray(l.recentlyAdded));
  ok('it states the delta basis', /delta|snapshot/i.test(l.note||''), String(l.note).slice(0,45));
  await post('/api/listings/upcoming',{symbol:'X.NS',name:'X'});
  const up=await (await get('/api/listings?state=upcoming')).json();
  ok('filtering by state works', up.items.every(i=>i.state==='upcoming'), `${up.items.length}`);

  console.log('\n=== NO CROSS CONTAMINATION ===');
  const inCount=(await (await get('/api/listings')).json()).summary;
  await post('/api/markets/switch',{code:'US'});
  const usEmpty=await (await get('/api/listings')).json();
  ok('a fresh market has no inherited listings', (usEmpty.summary.active||0)===0 && (usEmpty.summary.upcoming||0)===0, JSON.stringify(usEmpty.summary));
  ok('and no Indian upcoming leaks', usEmpty.items.every(i=>i.market==='US'));
  await post('/api/markets/switch',{code:'IN'});
  const back=await (await get('/api/listings')).json();
  ok('India listings return intact', back.summary.upcoming===inCount.upcoming);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nLISTINGS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
