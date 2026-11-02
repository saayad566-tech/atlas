// Alpha factors and the information ratio — the two ideas taken from Qlib.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
const A=require('../dist/finance/core/alpha');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== FACTOR MATHS (hand-built bars) ===');
// A clean ramp: open 100, close 110, high 112, low 99
const bar=(o,h,l,c,v=1000,date='2026-01-01')=>({date,open:o,high:h,low:l,close:c,volume:v});
const one=[bar(100,112,99,110)];
const f1=A.alphaFactors(one).factors;
const get=(n)=>f1.find(f=>f.name===n)?.value;
ok('KMID = (close-open)/open', Math.abs(get('KMID')-0.1)<0.001, String(get('KMID')));
ok('KLEN = (high-low)/open', Math.abs(get('KLEN')-0.13)<0.001, String(get('KLEN')));
ok('KMID2 = (close-open)/(high-low)', Math.abs(get('KMID2')-(10/13))<0.001, String(get('KMID2')));
ok('KUP = upper shadow / open', Math.abs(get('KUP')-(2/100))<0.001, String(get('KUP')));
ok('KLOW = lower shadow / open', Math.abs(get('KLOW')-(1/100))<0.001, String(get('KLOW')));

const ramp = Array.from({length: 30}, (_,i)=>bar(100+i, 102+i, 99+i, 101+i, 1000+i, `2026-01-${String(i+1).padStart(2,'0')}`));
const fr=A.alphaFactors(ramp).factors;
const g=(n)=>fr.find(f=>f.name===n)?.value;
ok('ROC5 is positive on a rising series', (g('ROC5')??0)>0, String(g('ROC5')));
ok('MA5 is above 1 when price is above its mean', (g('MA5')??0)>1, String(g('MA5')));
ok('RANK20 is 1 when today is the highest', g('RANK20')===1, String(g('RANK20')));
ok('CORD10 is positive on a clean trend', (g('CORD10')??0)>0.9, String(g('CORD10')));
ok('RSV10 sits near 1 at a new high', (g('RSV10')??0)>0.9, String(g('RSV10')));

const short=A.alphaFactors([bar(100,101,99,100)]);
ok('missing windows return null, not zero', short.factors.some(f=>f.value===null), `${short.factors.filter(f=>f.value===null).length} null`);
ok('it states the limitation', /VWAP|omitted/i.test(short.note), short.note.slice(0,50));

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'af-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}`;
  const post=(p,b)=>fetch(`${base}/api/fin${p}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:20});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;

  console.log('\n=== ENDPOINT ===');
  const r=await (await fetch(`${base}/api/fin/api/alpha/${encodeURIComponent(sym)}`)).json();
  ok('it returns a factor set', r.factors.length>=35, `${r.factors.length} factors`);
  ok('factors are grouped', Object.keys(r.byGroup).length>=6, Object.keys(r.byGroup).join(','));
  ok('every factor explains itself', r.factors.every(f=>f.note.length>10));
  ok('strongest readings are surfaced', r.strongest.length>0, `${r.strongest.length}`);
  ok('it carries a timestamp', typeof r.generatedAt==='string');
  ok('unknown symbol is 404', (await fetch(`${base}/api/fin/api/alpha/NOPE.XX`)).status===404);

  console.log('\n=== INFORMATION RATIO ===');
  const bt=await (await post('/api/backtest',{})).json();
  ok('the backtest reports an information ratio', 'informationRatio' in (bt.stats||{}), String(bt.stats?.informationRatio));
  ok('it also reports Sharpe', 'sharpe' in (bt.stats||{}), String(bt.stats?.sharpe));

  console.log('\n=== REPORT EXISTS ===');
  const doc=fs.readFileSync('docs/REFERENCE-STUDY.md','utf8');
  ok('the comparison report is written', doc.length>1000, `${doc.length} chars`);
  ok('it names both references', /OpenStock/.test(doc) && /Qlib/.test(doc));
  ok('it records what was rejected and why', /not adopted/i.test(doc));

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nALPHA CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
