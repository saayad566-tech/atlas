// Universal bulk manifest: parsing, market separation, diffing.
const fs=require('fs'),os=require('os'),path=require('path');
const { openDatabase } = require('../dist/finance/core/db');
const { parseCompanyTickers, syncBulkManifest, fetchSecBulkManifest } = require('../dist/finance/core/bulkmanifest');
const { countDirectory, searchDirectory } = require('../dist/finance/core/directory');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

// SEC company_tickers.json shape: an object map keyed by index.
const SEC = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  '1': { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corp' },
  '2': { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA Corp' },
  '3': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },   // duplicate ticker
  '4': { cik_str: 1, ticker: '', title: 'No Ticker Co' },          // unusable
};

(async()=>{
  console.log('=== PARSING ===');
  const p = parseCompanyTickers(SEC);
  ok('parses every usable row', p.length===3, `${p.length} symbols`);
  ok('dedupes repeated tickers', p.filter(x=>x.ticker==='AAPL').length===1);
  ok('drops rows without a ticker', !p.some(x=>!x.ticker));
  ok('CIK is zero-padded to 10 digits', p[0].cik==='0000320193', p[0].cik);
  ok('name comes from title', p[0].name==='Apple Inc.', p[0].name);
  ok('tickers are upper-cased', p.every(x=>x.ticker===x.ticker.toUpperCase()));
  ok('accepts an array form too', parseCompanyTickers([{cik_str:1,ticker:'X',title:'X Co'}]).length===1);
  ok('null and junk are handled', parseCompanyTickers(null).length===0 && parseCompanyTickers({a:'str'}).length===0);

  console.log('\n=== MARKET SEPARATION (the important one) ===');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'bulk-'));
  const db=openDatabase(path.join(home,'b.db'));
  const refused=syncBulkManifest(db.db,'IN',p,'Unclassified','US');
  ok('refuses a US manifest for the IN market', !!refused.error && /refuses|refused/.test(refused.error), refused.error);
  ok('nothing was written on refusal', countDirectory(db.db,'IN')===0);
  const us=syncBulkManifest(db.db,'US',p,'Unclassified','US');
  ok('accepts a US manifest for the US market', !us.error && us.added===3, `${us.added} added`);
  ok('IN directory still empty after the US sync', countDirectory(db.db,'IN')===0);
  ok('US directory has the symbols', countDirectory(db.db,'US')===3);
  ok('symbols are searchable in their own market', searchDirectory(db.db,'US','AAPL').length===1);
  ok('and not visible from the other market', searchDirectory(db.db,'IN','AAPL').length===0);
  const again=syncBulkManifest(db.db,'US',p,'Unclassified','US');
  ok('re-syncing adds nothing new', again.added===0 && again.existing===3, `${again.added} new / ${again.existing} existing`);

  console.log('\n=== FETCHER (mocked) ===');
  let seen=null;
  const mock=(url,init)=>{ seen={url,init}; return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(SEC)) }); };
  const r=await fetchSecBulkManifest({ contact:'ops@example.com', fetchImpl: mock });
  ok('fetch succeeds and parses', r.ok && r.entries.length===3, `${r.entries.length} entries`);
  ok('declares its market as US', r.manifestMarket==='US');
  ok('sends the contact User-Agent', /ops@example.com/.test(seen.init.headers['User-Agent']), seen.init.headers['User-Agent']);
  ok('hits the SEC bulk URL', /company_tickers\.json$/.test(seen.url), seen.url);
  const noContact=await fetchSecBulkManifest({ contact:'', fetchImpl: mock });
  ok('blank contact refused before any request', !noContact.ok && /contact/.test(noContact.error||''), noContact.error);
  const forbidden=()=>Promise.resolve({ ok:false, status:403, text:()=>Promise.resolve('') });
  const f403=await fetchSecBulkManifest({ contact:'a@b.c', fetchImpl: forbidden });
  ok('403 explains the User-Agent', !f403.ok && /User-Agent rejected/.test(f403.error||''), f403.error);
  const empty=()=>Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve('{}') });
  const e0=await fetchSecBulkManifest({ contact:'a@b.c', fetchImpl: empty });
  ok('empty manifest is an error, not a silent success', !e0.ok && /zero symbols/.test(e0.error||''), e0.error);

  console.log('\n=== EVERY MARKET SUPPORTED (no market is blocked) ===');
  const atlas=require('../dist/gateway').createAtlas({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'mmk-')),consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  const get=(p)=>fetch(B+p).then(r=>r.json());
  await post('/api/setup/complete',{code:'IN'});
  for (const mk of ['IN','US','GB','JP','SG','HK','AU','CA','DE']) {
    await post('/api/markets/switch',{code:mk});
    const st=await get('/api/bulk/status');
    ok(`${mk}: bulk supported`, st.supportsBulk===true, `primary ${st.primary}`);
  }
  console.log('\n=== CROSS-MARKET WRITE REFUSED ===');
  await post('/api/markets/switch',{code:'IN'});
  const xr=await fetch(`${B}/api/directory/sync/US`,{method:'POST'});
  ok('directory sync refuses another market\'s code', xr.status===409, `HTTP ${xr.status}`);
  const body=await xr.json();
  ok('the refusal names both markets', /US/.test(body.error) && /IN/.test(body.error), body.error);

  fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nBULK MANIFEST CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
