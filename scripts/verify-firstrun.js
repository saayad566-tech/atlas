// First-run experience: a brand-new install must explain itself and offer a way forward.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium } = require('playwright-core');
const { createAtlas } = require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'fr-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}`;
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const p=await br.newPage({viewport:{width:1440,height:1000},bypassCSP:true});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,90)));

  console.log('=== SETUP WIZARD ===');
  await p.goto(B,{waitUntil:'networkidle'});
  await p.waitForTimeout(2500);
  ok('setup wizard appears on a fresh install', !(await p.locator('#setup').isHidden()));
  const countries=await p.locator('#setup-grid').innerText();
  ok('every country is offered', /India/.test(countries) && /United States/.test(countries) && /Japan/.test(countries));
  ok('no market is preselected silently', await p.locator('#setup').isVisible());

  console.log('\n=== CHOOSING A COUNTRY ===');
  await p.locator('#setup-grid').getByText('India',{exact:false}).first().click();
  await p.waitForTimeout(3500);
  ok('setup closes after a choice', await p.locator('#setup').isHidden());
  ok('the market is applied', (await p.locator('#market-select').inputValue()).toUpperCase()==='IN');

  console.log('\n=== EMPTY MARKET EXPLAINS ITSELF ===');
  ok('empty state is shown, not a blank table', !(await p.locator('#empty').isHidden()));
  const title=await p.locator('#empty-title').innerText();
  ok('title names the situation', /Nothing in this market/.test(title), title);
  ok('it offers actions', !(await p.locator('#empty-actions').isHidden()));
  ok('three ways forward', (await p.locator('#empty-actions button').count())===3);

  console.log('\n=== THE ACTIONS WORK ===');
  await p.click('#btn-empty-demo');
  await p.waitForTimeout(4500);
  ok('loading demo data populates the screen', (await p.locator('#result-body tr').count())>0, `${await p.locator('#result-body tr').count()} rows`);
  ok('the empty state gets out of the way', await p.locator('#empty').isHidden());
  ok('no page errors throughout', errs.length===0, errs.slice(0,1).join(''));

  await br.close(); await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nFIRST-RUN CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
