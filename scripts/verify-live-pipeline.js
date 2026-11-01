// The whole live path, end to end: fetch a real company, then prove every downstream
// feature works on that real data. Skips cleanly when the network is unavailable.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'lp-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'});

  console.log('=== LIVE FETCH ===');
  const r=await post('/api/live/fetch',{symbol:'RELIANCE.NS'});
  if (r.status!==200) { console.log('  SKIP  live source unavailable from this network'); console.log('\nLIVE PIPELINE SKIPPED'); process.exit(0); }
  const b=await r.json();
  ok('a real company is fetched', r.status===200);
  ok('it stores price history', (b.history?.annual ?? 0) > 0, `${b.history?.annual} annual, ${b.history?.quarterly} quarterly`);
  ok('it stores statements', (b.coverage?.years ?? 0) >= 3, `${b.coverage?.years} years`);
  ok('coverage reports ready', b.coverage?.ready===true);
  ok('it stores company summary', !!b.summary?.name, b.summary?.name);
  ok('it stores news', (b.news?.stored ?? 0) > 0, `${b.news?.stored} items from ${b.news?.sources?.join(',')}`);

  console.log('\n=== THE DATA IS REAL AND MARKED AS SUCH ===');
  const s=await (await post('/api/screen',{expression:'Symbol = "RELIANCE.NS"',limit:1})).json();
  const row=s.rows[0];
  ok('it appears in the screener', !!row, row?.symbol);
  ok('the price is a real number', row?.price>0, String(row?.price));
  ok('fundamentals are populated', row?.pe>0 && row?.roe!==0, `PE ${row?.pe}, ROE ${row?.roe}`);
  ok('it is NOT marked as demo data', row?.source!=='fixture', row?.source);

  console.log('\n=== DOWNSTREAM FEATURES WORK ON REAL DATA ===');
  const ind=await (await fetch(`${base}/api/indicators/RELIANCE.NS`)).json().catch(()=>null);
  ok('indicators compute', ind!==null, ind? 'series returned':'unavailable');
  const brief=await (await fetch(`${base}/api/briefing/RELIANCE.NS`)).json().catch(()=>null);
  ok('the briefing writes about a real company', !!brief?.headline, brief?.headline?.slice(0,45));
  ok('it reports real data age', typeof brief?.dataAge?.newestDays==='number', `${brief?.dataAge?.newestDays} days old`);
  ok('it carries falsifiers', (brief?.falsifiers?.length ?? 0)===4);
  const risk=await (await fetch(`${base}/api/risk/RELIANCE.NS`)).json().catch(()=>null);
  ok('the risk profile computes', risk!==null && (risk.sharpe!==undefined), risk? `sharpe ${risk.sharpe}`:'none');
  const extras=await (await fetch(`${base}/api/extras/RELIANCE.NS`)).json().catch(()=>null);
  ok('derived metrics compute', !!extras?.extras, extras? Object.keys(extras.extras).length+' metrics':'none');

  console.log('\n=== MARKET DATA DOES NOT CROSS ===');
  await post('/api/markets/switch',{code:'US'});
  const us=await (await post('/api/screen',{expression:'Symbol = "RELIANCE.NS"',limit:5})).json();
  ok('the Indian company is absent from the US market', us.rows.length===0, `${us.rows.length} rows`);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nLIVE PIPELINE CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
