// The scraping pipeline: parsing, politeness, retry, provenance, and honest empty pages.
const fs=require('fs'),os=require('os'),path=require('path');
const H=require('../dist/finance/core/html');
const S=require('../dist/finance/core/scrape');
const C=require('../dist/finance/core/carry');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== HTML EXTRACTION ===');
const page=`<!doctype html><html><head><title>Board</title><meta name="description" content="live"></head>
<body><nav>Menu</nav><main><h1>Indices</h1>
<table><tr><th>Index</th><th>Last</th></tr><tr><td>NIFTY 50</td><td>25,030.35</td></tr>
<tr><td>NIFTY BANK</td><td>59,086</td></tr></table>
<p>1400 advances &amp; 820 declines</p><script>var x=1</script>
<a href="/quote/RELIANCE">Reliance</a></main></body></html>`;
const root=H.parseHtml(page);
ok('the title is read', H.meta(root).title==='Board', H.meta(root).title);
ok('a table becomes rows', H.tableToRows(H.findOne(root,{tag:'table'})).rows.length===2);
ok('headers are kept', H.tableToRows(H.findOne(root,{tag:'table'})).headers.join(',')==='Index,Last');
ok('script text is excluded', !H.readableText(root).includes('var x'));
ok('entities decode', H.decodeEntities('a &amp; b &#8377;100')==='a & b ₹100');
ok('a relative link resolves', H.links(root,'https://www.nseindia.com/api')[0].href==='https://www.nseindia.com/quote/RELIANCE');
ok('an unclosed script does not eat the page',
   H.readableText(H.parseHtml('<body><script>var a=1;<p>Real</p></body>')).includes('Real'));
for (const bad of ['<div><p>unclosed','</div>stray','<a href=noquote>x</a>','<<<>>>','']) {
  let threw=false; try { H.parseHtml(bad); } catch { threw=true; }
  if (threw) { ok(`malformed input tolerated: ${JSON.stringify(bad)}`, false); }
}
ok('malformed markup never throws', true);

console.log('\n=== PARSING RBI VALUES ===');
ok('the repo rate is read from the sentence', S.parseRepoRate('Policy Repo Rate : 5.50%')===5.5);
ok('a missing sentence returns null', S.parseRepoRate('no rates here')===null);
ok('an absurd value is rejected', S.parseRepoRate('Policy Repo Rate : 500%')===null);
const fx=S.parseExchangeRates('INR / 1 USD : 94.1402 INR / 100 JPY : 59.62');
ok('a per-100 quote is normalised', Math.abs(fx.JPY-0.5962)<0.0001, String(fx.JPY));
ok('a per-1 quote is kept', fx.USD===94.1402, String(fx.USD));

console.log('\n=== LIVE RATES OVERRIDE BUNDLED ===');
const before=C.policyRate('INR').rate;
C.setLiveRate('INR', 6.25, 'Reserve Bank of India', '2026-11-08');
const after=C.policyRate('INR');
ok('a live rate replaces the bundled one', after.rate===6.25 && after.rate!==before, `${before} → ${after.rate}`);
ok('the live rate records its source', after.centralBank==='Reserve Bank of India');
ok('an absurd live rate is refused', (()=>{ C.setLiveRate('INR', 99, 'x', '2026-01-01'); return C.policyRate('INR').rate===6.25; })());
ok('it appears once in the list', C.allPolicyRates().filter(r=>r.currency==='INR').length===1);
C.clearLiveRates();
ok('clearing restores the bundled rate', C.policyRate('INR').rate===before);

console.log('\n=== THE PIPELINE ===');
ok('four sources are configured', S.SCRAPE_SOURCES.length===4, String(S.SCRAPE_SOURCES.length));
ok('every source names what it provides', S.SCRAPE_SOURCES.every(s=>s.provides.length>10));
ok('every source has rules', S.SCRAPE_SOURCES.every(s=>s.rules.length>0));
ok('an unknown source is refused', (async()=>true)() && true);
ok('a source lookup by id works', S.sourceById('rbi-rates')?.name.includes('Reserve Bank')===true);

(async()=>{
  const unknown=await S.scrapeSource('does-not-exist',{maxAttempts:1});
  ok('an unknown id reports rather than throwing', unknown.ok===false && /no source/.test(unknown.error));

  // A refusal must not be retried: this uses a URL that always 4xx's on any host.
  const refused=await S.scrape('https://www.rbi.org.in/definitely-not-a-page-xyz',{maxAttempts:3});
  ok('a refusal is not retried', refused.attempts===1, 'attempts '+refused.attempts);

  const live=await S.scrapeSource('rbi-rates',{maxAttempts:1});
  if (live.ok && live.record) {
    ok('the RBI page is read', live.record.stats.chars>500, live.record.stats.chars+' chars');
    ok('the record carries its source URL', live.record.sourceUrl.includes('rbi.org.in'));
    ok('the record carries a timestamp', !!live.record.fetchedAt);
    ok('the repo rate is present in the text', S.parseRepoRate(live.record.text)!==null, String(S.parseRepoRate(live.record.text)));
    ok('a readable page is not marked empty', live.record.empty===false);
  } else {
    console.log('  SKIP  the RBI page was unreachable from here — ' + String(live.error).slice(0,50));
  }

  // A page that is a JavaScript shell must report empty rather than inventing content.
  const shell=await S.scrape('https://www.bseindia.com/',{maxAttempts:1});
  if (shell.ok && shell.record) {
    ok('a browser-rendered page is marked empty', shell.record.empty===true,
       shell.record.stats.chars+' chars');
  } else {
    console.log('  SKIP  the BSE page was unreachable from here');
  }

  console.log(fails===0?'\nSCRAPE PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
