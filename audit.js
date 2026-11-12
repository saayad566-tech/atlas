const fs=require('fs'),os=require('os'),path=require('path');
const { chromium }=require('playwright-core');
const { createAtlas }=require('./dist/gateway');
const VIEWS = process.argv[2].split(',');
(async()=>{
  const h=fs.mkdtempSync(path.join(os.tmpdir(),'aud-'));
  const a=createAtlas({dataDir:h,consoleDir:'./dist/console'});
  await new Promise(r=>a.server.listen(0,r));
  const B='http://127.0.0.1:'+a.server.address().port;
  const post=(p,b)=>fetch(B+'/api/fin'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:20});
  const br=await chromium.launch({executablePath:'/usr/local/bin/chromium',args:['--no-sandbox']});
  const pg=await br.newPage({viewport:{width:1400,height:900}});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,100)));
  const failed=new Set();
  pg.on('response',r=>{ if(r.url().includes('/api/') && r.status()>=400) failed.add(r.status()+' '+r.url().split('/api/fin')[1]?.split('?')[0]); });
  await pg.goto(B,{waitUntil:'networkidle'}); await pg.waitForTimeout(2000);
  let clicked=0;
  for(const v of VIEWS){
    await pg.evaluate((vv)=>document.querySelector(`.navbtn[data-view="${vv}"]`)?.click(), v);
    await pg.waitForTimeout(280);
    const vis=await pg.locator(`#view-${v}`).isVisible().catch(()=>false);
    const ids=await pg.evaluate((vv)=>[...document.querySelectorAll(`#view-${vv} button`)].map((b,i)=>b.id||('anon'+i)), v);
    let n=0;
    for(const id of ids){
      const ok=await pg.evaluate(({vv,id})=>{
        const btns=[...document.querySelectorAll(`#view-${vv} button`)];
        const b=btns.find(x=>x.id===id) || (id.startsWith('anon')?btns[Number(id.slice(4))]:null);
        if(!b||b.disabled) return false; b.click(); return true;
      },{vv:v,id}).catch(()=>false);
      if(ok){clicked++;n++;}
      await pg.waitForTimeout(60);
    }
    console.log(`  ${v.padEnd(12)} visible:${vis?'yes':'NO'}  buttons:${ids.length} clicked:${n}`);
  }
  console.log('clicked:', clicked, '| page errors:', errs.length, '| failed APIs:', failed.size);
  [...new Set(errs)].slice(0,4).forEach(e=>console.log('   ERR', e));
  [...failed].slice(0,6).forEach(f=>console.log('   API', f));
  await br.close(); await a.close(); fs.rmSync(h,{recursive:true,force:true});
})();
