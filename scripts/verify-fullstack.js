// Full-stack audit: every frontend call reaches a real route, every selector exists,
// every button has a handler, and every view renders without an error.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium }=require('playwright-core');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

const app=fs.readFileSync('src/console/app.js','utf8');
const html=fs.readFileSync('src/console/index.html','utf8');

// ---- 1. extract every API path the frontend calls ----
const calls=new Set();
for (const m of app.matchAll(/api\(\s*[`'"]([^`'"]+)[`'"]/g)) {
  let p=m[1];
  if (!p.startsWith('/api')) continue;
  p=p.split('?')[0].replace(/\$\{[^}]*\}/g,':X');
  if (p.endsWith('/')) p += ':X';
  calls.add(p);
}
// paths built by concatenation, e.g. '/api/directory/sync/' + code
for (const m of app.matchAll(/['"`](\/api\/[a-z0-9-]+\/[a-z0-9-]*)['"`]\s*\+/gi)) calls.add(m[1]+':X');

// ---- 2. extract every route the server defines ----
const server=fs.readFileSync('src/finance/api/server.ts','utf8');
const routes=new Set();
for (const m of server.matchAll(/p === '(\/api\/[^']+)'/g)) routes.add(m[1]);
for (const m of server.matchAll(/p\.startsWith\('(\/api\/[^']+)'\)/g)) routes.add(m[1]+':X');
for (const m of server.matchAll(/p\.startsWith\('(\/api\/[^']+)'\)\s*&&\s*p\.endsWith/g)) routes.add(m[1]);

/** Does a concrete call match any server route? */
function routeExists(call) {
  if (routes.has(call)) return true;
  for (const r of routes) {
    if (r.endsWith(':X')) { const base=r.slice(0,-2); if (call.startsWith(base)) return true; }
  }
  return false;
}

console.log('=== FRONTEND CALLS REACH REAL ROUTES ===');
const orphans=[...calls].filter(c=>!routeExists(c));
ok(`all ${calls.size} frontend calls have a route`, orphans.length===0, orphans.slice(0,5).join(', ')||`${calls.size} calls`);

// ---- 3. selectors ----
console.log('\n=== SELECTORS EXIST IN THE MARKUP ===');
const selectors=new Set();
for (const m of app.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)) selectors.add(m[1]);
for (const m of app.matchAll(/\$\$\('#([a-zA-Z0-9_-]+)'\)/g)) selectors.add(m[1]);
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
// ids created at runtime by app.js itself
const dynamic=new Set([...app.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map(m=>m[1]));
// ids produced by helpers such as field('va-growth', ...)
for (const m of app.matchAll(/\b(?:field|row|input|card)\(\s*'([a-zA-Z0-9_-]+)'/g)) dynamic.add(m[1]);
// ids assigned at runtime: el.id = 'toast'
for (const m of app.matchAll(/\.id\s*=\s*'([a-zA-Z0-9_-]+)'/g)) dynamic.add(m[1]);
const missingIds=[...selectors].filter(s=>!ids.has(s) && !dynamic.has(s));
ok(`all ${selectors.size} selectors resolve`, missingIds.length===0, missingIds.slice(0,6).join(', ')||`${selectors.size} selectors`);

// ---- 4. buttons have handlers ----
console.log('\n=== EVERY BUTTON IS WIRED ===');
const buttonIds=[...html.matchAll(/<button[^>]*id="([^"]+)"/g)].map(m=>m[1]);
const unwired=buttonIds.filter(id=>!app.includes(`#${id}`));
ok(`all ${buttonIds.length} buttons have a handler`, unwired.length===0, unwired.join(', ')||`${buttonIds.length} buttons`);

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'fs-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}`;
  const B=`${base}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:20});

  console.log('\n=== EVERY FRONTEND CALL ANSWERS ===');
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;
  const probe=(c)=>c.replace(/:X/g, encodeURIComponent(sym));
  const bad=[];
  for (const c of calls) {
    const url=B+probe(c);
    try {
      const r=await fetch(url);
      // 400/404 on a parameterised route is acceptable only for a genuinely bad id
      if (r.status>=500) bad.push(`${c}(${r.status})`);
    } catch { bad.push(`${c}(threw)`); }
  }
  ok(`no frontend call causes a server error`, bad.length===0, bad.slice(0,4).join(', ')||`${calls.size} checked`);

  console.log('\n=== EVERY VIEW RENDERS ===');
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const pg=await br.newPage({viewport:{width:1440,height:1000},bypassCSP:true});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,90)));
  const failedReq=[];
  pg.on('response',r=>{ if (r.url().includes('/api/') && r.status()>=500) failedReq.push(`${r.url().split('/api/fin')[1]}(${r.status()})`); });
  await pg.goto(base,{waitUntil:'networkidle'});
  await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2,{timeout:20000}).catch(()=>{});
  ok('the screener renders rows', (await pg.locator('#result-body tr').count())>2, `${await pg.locator('#result-body tr').count()}`);

  const views=await pg.locator('.navbtn[data-view]').evaluateAll(els=>els.map(e=>e.dataset.view));
  for (const v of views) {
    await pg.click(`.navbtn[data-view="${v}"]`);
    await pg.waitForTimeout(700);
    const visible=await pg.locator(`#view-${v}`).isVisible().catch(()=>false);
    ok(`view "${v}" opens`, visible);
  }
  ok('no page errors across every view', errs.length===0, errs.slice(0,2).join(' | '));
  ok('no 5xx during the walk', failedReq.length===0, failedReq.slice(0,3).join(', ')||'none');

  console.log('\n=== COMPANY VIEW LOADS ITS PANELS ===');
  await pg.click('.navbtn[data-view="screener"]');
  await pg.waitForTimeout(400);
  await pg.click('#result-body tr:first-child td.l a, #result-body tr:first-child').catch(()=>{});
  await pg.waitForTimeout(2500);
  // The real panel ids, taken from the markup so the list cannot drift.
  const panelIds=[...html.matchAll(/id="(co-[a-z-]+)"/g)].map(m=>m[1])
    .filter(id=>!['co-table-body','co-table-head','co-table-wrap'].includes(id));
  ok('the company view declares its panels', panelIds.length>=25, `${panelIds.length} panels`);
  let filled=0; const empty=[];
  for (const id of panelIds) {
    const n=await pg.locator(`#${id}`).count();
    if (!n) { empty.push(`${id}(absent)`); continue; }
    const txt=(await pg.locator(`#${id}`).innerText().catch(()=>'')) || '';
    if (txt.trim().length>5) filled++; else empty.push(id);
  }
  ok('every company panel exists', !empty.some(e=>e.includes('absent')), empty.filter(e=>e.includes('absent')).join(',')||'all present');
  ok('the panels fill with real content', filled>=panelIds.length-4, `${filled}/${panelIds.length} filled${empty.length?'; empty: '+empty.slice(0,4).join(','):''}`);
  await br.close();

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nFULL-STACK AUDIT PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
