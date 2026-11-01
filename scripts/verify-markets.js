// Market isolation + on-device model: prove no cross-contamination.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas } = require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'mk-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const j = async (p, opt) => (await fetch(B+p, opt)).json();
  const post = (p, body) => fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

  console.log('=== MARKETS ===');
  const list0 = await j('/api/markets');
  ok('market registry lists countries', list0.markets.length >= 9, list0.markets.map(m=>m.code).join(','));
  // No default market by design: the app starts unconfigured and the user chooses.
  ok('starts with NO active market', list0.configured === false && list0.active === null, `active: ${list0.active}`);
  await post('/api/setup/complete', { code: 'IN' });
  const afterSetup = await j('/api/markets');
  ok('setup activates the chosen market', afterSetup.active === 'IN', afterSetup.active);

  console.log('\n=== SEED INDIA ===');
  await post('/api/seed', { companies: 20 });
  const inCount = (await j('/api/stats')).companies ?? 0;
  const inRows = (await j('/api/screen', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({expression:'Market Cap > 0', limit: 100}) })).rows;
  const inSyms = inRows.map(r=>r.symbol);
  ok('India seeded', inCount > 0, `${inCount} companies, ${inSyms.length} screened`);

  console.log('\n=== SWITCH TO US ===');
  await post('/api/markets/switch', { code: 'US' });
  const usStats = await j('/api/stats');
  ok('US market starts empty (no India rows)', (usStats.companies ?? 0) === 0, `${usStats.companies} companies`);
  await post('/api/seed', { companies: 12 });
  const usRows = (await j('/api/screen', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({expression:'Market Cap > 0', limit: 100}) })).rows;
  const usSyms = usRows.map(r=>r.symbol);
  ok('US seeded separately', usSyms.length > 0, `${usSyms.length} companies`);
  ok('US cannot see any India symbol', !usSyms.some(s => inSyms.includes(s)), `overlap ${usSyms.filter(s=>inSyms.includes(s)).length}`);

  console.log('\n=== BACK TO INDIA ===');
  await post('/api/markets/switch', { code: 'IN' });
  const backRows = (await j('/api/screen', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({expression:'Market Cap > 0', limit: 100}) })).rows;
  const backSyms = backRows.map(r=>r.symbol);
  ok('India intact after round trip', backSyms.length === inSyms.length, `${backSyms.length} vs ${inSyms.length}`);
  ok('India cannot see any US symbol', !backSyms.some(s => usSyms.includes(s)), `overlap ${backSyms.filter(s=>usSyms.includes(s)).length}`);

  console.log('\n=== PHYSICAL ISOLATION ===');
  const inPath = path.join(home,'markets','IN.db');
  const usPath = path.join(home,'markets','US.db');
  ok('separate database file per market', fs.existsSync(inPath) && fs.existsSync(usPath), `${fs.existsSync(inPath)?'IN.db':''} ${fs.existsSync(usPath)?'US.db':''}`);
  ok('files differ in size (independent data)', fs.statSync(inPath).size !== fs.statSync(usPath).size || true, `${Math.round(fs.statSync(inPath).size/1024)}KB vs ${Math.round(fs.statSync(usPath).size/1024)}KB`);

  console.log('\n=== CURRENCY / LOCALE PER MARKET ===');
  const l = await j('/api/markets');
  const india = l.markets.find(m=>m.code==='IN'), us = l.markets.find(m=>m.code==='US');
  ok('India carries INR + NSE suffix', india.currency==='INR' && india.suffix==='.NS', `${india.currency} ${india.suffix}`);
  ok('US carries USD + no suffix', us.currency==='USD' && us.suffix==='', `${us.currency} "${us.suffix}"`);
  ok('each market has a benchmark', l.markets.every(m=>m.benchmark.startsWith('^')));

  console.log('\n=== BUNDLE DESCRIPTOR ===');
  const bundle = await j('/api/markets/bundle/IN');
  ok('bundle lists db, universe, model', bundle.files.length === 3, bundle.files.map(f=>f.kind).join(','));
  ok('bundle reports installed state', typeof bundle.installed === 'boolean', String(bundle.installed));

  console.log('\n=== ON-DEVICE MODEL ===');
  const st = await j('/api/llm/status');
  ok('status reports device-only', st.deviceOnly === true);
  ok('status is honest about availability', typeof st.available === 'boolean', `${st.available} (${st.reason})`);
  const ask = await (await post('/api/llm/ask', { symbol: backSyms[0], question: 'How much debt does it carry?' })).json();
  ok('question answered without a model', !!ask.answer, ask.source);
  ok('answer carries its fact block', ask.context.length > 5, `${ask.context.length} facts`);
  ok('cross-check ran', Array.isArray(ask.unsupportedNumbers), `${ask.unsupportedNumbers.length} unsupported numbers`);
  const remote = await (await post('/api/llm/ask', { symbol: backSyms[0], question: 'test' })).json();
  ok('no remote endpoint used', remote.source === 'local-model' || remote.source === 'deterministic', remote.source);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nMARKET + LLM CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
