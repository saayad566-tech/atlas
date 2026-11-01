// Provenance: synthetic data must be visibly marked wherever it appears.
// A fabricated company that looks identical to a real one is the one unacceptable failure.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium } = require('playwright-core');
const { createAtlas } = require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'pv-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/fin/api/setup/complete',{code:'IN'});
  await post('/api/fin/api/seed',{companies:20});

  console.log('=== THE API CARRIES PROVENANCE ===');
  const rows=(await (await post('/api/fin/api/screen',{expression:'Market Cap > 0',limit:5})).json()).rows;
  ok('every screener row states its source', rows.every(r=>typeof r.source==='string' && r.source.length>0), rows[0]?.source);
  ok('demo rows are marked fixture', rows.every(r=>r.source==='fixture'), rows[0]?.source);

  console.log('\n=== THE UI MARKS EVERY SYNTHETIC ROW ===');
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const p=await br.newPage({viewport:{width:1440,height:1000},bypassCSP:true});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,90)));
  await p.goto(B,{waitUntil:'networkidle'});
  await p.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2);
  await p.waitForTimeout(2000);
  const rowCount=await p.locator('#result-body tr').count();
  const tagCount=await p.locator('#result-body .demotag').count();
  ok('a demo tag appears on every synthetic row', tagCount===rowCount, `${tagCount} tags / ${rowCount} rows`);
  const firstRow=await p.locator('#result-body tr').first().innerText();
  ok('the tag reads "demo"', /demo/i.test(firstRow), firstRow.replace(/\n/g,' ').slice(0,50));

  console.log('\n=== THE COMPANY PAGE MARKS IT TOO ===');
  await p.locator('#result-body tr').first().click();
  await p.waitForTimeout(2500);
  const coText=await p.locator('#view-company').innerText();
  ok('the company page says demo data', /demo data/i.test(coText), 'present');

  console.log('\n=== REAL DATA IS NOT MARKED ===');
  // A live company must not carry the demo tag; verified at the API level since the
  // network may be unavailable.
  const live=await post('/api/fin/api/live/fetch',{symbol:'RELIANCE.NS'});
  if (live.status===200) {
    const lr=(await (await post('/api/fin/api/screen',{expression:'Symbol = "RELIANCE.NS"',limit:1})).json()).rows[0];
    ok('a live company is not marked fixture', lr && lr.source!=='fixture', lr?.source);
  } else { console.log('  SKIP  live fetch unavailable — real-data marking not checked'); }

  ok('no page errors', errs.length===0, errs.slice(0,1).join(''));
  await br.close(); await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nPROVENANCE CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
