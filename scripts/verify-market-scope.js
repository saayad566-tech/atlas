// Market scope: switching a country must change every market-specific panel,
// and nothing from the previous market may survive the switch.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium }=require('playwright-core');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ms-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}`;
  const post=(p,b)=>fetch(`${base}/api/fin${p}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:12});
  const inSymbols=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:50})).json()).rows.map(r=>r.symbol);

  console.log('=== NO HARDCODED MARKET FALLBACK ===');
  const src=fs.readFileSync('src/console/app.js','utf8');
  ok('no call silently defaults to IN', !/state\.market \|\| 'IN'/.test(src));
  ok('a single activeMarket helper exists', /function activeMarket\(\)/.test(src));
  ok('the market is read from the server on boot', /api\/markets/.test(src) && /state\.market = active/.test(src));

  console.log('\n=== NEWS FOLLOWS THE MARKET ===');
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const pg=await br.newPage({viewport:{width:1440,height:1100},bypassCSP:true});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,80)));
  await pg.goto(base,{waitUntil:'networkidle'});
  await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2);
  await pg.click('.navbtn[data-view="intel"]'); await pg.waitForTimeout(4000);
  const inNews=await pg.locator('#newsroom-panel').innerText().catch(()=>'');
  ok('India shows a newsroom', inNews.length>20, inNews.split('\n')[0]?.slice(0,45));

  await pg.selectOption('#market-select','US'); await pg.waitForTimeout(7000);
  await pg.click('.navbtn[data-view="intel"]').catch(()=>{}); await pg.waitForTimeout(4500);
  const usNews=await pg.locator('#newsroom-panel').innerText().catch(()=>'');
  ok('the market label followed', (await pg.locator('#market-select').inputValue())==='US');
  ok('the newsroom changed with the market', inNews!==usNews && usNews.length>20, usNews.split('\n')[0]?.slice(0,45));

  console.log('\n=== DATA DOES NOT CROSS ===');
  const body=await pg.locator('body').innerText();
  const leaked=inSymbols.filter(s=>body.includes(s));
  ok('no Indian symbol appears in the US view', leaked.length===0, leaked.slice(0,3).join(',')||'none');
  ok('the US screener is empty, not Indian', (await pg.locator('#result-body tr').count())===0, `${await pg.locator('#result-body tr').count()} rows`);

  console.log('\n=== SWITCHING BACK ===');
  await pg.selectOption('#market-select','IN'); await pg.waitForTimeout(7000);
  await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2,{timeout:20000}).catch(()=>{});
  ok('India data returns', (await pg.locator('#result-body tr').count())>2, `${await pg.locator('#result-body tr').count()} rows`);
  ok('no page errors throughout', errs.length===0, errs.slice(0,1).join(''));
  await br.close();

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nMARKET SCOPE CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
