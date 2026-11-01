// Deep fundamental measures: every formula checked against a hand-computed value.
const F=require('../dist/finance/core/fundamentalExtras');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
const eq=(a,b)=>typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<0.02;

console.log('=== OWNER EARNINGS ===');
const oe=F.ownerEarnings({netProfit:100,depreciation:30,capex:40,workingCapitalChange:10});
ok('it equals profit + D&A − capex − WC change', oe.value===80, String(oe.value));
ok('it reports the gap to reported profit', oe.vsReportedPct===-20, `${oe.vsReportedPct}%`);
ok('a zero profit does not divide by zero', F.ownerEarnings({netProfit:0,depreciation:0,capex:0,workingCapitalChange:0}).vsReportedPct===null);

console.log('\n=== CASH CONVERSION CYCLE ===');
const ccc=F.cashConversionCycle({receivables:100,inventory:50,payables:80,sales:1000,cogs:600});
ok('DSO = receivables/sales × 365', eq(ccc.dso,36.5), String(ccc.dso));
ok('DIO = inventory/COGS × 365', eq(ccc.dio,30.42), String(ccc.dio));
ok('DPO = payables/COGS × 365', eq(ccc.dpo,48.67), String(ccc.dpo));
ok('CCC = DSO + DIO − DPO', eq(ccc.ccc,18.25), String(ccc.ccc));
ok('negative CCC is called excellent', F.cashConversionCycle({receivables:10,inventory:10,payables:500,sales:1000,cogs:600}).verdict==='suppliers fund the business');
ok('zero sales returns null, not Infinity', F.cashConversionCycle({receivables:1,inventory:1,payables:1,sales:0,cogs:0})===null);

console.log('\n=== DILUTION ===');
ok('rising share count is dilution', F.dilution([100,102,105,110]).changePct===10, String(F.dilution([100,102,105,110]).changePct));
ok('falling share count is a buyback', F.dilution([110,105,100]).verdict==='buying back stock');
ok('a flat count is stable', F.dilution([100,100,100]).verdict==='share count stable');
ok('heavy issuance is called out', F.dilution([100,120]).verdict==='material dilution');
ok('one period returns null', F.dilution([100])===null);
ok('it annualises the rate', Math.abs(F.dilution([100,110]).cagrPct-10)<0.1, String(F.dilution([100,110]).cagrPct));

console.log('\n=== INCREMENTAL ROIC ===');
const ri=F.incrementalRoic({nopatNow:150,nopatPrior:100,investedNow:600,investedPrior:400});
ok('it divides new profit by new capital', ri.roiicPct===25, String(ri.roiicPct));
ok('strong compounding is named', ri.verdict==='compounding well');
ok('shrinking capital returns null', F.incrementalRoic({nopatNow:150,nopatPrior:100,investedNow:400,investedPrior:400})===null);
ok('value-destroying growth is named', F.incrementalRoic({nopatNow:90,nopatPrior:100,investedNow:600,investedPrior:400}).verdict==='value-destroying growth');

console.log('\n=== DIVIDEND SAFETY ===');
const ds=F.dividendSafety({dividendsPaid:50,freeCashFlow:120,netProfit:100});
ok('payout is measured against free cash flow', eq(ds.fcfPayoutPct,41.67), String(ds.fcfPayoutPct));
ok('a covered dividend says so', /comfortably/.test(ds.verdict), ds.verdict);
const unsafe=F.dividendSafety({dividendsPaid:150,freeCashFlow:100,netProfit:200});
ok('an uncovered dividend is flagged', /exceeds free cash flow/.test(unsafe.verdict), unsafe.verdict);
ok('negative FCF is stated plainly', /not covered/.test(F.dividendSafety({dividendsPaid:10,freeCashFlow:-50,netProfit:100}).verdict));
ok('no dividend returns null', F.dividendSafety({dividendsPaid:0,freeCashFlow:100,netProfit:100})===null);

console.log('\n=== REINVESTMENT RATE ===');
ok('it uses net investment over NOPAT', F.reinvestmentRate({capex:80,workingCapitalChange:10,depreciation:30,nopat:100}).ratePct===60);
ok('negative net investment is named', /shrinking/.test(F.reinvestmentRate({capex:10,workingCapitalChange:0,depreciation:50,nopat:100}).verdict));
ok('no NOPAT returns null, not a number', F.reinvestmentRate({capex:10,workingCapitalChange:0,depreciation:5,nopat:0}).ratePct===null);

console.log('\n=== COMMON SIZE ===');
const cs=F.commonSize([{label:'Sales',value:1000},{label:'Profit',value:190}],1000);
ok('revenue is 100%', cs[0].pctOfRevenue===100);
ok('a line is a share of revenue', cs[1].pctOfRevenue===19, String(cs[1].pctOfRevenue));
ok('zero revenue gives null, not Infinity', F.commonSize([{label:'X',value:5}],0)[0].pctOfRevenue===null);

console.log('\n=== LIVE ENDPOINT ===');
(async()=>{
  const fs=require('fs'),os=require('os'),path=require('path');
  const { createAtlas }=require('../dist/gateway');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'fx-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:15});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;
  const r=await (await fetch(`${base}/api/fundamentals/${encodeURIComponent(sym)}`)).json();
  ok('the endpoint answers', !!r.symbol, r.symbol);
  ok('it reads real statements', r.periods>=2, `${r.periods} periods`);
  ok('owner earnings is computed', typeof r.ownerEarnings?.value==='number', String(r.ownerEarnings?.value));
  ok('the cash conversion cycle is computed', typeof r.cashConversionCycle?.ccc==='number', `${r.cashConversionCycle?.ccc} days`);
  ok('common-size lines sum to the revenue base', r.commonSize[0].pctOfRevenue===100);
  ok('unknown symbols are 404', (await fetch(`${base}/api/fundamentals/NOPE.XX`)).status===404);
  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nDEEP FUNDAMENTAL CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
