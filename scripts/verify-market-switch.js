// Switching markets in the UI: data must change completely and nothing may leak.
// This is the user-facing form of the isolation guarantee.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium } = require('playwright-core');
const { createAtlas } = require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ms-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/fin/api/setup/complete',{code:'IN'});
  await post('/api/fin/api/seed',{companies:30,seed:11});
  const inRows=(await (await post('/api/fin/api/screen',{expression:'Market Cap > 0',limit:200})).json()).rows;
  const inSyms=inRows.map(r=>r.symbol);
  // put one IN company on the watchlist so cross-market leakage of user data is tested too
  await post('/api/fin/api/watchlist/bulk',{symbols:[inSyms[0]]});

  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const p=await br.newPage({viewport:{width:1440,height:1000},bypassCSP:true});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,90)));
  await p.goto(B,{waitUntil:'networkidle'});
  await p.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2);

  console.log('=== STARTING MARKET ===');
  ok('India shows its companies', (await p.locator('#result-body tr').count())===30, `${await p.locator('#result-body tr').count()} rows`);
  const options=await p.locator('#market-select option').evaluateAll(os=>os.map(o=>o.value));
  ok('all nine markets are selectable', options.length===9, options.join(','));

  console.log('\n=== SWITCHING TO AN EMPTY MARKET ===');
  await p.selectOption('#market-select','US');
  await p.waitForTimeout(3500);
  ok('the US view has no Indian rows', (await p.locator('#result-body tr').count())===0, `${await p.locator('#result-body tr').count()} rows`);
  ok('the market label follows', (await p.locator('#market-select').inputValue())==='US');
  ok('an empty market explains itself', !(await p.locator('#empty').isHidden()));
  const body=await p.locator('body').innerText();
  const leaked=inSyms.filter(s=>body.includes(s));
  ok('no Indian symbol appears anywhere on the page', leaked.length===0, leaked.slice(0,3).join(',')||'none');

  console.log('\n=== WATCHLIST DOES NOT CROSS ===');
  await p.click('.navbtn[data-view="watchlist"]'); await p.waitForTimeout(1500);
  const wl=await p.locator('#view-watchlist').innerText();
  ok('the Indian watchlist entry is absent in the US', !wl.includes(inSyms[0]), inSyms[0]);

  console.log('\n=== SWITCHING BACK ===');
  await p.click('.navbtn[data-view="screener"]');
  await p.selectOption('#market-select','IN'); await p.waitForTimeout(3500);
  ok('India data returns intact', (await p.locator('#result-body tr').count())===30, `${await p.locator('#result-body tr').count()} rows`);
  await p.click('.navbtn[data-view="watchlist"]'); await p.waitForTimeout(1500);
  ok('the watchlist entry returns', (await p.locator('#view-watchlist').innerText()).includes(inSyms[0]), inSyms[0]);
  ok('no page errors throughout', errs.length===0, errs.slice(0,1).join(''));

  await br.close(); await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nMARKET SWITCH CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
