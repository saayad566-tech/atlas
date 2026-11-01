// Every navigation tab must open. This exists because a duplicated view map silently
// broke three tabs across three rounds — a class of bug a suite should catch, not a user.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium } = require('playwright-core');
const { createAtlas } = require('../dist/gateway');
(async()=>{
  const h=fs.mkdtempSync(path.join(os.tmpdir(),'tb-'));
  const a=createAtlas({dataDir:h,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>a.server.listen(0,r));
  const B=`http://127.0.0.1:${a.server.address().port}`;
  await fetch(`${B}/api/fin/api/seed`,{method:'POST',body:JSON.stringify({companies:12})});
  const b=await chromium.launch({executablePath:'/usr/local/bin/chromium',args:['--no-sandbox']});
  const p=await b.newPage({viewport:{width:1440,height:1000},bypassCSP:true});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,80))); p.on('dialog',async d=>d.dismiss());
  let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
  await p.goto(B,{waitUntil:'networkidle'});
  await p.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2);
  const tabs=await p.$$eval('.navbtn',els=>els.map(e=>e.dataset.view));
  ok('navigation has every view', tabs.length>=9, tabs.join(','));
  const broken=[];
  for (const t of tabs) {
    await p.click(`.navbtn[data-view="${t}"]`);
    const opened=await p.waitForSelector(`#view-${t}.active`,{timeout:8000}).then(()=>true).catch(()=>false);
    if(!opened) broken.push(t);
  }
  ok('every tab opens', broken.length===0, broken.length?`broken: ${broken.join(',')}`:`${tabs.length} tabs`);
  // a company view is opened from a row, not the nav
  await p.click('.navbtn[data-view="screener"]');
  await p.waitForSelector('#result-body tr');
  await p.click('#result-body tr:first-child');
  const companyOpen=await p.waitForSelector('#view-company.active',{timeout:10000}).then(()=>true).catch(()=>false);
  ok('company view opens from a row', companyOpen);
  ok('no page errors during the sweep', errs.length===0, errs.slice(0,2).join(' | '));
  await b.close(); await a.close(); fs.rmSync(h,{recursive:true,force:true});
  console.log(fails===0?'\nTAB CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
