// Peer percentile ranking, plus the performance fix it depends on.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'pr-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:80});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;

  console.log('=== PEER PERCENTILES ===');
  const r=await (await fetch(`${B}/api/peer-percentiles/${encodeURIComponent(sym)}`)).json();
  ok('it answers', !!r.symbol, r.symbol);
  ok('it names the sector', typeof r.sector==='string' && r.sector.length>0, r.sector);
  ok('it counts the peer set', r.peers>0, `${r.peers} peers`);
  ok('it ranks many metrics', r.ranks.length>=10, `${r.ranks.length}`);
  ok('every percentile is 0-100', r.ranks.filter(x=>x.percentile!==null).every(x=>x.percentile>=0&&x.percentile<=100));
  ok('every ranked metric explains itself', r.ranks.filter(x=>x.percentile!==null).every(x=>x.verdict.length>10));
  ok('a sector median is given', r.ranks.some(x=>x.sectorMedian!==null));
  ok('percentiles vary rather than all being 50', new Set(r.ranks.map(x=>x.percentile).filter(v=>v!==null)).size>1, `${new Set(r.ranks.map(x=>x.percentile)).size} distinct`);
  ok('unknown symbol is 404', (await fetch(`${B}/api/peer-percentiles/NOPE.XX`)).status===404);

  console.log('\n=== PERFORMANCE (the fix this relies on) ===');
  const times=[];
  for (let i=0;i<10;i++){ const t=Date.now(); await fetch(`${B}/api/atlas-score/${encodeURIComponent(sym)}`); times.push(Date.now()-t); }
  times.sort((a,b)=>a-b);
  const p95=times[Math.floor(times.length*0.95)] ?? times[times.length-1];
  ok('atlas-score p95 under 300ms', p95<300, `${p95}ms (median ${times[Math.floor(times.length/2)]}ms)`);
  const rp=[]; for (let i=0;i<5;i++){ const t=Date.now(); await fetch(`${B}/api/risk/${encodeURIComponent(sym)}`); rp.push(Date.now()-t); }
  ok('risk profile stays fast', Math.max(...rp)<300, `${Math.max(...rp)}ms`);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nPEER RANK CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
