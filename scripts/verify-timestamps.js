// Every JSON response must carry the moment it was produced.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ts-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:15});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;

  const endpoints = [
    '/api/health', '/api/stats', '/api/briefing', `/api/briefing/${sym}`,
    '/api/discover/sectors', '/api/discover/recommendations', '/api/data-truth',
    `/api/data-truth/${sym}`, '/api/prices/coverage', `/api/prices/${sym}`,
    '/api/journal', '/api/strategies', '/api/advisors', `/api/advisors/${'graham-in'}`,
    `/api/history/${sym}`, `/api/peer-percentiles/${sym}`, `/api/graph/${sym}`,
    `/api/storylines/${sym}`, `/api/timeline/${sym}`, `/api/flows/${sym}`,
    `/api/risk/${sym}`, `/api/extras/${sym}`, `/api/fundamentals/${sym}`,
    `/api/valuation-deep/${sym}`, `/api/held-review`, '/api/ratios',
  ];

  console.log('=== EVERY RESPONSE IS TIMESTAMPED ===');
  let stamped=0; const missing=[];
  for (const e of endpoints) {
    try {
      const r=await (await fetch(B+e)).json();
      if (r && typeof r==='object' && typeof r.generatedAt==='string') stamped++;
      else missing.push(e);
    } catch { missing.push(e+' (error)'); }
  }
  ok('every endpoint carries generatedAt', missing.length===0, missing.length? missing.slice(0,3).join(', ') : `${stamped}/${endpoints.length}`);

  console.log('\n=== THE TIMESTAMP IS VALID AND CURRENT ===');
  const a=await (await fetch(`${B}/api/health`)).json();
  const t=new Date(a.generatedAt);
  ok('it parses as a date', !Number.isNaN(t.getTime()), a.generatedAt);
  ok('it is ISO 8601 UTC', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a.generatedAt), a.generatedAt);
  ok('it is within a minute of now', Math.abs(Date.now()-t.getTime())<60_000, `${Math.round((Date.now()-t.getTime())/1000)}s ago`);

  console.log('\n=== TWO CALLS GIVE DIFFERENT TIMESTAMPS ===');
  const b1=await (await fetch(`${B}/api/health`)).json();
  await new Promise(r=>setTimeout(r,15));
  const b2=await (await fetch(`${B}/api/health`)).json();
  ok('a fresh call is not a cached answer', b1.generatedAt!==b2.generatedAt, `${b1.generatedAt} vs ${b2.generatedAt}`);

  console.log('\n=== DATA DATES ARE PRESENT WHERE THEY MATTER ===');
  const d=await (await fetch(`${B}/api/prices/${sym}`)).json();
  ok('price data states its span', !!d.coverage.firstDate && !!d.coverage.lastDate, `${d.coverage.firstDate} → ${d.coverage.lastDate}`);
  ok('bars carry dates', d.bars.every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)), d.bars[0]?.date);
  const dt=await (await fetch(`${B}/api/data-truth/${sym}`)).json();
  ok('data truth reports freshness in days', typeof dt.freshnessDays==='number', `${dt.freshnessDays} days`);
  const h=await (await fetch(`${B}/api/history/${sym}`)).json();
  ok('history names its years', h.years.length>0, h.years[0]+'–'+h.years[h.years.length-1]);
  const br=await (await fetch(`${B}/api/briefing/${sym}`)).json();
  ok('the briefing carries its own timestamp', typeof br.generatedAt==='string');
  const j=await (await fetch(`${B}/api/journal`)).json();
  ok('journal entries carry createdAt', j.entries.length===0 || typeof j.entries[0].createdAt==='string');

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nTIMESTAMP CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
