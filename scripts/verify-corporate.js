// Corporate timeline and insider flows — the two AnalyzerX views rebuilt natively.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'co-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:15});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;

  console.log('=== TIMELINE ===');
  const t=await (await fetch(`${B}/api/timeline/${encodeURIComponent(sym)}`)).json();
  ok('it answers', !!t.symbol, t.symbol);
  ok('it returns events', t.events.length>0, `${t.events.length} events`);
  ok('events are newest first', t.events.every((e,i,a)=>i===0||a[i-1].date>=e.date), t.events[0]?.date);
  ok('every event has a kind', t.events.every(e=>['announcement','action','insider','result'].includes(e.kind)));
  ok('every event has a title', t.events.every(e=>typeof e.title==='string' && e.title.length>0));
  ok('counts match the events returned', Object.values(t.counts).reduce((a,b)=>a+b,0)>=t.events.length);
  ok('it states the significance flag is not advice', /not a recommendation/i.test(t.note), t.note.slice(0,45));
  ok('unknown symbol is 404', (await fetch(`${B}/api/timeline/NOPE.XX`)).status===404);

  console.log('\n=== INSIDER FLOWS ===');
  const f=await (await fetch(`${B}/api/flows/${encodeURIComponent(sym)}`)).json();
  ok('it answers', !!f.symbol, f.symbol);
  ok('buys and sells are counted', typeof f.insider.buys==='number' && typeof f.insider.sells==='number', `${f.insider.buys} buys / ${f.insider.sells} sells`);
  ok('it names a direction', ['net buying','net selling','balanced'].includes(f.insider.netDirection), f.insider.netDirection);
  ok('values are reported', typeof f.insider.boughtValue==='number' && typeof f.insider.soldValue==='number');
  ok('net equals bought minus sold', Math.abs(f.insider.netValue-(f.insider.boughtValue-f.insider.soldValue))<0.02, `${f.insider.netValue}`);
  ok('the window is stated', typeof f.insider.windowDays==='number', `${f.insider.windowDays} days`);
  ok('ownership is reported when stored', f.ownership===null || typeof f.ownership.institutionsPct!=='undefined');
  ok('it warns that selling is not a verdict', /diversification/i.test(f.note), f.note.slice(0,45));
  ok('unknown symbol is 404', (await fetch(`${B}/api/flows/NOPE.XX`)).status===404);

  console.log('\n=== RENDERED IN THE UI ===');
  const { chromium }=require('playwright-core');
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const pg=await br.newPage({viewport:{width:1440,height:1100},bypassCSP:true});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,80)));
  await pg.goto(`http://127.0.0.1:${atlas.server.address().port}`,{waitUntil:'networkidle'});
  await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2);
  await pg.locator('#result-body tr').first().click(); await pg.waitForTimeout(3500);
  ok('the timeline renders rows', (await pg.locator('#co-timeline-panel tr').count())>0, `${await pg.locator('#co-timeline-panel tr').count()} rows`);
  ok('the flow cards render', (await pg.locator('#co-flows .scorecard').count())>=2, `${await pg.locator('#co-flows .scorecard').count()} cards`);
  ok('no page errors', errs.length===0, errs.slice(0,1).join(''));
  await br.close();

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nCORPORATE CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
