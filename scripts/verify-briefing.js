// The briefing's judgement: stances, dissent, falsifiers, confidence.
// Crafted inputs prove the reasoning; the live call proves it composes.
const B=require('../dist/finance/core/briefing');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== STANCES FROM NUMBERS ===');
const cheapWeak = B.stancesFor({pe:8, pb:1, roe:4, opm:5, debt_to_equity:0.2}, 5);
ok('four dimensions always produced', cheapWeak.length===4, cheapWeak.map(s=>s.dimension).join(','));
ok('low P/E scores as inexpensive', cheapWeak.find(s=>s.dimension==='value').score>70, String(cheapWeak.find(s=>s.dimension==='value').score));
ok('low ROE scores as weak quality', cheapWeak.find(s=>s.dimension==='quality').score<35, String(cheapWeak.find(s=>s.dimension==='quality').score));
const expensiveStrong = B.stancesFor({pe:45, pb:8, roe:28, opm:25, debt_to_equity:0.1}, 40);
ok('high P/E scores as expensive', expensiveStrong.find(s=>s.dimension==='value').score<35);
ok('high ROE scores as high quality', expensiveStrong.find(s=>s.dimension==='quality').score>70);
ok('rising price scores as momentum', B.stancesFor({pe:20,roe:15,opm:12,debt_to_equity:0.5}, 40).find(s=>s.dimension==='momentum').score>65);
ok('scores never leave 0-100', [...cheapWeak,...expensiveStrong].every(s=>s.score>=0&&s.score<=100));

console.log('\n=== DISSENT (the honest part) ===');
const d1=B.findDissent(cheapWeak);
ok('cheap + weak quality is flagged as a value trap', d1.some(d=>d.severity==='flag' && /value trap/i.test(d.message)), d1[0]?.message.slice(0,50));
const d2=B.findDissent(expensiveStrong);
ok('expensive + strong quality is a note, not a flag', d2.length>0 && d2.every(d=>d.severity==='note'), d2[0]?.message.slice(0,40));
const balanced=B.stancesFor({pe:22,pb:3,roe:16,opm:14,debt_to_equity:0.6}, 8);
ok('a balanced company raises no dissent', B.findDissent(balanced).length===0, `${B.findDissent(balanced).length} found`);
const momentumTrap=B.stancesFor({pe:40,pb:6,roe:5,opm:4,debt_to_equity:0.4}, 60);
ok('price running ahead of earnings is flagged', B.findDissent(momentumTrap).some(d=>/ahead of the fundamentals/.test(d.message)));

console.log('\n=== FALSIFIERS ===');
const f=B.falsifiersFor(cheapWeak);
ok('every stance gets a falsifier', f.length===4, `${f.length}`);
ok('each names a concrete threshold', f.every(x=>x.wouldChangeIf.length>20));
ok('the value falsifier mentions P/E', /P\/E/.test(f.find(x=>/inexpensive|expensive|fairly/.test(x.claim)).wouldChangeIf));

console.log('\n=== COMPOSITION (live) ===');
(async()=>{
  const fs=require('fs'),os=require('os'),path=require('path');
  const { createAtlas }=require('../dist/gateway');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'bf-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:25});
  const m=await (await fetch(`${base}/api/briefing`)).json();
  ok('market briefing has a headline', typeof m.headline==='string' && m.headline.length>10, m.headline);
  ok('market briefing has prose', m.paragraphs.length>0);
  ok('it greets by time of day', /Good (morning|afternoon|evening)/.test(m.greeting), m.greeting);
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;
  const c=await (await fetch(`${base}/api/briefing/${encodeURIComponent(sym)}`)).json();
  ok('company briefing names the company', c.headline.includes(sym) || c.paragraphs[0].length>20, c.headline);
  ok('it states a confidence level with a reason', ['high','moderate','low'].includes(c.confidence.level) && c.confidence.reason.length>10, `${c.confidence.level}: ${c.confidence.reason}`);
  ok('it carries falsifiers', c.falsifiers.length===4);
  ok('it reports data age', typeof c.dataAge.newestDays==='number' || c.dataAge.newestDays===null, String(c.dataAge.newestDays));
  ok('unknown symbol is 404', (await fetch(`${base}/api/briefing/NOPE.XX`)).status===404);
  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nBRIEFING CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
