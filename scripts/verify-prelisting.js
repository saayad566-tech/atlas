// Pre-listing discovery: SEC submissions + IPO calendar parsing, staging and status.
const fs=require('fs'),os=require('os'),path=require('path');
const { parseEdgarSubmissions, parseIpoCalendar, storePreListing, listPreListing, preListingSummary } = require('../dist/finance/core/prelisting');
const { openDatabase } = require('../dist/finance/core/db');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

// The SEC submissions feed shape, trimmed to the fields that matter.
const EDGAR = {
  cik: '320193', name: 'Example Robotics Inc.',
  filings: { recent: {
    form: ['S-1', 'S-1/A', '8-K', 'F-1', '10-Q', 'DRS', '424B4'],
    filingDate: ['2026-09-14', '2026-10-02', '2026-10-05', '2026-08-01', '2026-07-20', '2026-06-11', '2026-10-09'],
    accessionNumber: ['a1','a2','a3','a4','a5','a6','a7'],
  } },
};
const IPO = [
  { symbol: 'EXRB', name: 'Example Robotics Inc.', exchange: 'NASDAQ', date: '2026-11-05', price_range: '18.00-21.00', status: 'expected', shares: 12000000 },
  { name: 'Quiet Filing Co', status: 'filed', date: '2026-10-30' },
  { symbol: 'GONE', name: 'Withdrawn Ltd', status: 'withdrawn', date: '2026-09-01' },
];

console.log('=== SEC EDGAR PARSING ===');
const ed = parseEdgarSubmissions(EDGAR);
ok('keeps only listing forms', ed.every(e=>['S-1','S-1/A','F-1','DRS','S-1MEF','DRS/A','10-12B','10-12G'].includes(e.formType)), ed.map(e=>e.formType).join(','));
ok('found the registration forms', ed.length===4, `${ed.length} filings`);
ok('skips routine filings (8-K, 10-Q, 424B4)', !ed.some(e=>['8-K','10-Q','424B4'].includes(e.formType)));
ok('CIK is zero-padded to 10 digits', ed[0].cik==='0000320193', ed[0].cik);
ok('filed date is preserved', ed[0].filedAt==='2026-09-14', ed[0].filedAt);
ok('status starts at FILED', ed.every(e=>e.status==='FILED'));
ok('empty payload is handled', parseEdgarSubmissions(null).length===0 && parseEdgarSubmissions({}).length===0);
ok('malformed dates are rejected', parseEdgarSubmissions({cik:'1',name:'X',filings:{recent:{form:['S-1'],filingDate:['not-a-date']}}}).length===0);

console.log('\n=== IPO CALENDAR PARSING ===');
const ip = parseIpoCalendar(IPO);
ok('parses every entry', ip.length===3, `${ip.length} rows`);
const exrb = ip.find(x=>x.ticker==='EXRB');
ok('price range split into low/high', exrb.priceLow===18 && exrb.priceHigh===21, `${exrb.priceLow}-${exrb.priceHigh}`);
ok('ticker-bearing entry is PRICED', exrb.status==='PRICED');
ok('filed-only entry stays FILED', ip.find(x=>x.name==='Quiet Filing Co').status==='FILED');
ok('withdrawn entry is WITHDRAWN', ip.find(x=>x.ticker==='GONE').status==='WITHDRAWN');
ok('shares captured', exrb.shares===12000000);
ok('handles {data:[...]} wrapper', parseIpoCalendar({data:IPO}).length===3);
ok('handles an empty body', parseIpoCalendar(null).length===0);

