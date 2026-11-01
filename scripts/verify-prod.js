// Production-readiness checks: auth, rate limiting, headers, health, jobs, errors.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas } = require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'prod-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  await fetch(`${B}/api/seed`,{method:'POST',body:JSON.stringify({companies:5})});

  const health=await (await fetch(`${B}/api/health`)).json();
  ok('health endpoint public', health.ok===true, `v${health.version}, ${health.db.companies} companies`);
  const hdr=(await fetch(`${B}/api/health`)).headers;
  ok('security headers present', hdr.get('x-content-type-options')==='nosniff' && hdr.get('x-frame-options')==='DENY' && !!hdr.get('content-security-policy'));

  const status=await (await fetch(`${B}/api/auth/status`)).json();
  ok('auth reports open mode initially', status.configured===false);
  const set=await (await fetch(`${B}/api/auth/setup`,{method:'POST',body:JSON.stringify({pin:'482913'})})).json();
  ok('PIN can be set', set.ok===true);
  const gated=await fetch(`${B}/api/screen`,{method:'POST',body:JSON.stringify({expression:'Market Cap > 0'})});
  const gbody=await gated.json();
  ok('API gated without token', gated.status===401 && gbody.code==='UNAUTHORISED', JSON.stringify(gbody).slice(0,60));
  const wrong=await (await fetch(`${B}/api/auth/unlock`,{method:'POST',body:JSON.stringify({pin:'999999'})})).json();
  ok('wrong PIN refused', wrong.ok===false, wrong.error);
  const right=await (await fetch(`${B}/api/auth/unlock`,{method:'POST',body:JSON.stringify({pin:'482913'})})).json();
  ok('correct PIN mints a session', right.ok===true && right.token.length===64);
  const authed=await fetch(`${B}/api/screen`,{method:'POST',body:JSON.stringify({expression:'Market Cap > 0'}),headers:{authorization:`Bearer ${right.token}`}});
  ok('authorised request succeeds', authed.status===200);
  const badTok=await fetch(`${B}/api/screen`,{method:'POST',body:JSON.stringify({expression:'Market Cap > 0'}),headers:{authorization:'Bearer deadbeef'}});
  ok('forged token rejected', badTok.status===401);

  const jobs=await (await fetch(`${B}/api/jobs`,{headers:{authorization:`Bearer ${right.token}`}})).json();
  ok('job queue reports state', typeof jobs.queued==='number', JSON.stringify(jobs));

  // rate limiting: hammer the endpoint
  let limited=false;
  for(let i=0;i<300;i++){ const r=await fetch(`${B}/api/health`); if(r.status===429){ limited=true; break; } }
  ok('rate limiter engages', limited, 'after sustained requests');

  const notFound=await fetch(`${B}/api/nope`,{headers:{authorization:`Bearer ${right.token}`}});
  const nfBody=await notFound.json();
  ok('unknown route returns a clean envelope', notFound.status===404 || nfBody.code, `${notFound.status} ${JSON.stringify(nfBody).slice(0,50)}`);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nPRODUCTION CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
