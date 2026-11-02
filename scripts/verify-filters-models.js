// Filters must actually filter, and the model catalogue must explain each choice.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium }=require('playwright-core');
const { createAtlas }=require('../dist/gateway');
const { MODEL_CATALOGUE }=require('../dist/finance/core/modelmanager');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  console.log('=== MODEL CATALOGUE ===');
  ok('a real choice of models', MODEL_CATALOGUE.length>=10, `${MODEL_CATALOGUE.length} models`);
  ok('every model says what it is', MODEL_CATALOGUE.every(m=>m.description && m.description.length>15));
  ok('every model says what it is good for', MODEL_CATALOGUE.every(m=>m.bestFor && m.bestFor.length>15));
  ok('every model states its RAM need', MODEL_CATALOGUE.every(m=>typeof m.ramNeededMb==='number' && m.ramNeededMb>0));
  ok('every model states its licence', MODEL_CATALOGUE.every(m=>m.licence && m.licence.length>=2));
  ok('every model has a download source', MODEL_CATALOGUE.every(m=>/^https:\/\//.test(m.source)));
  ok('no duplicate ids', new Set(MODEL_CATALOGUE.map(m=>m.id)).size===MODEL_CATALOGUE.length);

  const home=fs.mkdtempSync(path.join(os.tmpdir(),'fm-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}`;
  const post=(p,b)=>fetch(`${base}/api/fin${p}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:40});

  console.log('\n=== MODEL ENDPOINT ===');
  const mp=await (await fetch(`${base}/api/fin/api/models`)).json();
  ok('it lists the catalogue', mp.models.length>=10, `${mp.models.length}`);
  ok('it reports this device', typeof mp.device?.ramMb==='number', `${mp.device?.ramMb}MB RAM`);
  ok('it says which models fit', mp.models.every(m=>typeof m.fitsThisDevice==='boolean'), `${mp.models.filter(m=>m.fitsThisDevice).length} fit`);
  ok('it recommends one', mp.recommended!==null, String(mp.recommended));

  console.log('\n=== FILTERS ACTUALLY FILTER ===');
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const pg=await br.newPage({viewport:{width:1440,height:1000},bypassCSP:true});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,80)));
  await pg.goto(base,{waitUntil:'networkidle'});
  await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2);
  const run=async(expr)=>{ await pg.fill('#expr',expr); await pg.click('#btn-apply'); await pg.waitForTimeout(1600); return pg.locator('#result-body tr').count(); };

  const all=await pg.locator('#result-body tr').count();
  ok('a baseline exists', all>10, `${all} rows`);
  const roe20=await run('ROE > 20');
  ok('ROE > 20 narrows the set', roe20<all, `${all} → ${roe20}`);
  const impossible=await run('ROE > 999');
  ok('an impossible filter returns nothing', impossible===0, `${impossible}`);
  const pe=await run('P/E < 15');
  ok('a different filter gives a different set', pe!==roe20 || pe<all, `P/E<15 → ${pe}`);
  const combined=await run('ROE > 20 AND P/E < 15');
  ok('combining filters narrows further', combined<=Math.min(roe20,pe), `${combined}`);
  const restored=await run('Market Cap > 0');
  ok('clearing restores the full set', restored===all, `${restored} of ${all}`);
  ok('no page errors', errs.length===0, errs.slice(0,1).join(''));

  console.log('\n=== NO DUPLICATE ATTRIBUTES ===');
  const html=fs.readFileSync('src/console/index.html','utf8');
  const dupes=[...html.matchAll(/<input[^>]*>/g)].filter(m=>(m[0].match(/aria-label=/g)||[]).length>1);
  ok('no input has two aria-labels', dupes.length===0, `${dupes.length} found`);

  await br.close(); await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nFILTER + MODEL CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