console.log('\n=== STAGING + STATUS ===');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'pl-'));
const db=openDatabase(path.join(home,'p.db'));
const r1=storePreListing(db.db,'US',[...ed, ...ip]);
ok('stores filings and calendar rows', r1.inserted===7, `${r1.inserted} inserted`);
const r2=storePreListing(db.db,'US',[...ed, ...ip]);
ok('re-storing does not duplicate', r2.inserted===0 && r2.updated===7, `${r2.inserted} new, ${r2.updated} updated`);
const sum=preListingSummary(db.db,'US');
ok('summary counts by status', sum.filed===5 && sum.priced===1 && sum.withdrawn===1, JSON.stringify(sum));
const rows=listPreListing(db.db,'US');
ok('list returns newest first', rows[0].filedAt>=rows[rows.length-1].filedAt, `${rows[0].filedAt}`);
ok('filter by status', listPreListing(db.db,'US','PRICED').length===1);
ok('market isolation holds', listPreListing(db.db,'IN').length===0);
// an amendment arriving later upgrades the same company's status
storePreListing(db.db,'US',[{...ip[0], status:'PRICED', priceLow:22, priceHigh:24}]);
ok('later pricing updates the row', listPreListing(db.db,'US','PRICED').some(x=>x.priceLow===22));

fs.rmSync(home,{recursive:true,force:true});

(async () => {
console.log('\n=== NETWORK ADAPTERS (mocked) ===');
const { secUserAgent, fetchEdgarSubmissions, fetchIpoCalendar } = require('../dist/finance/core/prelistingfetch');
const { graduateListed } = require('../dist/finance/core/prelisting');
ok('User-Agent carries a contact', /Atlas .+@/.test(secUserAgent('ops@example.com')), secUserAgent('ops@example.com'));
ok('blank contact is rejected', (()=>{ try { secUserAgent('   '); return false; } catch { return true; } })());
const home2=fs.mkdtempSync(path.join(os.tmpdir(),'pf2-'));
const db2=openDatabase(path.join(home2,'p.db'));
let seenHeaders={}; let seenUrl='';
const mockFetch=(url,init)=>{ seenUrl=url; seenHeaders=init&&init.headers||{}; return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(EDGAR)) }); };
const ed2=await fetchEdgarSubmissions('320193',{contact:'ops@example.com',fetchImpl:mockFetch});
ok('EDGAR fetch sends the User-Agent', /ops@example.com/.test(seenHeaders['User-Agent']||''), seenHeaders['User-Agent']);
ok('EDGAR fetch pads the CIK in the URL', /CIK0000320193\.json$/.test(seenUrl), seenUrl.replace('https://data.sec.gov',''));
ok('EDGAR fetch parses the payload', ed2.ok && ed2.items.length===4, `${ed2.items.length} items`);
const forbidden=(u,i)=>Promise.resolve({ ok:false, status:403, text:()=>Promise.resolve('') });
const ed3=await fetchEdgarSubmissions('1',{contact:'ops@example.com',fetchImpl:forbidden});
ok('403 explains the User-Agent problem', !ed3.ok && /User-Agent rejected/.test(ed3.error||''), ed3.error);
const ipoMock=(u,i)=>Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(IPO)) });
const ip2=await fetchIpoCalendar('https://example.test/ipo',{apiKey:'KEY',fetchImpl:ipoMock});
ok('IPO calendar fetch parses', ip2.ok && ip2.items.length===3, `${ip2.items.length} items`);

console.log('\n=== GRADUATION ===');
storePreListing(db2.db,'US',parseIpoCalendar(IPO));
db2.db.prepare(`INSERT INTO companies (id,symbol,name,sector,industry,currency,source,listed_on,updated_at) VALUES (1,'EXRB','Example Robotics','Technology','SW','USD','yahoo','NASDAQ',?)`).run(Date.now());
const grad=graduateListed(db2.db,'US');
ok('a priced listing that now trades graduates', grad===1, `${grad} graduated`);
ok('it leaves the PRICED list', listPreListing(db2.db,'US','PRICED').length===0);
ok('it is retained as GRADUATED', listPreListing(db2.db,'US','GRADUATED').length===1);
ok('unlisted companies are untouched', listPreListing(db2.db,'US','WITHDRAWN').length===1);
fs.rmSync(home2,{recursive:true,force:true});

console.log(fails===0?'\nPRE-LISTING CHECKS PASSED':`\n${fails} FAILED`);
process.exit(fails===0?0:1);
})();
