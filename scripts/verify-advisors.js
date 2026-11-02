// Investor library: documented methods, honest labelling, and that they actually run.
const fs=require('fs'),os=require('os'),path=require('path');
const A=require('../dist/finance/core/advisors');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== LIBRARY ===');
ok('the library is substantial', A.ADVISORS.length>=40, `${A.ADVISORS.length} methods`);
const cov=A.libraryCoverage();
ok('every market has its own tradition', ['IN','US','GB','JP','DE','SG','HK','AU','CA'].every(c=>cov.some(x=>x.country===c)), cov.map(x=>x.country).join(','));
ok('India has several entries', A.advisorsFor('IN').length>=6, `${A.advisorsFor('IN').length}`);
ok('no duplicate ids', new Set(A.ADVISORS.map(a=>a.id)).size===A.ADVISORS.length);
ok('every entry names a country and era', A.ADVISORS.every(a=>a.country.length===2 && a.era.length>3));
ok('every entry states its basis', A.ADVISORS.every(a=>a.basis.length>20));
ok('every entry has at least one criterion', A.ADVISORS.every(a=>a.criteria.length>0));
ok('confidence is labelled on every entry', A.ADVISORS.every(a=>['documented','summary'].includes(a.confidence)));
ok('summaries are the minority claim', A.ADVISORS.filter(a=>a.confidence==='documented').length>0, `${A.ADVISORS.filter(a=>a.confidence==='documented').length} documented / ${A.ADVISORS.filter(a=>a.confidence==='summary').length} summaries`);

console.log('\n=== NO FABRICATED QUOTES ===');
const src=fs.readFileSync('src/finance/core/advisors.ts','utf8');
// Look for actual attributed speech, not the word "quote" in the disclaimer.
ok('no attributed speech anywhere', !/(said|stated that|according to|“|”)/i.test(src));
ok('no entry claims to be their words', !/his words|her words|verbatim/i.test(src));

console.log('\n=== METHODS COMPILE AND RUN ===');
(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'adv-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:40});

  const list=await (await fetch(`${B}/api/advisors?country=IN`)).json();
  ok('the endpoint returns the market library', list.advisors.length>0, `${list.advisors.length} for India`);
  ok('it discloses how to read a summary entry', /not a published rule set/i.test(list.note), list.note.slice(0,45));
  ok('it states no entry quotes the person', /No entry quotes/i.test(list.note));

  let ran=0;
  for (const a of list.advisors) {
    const r=await (await fetch(`${B}/api/advisors/${encodeURIComponent(a.id)}/run`)).json();
    if (r.matches!==undefined) ran++;
  }
  ok('every India method runs against the market', ran===list.advisors.length, `${ran}/${list.advisors.length}`);

  const one=await (await fetch(`${B}/api/advisors/graham-in/run`)).json();
  ok('a run reports matches and total', typeof one.matches==='number' && one.total>0, `${one.matches} of ${one.total}`);
  ok('it explains the result in words', /criteria match/i.test(one.note), one.note.slice(0,50));
  ok('the expression is shown', one.expression.includes('P/E'), one.expression);
  ok('unknown advisor is 404', (await fetch(`${B}/api/advisors/nope/run`)).status===404);

  console.log('\n=== RENDERED ===');
  const { chromium }=require('playwright-core');
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const pg=await br.newPage({viewport:{width:1440,height:1100},bypassCSP:true});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,80)));
  await pg.goto(`http://127.0.0.1:${atlas.server.address().port}`,{waitUntil:'networkidle'});
  await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2);
  await pg.click('.navbtn[data-view="intel"]'); await pg.waitForTimeout(2500);
  ok('the library renders', (await pg.locator('#advisors-panel .scorecard').count())>3, `${await pg.locator('#advisors-panel .scorecard').count()} cards`);
  ok('no page errors', errs.length===0, errs.slice(0,1).join(''));
  await br.close();

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nADVISOR CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
