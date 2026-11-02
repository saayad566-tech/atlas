// Trading sessions across nine markets, and the command palette.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium }=require('playwright-core');
const { createAtlas }=require('../dist/gateway');
const S=require('../dist/finance/core/session');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== SESSIONS: NINE MARKETS ===');
ok('every market has hours', S.MARKET_HOURS.length===9, S.MARKET_HOURS.map(m=>m.code).join(','));
ok('every market has a timezone', S.MARKET_HOURS.every(m=>m.timezone.includes('/')));

// India: 09:15-15:30 IST
const ist = (h,m,dow='2026-11-06') => new Date(`${dow}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+05:30`);
ok('India open at 10:00', S.sessionFor('IN',ist(10,0)).phase==='open');
ok('India closed at 09:00', S.sessionFor('IN',ist(9,0)).phase==='pre' || S.sessionFor('IN',ist(9,0)).phase==='closed');
ok('India closed at 16:00', S.sessionFor('IN',ist(16,0)).phase==='closed');
ok('India closed on Saturday', S.sessionFor('IN',ist(10,0,'2026-11-07')).phase==='closed');
ok('weekend countdown lands on Monday', /1d 2\dh/.test(S.sessionFor('IN',ist(10,0,'2026-11-07')).label) || S.sessionFor('IN',ist(10,0,'2026-11-07')).minutesToChange>1400, S.sessionFor('IN',ist(10,0,'2026-11-07')).label);

// Japan lunch 11:30-12:30 JST
const jst = (h,m) => new Date(`2026-11-06T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+09:00`);
ok('Japan has a lunch break at 12:00', S.sessionFor('JP',jst(12,0)).phase==='lunch');
ok('Japan open at 10:00', S.sessionFor('JP',jst(10,0)).phase==='open');
ok('Japan open again at 13:00', S.sessionFor('JP',jst(13,0)).phase==='open');

// US pre-market
const et = (h,m) => new Date(`2026-11-06T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00-05:00`);
ok('US pre-market at 06:00', S.sessionFor('US',et(6,0)).phase==='pre');
ok('US open at 11:00', S.sessionFor('US',et(11,0)).phase==='open');
ok('US after hours at 18:00', S.sessionFor('US',et(18,0)).phase==='after');

ok('countdown is positive', S.allSessions().every(s=>s.minutesToChange>=0));
ok('every session has a label', S.allSessions().every(s=>s.label.length>5));

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'sc-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}`;
  const post=(p,b)=>fetch(`${base}/api/fin${p}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:20});

  console.log('\n=== SESSION ENDPOINT ===');
  const all=await (await fetch(`${base}/api/fin/api/session`)).json();
  ok('it returns all nine', all.sessions.length===9);
  ok('it states its limitation honestly', /holiday/i.test(all.note), all.note.slice(0,50));
  const one=await (await fetch(`${base}/api/fin/api/session/JP`)).json();
  ok('one market answers', one.market==='JP', one.phase);
  ok('unknown market is 404', (await fetch(`${base}/api/fin/api/session/ZZ`)).status===404);

  console.log('\n=== COMMAND PALETTE ===');
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const pg=await br.newPage({viewport:{width:1440,height:1000},bypassCSP:true});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,80)));
  await pg.goto(base,{waitUntil:'networkidle'});
  await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2);

  ok('the palette starts hidden', await pg.locator('#cmdk').isHidden());
  await pg.keyboard.press('Control+k');
  await pg.waitForTimeout(600);
  ok('Ctrl+K opens it', await pg.locator('#cmdk').isVisible());
  const rows=await pg.locator('#cmdk-list .cmdkitem').count();
  ok('it lists companies', rows>0, `${rows} items`);
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(300);
  ok('Escape closes it', await pg.locator('#cmdk').isHidden());
  ok('the session badge is shown', (await pg.locator('#session-badge').count())===1);
  ok('no page errors', errs.length===0, errs.slice(0,1).join(''));
  await br.close();

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nSESSION + PALETTE CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
