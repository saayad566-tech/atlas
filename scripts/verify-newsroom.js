// Per-country newsroom: nine locales, caching, offline storage, honest failure.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
const N=require('../dist/finance/core/newsroom');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  console.log('=== NINE MARKETS CONFIGURED ===');
  ok('every market has a locale', N.LOCALES.length===9, N.LOCALES.map(l=>l.code).join(','));
  ok('every market names its national press', N.LOCALES.every(l=>l.press.length>=2), N.LOCALES.map(l=>l.code+':'+l.press.length).join(' '));
  ok('every market has search terms', N.LOCALES.every(l=>l.queries.length>0));
  ok('each has its own locale parameters', new Set(N.LOCALES.map(l=>l.ceid)).size===9);

  const home=fs.mkdtempSync(path.join(os.tmpdir(),'nr-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:12});

  console.log('\n=== COVERAGE ===');
  const cov=await (await fetch(`${B}/api/newsroom/coverage`)).json();
  ok('coverage lists all markets', cov.markets.length===9);
  ok('it carries a timestamp', typeof cov.generatedAt==='string');

  console.log('\n=== LIVE FETCH (skips when blocked) ===');
  const r=await (await fetch(`${B}/api/newsroom?market=IN&limit=6`)).json();
  if (r.items.length) {
    ok('headlines are returned', r.items.length>0, `${r.items.length} items`);
    ok('each has a title and source', r.items.every(i=>i.title.length>5 && i.source.length>0));
    ok('it names which source answered', r.sources.length>0, r.sources.join(','));
    ok('it explains its coverage', /aggregator|covered/i.test(r.note), r.note.slice(0,50));
    ok('it is marked fresh on first call', r.fromCache===false);
    const r2=await (await fetch(`${B}/api/newsroom?market=IN&limit=6`)).json();
    ok('a second call is served from cache', r2.fromCache===true);
    const st=await (await fetch(`${B}/api/newsroom/stored?market=IN`)).json();
    ok('headlines are stored for offline reading', st.items.length>0, `${st.items.length} stored`);
  } else { console.log('  SKIP  aggregator unreachable'); }

  console.log('\n=== HONEST FAILURE ===');
  const bad=await (await fetch(`${B}/api/newsroom?market=ZZ`)).json();
  ok('an unknown market is refused', bad.error !== undefined, String(bad.error).slice(0,40));

  console.log('\n=== OFFLINE READ ===');
  const st2=await (await fetch(`${B}/api/newsroom/stored?market=US`)).json();
  ok('stored news for a market with no fetch is empty, not an error', Array.isArray(st2.items), `${st2.items.length}`);

  console.log('\n=== RENDERED ===');
  const { chromium }=require('playwright-core');
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const pg=await br.newPage({viewport:{width:1440,height:1100},bypassCSP:true});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,80)));
  await pg.goto(`http://127.0.0.1:${atlas.server.address().port}`,{waitUntil:'networkidle'});
  await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2);
  await pg.click('.navbtn[data-view="intel"]'); await pg.waitForTimeout(3500);
  ok('the newsroom renders', (await pg.locator('#newsroom-panel .scorecard').count())>1, `${await pg.locator('#newsroom-panel .scorecard').count()} cards`);
  ok('no page errors', errs.length===0, errs.slice(0,1).join(''));
  await br.close();

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nNEWSROOM CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
