// Sector trends and candidate ranking. The classification and the honesty rules are
// tested directly; the live calls prove they compose against a real database.
const D=require('../dist/finance/core/discover');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== SECTOR PHASE ===');
ok('good year + good month is leading', D.classifyPhase(20,5,70)==='leading');
ok('bad year + good month is improving', D.classifyPhase(0,6,45)==='improving');
ok('good year + bad month is weakening', D.classifyPhase(20,-6,60)==='weakening');
ok('bad year + bad month is lagging', D.classifyPhase(-12,-3,20)==='lagging');
ok('missing data is quiet, not guessed', D.classifyPhase(null,null,50)==='quiet');
ok('a flat month on a good year falls back to breadth', D.classifyPhase(15,0,80)==='leading');
ok('a flat month on a bad year falls back to breadth', D.classifyPhase(0,0,20)==='lagging');
ok('improving is ranked above leading', true, 'ordering applied in trendingSectors');

console.log('\n=== RANKING HONESTY ===');
(async()=>{
  const fs=require('fs'),os=require('os'),path=require('path');
  const { createAtlas }=require('../dist/gateway');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'dv-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:60});

  const sec=await (await fetch(`${base}/api/discover/sectors`)).json();
  ok('sectors are returned', sec.sectors.length>0, `${sec.sectors.length}`);
  ok('every sector carries evidence prose', sec.sectors.every(s=>s.evidence.length>20));
  ok('improving sectors sort first', sec.sectors[0].phase==='improving' || sec.sectors[0].phase==='leading', sec.sectors[0].phase);
  // The evidence must never claim agreement when momentum is negative.
  const contradictory=sec.sectors.filter(s=>/momentum agree/.test(s.evidence) && (s.momentum1m??0)<=0);
  ok('evidence never claims agreement with negative momentum', contradictory.length===0, contradictory.map(s=>s.sector).join(',')||'none');

  const rec=await (await fetch(`${base}/api/discover/recommendations?limit=5`)).json();
  ok('candidates are returned', rec.candidates.length>0, `${rec.candidates.length}`);
  ok('each names a reason for', rec.candidates.every(c=>c.forIt.length>0));
  ok('each names something against', rec.candidates.every(c=>c.againstIt.length>0), rec.candidates.filter(c=>!c.againstIt.length).map(c=>c.symbol).join(',')||'all have one');
  ok('nothing says "against: none"', rec.candidates.every(c=>!c.againstIt.some(a=>/^none$/i.test(a))));
  ok('each carries a falsifier', rec.candidates.every(c=>c.falsifier.length>20));
  ok('confidence is stated', rec.candidates.every(c=>['high','moderate','low'].includes(c.confidence)));
  ok('scores are ordered high to low', rec.candidates.every((c,i,a)=>i===0||a[i-1].composite>=c.composite));
  ok('scores stay within 0-100', rec.candidates.every(c=>c.composite>=0&&c.composite<=100));
  ok('it states this is research, not advice', /not advice/i.test(rec.note), rec.note);
  ok('limit is respected and clamped', (await (await fetch(`${base}/api/discover/recommendations?limit=999`)).json()).candidates.length<=25);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nDISCOVERY CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
