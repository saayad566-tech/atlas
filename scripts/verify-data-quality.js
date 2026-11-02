// Data quality: impossible values rejected, missing values distinct from zero.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
const { openDatabase }=require('../dist/finance/core/db');
const S=require('../dist/finance/core/sane');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== SANITY BOUNDARY ===');
ok('a plausible P/E passes', S.saneNumber('pe',25)===25);
ok('an absurd P/E is rejected', S.saneNumber('pe',1e308)===null);
ok('a negative market cap is rejected', S.saneNumber('market_cap',-1)===null);
ok('a yield above 100% is rejected', S.saneNumber('dividend_yield',150)===null);
ok('NaN is rejected', S.saneNumber('pe',NaN)===null);
ok('null stays null', S.saneNumber('pe',null)===null);
ok('an unknown field is still bounded', S.saneNumber('anything',1e20)===null);
ok('a genuine zero is preserved', S.saneNumber('roe',0)===0);

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'dq-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  const get=(p)=>fetch(B+p);
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:8});

  const db=openDatabase(path.join(home,'markets','IN-STOCK.db'));
  const cols=db.db.prepare('PRAGMA table_info(ratios)').all();
  console.log('\n=== SCHEMA ALLOWS UNKNOWN ===');
  ok('ratio columns accept NULL', cols.find(c=>c.name==='pe').notnull===0);

  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;
  const cid=db.db.prepare('SELECT id FROM companies WHERE symbol=?').get(sym).id;

  console.log('\n=== IMPOSSIBLE VALUES DO NOT REACH THE API ===');
  // The screener reads the materialised latest_metrics table, so corrupt that directly.
  db.db.prepare('UPDATE latest_metrics SET pe=1e308, roe=1e308, market_cap=1e308 WHERE UPPER(symbol)=UPPER(?)').run(sym);
  let row=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:50})).json()).rows.find(r=>r.symbol===sym);
  ok('an absurd P/E comes back as null', row.pe===null, String(row.pe));
  ok('an absurd ROE comes back as null', row.roe===null, String(row.roe));

  console.log('\n=== UNKNOWN IS NOT ZERO ===');
  db.db.prepare('UPDATE latest_metrics SET pe=NULL WHERE UPPER(symbol)=UPPER(?)').run(sym);
  row=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:50})).json()).rows.find(r=>r.symbol===sym);
  ok('a missing P/E is null, not 0', row.pe===null, String(row.pe));
  // A company with no ratio row at all must read as unknown, not as a zero multiple.
  const bare=db.db.prepare(`INSERT INTO companies (symbol,name,sector,industry,currency,source,listed_on,updated_at)
    VALUES ('BARE.NS','Bare Ltd','Unclassified','','INR','test','2026-01-01','2026-01-01')`).run();
  db.db.prepare(`INSERT INTO latest_metrics (id,symbol,name,sector,industry,source,market_cap,price,pe,roe)
    SELECT id,symbol,name,sector,industry,source,1000000,10,NULL,NULL FROM companies WHERE id=?`).run(Number(bare.lastInsertRowid));
  const bareRow=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:100})).json()).rows.find(r=>r.symbol==='BARE.NS');
  ok('a company with no ratios reads as unknown', bareRow && bareRow.pe===null, String(bareRow?.pe));
  const cheap=(await (await post('/api/screen',{expression:'P/E < 15',limit:100})).json()).rows;
  ok('a "P/E under 15" screen excludes unknowns', cheap.every(r=>r.pe!==null && r.pe<15), `${cheap.length} rows`);

  console.log('\n=== NO CRASH ON HOSTILE INPUT ===');
  const hostile=['/api/company/'+encodeURIComponent("'; DROP TABLE companies;--"),
                 '/api/company/'+encodeURIComponent('A'.repeat(400)),
                 '/api/screen?expression=%20%20',
                 '/api/screen?expression='+encodeURIComponent('(((((')];
  let crashed=0;
  for (const u of hostile) { const r=await get(u); if (r.status>=500) crashed++; }
  ok('hostile input causes no server error', crashed===0, `${crashed} failures`);
  ok('the table still exists after an injection attempt', (await get('/api/stats')).status===200);

  console.log('\n=== EVERY NUMBER IN A RESPONSE IS FINITE ===');
  const eps=['/api/company/','/api/deep2/','/api/extras/','/api/audit/','/api/valuation/','/api/risk/','/api/alpha/','/api/scores/'];
  let badNums=0;
  const scan=(o)=>{ if(typeof o==='number'&&!Number.isFinite(o)) badNums++;
    else if(Array.isArray(o)) o.forEach(scan); else if(o&&typeof o==='object') Object.values(o).forEach(scan); };
  for (const e of eps) { const r=await get(e+encodeURIComponent(sym)); if(r.ok) scan(await r.json()); }
  ok('no NaN or Infinity anywhere', badNums===0, `${badNums}`);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nDATA QUALITY PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
