// End-to-end feature walkthrough: every user-facing surface, clicked and asserted.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium } = require('playwright-core');
const { createAtlas } = require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
(async()=>{
  const h=fs.mkdtempSync(path.join(os.tmpdir(),'ft-'));
  const a=createAtlas({dataDir:h,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>a.server.listen(0,r));
  const B=`http://127.0.0.1:${a.server.address().port}`;
  await fetch(`${B}/api/fin/api/setup/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'IN'})});
  await fetch(`${B}/api/fin/api/seed`,{method:'POST',body:JSON.stringify({companies:40})});
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const p=await br.newPage({viewport:{width:1440,height:1000},bypassCSP:true});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,90)));
  await p.goto(B,{waitUntil:'networkidle'});
  await p.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2,{timeout:20000});

  console.log('=== SCREENER ===');
  ok('results render', (await p.locator('#result-body tr').count())>2);
  ok('result count + timing shown', /\d+ result/.test(await p.locator('#result-count').innerText()));
  ok('quick filter chips', (await p.locator('#quick-filters .chip').count())>=8, `${await p.locator('#quick-filters .chip').count()} chips`);
  await p.locator('#quick-filters .chip').first().click(); await p.waitForTimeout(900);
  ok('quick filter applies', (await p.locator('#result-body tr').count())>0);
  await p.waitForTimeout(700);
  ok('screen history records', (await p.locator('#screen-history .chip').count())>0, `${await p.locator('#screen-history .chip').count()} chips`);
  await p.fill('#expr','ROE > 10'); await p.click('#btn-apply'); await p.waitForTimeout(900);
  ok('expression screen runs', (await p.locator('#result-body tr').count())>0);
  await p.fill('#nl','low debt high roe'); await p.click('#btn-run-nl'); await p.waitForTimeout(1200);
  ok('natural-language screen runs', (await p.locator('#result-body tr').count())>=0 && /Debt/.test(await p.locator('#expr').inputValue()), await p.locator('#expr').inputValue());
  await p.click('#btn-builder'); await p.waitForSelector('#builder:not([hidden])');
  ok('query builder opens', (await p.locator('#builder-rows .b-field option').count())>20);
  await p.click('#btn-builder'); 
  ok('stars present', (await p.locator('#result-body [data-star]').count())>0);
  await p.locator('#result-body [data-star]').first().click(); await p.waitForTimeout(600);
  ok('star adds to watchlist', (await p.locator('#toast').innerText().catch(()=>'')).includes('watchlist'));
  const sec=p.locator('#result-body [data-sector]').first();
  if (await sec.count()) { await sec.click(); await p.waitForTimeout(900); ok('sector drill-down', /Sector =/.test(await p.locator('#expr').inputValue())); }
  else ok('sector drill-down', false, 'no sector link');

  console.log('=== COMPANY ===');
  await p.fill('#expr','Market Cap > 0'); await p.click('#btn-apply'); await p.waitForTimeout(900);
  const sym=await p.locator('#result-body tr').first().getAttribute('data-sym');
  await p.locator('#result-body tr').first().click();
  await p.waitForSelector('#view-company.active',{timeout:15000});
  await p.waitForTimeout(3000);
  for (const [id,label] of [['#co-deep2','capital efficiency'],['#co-market','market & analysts'],['#co-more','more intelligence'],['#co-fresh','data freshness'],['#co-timeline','timeline'],['#co-note','note & rating'],['#co-research','research report']]) {
    const len=(await p.locator(id).innerHTML().catch(()=>'')).length;
    ok(`company panel: ${label}`, len>40, `${len} chars`);
  }
  ok('chart type toggle', (await p.locator('#co-chart [data-ctype="candles"]').count())===1);
  await p.locator('#co-chart [data-ctype="candles"]').click(); await p.waitForTimeout(1500);
  ok('candlestick bodies render', (await p.locator('#co-chart svg rect').count())>50, `${await p.locator('#co-chart svg rect').count()} rects`);
  ok('volume strip renders', (await p.locator('#co-chart svg[aria-label^="Volume"]').count())===1);
  ok('no NaN coordinates in the chart', !(await p.evaluate(()=>{const s=document.querySelector('#co-chart svg');return s?s.innerHTML.includes('NaN'):false;})));
  ok('company price chart', (await p.locator('#co-chart svg path').count())>=1, `${await p.locator('#co-chart svg path').count()} path(s)`);
  ok('copy-symbol button', (await p.locator('#btn-copy-sym').count())===1);
  ok('print button', (await p.locator('#btn-print').count())===1);

  console.log('=== TABS ===');
  for (const v of ['watchlist','rank','portfolio','macro','intel','compare','store','import']) {
    await p.click(`.navbtn[data-view="${v}"]`); await p.waitForTimeout(v==='intel'?1800:700);
    ok(`tab ${v} opens`, (await p.locator(`#view-${v}.active`).count())===1);
  }
  await p.click('.navbtn[data-view="intel"]'); await p.waitForTimeout(1500);
  await p.click('.navbtn[data-view="store"]'); await p.waitForTimeout(1600);
  ok('AI store: model panel', (await p.locator('#model-panel .scorecard').count())>=3, `${await p.locator('#model-panel .scorecard').count()} cards`);
  ok('AI store: model catalogue', (await p.locator('#model-rows tr').count())>=5, `${await p.locator('#model-rows tr').count()} rows`);
  ok('AI store: fit verdicts shown', (await p.locator('#model-rows tr td:nth-child(6)').allInnerTexts()).length>0);
  ok('AI store: install-from-file control', (await p.locator('#btn-model-install').count())===1);
  await p.click('.navbtn[data-view="intel"]'); await p.waitForTimeout(1400);
  ok('movers panel', (await p.locator('#intel-movers .scorecard').count())>0);
  ok('sector breadth panel', (await p.locator('#intel-breadth .scorecard').count())>0);
  ok('sector breadth chart', (await p.locator('#intel-sector-chart .d').count())>0, `${await p.locator('#intel-sector-chart .d').count()} bars`);
  ok('all-sectors panel', (await p.locator('#intel-sectors .scorecard').count())>0, `${await p.locator('#intel-sectors .scorecard').count()} sectors`);
  const qs=(await p.locator('#result-body tr').first().getAttribute('data-sym')||'').slice(0,3);
  await p.fill('#global-search', qs); await p.waitForTimeout(1100);
  ok('global search dropdown', (await p.locator('.searchbox .hit').count())>0, `"${qs}" → ${await p.locator('.searchbox .hit').count()} hits`);
  await p.fill('#global-search','');
  await p.click('.navbtn[data-view="watchlist"]'); await p.waitForTimeout(900);
  ok('watchlist calendar', (await p.locator('#wl-calendar .scorecard').count())>0);
  await p.click('.navbtn[data-view="portfolio"]'); await p.waitForTimeout(900);
  ok('portfolio P&L', (await p.locator('#portfolio-pnl .scorecard').count())>0);

  console.log('=== GLOBAL ===');
  await p.click('#btn-theme'); await p.waitForTimeout(300);
  ok('theme toggle', (await p.evaluate(()=>document.documentElement.getAttribute('data-theme')))==='dark');
  ok('offline banner exists', (await p.locator('#offline-banner').count())===1);
  await p.click('body');
  await p.keyboard.press('/'); await p.waitForTimeout(300);
  const focusId = await p.evaluate(()=>document.activeElement ? document.activeElement.id : '');
  ok('keyboard: / focuses a search box', ['nl','search'].includes(focusId), `focused #${focusId||'none'}`);
  const p2=await br.newPage({viewport:{width:1280,height:800},bypassCSP:true});
  await p2.goto(`${B}/?wall=company&symbol=${sym}`,{waitUntil:'networkidle'}); await p2.waitForTimeout(2500);
  ok('wall mode renders', (await p2.evaluate(()=>document.body.className)).includes('wall') && (await p2.locator('#view-company').innerText().catch(()=>'')).length>50);
  ok('no page errors', errs.length===0, errs.slice(0,1).join(''));

  await br.close(); await a.close(); fs.rmSync(h,{recursive:true,force:true});
  console.log(fails===0?'\nFEATURE CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
