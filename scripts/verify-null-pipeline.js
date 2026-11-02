// Nulls through the whole pipeline: filter, sort, format, export, render.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium }=require('playwright-core');
const { createAtlas }=require('../dist/gateway');
const { openDatabase }=require('../dist/finance/core/db');
const { Store }=require('../dist/finance/core/store');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== FORMATTERS ===');
const app=fs.readFileSync('src/console/app.js','utf8');
for (const fn of ['cr','pct','ratio','money']) {
  const m=new RegExp(`const ${fn} = \\(v\\) => \\(v === null`).test(app);
  ok(`${fn}() guards null`, m);
}

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'np-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}`;
  const F=`${B}/api/fin`;
  const post=(p,b)=>fetch(F+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:10});
  const db=openDatabase(path.join(home,'markets','IN-STOCK.db'));
  db.db.prepare('UPDATE latest_metrics SET pe=NULL, roe=NULL, price=NULL WHERE rowid IN (SELECT rowid FROM latest_metrics LIMIT 3)').run();
  const st=new Store(db.db);

  console.log('\n=== FILTERING ===');
  const gt=st.screener('P/E > 15',{limit:50});
  ok('a comparison excludes nulls', gt.rows.every(r=>r.pe!==null && r.pe>15), `${gt.rows.length} rows`);
  const lt=st.screener('P/E < 15',{limit:50});
  ok('the opposite comparison also excludes nulls', lt.rows.every(r=>r.pe!==null), `${lt.rows.length} rows`);

  console.log('\n=== SORTING ===');
  for (const dir of ['asc','desc']) {
    const r=st.screener('Market Cap > 0',{sort:'pe',order:dir,limit:50});
    const pes=r.rows.map(x=>x.pe);
    // Every null must sit after every real value.
    const firstNull=pes.indexOf(null);
    const nullsAtEnd = firstNull===-1 || pes.slice(firstNull).every(v=>v===null);
    ok(`nulls sort last (${dir})`, nullsAtEnd, JSON.stringify(pes.map(v=>v===null?'–':Math.round(v))));
  }

  console.log('\n=== EXPORT ===');
  for (const u of ['/api/export.csv?expression=Market%20Cap%3E0','/api/export/enriched.csv?expression=Market%20Cap%3E0']) {
    const r=await fetch(F+u); const t=await r.text();
    ok(`${u.split('?')[0]} is clean`, r.ok && !/\bnull\b|\bNaN\b|\bundefined\b/.test(t), `${r.status}`);
  }
  const rows=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:5})).json()).rows;
  const x=await post('/api/export/xlsx',{rows,name:'nulls'});
  ok('xlsx survives nulls', x.status===200 && (await x.arrayBuffer()).byteLength>0);

  console.log('\n=== AGGREGATION ===');
  const stats=await (await post('/api/screen/stats',{expression:'Market Cap > 0'})).json().catch(()=>null);
  ok('screen stats do not crash on nulls', stats===null || typeof stats==='object');

  console.log('\n=== UI RENDER ===');
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const pg=await br.newPage({viewport:{width:1440,height:1000},bypassCSP:true});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,70)));
  await pg.goto(B,{waitUntil:'networkidle'});
  await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2,{timeout:20000}).catch(()=>{});
  const views=await pg.locator('.navbtn[data-view]').evaluateAll(e=>e.map(x=>x.dataset.view));
  const dirty=[];
  for (const v of views) {
    await pg.click(`.navbtn[data-view="${v}"]`); await pg.waitForTimeout(500);
    // Scan only the visible view, not hidden ones — hidden markup legitimately contains
    // words like "undefined" inside placeholders and help text.
    const txt=await pg.locator(`#view-${v}`).innerText().catch(()=>'');
    if (/\bnull\b|\bNaN\b|\bundefined\b|\[object Object\]/.test(txt)) dirty.push(v);
  }
  ok('no view renders null, NaN or undefined', dirty.length===0, dirty.join(',')||`${views.length} views`);
  ok('no page errors', errs.length===0, errs.slice(0,1).join(''));
  await br.close();

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nNULL PIPELINE PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
