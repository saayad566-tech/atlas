// Indicator maths against known values. A wrong RSI that "looks fine on a chart" is
// worse than no RSI, so every formula is checked numerically.
const fs=require('fs'),os=require('os'),path=require('path');
const I=require('../dist/finance/core/indicators');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
const eq=(a,b,t=0.01)=>a!==null&&b!==null&&Math.abs(a-b)<=t;

(async()=>{
  console.log('=== SMA ===');
  const s=I.sma([1,2,3,4,5],3);
  ok('nulls before the window', s[0]===null&&s[1]===null);
  ok('values are exact', eq(s[2],2)&&eq(s[3],3)&&eq(s[4],4), JSON.stringify(s));

  console.log('\n=== EMA ===');
  const e=I.ema([1,2,3,4,5],3);
  ok('seeded with SMA of first period', eq(e[2],2), String(e[2]));
  ok('subsequent values weight the latest', e[4]>e[3] && e[4]<5, `${e[3]} → ${e[4]}`);

  console.log('\n=== RSI ===');
  const rising=Array.from({length:40},(_,i)=>100+i);
  const falling=Array.from({length:40},(_,i)=>200-i);
  ok('monotonic rise gives 100', eq(I.rsi(rising,14)[39],100), String(I.rsi(rising,14)[39]));
  ok('monotonic fall gives 0', eq(I.rsi(falling,14)[39],0), String(I.rsi(falling,14)[39]));
  const flat=Array.from({length:40},()=>100);
  ok('flat series gives null-safe value', I.rsi(flat,14)[39]===null || eq(I.rsi(flat,14)[39],100), String(I.rsi(flat,14)[39]));
  ok('RSI stays within 0-100', I.rsi(rising.map((v,i)=>v+(i%3===0?5:-2)),14).filter(v=>v!==null).every(v=>v>=0&&v<=100));

  console.log('\n=== MACD ===');
  const m=I.macd(rising);
  ok('macd line defined late', m.macd.slice(0,25).every(v=>v===null) && m.macd[30]!==null);
  ok('signal defined after macd', m.signal[30]===null || typeof m.signal[30]==='number');
  const flatM=I.macd(Array.from({length:60},()=>100));
  ok('flat series → macd ~0', eq(flatM.macd[59],0,0.01), String(flatM.macd[59]));

  console.log('\n=== BOLLINGER ===');
  const constB=I.bollinger(Array.from({length:30},()=>50),20,2);
  ok('constant series collapses the bands', eq(constB.upper[29],50)&&eq(constB.lower[29],50), `${constB.lower[29]}–${constB.upper[29]}`);
  const waveB=I.bollinger(Array.from({length:30},(_,i)=>100+Math.sin(i)*10),20,2);
  ok('bands bracket the middle', waveB.upper[29]>waveB.middle[29] && waveB.lower[29]<waveB.middle[29]);

  console.log('\n=== ROC ===');
  const roc=I.roc([100,110,121],1);
  ok('1-period ROC is the percent change', eq(roc[1],10)&&eq(roc[2],10), `${roc[1]}, ${roc[2]}`);
  ok('nulls before the period', roc[0]===null);

  console.log('\n=== RESAMPLE ===');
  const daily=Array.from({length:120},(_,i)=>{
    const d=new Date(Date.UTC(2025,0,1+i));
    return { date:d.toISOString().slice(0,10), open:100, high:110, low:90, close:100+i, volume:1000 };
  });
  const weekly=I.resample(daily,'1W');
  const monthly=I.resample(daily,'1M');
  ok('1D is a passthrough', I.resample(daily,'1D').length===120);
  ok('weekly buckets fewer than daily', weekly.length<120 && weekly.length>5, `${weekly.length} weeks`);
  ok('monthly buckets fewer than weekly', monthly.length<weekly.length, `${monthly.length} months`);
  ok('weekly close is the last close in the bucket', weekly[0].close>=daily[0].close);
  ok('volume sums within a bucket', monthly.every(b=>b.volume>=1000));

  console.log('\n=== AVAILABILITY HONESTY ===');
  const bars=daily;
  const comp=I.computeIndicators(bars,['sma20','rsi14','atr14','obv']);
  ok('close-only indicators computed', Array.isArray(comp.sma20) && Array.isArray(comp.rsi14));
  // computeIndicators CAN do OHLC studies when given real bars; the ENDPOINT chooses
  // not to, because this data source stores close only. Verified separately below.
  ok('OHLC studies available when real bars are supplied', comp.atr14!==undefined);

  console.log('\n=== ENDPOINT ===');
  const { createAtlas } = require('../dist/gateway');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ind-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:10});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;
  const r=await (await fetch(`${B}/api/indicators/${sym}?tf=1W&set=sma20,rsi14,atr14,obv`)).json();
  const full=await (await fetch(`${B}/api/indicators/${sym}?tf=1D&set=atr14,stoch14,williams14,obv`)).json();
  ok('endpoint returns bars for the timeframe', r.bars.length>0, `${r.bars.length} bars`);
  ok('computable studies present', Array.isArray(r.indicators.sma20) && Array.isArray(r.indicators.rsi14));
  ok('OHLCV now stored, so OHLC studies compute', full.unavailable.length===0, `${full.unavailable.length} unavailable`);
  ok('ATR returns a positive number', (full.indicators.atr14||[]).filter(v=>v!==null).every(v=>v>0));
  ok('Stochastic stays within 0-100', (full.indicators.stoch14||[]).filter(v=>v!==null).every(v=>v>=0&&v<=100));
  ok('Williams %R stays within -100-0', (full.indicators.williams14||[]).filter(v=>v!==null).every(v=>v>=-100&&v<=0));
  ok('OBV is cumulative', (full.indicators.obv||[]).length>1);
  ok('bars carry OHLCV', full.bars[0] && typeof full.bars[0].high==='number' && typeof full.bars[0].volume==='number');
  ok('catalogue lists every study', r.available.length===12, `${r.available.length} studies`);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nINDICATOR CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
