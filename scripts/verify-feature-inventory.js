// Feature inventory: every capability Atlas has shipped must still be present and answering.
// This is the regression net against losing our own work while adopting outside ideas.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

const MODULES = [
  'briefing','journal','discover','extras','customRatios','xlsx','fundamentalExtras',
  'valuationDeep','valuation','history','corporate','datatruth','graph','strategy','ask',
  'advisors','pricehistory','newsroom','session','alpha','backtest','adapters','failover',
  'sourceRegistry','scheduler','directory','markets','db','store','indicators','chart',
  'audit','research','modelmanager','aistore','llm','scores','metrics','expr','nl',
  'ingest','importers','jobs','events','prelisting','bulkmanifest','universeBundle',
];

console.log('=== OUR OWN MODULES ARE ALL STILL THERE ===');
const missing = MODULES.filter((m)=>!fs.existsSync(path.join('src','finance','core',`${m}.ts`)));
ok('every shipped module still exists', missing.length===0, missing.join(',')||`${MODULES.length} modules`);

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'inv-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}`;
  const B=`${base}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  const get=(p)=>fetch(B+p);
  await post('/api/setup/complete',{code:'IN'});
  await post('/api/seed',{companies:25});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;

  console.log('\n=== EVERY FEATURE ENDPOINT ANSWERS ===');
  const E = (label, path, want=200) => ({label, path, want});
  const checks = [
    // core screening and company
    E('screen','/api/screen?expression=Market%20Cap%3E0'),
    E('company detail',`/api/company/${sym}`),
    E('stats','/api/stats'), E('health','/api/health'),
    E('markets','/api/markets'), E('sectors','/api/sectors'),
    E('search','/api/search?q=a'),
    // analysis depth
    E('atlas score',`/api/atlas-score/${sym}`),
    E('deep analysis incl. piotroski/altman/beneish',`/api/deep2/${sym}`),
    E('extras',`/api/extras/${sym}`),
    E('deep fundamentals',`/api/fundamentals/${sym}`),
    E('reverse DCF',`/api/valuation-deep/${sym}`),
    E('valuation',`/api/valuation/${sym}`),
    E('risk profile',`/api/risk/${sym}`),
    E('history trends',`/api/history/${sym}`),
    E('peer percentiles',`/api/peer-percentiles/${sym}`),
    E('alpha factors',`/api/alpha/${sym}`),
    E('business graph',`/api/graph/${sym}`),
    E('storylines',`/api/storylines/${sym}`),
    E('corporate timeline',`/api/timeline/${sym}`),
    E('insider flows',`/api/flows/${sym}`),
    E('data truth',`/api/data-truth/${sym}`),
    E('market data truth','/api/data-truth'),
    E('briefing',`/api/briefing/${sym}`),
    E('market briefing','/api/briefing'),
    E('ask',`/api/ask/${sym}?q=cheap`),
    E('assistant',`/api/assistant/${sym}?q=cheap`),
    // discovery
    E('sector phases','/api/discover/sectors'),
    E('recommendations','/api/discover/recommendations'),
    E('advisors','/api/advisors?country=IN'),
    // back data
    E('price history',`/api/prices/${sym}`),
    E('coverage','/api/prices/coverage'),
    // news and session
    E('newsroom','/api/newsroom?market=IN&limit=5'),
    E('stored news','/api/newsroom/stored?market=IN'),
    E('sessions','/api/session'),
    // tools
    E('custom ratios','/api/ratios'),
    E('journal','/api/journal'),
    E('held review','/api/held-review'),
    E('strategies','/api/strategies'),
    E('models','/api/models'),
    E('sources','/api/sources'),
    E('adapters','/api/adapters'),
    E('universe bundle','/api/bundle'),
    E('universe search','/api/bundle/search?market=IN&q=tata'),
    E('directory coverage','/api/directory/coverage'),
    E('events','/api/events'),
    E('saved screens','/api/saved-screens'),
    E('watchlist','/api/watchlist'),
    E('portfolio','/api/portfolio'),
    E('prefs','/api/prefs'),
  ];

  let pass=0; const bad=[];
  for (const c of checks) {
    try { const r = await get(c.path); if (r.status===c.want) pass++; else bad.push(`${c.label}(${r.status})`); }
    catch { bad.push(`${c.label}(err)`); }
  }
  ok(`all ${checks.length} feature endpoints answer`, bad.length===0, bad.length?bad.join(', '):`${pass}/${checks.length}`);

  console.log('\n=== WRITE PATHS STILL WORK ===');
  const r1=await post('/api/ratios',{name:'Inventory check',formula:'cfo / net_profit * 100'});
  ok('custom ratio can be saved', r1.status===200, String(r1.status));
  const r2=await post('/api/strategies',{name:'Inventory strat',lookbackDays:120,topN:5,rebalanceDays:21,costPct:0.25});
  ok('strategy can be saved', r2.status===200, String(r2.status));
  const r3=await post('/api/journal',{symbol:sym,action:'buy',thesis:'Inventory regression check of the journal',expectation:'up',horizonDays:90});
  ok('journal entry can be recorded', r3.status===200, String(r3.status));
  const r4=await post('/api/portfolio',{symbol:sym,quantity:5,avgCost:100});
  ok('portfolio holding can be added', r4.status===200, String(r4.status));
  const r5=await post('/api/watchlist',{symbol:sym});
  ok('watchlist can be updated', r5.status===200, String(r5.status));
  const r6=await post('/api/conditions/compile',{conditions:[{field:'ROE',op:'>',value:10}]});
  ok('condition builder still compiles', r6.status===200 && (await r6.json()).ok===true);
  const r7=await post('/api/backtest',{});
  ok('backtest still runs', r7.status===200 && (await r7.json()).ok===true);
  const rows=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:5})).json()).rows;
  const r8=await post('/api/export/xlsx',{rows,name:'Inventory'});
  ok('xlsx export still works', r8.status===200, String(r8.status));

  console.log('\n=== UI VIEWS ARE ALL PRESENT ===');
  const html=fs.readFileSync('src/console/index.html','utf8');
  const views=['screener','company','intel','compare','macro','portfolio','watchlist','import','store','rank'];
  const missingViews=views.filter(v=>!html.includes(`id="view-${v}"`));
  ok('every console view still exists', missingViews.length===0, missingViews.join(',')||`${views.length} views`);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nFEATURE INVENTORY PASSED — nothing lost':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
