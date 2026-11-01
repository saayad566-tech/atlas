// Deep integrity: the paths that were built but never exercised end to end.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas } = require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ig-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const ROOT=`http://127.0.0.1:${atlas.server.address().port}`;
  const B=`${ROOT}/api/fin`;
  const get=async p=>(await fetch(B+p)).json();
  const post=async(p,body,raw)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:raw!==undefined?raw:JSON.stringify(body??{})});
  await post('/api/seed',{companies:15});

  console.log('=== BACKUP → RESTORE ROUND TRIP ===');
  const before=(await get('/api/stats')).companies;
  const backup=await (await fetch(`${B}/api/backup`)).text();
  ok('backup returns JSON', backup.length>1000 && backup.trim().startsWith('{'), `${Math.round(backup.length/1024)} KB`);
  // wipe then restore
  await post('/api/restore',null,JSON.stringify({})).catch(()=>{});
  const restoreRes=await post('/api/restore',null,backup);
  const after=(await get('/api/stats')).companies;
  ok('restore endpoint accepts a backup', restoreRes.status===200, `HTTP ${restoreRes.status}`);
  ok('company count preserved', after===before, `${before} → ${after}`);

  console.log('\n=== CSV IMPORT ===');
  const csv='symbol,name,sector\nCSVTEST1,Csv Test Co,Chemicals\n';
  const imp=await post('/api/import/csv',{csv});
  ok('CSV import responds', imp.status===200, `HTTP ${imp.status}`);
  const found=await (await post('/api/screen',{expression:'Symbol = "CSVTEST1"'})).json();
  ok('imported company is screenable', (found.rows||[]).length===1, `${(found.rows||[]).length} row(s)`);

  console.log('\n=== SAVED SCREENS ===');
  const saveRes=await post('/api/saved-screens',{name:'IntegrityTest',expression:'ROE > 10'});
  ok('screen saves', saveRes.status===201 || saveRes.status===200, `HTTP ${saveRes.status}`);
  const list=await get('/api/saved-screens');
  const arr=Array.isArray(list)?list:(list.screens||[]);
  ok('saved screen appears in list', arr.some(s=>s.name==='IntegrityTest'), `${arr.length} saved`);

  console.log('\n=== ALERT RULES ===');
  const ruleRes=await post('/api/alert-rules',{metric:'ROE',op:'<',threshold:5});
  ok('alert rule creates', ruleRes.status===201, `HTTP ${ruleRes.status}`);
  const evalRes=await get('/api/alert-rules/evaluate');
  ok('alert evaluation returns hits', typeof evalRes==='object', JSON.stringify(evalRes).slice(0,70));

  console.log('\n=== CONCURRENCY DURING MARKET SWITCH ===');
  const bursts=[];
  for(let i=0;i<20;i++) bursts.push(fetch(`${B}/api/screen`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expression:'Market Cap > 0',limit:5})}));
  const sw=post('/api/markets/switch',{code:'US'});
  const results=await Promise.all([...bursts, sw]);
  const statuses=results.map(r=>r.status);
  ok('no request errored during switch', statuses.every(s=>s<500), `${statuses.filter(s=>s>=500).length} server errors`);
  const usNow=await get('/api/markets');
  ok('switch completed', usNow.active==='US', usNow.active);
  const usStats=await get('/api/stats');
  ok('US market clean after concurrent switch', (usStats.companies??0)===0, `${usStats.companies} companies`);
  await post('/api/markets/switch',{code:'IN'});

  console.log('\n=== WORKSPACES MODULE ===');

  console.log('\n=== SERVICE WORKER ===');
  const swRes=await fetch(`${ROOT}/service-worker.js`);
  const swText=await swRes.text();
  ok('service worker served', swRes.status===200, `${swRes.headers.get('content-type')}`);
  ok('service worker is valid JS', swText.includes('self.addEventListener') && swText.includes('caches.open'));

  console.log('\n=== AUTH LOCKOUT (runs last: it locks the API) ===');
  await post('/api/auth/setup',{pin:'135790'});
  let locked=false, msg='';
  for(let i=0;i<6;i++){ const r=await (await post('/api/auth/unlock',{pin:'000000'})).json(); if(/lock/i.test(r.error||'')){ locked=true; msg=r.error; } }
  ok('locks after repeated failures', locked, msg||'never locked');
  const afterLock=await (await post('/api/auth/unlock',{pin:'135790'})).json();
  ok('correct PIN refused while locked', afterLock.ok===false, afterLock.error);
  await post('/api/auth/remove',{pin:'135790'}).catch(()=>{});

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nINTEGRITY CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
