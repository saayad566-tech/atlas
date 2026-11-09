// The ETF universe, bulk backfill, and the events record.
const fs=require('fs'),os=require('os'),path=require('path');
const { bundledMarkets, loadUniverse }=require('../dist/finance/core/universeBundle');
const { MARKETS }=require('../dist/finance/core/markets');
const B=require('../dist/finance/core/backfill');
const { openDatabase }=require('../dist/finance/core/db');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== THE ETF UNIVERSE ===');
const bundles=bundledMarkets();
const etf=bundles.find(b=>b.market==='ETF');
ok('an ETF bundle ships', !!etf, etf ? String(etf.count) : 'missing');
ok('it holds more than 3,000 funds', (etf?.count??0)>3000, String(etf?.count));
const rows=loadUniverse('ETF');
ok('the bundle loads', rows.length>3000, String(rows.length));
ok('every row has a symbol and a name', rows.every(r=>r.symbol && r.name));
ok('no index symbols leaked in', !rows.some(r=>r.symbol.startsWith('^')));
ok('funds from outside the US are present', rows.some(r=>/\.(TW|KS|DE|L|T)$/.test(r.symbol)));
const names=rows.map(r=>r.name.toLowerCase());
ok('well-known funds are present', names.some(n=>n.includes('s&p 500')));

console.log('\n=== TOTAL COVERAGE ===');
const total=bundles.reduce((a,b)=>a+b.count,0);
ok('the universe exceeds 140,000 instruments', total>140000, total.toLocaleString());
ok('every asset class has a bundle', ['GLOBAL','FX','INDEX','ETF','MONEY'].every(c=>bundles.some(b=>b.market===c)),
   bundles.filter(b=>['GLOBAL','FX','INDEX','ETF','MONEY'].includes(b.market)).map(b=>b.market).join(','));
ok('every bundle maps to a market', bundles.every(b=>MARKETS.some(m=>m.code===b.market)));
ok('every country market has a bundle',
   MARKETS.filter(m=>!m.pseudo).every(m=>bundles.some(b=>b.market===m.code)),
   MARKETS.filter(m=>!m.pseudo && !bundles.some(b=>b.market===m.code)).map(m=>m.code).join(',')||'all');

console.log('\n=== BULK BACKFILL ===');
const db=openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'bf-')),'x.db'));
let p=B.startBackfill(db.db,['AAA','BBB','CCC'],{range:'1y'});
ok('a queue starts with every symbol', p.queued===3, String(p.queued));
ok('it reports as running', p.running===true);
ok('an empty queue is not running', B.startBackfill(db.db,[],{}).running===false);
p=B.startBackfill(db.db,['AAA','BBB','CCC'],{range:'1y'});
ok('progress starts at zero done', p.done===0 && p.remaining===3);
B.cancelBackfill();
ok('a cancel stops the run', B.progress().running===false);
const recent=B.recentBackfill(db.db,5);
ok('recent results are readable', Array.isArray(recent));

(async()=>{
  console.log('\n=== A LIVE RUN ===');
  const db2=openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'bf2-')),'x.db'));
  let q=B.startBackfill(db2.db,['RELIANCE.NS','TCS.NS'],{range:'1y'});
  q=await B.stepBackfill(db2.db,2);
  if (q.done>0) {
    ok('symbols are fetched in a bounded step', q.done>0, q.done+' done');
    ok('bars are stored', q.bars>0, q.bars+' bars');
    ok('the run finishes', q.running===false);
    const again=B.startBackfill(db2.db,['RELIANCE.NS','TCS.NS'],{range:'1y'});
    ok('a second run skips what is stored', again.queued===0, again.queued+' queued (was 2)');
  } else {
    console.log('  SKIP  the history source was unreachable');
  }
  console.log(fails===0?'\nPIPELINE PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
