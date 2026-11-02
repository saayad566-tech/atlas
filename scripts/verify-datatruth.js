// Data truth: every claim about coverage, freshness and provenance must be checkable.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:12});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;

  console.log('=== COMPANY DATA TRUTH ===');
  const t=await (await fetch(`${B}/api/data-truth/${encodeURIComponent(sym)}`)).json();
  ok('it answers', !!t.symbol, t.symbol);
  ok('it checks every data type', t.types.length>=8, `${t.types.length} types`);
  ok('each type reports coverage and rows', t.types.every(x=>['present','partial','missing'].includes(x.coverage) && typeof x.rows==='number'));
  ok('completeness is a percentage', t.completenessPct>=0 && t.completenessPct<=100, `${t.completenessPct}%`);
  ok('it states a verdict', ['well supported','usable with gaps','thin'].includes(t.verdict), t.verdict);
  ok('synthetic data is flagged', t.synthetic===true && t.warnings.some(w=>/Synthetic/i.test(w)), t.warnings[0]?.slice(0,40));
  ok('it reports freshness', typeof t.freshnessDays==='number' || t.freshnessDays===null, `${t.freshnessDays} days`);
  ok('every type explains why it matters', t.types.every(x=>x.note.length>10));
  ok('unknown symbol is 404', (await fetch(`${B}/api/data-truth/NOPE.XX`)).status===404);

  console.log('\n=== MARKET DATA TRUTH ===');
  const m=await (await fetch(`${B}/api/data-truth`)).json();
  ok('it answers', typeof m.companies==='number', `${m.companies} companies`);
  ok('synthetic and real are separated', m.synthetic + m.real === m.companies, `${m.synthetic} synthetic / ${m.real} real`);
  ok('it reports average completeness', m.averageCompletenessPct>=0, `${m.averageCompletenessPct}%`);
  ok('it counts stale prices', typeof m.stalePrices==='number', `${m.stalePrices}`);
  ok('it lists coverage per type', m.byType.length>=8, `${m.byType.length} types`);
  ok('it explains the synthetic count in words', /synthetic demo data/i.test(m.note), m.note.slice(0,50));

  console.log('\n=== HONESTY: REAL DATA IS NOT CALLED SYNTHETIC ===');
  // Seeding a live company must flip the flag; skipped when the network is unavailable.
  const live=await post('/api/live/fetch',{symbol:'RELIANCE.NS'});
  if (live.status===200) {
    const lt=await (await fetch(`${B}/api/data-truth/RELIANCE.NS`)).json();
    ok('a live company is not flagged synthetic', lt.synthetic===false, lt.source);
    ok('a live company has real prices', lt.types.find(x=>x.key==='prices').coverage!=='missing');
  } else { console.log('  SKIP  live source unavailable'); }

  console.log('\n=== RENDERED ===');
  const { chromium }=require('playwright-core');
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const pg=await br.newPage({viewport:{width:1440,height:1100},bypassCSP:true});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,80)));
  await pg.goto(`http://127.0.0.1:${atlas.server.address().port}`,{waitUntil:'networkidle'});
  await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2);
  await pg.locator('#result-body tr').first().click(); await pg.waitForTimeout(3500);
  ok('the panel renders', (await pg.locator('#co-datatruth .scorecard').count())>=9, `${await pg.locator('#co-datatruth .scorecard').count()} cards`);
  ok('no page errors', errs.length===0, errs.slice(0,1).join(''));
  await br.close();

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nDATA TRUTH CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
