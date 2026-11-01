// The decision journal: recording, grading and the scorecard.
// Grading is the part that must be honest, so every outcome is forced explicitly.
const J=require('../dist/finance/core/journal');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
const DAY=86_400_000;
const entry=(over={})=>({ id:1, market:'IN', symbol:'X', action:'buy', thesis:'t', expectation:'up',
  horizonDays:90, priceAtEntry:100, confidence:3, createdAt:new Date(Date.now()-10*DAY).toISOString(),
  closedAt:null, closedPrice:null, closedNote:null, ...over });

console.log('=== GRADING ===');
ok('up and it went up is right', J.gradeEntry(entry(),130).verdict==='right', J.gradeEntry(entry(),130).note);
ok('up and it went down is wrong', J.gradeEntry(entry(),80).verdict==='wrong', J.gradeEntry(entry(),80).note);
ok('down and it went down is right', J.gradeEntry(entry({expectation:'down'}),80).verdict==='right');
ok('a 1% move is flat, not a call', J.gradeEntry(entry(),101).verdict==='flat', J.gradeEntry(entry(),101).note);
ok('a small adverse move inside the horizon is early', J.gradeEntry(entry({createdAt:new Date(Date.now()-5*DAY).toISOString()}),95).verdict==='early', J.gradeEntry(entry({createdAt:new Date(Date.now()-5*DAY).toISOString()}),95).note);
ok('a material adverse move inside the horizon is wrong, not early', J.gradeEntry(entry({createdAt:new Date(Date.now()-5*DAY).toISOString()}),80).verdict==='wrong', J.gradeEntry(entry({createdAt:new Date(Date.now()-5*DAY).toISOString()}),80).note);
ok('wrong past the horizon is wrong', J.gradeEntry(entry({createdAt:new Date(Date.now()-200*DAY).toISOString()}),90).verdict==='wrong');
ok('no price leaves it unresolved', J.gradeEntry(entry(),null).verdict==='unresolved');
ok('a zero entry price cannot be graded', J.gradeEntry(entry({priceAtEntry:0}),120).verdict==='unresolved');
const closed=J.gradeEntry(entry({closedAt:new Date().toISOString(),closedPrice:150}),120);
ok('a closed winner grades on the closing price', closed.verdict==='right' && closed.returnPct===50, String(closed.returnPct));
ok('the return is reported to one decimal', J.gradeEntry(entry(),123.456).returnPct===23.5, String(J.gradeEntry(entry(),123.456).returnPct));

console.log('\n=== SCORECARD ===');
const mk=(v,c=3)=>({...entry(), verdict:v, confidence:c, currentPrice:100, returnPct:0, daysHeld:10, note:''});
const sc=J.journalScorecard([mk('right',4),mk('right',4),mk('wrong',2),mk('early')]);
ok('accuracy counts only resolved calls', sc.accuracy===67, String(sc.accuracy));
ok('unresolved calls are excluded from accuracy', sc.graded===3, String(sc.graded));
ok('early calls are counted separately', sc.early===1);
ok('confidence when right is tracked', sc.avgConfidenceWhenRight===4, String(sc.avgConfidenceWhenRight));
ok('confidence when wrong is tracked', sc.avgConfidenceWhenWrong===2, String(sc.avgConfidenceWhenWrong));
ok('the scorecard offers an insight', sc.insight.length>20, sc.insight.slice(0,70));
const empty=J.journalScorecard([]);
ok('an empty journal says so plainly', /No resolved calls/.test(empty.insight), empty.insight);
ok('low accuracy is stated bluntly', /Worth re-reading/.test(J.journalScorecard([mk('wrong'),mk('wrong'),mk('right')]).insight));

console.log('\n=== STORAGE (live) ===');
(async()=>{
  const fs=require('fs'),os=require('os'),path=require('path');
  const { createAtlas }=require('../dist/gateway');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'jv-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:15});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;
  ok('a one-word thesis is refused', (await (await post('/api/journal',{symbol:sym,thesis:'buy'})).json()).error !== undefined);
  const rec=await (await post('/api/journal',{symbol:sym,thesis:'Cheap on earnings with improving margins.',expectation:'up',horizonDays:90,confidence:4})).json();
  ok('a real thesis is recorded', rec.ok===true && rec.id>0, `id ${rec.id}`);
  const list=await (await fetch(`${base}/api/journal`)).json();
  ok('it comes back graded', list.entries.length===1 && typeof list.entries[0].verdict==='string', list.entries[0].verdict);
  ok('the entry price was captured', list.entries[0].priceAtEntry>0, String(list.entries[0].priceAtEntry));
  const entryPrice=list.entries[0].priceAtEntry;
  ok('closing an entry works', (await (await post(`/api/journal/close/${rec.id}`,{price:entryPrice*1.2,note:'target hit'})).json()).ok===true);
  ok('closing twice is refused', (await fetch(`${base}/api/journal/close/${rec.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status===404);
  const after=await (await fetch(`${base}/api/journal`)).json();
  ok('the closed entry shows its outcome', after.entries[0].closedAt!==null && after.entries[0].verdict==='right', after.entries[0].verdict);
  await post('/api/markets/switch',{code:'US'});
  const us=await (await fetch(`${base}/api/journal`)).json();
  ok('the journal does not cross markets', us.entries.length===0, `${us.entries.length} in US`);
  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nJOURNAL CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
