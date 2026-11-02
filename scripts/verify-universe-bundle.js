// The bundled symbol universe: complete, offline, and honest about what it lacks.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
const U=require('../dist/finance/core/universeBundle');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== BUNDLE CONTENTS ===');
const markets=U.bundledMarkets();
ok('all nine markets are bundled', markets.length===9, markets.map(m=>m.market).join(','));
ok('every market has companies', markets.every(m=>m.count>100), markets.map(m=>m.market+':'+m.count).join(' '));
const total=markets.reduce((a,m)=>a+m.count,0);
ok('the universe is substantial', total>20000, `${total} companies`);
const ind=U.loadUniverse('IN');
ok('sector metadata is present', ind.filter(c=>c.sector).length/ind.length>0.5, `${Math.round(ind.filter(c=>c.sector).length/ind.length*100)}% have a sector`);
ok('industry metadata is present', ind.some(c=>c.industry));
ok('no duplicate symbols in a market', new Set(ind.map(c=>c.symbol)).size===ind.length);

console.log('\n=== SEARCH ===');
const s1=U.searchUniverse('IN','reliance',5);
ok('search finds a known company', s1.length>0, s1[0]?.symbol);
ok('symbol matches come first', s1[0].symbol.toUpperCase().startsWith('RELIANCE'), s1[0]?.symbol);
ok('an empty query returns the top of the list', U.searchUniverse('IN','',5).length===5);
ok('a nonsense query returns nothing', U.searchUniverse('IN','zzzzqqqq',5).length===0);

console.log('\n=== STATS ===');
const st=U.universeStats('IN');
ok('stats report the total', st.total>5000, `${st.total}`);
ok('stats count sectors', st.sectors>=5, `${st.sectors}`);
ok('stats sample each sector', st.sampleBySector.length>=5, `${st.sampleBySector.length} sectors sampled`);
ok('stats are honest about missing market caps', /not market caps|carry a market cap/i.test(st.note), st.note.slice(0,50));

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ub-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}`;
  const post=(p,b)=>fetch(`${base}/api/fin${p}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'});

  console.log('\n=== ENDPOINTS ===');
  const mk=await (await fetch(`${base}/api/fin/api/bundle`)).json();
  ok('the bundle endpoint lists markets', mk.markets.length===9);
  ok('it names the licence', /MIT/i.test(mk.note), mk.note.slice(0,40));
  const se=await (await fetch(`${base}/api/fin/api/bundle/search?market=IN&q=tata&limit=5`)).json();
  ok('search works over the bundle', se.results.length>0, se.results[0]?.symbol);
  ok('unknown market is 404', (await fetch(`${base}/api/fin/api/bundle/ZZ`)).status===404);

  console.log('\n=== IMPORT ===');
  const im=await (await post('/api/bundle/IN/import',{})).json();
  ok('the import lists companies', im.listed>5000, `${im.listed} listed`);
  ok('it explains what is still missing', /prices|fetched/i.test(im.note||''), String(im.note).slice(0,45));
  const stats=await (await fetch(`${base}/api/fin/api/stats`)).json();
  ok('they are in the database', stats.companies>5000, `${stats.companies}`);
  ok('marked as financedatabase, not live prices', (stats.sources.financedatabase||0)>5000, JSON.stringify(stats.sources));
  ok('no statements were invented', stats.statements===0, `${stats.statements}`);
  const ds=await (await fetch(`${base}/api/fin/api/directory/search?q=reliance&limit=3`)).json();
  ok('directory search sees them', (ds.results||[]).length>0, (ds.results||[]).map(r=>r.symbol).join(','));

  console.log('\n=== ISOLATION IS PRESERVED ===');
  const cross=await post('/api/bundle/US/import',{});
  ok('importing another market is refused', cross.status===409, String(cross.status));

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nUNIVERSE BUNDLE CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
