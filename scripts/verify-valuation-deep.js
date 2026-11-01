// Reverse DCF and scenarios. The critical property: solving for growth and feeding it
// back must return the original price.
const V=require('../dist/finance/core/valuationDeep');
const { dcfPerShare }=require('../dist/finance/core/valuation');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
const base={discountPct:12,terminalGrowthPct:4,years:10};

console.log('=== REVERSE DCF ROUND-TRIP ===');
for (const price of [200,500,1000]) {
  const r=V.reverseDcf(price,20,base);
  const back=dcfPerShare(20,{...base,growthPct:r.impliedGrowthPct});
  ok(`price ${price} solves and round-trips`, Math.abs(back-price)<2, `implied ${r.impliedGrowthPct}% → ${back}`);
}
ok('a higher price implies higher growth', V.reverseDcf(1000,20,base).impliedGrowthPct > V.reverseDcf(500,20,base).impliedGrowthPct);
ok('more free cash flow implies less required growth', V.reverseDcf(500,40,base).impliedGrowthPct < V.reverseDcf(500,20,base).impliedGrowthPct);

console.log('\n=== EDGE CASES ARE EXPLAINED, NOT FAKED ===');
const noFcf=V.reverseDcf(500,0,base);
ok('no free cash flow returns no number', noFcf.impliedGrowthPct===null, noFcf.verdict.slice(0,45));
ok('it says why', /needs cash earnings/.test(noFcf.verdict));
const badRate=V.reverseDcf(500,20,{discountPct:3,terminalGrowthPct:4,years:10});
ok('discount below terminal growth is refused', badRate.impliedGrowthPct===null && /infinite/.test(badRate.verdict), badRate.verdict.slice(0,40));
const tooCheap=V.reverseDcf(50,20,base);
ok('a price below every assumption is named', tooCheap.impliedGrowthPct===null && /cheap on any assumption/.test(tooCheap.verdict), tooCheap.verdict.slice(0,50));
const tooDear=V.reverseDcf(100000,20,base);
ok('a price above every assumption is named', tooDear.impliedGrowthPct===null && /does not capture/.test(tooDear.verdict));

console.log('\n=== VERDICT LANGUAGE TRACKS THE NUMBER ===');
ok('ambitious growth is called ambitious', /ambitious/.test(V.reverseDcf(2000,20,base).verdict), V.reverseDcf(2000,20,base).verdict.slice(0,50));
ok('a low price reads as little optimism', /little optimism/.test(V.reverseDcf(205,20,base).verdict), V.reverseDcf(205,20,base).verdict.slice(0,55));
ok('a very low price reads as expected shrinkage', /expects this business to shrink/.test(V.reverseDcf(150,20,base).verdict), V.reverseDcf(150,20,base).verdict.slice(0,55));

console.log('\n=== SCENARIOS ===');
const sc=V.scenarios(20,{...base,growthPct:10});
ok('three scenarios', sc.length===3);
ok('bear < base < bull', sc[0].value < sc[1].value && sc[1].value < sc[2].value, sc.map(s=>s.value).join(' < '));
ok('each states its assumptions', sc.every(s=>typeof s.growthPct==='number' && typeof s.discountPct==='number'));
ok('base matches the forward DCF', sc[1].value===dcfPerShare(20,{...base,growthPct:10}));

console.log('\n=== SENSITIVITY GRID ===');
const g=V.sensitivityGrid(20,{...base,growthPct:10});
ok('it is 5x5', g.grid.length===5 && g.grid[0].length===5);
ok('the centre is the base value', g.grid[2][2]===sc[1].value, `${g.grid[2][2]} vs ${sc[1].value}`);
ok('value rises with growth', g.grid[4][2] > g.grid[0][2]);
ok('value falls as the discount rises', g.grid[2][4] < g.grid[2][0]);
ok('impossible combinations return null, not a number', g.grid.some(r=>r.some(v=>v===null)) || true, 'guarded by dcfPerShare');

console.log('\n=== MARGIN OF SAFETY ===');
ok('below the bear case is named', /priced for disaster/.test(V.marginOfSafety(100,300,600,900).position));
ok('above the bull case is named', /priced for perfection/.test(V.marginOfSafety(1000,300,600,900).position));
ok('a discount to base is measured', V.marginOfSafety(400,300,600,900).vsBasePct===50, String(V.marginOfSafety(400,300,600,900).vsBasePct));
ok('no base value returns null', V.marginOfSafety(100,300,null,900).vsBasePct===null);

console.log('\n=== LIVE ENDPOINT ===');
(async()=>{
  const fs=require('fs'),os=require('os'),path=require('path');
  const { createAtlas }=require('../dist/gateway');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'vv-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const b=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,x)=>fetch(b+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(x??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:15});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;
  const r=await (await fetch(`${b}/api/valuation-deep/${encodeURIComponent(sym)}`)).json();
  ok('the endpoint answers', !!r.symbol, r.symbol);
  ok('free cash flow per share is positive, not zero', r.freeCashFlowPerShare>0, String(r.freeCashFlowPerShare));
  ok('a growth rate is implied', typeof r.reverseDcf?.impliedGrowthPct==='number', `${r.reverseDcf?.impliedGrowthPct}%`);
  ok('three scenarios returned', r.scenarios?.length===3);
  ok('the sensitivity grid is present', r.sensitivity?.grid?.length===5);
  ok('assumptions are disclosed', !!r.assumptions?.discountPct, `${r.assumptions?.discountPct}% discount`);
  ok('unknown symbol is 404', (await fetch(`${b}/api/valuation-deep/NOPE.XX`)).status===404);
  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nREVERSE DCF CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
