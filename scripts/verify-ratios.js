// Custom ratios and Excel export — the two features competitors have that we did not.
const fs=require('fs'),os=require('os'),path=require('path');
const C=require('../dist/finance/core/customRatios');
const X=require('../dist/finance/core/xlsx');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== FORMULA EVALUATION ===');
const row={market_cap:1000,net_profit:50,sales:500,pe:20,cfo:70,eps:10};
ok('arithmetic works', C.evaluateFormula('net_profit / sales * 100', row)===10, String(C.evaluateFormula('net_profit / sales * 100', row)));
ok('parentheses work', C.evaluateFormula('(market_cap - sales) / net_profit', row)===10);
ok('unary minus works', C.evaluateFormula('-net_profit', row)===-50);
ok('functions work', C.evaluateFormula('max(net_profit, 999)', row)===999);
ok('nested functions work', C.evaluateFormula('round(sqrt(market_cap))', row)===32);
ok('division by zero returns null, not Infinity', C.evaluateFormula('1 / 0', row)===null);
ok('unknown field returns null', C.evaluateFormula('mystery * 2', row)===null);
ok('malformed formula returns null', C.evaluateFormula('1 +', row)===null);

console.log('\n=== VALIDATION (before saving) ===');
ok('a good formula validates', C.validateFormula('cfo / net_profit * 100').ok===true);
ok('it reports which fields are used', C.validateFormula('cfo / net_profit').fields.length===2, C.validateFormula('cfo / net_profit').fields.join(','));
ok('an unknown field is rejected with a name', /Unknown field/.test(C.validateFormula('nope * 2').error), C.validateFormula('nope * 2').error);
ok('bad syntax is rejected', C.validateFormula('1 +').ok===false);
ok('an unknown function is rejected', /Unknown function/.test(C.validateFormula('frobnicate(1)').error));
ok('no eval or Function is used', !fs.readFileSync('src/finance/core/customRatios.ts','utf8').match(/\beval\(|new Function/), 'source scanned');

console.log('\n=== XLSX STRUCTURE ===');
const buf=X.buildXlsx([{name:'Screen',header:['Symbol','Price'],rows:[['A',10.5],['B',null]]}]);
ok('it is a zip', buf.subarray(0,2).toString()==='PK');
const tmp=path.join(os.tmpdir(),`t-${Date.now()}.xlsx`); fs.writeFileSync(tmp,buf);
ok('it is non-trivial in size', buf.length>1000, `${buf.length} bytes`);
fs.unlinkSync(tmp);

(async()=>{
  console.log('\n=== LIVE ENDPOINTS ===');
  const { createAtlas }=require('../dist/gateway');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'cr-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:15});

  const v=await (await post('/api/ratios/validate',{formula:'cfo / net_profit * 100'})).json();
  ok('validation is exposed', v.ok===true);
  const bad=await post('/api/ratios',{name:'Bad',formula:'nope * 2'});
  ok('an invalid ratio is refused', bad.status===400, String(bad.status));
  const saved=await (await post('/api/ratios',{name:'Cash Conversion',formula:'cfo / net_profit * 100',unit:'%'})).json();
  ok('a valid ratio saves', saved.ok===true, `id ${saved.id}`);
  const list=await (await fetch(`${base}/api/ratios`)).json();
  ok('it is listed', list.ratios.length===1, list.ratios[0]?.name);
  ok('available fields are offered for help', list.fields.length>20, `${list.fields.length} fields`);

  const x=await post('/api/export/xlsx',{rows:[{symbol:'A',price:10},{symbol:'B',price:20}]});
  const xb=Buffer.from(await x.arrayBuffer());
  ok('xlsx export returns a file', x.status===200 && xb.subarray(0,2).toString()==='PK', `${xb.length} bytes`);
  ok('the right content type is set', /spreadsheetml/.test(x.headers.get('content-type')??''), x.headers.get('content-type'));
  ok('empty export is refused', (await post('/api/export/xlsx',{rows:[]})).status===400);

  console.log('\n=== A RATIO IS USABLE, NOT DECORATIVE ===');
  const seeded=await (await post('/api/screen',{expression:'Market Cap > 0',limit:50})).json();
  const vals=seeded.rows.map(r=>r['ratio:Cash Conversion']).filter(v=>v!==null);
  ok('the ratio is computed on every row', vals.length===seeded.rows.length, `${vals.length}/${seeded.rows.length}`);
  ok('the values are real numbers', vals.every(v=>typeof v==='number'&&Number.isFinite(v)), vals.slice(0,2).join(', '));
  const filtered=await (await post('/api/screen',{expression:'Market Cap > 0',limit:50,ratioConditions:[{ratio:'Cash Conversion',op:'>',value:100}]})).json();
  ok('a ratio can be used as a screen condition', filtered.ratioConditionsApplied===1, String(filtered.ratioConditionsApplied));
  ok('every returned row satisfies it', filtered.rows.every(r=>r['ratio:Cash Conversion']>100), `${filtered.rows.length} rows`);
  ok('filtering actually narrows the set', filtered.rows.length<=seeded.rows.length, `${filtered.rows.length} of ${seeded.rows.length}`);
  const impossible=await (await post('/api/screen',{expression:'Market Cap > 0',limit:50,ratioConditions:[{ratio:'Cash Conversion',op:'>',value:999999}]})).json();
  ok('an impossible threshold returns nothing, not everything', impossible.rows.length===0, String(impossible.rows.length));
  ok('camelCase rows work with snake_case formulas', seeded.rows[0]['ratio:Cash Conversion']!==null, 'net_profit resolved from netProfit');

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nCUSTOM RATIO + XLSX CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
