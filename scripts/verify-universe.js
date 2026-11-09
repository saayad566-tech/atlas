// The global universe, long history and corporate actions.
const fs=require('fs'),os=require('os'),path=require('path');
const { bundledMarkets, loadUniverse }=require('../dist/finance/core/universeBundle');
const { MARKETS }=require('../dist/finance/core/markets');
const H=require('../dist/finance/core/history');
const { openDatabase }=require('../dist/finance/core/db');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== THE GLOBAL UNIVERSE ===');
const bundles=bundledMarkets();
const total=bundles.reduce((a,b)=>a+b.count,0);
ok('at least 50 market bundles ship', bundles.length>=50, String(bundles.length));
ok('the universe exceeds 100,000 instruments', total>100000, total.toLocaleString());
ok('the US bundle is complete', (bundles.find(b=>b.market==='US')?.count??0)>15000, String(bundles.find(b=>b.market==='US')?.count));
ok('India is covered', (bundles.find(b=>b.market==='IN')?.count??0)>5000, String(bundles.find(b=>b.market==='IN')?.count));
ok('crypto has its own bundle', (bundles.find(b=>b.market==='GLOBAL')?.count??0)>3000, String(bundles.find(b=>b.market==='GLOBAL')?.count));
ok('forex has its own bundle', (bundles.find(b=>b.market==='FX')?.count??0)>1000);
ok('indices have their own bundle', (bundles.find(b=>b.market==='INDEX')?.count??0)>1000);

const inRows=loadUniverse('IN');
ok('an India bundle loads', inRows.length>5000, String(inRows.length));
ok('every row has a symbol and a name', inRows.every(r=>r.symbol && r.name));
ok('a domestic listing is preferred', inRows.some(r=>r.symbol.endsWith('.NS')||r.symbol.endsWith('.BO')));
ok('sectors are populated', inRows.filter(r=>r.sector).length > inRows.length*0.5);
const usRows=loadUniverse('US');
ok('a US bundle loads', usRows.length>15000, String(usRows.length));

const missing=MARKETS.filter(m=>!m.pseudo && !bundles.some(b=>b.market===m.code));
ok('every country market has a bundle', missing.length===0, missing.map(m=>m.code).join(',')||'all present');
const orphans=bundles.filter(b=>!MARKETS.some(m=>m.code===b.market));
ok('every bundle maps to a market', orphans.length===0, orphans.map(b=>b.market).join(',')||'all mapped');

console.log('\n=== HISTORY PARSING ===');
const fixture=JSON.stringify({chart:{result:[{
  meta:{currency:'INR',symbol:'X.NS'},
  timestamp:[1700000000,1700086400,1700172800],
  indicators:{quote:[{open:[100,101,null],high:[105,106,null],low:[99,100,null],close:[104,105,null],volume:[1000,2000,null]}]},
  events:{dividends:{d1:{date:1700000000,amount:5}},splits:{s1:{date:1700000000,numerator:2,denominator:1}}},
}]}});
const p=H.parseHistory(fixture);
ok('bars are parsed', p.bars.length===2, String(p.bars.length));
ok('a bar with no close is skipped', !p.bars.some(b=>b.close===null));
ok('the date is an ISO day', /^\d{4}-\d{2}-\d{2}$/.test(p.bars[0].date), p.bars[0].date);
ok('dividends are parsed', p.dividends.length===1 && p.dividends[0].amount===5);
ok('splits are parsed', p.splits.length===1 && p.splits[0].ratio===2);
ok('malformed input reports an error', H.parseHistory('nope').error!==null);
ok('a source error is surfaced', H.parseHistory(JSON.stringify({chart:{error:{description:'bad'}}})).error!==null);

console.log('\n=== STORAGE ===');
const db=openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'h-')),'x.db'));
const stored=H.storeHistory(db.db,'X.NS',p);
ok('bars are stored', stored===2, String(stored));
ok('the summary records the span', H.historySummary(db.db,'X.NS').bars===2);
ok('corporate actions are stored', H.actionsFor(db.db,'X.NS').length===2);
ok('storing twice does not duplicate', (()=>{ H.storeHistory(db.db,'X.NS',p); return H.historySummary(db.db,'X.NS').bars===2; })());
ok('an unknown symbol has no summary', H.historySummary(db.db,'NOPE')===null);

(async()=>{
  console.log('\n=== LIVE BACKFILL ===');
  const r=await H.backfillSymbol(db.db,'RELIANCE.NS','max');
  if (!r.error) {
    ok('a long history is fetched', r.bars>200, r.bars+' bars');
    ok('it reaches back years', !!r.from && Number(r.from.slice(0,4))<2015, r.from);
    ok('corporate actions come with it', r.dividends>0, r.dividends+' dividends');
  } else {
    console.log('  SKIP  the history source was unreachable — ' + String(r.error).slice(0,50));
  }
  console.log(fails===0?'\nUNIVERSE PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
