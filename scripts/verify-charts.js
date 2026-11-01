// Chart data and rendering: series maths, sparklines, sector bars, SVG output.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas } = require('../dist/gateway');
const { priceSeries, sparklines, sectorBars, sparkSvg, svgPath } = require('../dist/finance/core/chart');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ch-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:30});
  const rows=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:5})).json()).rows;
  const sym=rows[0].symbol;

  console.log('=== SERIES MATHS ===');
  const ser=await (await fetch(`${B}/api/chart/${sym}?days=365`)).json();
  ok('returns a full year of sessions', ser.dates.length>200, `${ser.dates.length} points`);
  ok('dates and closes align', ser.dates.length===ser.closes.length);
  ok('change is computed from first and last', typeof ser.changePct==='number', `${ser.changePct}%`);
  ok('52-week range brackets the last price', ser.low52<=ser.last && ser.high52>=ser.last, `${ser.low52}–${ser.high52}`);
  ok('drawdown is zero or negative', ser.drawdownPct<=0, `${ser.drawdownPct}%`);
  ok('50-day average has nulls before the window', ser.ma50.slice(0,49).every(v=>v===null) && ser.ma50.slice(49).some(v=>typeof v==='number'));
  ok('unknown symbol is 404', (await fetch(`${B}/api/chart/NOPE.XX`)).status===404);

  console.log('\n=== SVG OUTPUT ===');
  const svgP=svgPath([1,2,3],100,50,1,3);
  ok('path starts with M and uses L', svgP.startsWith('M') && svgP.includes('L'), svgP.slice(0,40));
  ok('path has one point per value', (svgP.match(/[ML]/g)||[]).length===3);
  ok('flat series does not divide by zero', svgPath([5,5,5],100,50,5,5).length>0);
  const spark=sparkSvg([1,2,3,2,4]);
  ok('sparkline emits svg', /<svg/.test(spark) && /<path/.test(spark));
  ok('sparkline refuses a single point', sparkSvg([1]).includes('—'));

  console.log('\n=== SPARKLINES + SECTOR BARS ===');
  const sp=await (await post('/api/sparklines',{symbols:rows.map(r=>r.symbol)})).json();
  ok('sparklines for every row with history', Object.keys(sp.svgs).length>0, `${Object.keys(sp.svgs).length}/${rows.length}`);
  const sec=await (await fetch(`${B}/api/chart/sectors`)).json();
  ok('sector bars returned', sec.sectors.length>0, `${sec.sectors.length} sectors`);
  ok('sector percentages are 0-100', sec.sectors.every(x=>x.pctUp>=0 && x.pctUp<=100));

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nCHART CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
