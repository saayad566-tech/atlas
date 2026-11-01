// Every country bundle, one by one: each market seeds its own data, every screen has
// data for that country, and nothing crosses between markets.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas } = require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'bd-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const j=async p=>(await fetch(B+p)).json();
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});

  console.log('=== FIRST RUN: NO DEFAULT MARKET ===');
  const st0=await j('/api/setup/status');
  ok('starts unconfigured', st0.configured===false, `active: ${st0.active}`);
  ok('nine bundles offered', st0.markets.length===9, st0.markets.map(m=>m.code).join(','));
  const blocked=await fetch(`${B}/api/screen`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expression:'Market Cap > 0'})});
  const blockedBody=await blocked.json();
  ok('data routes refuse until setup', blocked.status===428 && blockedBody.code==='SETUP_REQUIRED', `HTTP ${blocked.status}`);
  ok('refusal lists the choices', (blockedBody.markets||[]).length===9);

  const seen=new Map();   // market → symbols
  const codes=st0.markets.map(m=>m.code);
  for (const code of codes) {
    console.log(`\n=== BUNDLE ${code} ===`);
    const setup=await (await post('/api/setup/complete',{code})).json();
    ok(`${code}: setup completes`, setup.configured===true && setup.market.code===code, `${setup.market.currency} ${setup.market.suffix||'(no suffix)'}`);
    await post('/api/seed',{companies:12,market:code});
    const ready=await j(`/api/markets/readiness/${code}`);
    ok(`${code}: has companies`, ready.companies>0, `${ready.companies}`);
    const notReady=ready.features.filter(f=>!f.ready);
    ok(`${code}: every screen has data`, notReady.length===0, notReady.map(f=>f.feature).join(', ')||`${ready.features.length} features ready`);
    // a full feature audit on one company of THIS market
    const rows=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:100})).json()).rows;
    const syms=rows.map(r=>r.symbol);
    seen.set(code,syms);
    const audit=await j(`/api/audit/${encodeURIComponent(syms[0])}`);
    ok(`${code}: feature audit passes`, audit.passed===audit.total, `${audit.passed}/${audit.total}`);
    ok(`${code}: atlas score computes`, (await j(`/api/atlas-score/${encodeURIComponent(syms[0])}`)).score>0);
    ok(`${code}: valuation computes`, !!(await j(`/api/valuation2/${encodeURIComponent(syms[0])}`)).blended);
    // isolation against every previously seeded market
    let overlap=0;
    for (const [prev,psyms] of seen) { if (prev===code) continue; overlap += syms.filter(s=>psyms.includes(s)).length; }
    ok(`${code}: no symbol shared with any other market`, overlap===0, `overlap ${overlap}`);
  }

  console.log('\n=== CROSS-MARKET SUMMARY ===');
  ok('nine separate database files', fs.readdirSync(path.join(home,'markets')).filter(f=>f.endsWith('.db')).length===9, fs.readdirSync(path.join(home,'markets')).filter(f=>f.endsWith('.db')).length+' files');
  const sizes=fs.readdirSync(path.join(home,'markets')).filter(f=>f.endsWith('.db')).map(f=>fs.statSync(path.join(home,'markets',f)).size);
  ok('every market file has content', sizes.every(s=>s>1000), sizes.map(s=>Math.round(s/1024)+'KB').join(' '));

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nBUNDLE CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
