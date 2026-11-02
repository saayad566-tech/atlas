// Multi-asset: four classes, instrument-driven market switching, per-class analysis.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium }=require('playwright-core');
const { createAtlas }=require('../dist/gateway');
const A=require('../dist/finance/core/assets');
const R=require('../dist/finance/core/resolve');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== ASSET CLASSES ===');
ok('four classes exist', A.ASSETS.length===4, A.ASSETS.map(a=>a.id).join(','));
ok('every class states what it is', A.ASSETS.every(a=>a.note.length>20));
ok('stocks have fundamentals', A.supports('stock','fundamentals'));
ok('ETFs do not', !A.supports('etf','fundamentals'));
ok('ETFs have holdings and cost', A.supports('etf','holdings') && A.supports('etf','cost'));
ok('forex has carry', A.supports('forex','carry'));
ok('crypto has supply', A.supports('crypto','supply'));
ok('only crypto is continuous', A.assetDef('crypto').continuous && !A.assetDef('stock').continuous);
ok('volatility is judged per class', A.volatilityVerdict('stock',30)==='normal' && A.volatilityVerdict('crypto',30)==='calm');

console.log('\n=== RESOLUTION ===');
const cases = [
  ['RELIANCE.NS','stock','IN'], ['INFY.BO','stock','IN'], ['AAPL','stock','US'],
  ['VOD.L','stock','GB'], ['7203.T','stock','JP'], ['SAP.DE','stock','DE'],
  ['D05.SI','stock','SG'], ['0700.HK','stock','HK'], ['BHP.AX','stock','AU'], ['SHOP.TO','stock','CA'],
  ['VOO','etf','US'], ['SPY','etf','US'], ['QQQ','etf','US'], ['GLD','etf','US'],
  ['EURUSD=X','forex','FX'], ['GBPJPY=X','forex','FX'], ['EUR/USD','forex','FX'],
  ['BTC-USD','crypto','GLOBAL'], ['ETH-USD','crypto','GLOBAL'], ['SOL-USD','crypto','GLOBAL'],
];
let good=0; const bad=[];
for (const [sym,cls,mkt] of cases) {
  const r=R.resolve(sym);
  if (r && r.assetClass===cls && r.market===mkt) good++; else bad.push(`${sym}→${r?r.assetClass+'/'+r.market:'null'}`);
}
ok(`all ${cases.length} symbols resolve correctly`, bad.length===0, bad.join(', ')||`${good}/${cases.length}`);
for (const junk of ['NOPE.XX','NOTAREAL','','ZZZZZZZZZ']) {
  ok(`"${junk||'(empty)'}" is refused, not guessed`, R.resolve(junk)===null);
}
ok('storage keys separate class from market', R.storageKey('IN','stock')==='IN-STOCK' && R.storageKey('IN','etf')==='IN-ETF');

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ma-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}`;
  const B=`${base}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  const get=(p)=>fetch(B+p);

  console.log('\n=== ENDPOINTS ===');
  const pre=await (await get('/api/markets')).json();
  ok('the setup picker offers countries only', !pre.markets.some(m=>['FX','GLOBAL'].includes(m.code)), `${pre.markets.length}`);
  await post('/api/setup/complete',{code:'IN'});
  await post('/api/seed',{companies:12});

  const al=await (await get('/api/assets')).json();
  ok('the asset endpoint lists four', al.classes.length===4, al.classes.map(c=>c.id).join(','));
  ok('it reports the active class', al.active==='stock', al.active);

  console.log('\n=== INSTRUMENT-FIRST SWITCHING ===');
  const seq=[['VOO','etf','US'],['RELIANCE.NS','stock','IN'],['EURUSD=X','forex','FX'],['BTC-USD','crypto','GLOBAL'],['AAPL','stock','US']];
  for (const [sym,cls,mkt] of seq) {
    const r=await (await post('/api/focus',{symbol:sym})).json();
    ok(`focus ${sym} sets ${cls}/${mkt}`, r.assetClass===cls && r.market===mkt, `${r.assetClass}/${r.market}`);
  }
  const badFocus=await post('/api/focus',{symbol:'NOPE.XX'});
  ok('an unknown symbol is refused', badFocus.status===400, String(badFocus.status));

  const cls=await (await post('/api/focus/class',{assetClass:'etf'})).json();
  ok('the class can be switched directly', cls.assetClass==='etf', cls.assetClass);
  ok('an unknown class is refused', (await post('/api/focus/class',{assetClass:'bonds'})).status===400);

  console.log('\n=== PER-CLASS ANALYSIS ===');
  for (const [sym,cls] of [['VOO','etf'],['EURUSD=X','forex'],['BTC-USD','crypto']]) {
    const r=await (await get(`/api/instrument/${encodeURIComponent(sym)}`)).json();
    ok(`${cls}: panels render`, Array.isArray(r.panels) && r.panels.length>0, `${r.panels?.length} panels`);
    ok(`${cls}: gaps are listed, not faked`, Array.isArray(r.unavailable), `${r.unavailable?.length} unavailable`);
  }
  const fx=await (await get('/api/instrument/EURUSD=X')).json();
  ok('forex states the pip size', fx.panels.some(p=>p.rows.some(x=>/Pip size/.test(x.label))));
  const cr=await (await get('/api/instrument/BTC-USD')).json();
  ok('crypto states it trades continuously', JSON.stringify(cr.panels).includes('24 hours'));

  console.log('\n=== UI ===');
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const pg=await br.newPage({viewport:{width:1440,height:1000},bypassCSP:true});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,70)));
  await pg.goto(base,{waitUntil:'networkidle'});
  await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2,{timeout:20000}).catch(()=>{});
  ok('the asset switcher is present', (await pg.locator('#asset-switch').count())===1);
  const opts=await pg.locator('#asset-switch option').count();
  ok('it offers all four classes', opts===4, `${opts}`);
  ok('no page errors', errs.length===0, errs.slice(0,1).join(''));
  await br.close();

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nMULTI-ASSET PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
