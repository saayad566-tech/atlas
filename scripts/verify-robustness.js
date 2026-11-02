// Robustness: concurrency, malformed input, body limits, and financial maths.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
const { openDatabase, withWriteRetry }=require('../dist/finance/core/db');
const V=require('../dist/finance/core/valuationDeep');
const A=require('../dist/finance/core/alpha');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== CONCURRENT WRITERS ===');
{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rb-'));
  const file=path.join(dir,'x.db');
  const a=openDatabase(file); a.db.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v INTEGER)');
  const b=openDatabase(file);
  let okA=0, okB=0, errs=0;
  for (let i=0;i<200;i++) {
    try { withWriteRetry(()=>a.db.prepare('INSERT INTO t (v) VALUES (?)').run(i)); okA++; } catch { errs++; }
    try { withWriteRetry(()=>b.db.prepare('INSERT INTO t (v) VALUES (?)').run(i)); okB++; } catch { errs++; }
  }
  ok('both writers complete', okA===200 && okB===200, `A=${okA} B=${okB}`);
  ok('no write is lost', a.db.prepare('SELECT COUNT(*) n FROM t').get().n===400);
  ok('no error escapes', errs===0, `${errs}`);
  ok('the database stays intact', a.db.pragma('integrity_check')[0].integrity_check==='ok');
  fs.rmSync(dir,{recursive:true,force:true});
}

console.log('\n=== FINANCIAL MATHS ===');
// A reverse DCF solves for growth; feeding it back must reproduce the price.
const asm={discountPct:10,terminalGrowthPct:3,years:10};
for (const price of [500,1000,2000]) {
  const r=V.reverseDcf(price,100,asm);
  ok(`reverse DCF solves for ${price}`, r.impliedGrowthPct!==null && Number.isFinite(r.impliedGrowthPct), r.impliedGrowthPct===null?'outside bracket (verdict given)':`${r.impliedGrowthPct}%`);
  ok(`  and explains its verdict`, typeof r.verdict==='string' && r.verdict.length>20);
}
// An out-of-bracket price must say so, not invent a number.
const low=V.reverseDcf(250,100,asm);
ok('an impossible price returns null with a reason', low.impliedGrowthPct===null && /cheap|expensive|bracket|assumption/i.test(low.verdict), low.verdict.slice(0,45));
// Monotonicity: more growth is worth more, a higher discount rate is worth less.
const val=(g,d)=>V.scenarios(100,{discountPct:d,terminalGrowthPct:3,years:10,growthPct:g})[0].value;
ok('higher growth raises value', val(15,10)>val(10,10), `${val(10,10).toFixed(0)} → ${val(15,10).toFixed(0)}`);
ok('a higher discount rate lowers value', val(10,15)<val(10,10), `${val(10,10).toFixed(0)} → ${val(10,15).toFixed(0)}`);
// Alpha factors against hand-computed values.
const f=A.alphaFactors([{date:'2026-01-01',open:100,high:112,low:99,close:110,volume:1000}]).factors;
const g=(n)=>f.find(x=>x.name===n)?.value;
ok('KMID = (110-100)/100', Math.abs(g('KMID')-0.1)<1e-6, String(g('KMID')));
ok('KLEN = (112-99)/100', Math.abs(g('KLEN')-0.13)<1e-6, String(g('KLEN')));
ok('KMID2 = 10/13 (rounded to 4dp)', Math.abs(g('KMID2')-10/13)<1e-4, String(g('KMID2')));
ok('KUP = (112-110)/100', Math.abs(g('KUP')-0.02)<1e-6, String(g('KUP')));

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'rb2-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b,raw)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:raw??JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:5});

  console.log('\n=== MALFORMED REQUESTS ===');
  ok('invalid JSON is a 400', (await post('/api/screen',null,'{not json')).status===400);
  ok('an empty body is a 400', (await post('/api/screen',null,'')).status===400);
  ok('an oversized body is a 413, not a dropped connection', (await post('/api/journal',null,JSON.stringify({thesis:'x'.repeat(2_000_000)}))).status===413);
  ok('a normal body still works', (await post('/api/screen',{expression:'Market Cap > 0',limit:2})).status===200);
  ok('an unknown route is a 404', (await fetch(B+'/api/does-not-exist')).status===404);

  console.log('\n=== MEMORY IS BOUNDED ===');
  const m0=process.memoryUsage().heapUsed;
  for (let i=0;i<200;i++) await fetch(B+'/api/stats');
  const growth=(process.memoryUsage().heapUsed-m0)/1e6;
  ok('200 requests grow the heap by a bounded amount', growth<40, `${growth.toFixed(1)} MB`);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nROBUSTNESS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
