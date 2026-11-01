// Multi-year metric history: series, trends and their direction logic.
const fs=require('fs'),os=require('os'),path=require('path');
const H=require('../dist/finance/core/history');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== YEAR RATIOS ===');
const yp=H.yearPoint({fiscal_year:'2024',sales:1000,operating_profit:200,net_profit:100,equity_capital:100,reserves:400,borrowings:250,eps:20,cfo:150});
ok('operating margin from the statement', yp.opmPct===20, String(yp.opmPct));
ok('net margin from the statement', yp.npmPct===10, String(yp.npmPct));
ok('ROE uses equity capital plus reserves', yp.roePct===20, String(yp.roePct));
ok('ROCE uses equity plus borrowings', yp.rocePct===26.67, String(yp.rocePct));
ok('debt to equity is computed', yp.debtToEquity===0.5, String(yp.debtToEquity));
ok('zero sales yields null margins, not NaN', H.yearPoint({sales:0,operating_profit:0,net_profit:0}).opmPct===null);
ok('zero equity yields null ROE', H.yearPoint({sales:100,net_profit:10,equity_capital:0,reserves:0}).roePct===null);

console.log('\n=== TREND DIRECTION ===');
const up=H.trendOf('roePct','ROE',[10,12,15,18],true);
ok('a rising good metric is improving', up.direction==='improving', up.verdict.slice(0,55));
ok('it reports first and last', up.first===10 && up.last===18, `${up.first} → ${up.last}`);
ok('it computes a CAGR', typeof up.cagrPct==='number', `${up.cagrPct}%`);
const down=H.trendOf('roePct','ROE',[18,15,12,10],true);
ok('a falling good metric is deteriorating', down.direction==='deteriorating');
const levUp=H.trendOf('debtToEquity','Debt',[0.2,0.4,0.6,0.9],false);
ok('rising leverage is deterioration', levUp.direction==='deteriorating', levUp.verdict.slice(0,50));
const levDown=H.trendOf('debtToEquity','Debt',[0.9,0.6,0.4,0.2],false);
ok('falling leverage is improvement', levDown.direction==='improving');
const flat=H.trendOf('opmPct','Margin',[20,20.5,19.8,20.2],true);
ok('a small move is called stable, not a trend', flat.direction==='stable', flat.verdict.slice(0,50));
ok('one year cannot be judged', H.trendOf('x','X',[5],true).direction==='unknown');
ok('nulls are skipped rather than treated as zero', H.trendOf('x','X',[null,10,null,20],true).direction==='improving');

console.log('\n=== LIVE ===');
(async()=>{
  const { createAtlas }=require('../dist/gateway');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'hy-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:15});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;
  const r=await (await fetch(`${B}/api/history/${encodeURIComponent(sym)}`)).json();
  ok('the endpoint answers', !!r.symbol, r.symbol);
  ok('it returns several years', r.years.length>=3, `${r.years.length} years`);
  ok('the series matches the year list', r.series.length===r.years.length);
  ok('it reports six trends', r.trends.length===6);
  ok('every trend carries a verdict', r.trends.every(t=>t.verdict.length>10));
  ok('it explains its own method', /Recomputed from/.test(r.note), r.note.slice(0,45));
  ok('unknown symbol is 404', (await fetch(`${B}/api/history/NOPE.XX`)).status===404);
  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nHISTORY CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
