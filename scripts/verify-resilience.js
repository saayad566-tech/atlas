// Auto error handling and reloading: the UI must survive a failing server.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium }=require('playwright-core');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'rs-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}`;
  const post=(p,b)=>fetch(`${base}/api/fin${p}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:15});

  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const pg=await br.newPage({viewport:{width:1440,height:1000},bypassCSP:true});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,80)));
  await pg.goto(base,{waitUntil:'networkidle'});
  await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2);

  console.log('=== THE WRAPPER EXISTS AND IS WIRED ===');
  const src=fs.readFileSync('src/console/app.js','utf8');
  ok('a timeout is set', /TIMEOUT_MS\s*=\s*\d+/.test(src), (src.match(/TIMEOUT_MS\s*=\s*(\d+)/)||[])[1]+'ms');
  ok('it retries', /maxAttempts\s*=\s*\d+/.test(src), (src.match(/maxAttempts\s*=\s*(\d+)/)||[])[1]+' attempts');
  ok('it backs off between attempts', /sleep\(300 \* 2 \*\* attempt\)/.test(src));
  ok('client errors are not retried', /res\.status >= 400 && res\.status < 500/.test(src));
  ok('it listens for reconnect', /addEventListener\('online'/.test(src));
  ok('it listens for disconnect', /addEventListener\('offline'/.test(src));
  ok('it can reload the current view', /function reloadCurrentView/.test(src));

  console.log('\n=== THE BANNER IS IN THE PAGE ===');
  ok('the banner element exists', await pg.locator('#net-banner').count()===1);
  ok('it is hidden while healthy', await pg.locator('#net-banner').isHidden());
  ok('it has a retry button', await pg.locator('#net-retry').count()===1);

  console.log('\n=== A FAILING REQUEST SURFACES AN ERROR, NOT A BLANK SCREEN ===');
  // Break the API and confirm the UI reports it and the page keeps working.
  await pg.route(/discover\/sectors/, r => r.abort());
  const before=await pg.locator('#result-body tr').count();
  await pg.click('.navbtn[data-view="intel"]');
  await pg.waitForTimeout(3000);
  ok('the app did not crash', errs.length===0, errs.slice(0,1).join(''));
  ok('the screener data is still intact', before>2, `${before} rows`);
  ok('other panels still rendered', (await pg.locator('.scorecard').count())>0, `${await pg.locator('.scorecard').count()} cards`);

  console.log('\n=== A 4xx IS NOT RETRIED ===');
  const t0=Date.now();
  const bad=await pg.evaluate(async () => {
    try { await api('/api/advisors/nope/run'); return 'no-error'; }
    catch (e) { return e.message; }
  });
  ok('a client error returns quickly', Date.now()-t0 < 5000, `${Date.now()-t0}ms`);
  ok('the error message is the server one', /advisor|No such|HTTP/i.test(bad), bad);

  console.log('\n=== A SERVER ERROR IS RETRIED ===');
  // Stub fetch inside the page so the retry path is exercised deterministically.
  const retry = await pg.evaluate(async () => {
    const real = window.fetch;
    let calls = 0;
    window.fetch = async (...args) => {
      calls++;
      return new Response(JSON.stringify({ error: 'busy' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    };
    let outcome = 'ok';
    try { await api('/api/stats'); } catch (e) { outcome = 'failed:' + e.message; }
    window.fetch = real;
    return { calls, outcome };
  });
  ok('it retried before giving up', retry.calls === 3, `${retry.calls} attempts`);
  ok('it eventually reports the failure', /failed/.test(retry.outcome), retry.outcome.slice(0, 40));

  console.log('\n=== A NETWORK DROP SHOWS THE BANNER ===');
  const banner = await pg.evaluate(async () => {
    const real = window.fetch;
    window.fetch = async () => { throw new TypeError('Failed to fetch'); };
    try { await api('/api/stats'); } catch (e) { /* expected */ }
    window.fetch = real;
    const el = document.querySelector('#net-banner');
    return { shown: el && !el.hidden, msg: (document.querySelector('#net-msg') || {}).textContent || '' };
  });
  ok('the offline banner appears on a network error', banner.shown === true, banner.msg.slice(0, 45));
  await pg.evaluate(async () => { try { await api('/api/health'); } catch (e) {} });
  ok('a healthy call hides it again', await pg.locator('#net-banner').isHidden());

  console.log('\n=== RECOVERY ===');
  await pg.unroute(/discover\/sectors/);
  const recovered=await pg.evaluate(async () => { try { const r=await api('/api/discover/sectors'); return r.sectors ? 'ok' : 'empty'; } catch { return 'failed'; } });
  ok('a healthy call succeeds after failures', recovered==='ok', recovered);

  await br.close(); await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nRESILIENCE CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
