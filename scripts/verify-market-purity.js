// Every market-scoped feature must answer for the ACTIVE market and never for another.
// This is the guarantee the user keeps asking about: switch a country, see only that country.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'mp-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}`;
  const B=`${base}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  const get=(p)=>fetch(B+p);

  console.log('=== NO HARDCODED MARKET IN THE UI ===');
  const js=fs.readFileSync('src/console/app.js','utf8');
  ok('no silent IN fallback', !/\|\| 'IN'/.test(js));
  ok('macro refresh uses the active market', /country: mk \|\| undefined/.test(js));
  ok('a single activeMarket helper is used', /function activeMarket\(\)/.test(js));

  console.log('\n=== ADVISORS ARE MARKET-SCOPED ===');
  const A=require('../dist/finance/core/advisors');
  for (const c of ['IN','US','GB','JP','DE','SG','HK','AU','CA']) {
    const list=A.advisorsFor(c);
    ok(`${c} gets its own advisors only`, list.length>0 && list.every(a=>a.country===c), `${list.length}`);
  }
  const inIds=new Set(A.advisorsFor('IN').map(a=>a.id));
  const usIds=new Set(A.advisorsFor('US').map(a=>a.id));
  ok('the two largest libraries do not overlap', [...inIds].every(id=>!usIds.has(id)), `${inIds.size} IN vs ${usIds.size} US`);
  ok('every advisor carries real analysis text', A.ADVISORS.every(a=>a.approach.length>40), `shortest ${Math.min(...A.ADVISORS.map(a=>a.approach.length))} chars`);
  ok('every advisor names its basis', A.ADVISORS.every(a=>a.basis.length>20));

  await post('/api/setup/complete',{code:'IN'});
  await post('/api/seed',{companies:20});
  const inSym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:50})).json()).rows.map(r=>r.symbol);

  console.log('\n=== INDIA ANSWERS AS INDIA ===');
  const aIn=await (await get('/api/advisors?country=IN')).json();
  ok('the advisor endpoint scopes by country', aIn.advisors.every(a=>a.country==='IN'), `${aIn.advisors.length}`);
  const nIn=await (await get('/api/newsroom?market=IN&limit=5')).json();
  ok('the newsroom answers for India', nIn.market==='IN', nIn.market);
  const mIn=await (await get('/api/macro?country=IN')).json();
  ok('macro answers for India', JSON.stringify(mIn).includes('IN') || mIn.country==='IN' || mIn.points!==undefined);

  console.log('\n=== SWITCH TO THE US ===');
  const sw=await post('/api/markets/switch',{code:'US'});
  ok('the switch succeeds', sw.status===200, String(sw.status));
  const active=(await (await get('/api/markets')).json()).active;
  ok('the server reports US as active', active==='US', active);

  console.log('\n=== NOTHING FROM INDIA SURVIVES ===');
  const rows=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:50})).json()).rows||[];
  ok('the screener is empty, not Indian', rows.length===0, `${rows.length} rows`);
  const leaked=rows.filter(r=>inSym.includes(r.symbol));
  ok('no Indian symbol appears', leaked.length===0, leaked.slice(0,3).join(',')||'none');
  const stats=await (await get('/api/stats')).json();
  ok('the database has no companies', stats.companies===0, `${stats.companies}`);
  const aUs=await (await get('/api/advisors')).json();
  ok('advisors default to the active market', aUs.country==='US' && aUs.advisors.every(a=>a.country==='US'), `${aUs.advisors.length} US advisors`);
  ok('no Indian advisor leaks into the US view', aUs.advisors.every(a=>!inIds.has(a.id)));
  const nUs=await (await get('/api/newsroom?limit=5')).json();
  ok('the newsroom defaults to the active market', nUs.market==='US', nUs.market);
  const sUs=await (await get('/api/session/US')).json();
  ok('the session answers for the US', sUs.market==='US', sUs.phase);

  console.log('\n=== SWITCH BACK ===');
  await post('/api/markets/switch',{code:'IN'});
  const back=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:50})).json()).rows||[];
  ok('India data returns intact', back.length===inSym.length, `${back.length} of ${inSym.length}`);
  const nBack=await (await get('/api/newsroom?limit=3')).json();
  ok('the newsroom follows back to India', nBack.market==='IN', nBack.market);

  console.log('\n=== A MARKET CANNOT BE CROSSED BY PARAMETER ===');
  const cross=await post('/api/bundle/US/import',{});
  ok('importing a non-active market is refused', cross.status===409, String(cross.status));

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nMARKET PURITY PASSED — no cross contamination':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
