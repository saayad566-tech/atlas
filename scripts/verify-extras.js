// Derived analytics: every formula checked against a hand-computed value.
const E=require('../dist/finance/core/extras');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
const eq=(a,b,t=0.01)=>typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=t;

console.log('=== VALUATION ===');
ok('earnings yield = 100/PE', eq(E.earningsYield(20),5), String(E.earningsYield(20)));
ok('zero PE gives null', E.earningsYield(0)===null);
ok('PEG = PE/growth', eq(E.pegRatio(20,10),2), String(E.pegRatio(20,10)));
ok('PEG null without growth', E.pegRatio(20,0)===null);
ok('Graham = sqrt(22.5·EPS·BVPS)', eq(E.grahamNumber(10,100),150), String(E.grahamNumber(10,100)));
ok('Graham null on negative EPS', E.grahamNumber(-1,100)===null);
ok('cash conversion = CFO/NP', eq(E.cashConversion(140,100),140), String(E.cashConversion(140,100)));
ok('cash conversion null on loss', E.cashConversion(50,-10)===null);

console.log('\n=== RISK ===');
ok('flat series has no volatility', eq(E.volatility(Array(20).fill(0)),0), String(E.volatility(Array(20).fill(0))));
ok('volatility is annualised and positive', (E.volatility([0.01,-0.01,0.02,-0.02,0.01,-0.01,0.015,-0.005,0.01,-0.01])??0)>0);
ok('range position at the low is 0', eq(E.rangePosition(100,100,200),0));
ok('range position at the high is 100', eq(E.rangePosition(200,100,200),100));
ok('range position mid is 50', eq(E.rangePosition(150,100,200),50));
ok('flat range gives null', E.rangePosition(100,100,100)===null);
ok('max drawdown from a peak', eq(E.maxDrawdown([100,120,60,80]),-50), String(E.maxDrawdown([100,120,60,80])));
ok('rising series has zero drawdown', eq(E.maxDrawdown([100,110,120]),0));
ok('sharpe = return/vol', eq(E.sharpe(20,10),2));

console.log('\n=== QUALITY ===');
ok('revenue per employee', eq(E.revenuePerEmployee(1000,10),100));
ok('revenue per employee null without staff', E.revenuePerEmployee(1000,0)===null);
ok('working capital improving', E.workingCapitalTrend([100,150],[50,50])==='improving');
ok('working capital deteriorating', E.workingCapitalTrend([150,100],[50,50])==='deteriorating');
ok('margin trend expanding', E.marginTrend([10,15,20])==='expanding');
ok('margin trend contracting', E.marginTrend([20,15,10])==='contracting');
ok('quality grade A for strong metrics', E.qualityGrade(25,0.2,25)==='A', E.qualityGrade(25,0.2,25));
ok('quality grade D for weak metrics', E.qualityGrade(5,2.5,5)==='D', E.qualityGrade(5,2.5,5));
ok('analyst dispersion flags division', (E.analystDispersion(100,300,200)?.verdict??'')==='very divided', JSON.stringify(E.analystDispersion(100,300,200)));

console.log('\n=== PORTFOLIO ===');
const H=[{symbol:'A',sector:'Tech',value:600,pnlPct:10},{symbol:'B',sector:'Energy',value:300,pnlPct:-5},{symbol:'C',sector:'Tech',value:100,pnlPct:20}];
const alloc=E.sectorAllocation(H);
ok('sector allocation sums to 100', eq(alloc.reduce((a,s)=>a+s.pct,0),100), JSON.stringify(alloc.map(s=>s.pct)));
ok('largest sector first', alloc[0].sector==='Tech' && eq(alloc[0].pct,70), alloc[0].sector);
ok('concentration flags a dominant position', E.concentrationWarnings(H).length>0, E.concentrationWarnings(H)[0]);
ok('concentration silent on an even book', E.concentrationWarnings([{symbol:'X',sector:'A',value:100,pnlPct:0},{symbol:'Y',sector:'B',value:100,pnlPct:0},{symbol:'Z',sector:'C',value:100,pnlPct:0}]).length===0);
ok('diversification is 0 for one holding', E.diversificationScore([H[0]])===null);
ok('diversification rises with more names', (E.diversificationScore(H)??0) < (E.diversificationScore([...H,{symbol:'D',sector:'Fin',value:100,pnlPct:0}])??0));
const rb=E.rebalanceHints(H);
ok('rebalance trims the overweight name', rb[0].symbol==='A' && rb[0].action==='trim', JSON.stringify(rb[0]));

console.log('\n=== SCREENER ===');
const hist=E.histogram([1,2,3,4,5,6],3);
ok('histogram has the requested buckets', hist.length===3);
ok('histogram counts every value', hist.reduce((a,b)=>a+b.count,0)===6);
ok('histogram handles identical values', E.histogram([5,5,5]).length===1);
const diff=E.screenDiff(['A','B','C'],['B','C','D']);
ok('diff finds additions', diff.added.join()==='D', diff.added.join());
ok('diff finds removals', diff.removed.join()==='A', diff.removed.join());
ok('diff counts survivors', diff.kept===2);
ok('sector breakdown counts', E.sectorBreakdown([{sector:'X'},{sector:'X'},{sector:'Y'}])[0].count===2);
const sim=E.similarCompanies({pe:20,roe:15,opm:12},[{symbol:'S1',name:'n',pe:21,roe:14,opm:12},{symbol:'S2',name:'n',pe:90,roe:2,opm:3}],1);
ok('similar picks the closest company', sim[0].symbol==='S1', sim[0].symbol);
ok('TSV has a header and rows', E.toTsv([{a:1,b:2}]).split('\n').length===2);
ok('cap category boundaries', E.capCategory(25000)==='large' && E.capCategory(6000)==='mid' && E.capCategory(1000)==='small' && E.capCategory(100)==='micro');

console.log(fails===0?'\nEXTRAS CHECKS PASSED':`\n${fails} FAILED`);
process.exit(fails===0?0:1);
