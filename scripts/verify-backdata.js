// Back data: browsing the stored record, resampling, and honest coverage reporting.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'bd-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:20});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;

  console.log('=== FULL RECORD ===');
  const d=await (await fetch(`${B}/api/prices/${encodeURIComponent(sym)}`)).json();
  ok('it answers', !!d.symbol, d.symbol);
  ok('bars are returned', d.bars.length>50, `${d.bars.length} bars`);
  ok('every bar has OHLC', d.bars.every(b=>typeof b.open==='number'&&typeof b.high==='number'&&typeof b.low==='number'&&typeof b.close==='number'));
  ok('high is never below low', d.bars.every(b=>b.high>=b.low));
  ok('bars are chronological', d.bars.every((b,i,a)=>i===0||a[i-1].date<=b.date));
  ok('stats are computed', typeof d.stats.changePct==='number', `${d.stats.changePct}%`);
  ok('coverage states the full span', !!d.coverage.firstDate && !!d.coverage.lastDate, `${d.coverage.firstDate} → ${d.coverage.lastDate}`);
  ok('it says how many sessions exist', d.coverage.totalSessions>=d.bars.length, `${d.coverage.totalSessions}`);

  console.log('\n=== DATE RANGE ===');
  const mid=d.coverage.firstDate;
  const ranged=await (await fetch(`${B}/api/prices/${encodeURIComponent(sym)}?from=${mid}&to=${d.coverage.lastDate}`)).json();
  ok('a range narrows the bars', ranged.bars.length<=d.bars.length, `${ranged.bars.length} of ${d.bars.length}`);
  ok('the range is echoed back', ranged.from===mid, ranged.from);
  const empty=await (await fetch(`${B}/api/prices/${encodeURIComponent(sym)}?from=1900-01-01&to=1900-12-31`)).json();
  ok('an empty range returns no bars, not an error', empty.bars.length===0 && empty.stats.changePct===null);

  console.log('\n=== RESAMPLING ===');
  const week=await (await fetch(`${B}/api/prices/${encodeURIComponent(sym)}?interval=week`)).json();
  const month=await (await fetch(`${B}/api/prices/${encodeURIComponent(sym)}?interval=month`)).json();
  ok('weekly bars are fewer than daily', week.bars.length<d.bars.length, `${week.bars.length} weekly`);
  ok('monthly bars are fewer than weekly', month.bars.length<week.bars.length, `${month.bars.length} monthly`);
  ok('resampling keeps the last close', week.bars[week.bars.length-1].close===d.bars[d.bars.length-1].close);
  ok('resampling keeps the true high', Math.max(...week.bars.map(b=>b.high))===Math.max(...d.bars.map(b=>b.high)));
  ok('an invalid interval falls back to daily', (await (await fetch(`${B}/api/prices/${encodeURIComponent(sym)}?interval=nonsense`)).json()).bars.length===d.bars.length);

  console.log('\n=== COVERAGE ===');
  const cov=await (await fetch(`${B}/api/prices/coverage`)).json();
  ok('coverage reports the market record', cov.companies>0 && cov.sessions>0, `${cov.companies} companies, ${cov.sessions} sessions`);
  ok('it names the earliest and latest date', !!cov.earliest && !!cov.latest, `${cov.earliest} → ${cov.latest}`);
  ok('it counts thin histories', typeof cov.thin==='number', `${cov.thin}`);
  ok('unknown symbol is 404', (await fetch(`${B}/api/prices/NOPE.XX`)).status===404);

  console.log('\n=== RENDERED ===');
  const { chromium }=require('playwright-core');
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const pg=await br.newPage({viewport:{width:1440,height:1100},bypassCSP:true});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,80)));
  await pg.goto(`http://127.0.0.1:${atlas.server.address().port}`,{waitUntil:'networkidle'});
  await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2);
  await pg.locator('#result-body tr').first().click(); await pg.waitForTimeout(3500);
  ok('the table renders rows', (await pg.locator('#bd-rows tr').count())>10, `${await pg.locator('#bd-rows tr').count()} rows`);
  ok('the stat cards render', (await pg.locator('#bd-stats .scorecard').count())===6, `${await pg.locator('#bd-stats .scorecard').count()} cards`);
  await pg.selectOption('#bd-interval','month'); await pg.click('#bd-go'); await pg.waitForTimeout(1500);
  ok('switching interval re-renders', (await pg.locator('#bd-rows tr').count())>0 && (await pg.locator('#bd-rows tr').count())<50, `${await pg.locator('#bd-rows tr').count()} monthly rows`);
  ok('no page errors', errs.length===0, errs.slice(0,1).join(''));
  await br.close();

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nBACK DATA CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
