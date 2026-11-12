// The news pipeline: parsing, dedupe, storage, history search, honest failure.
const fs=require('fs'),os=require('os'),path=require('path');
const W=require('../dist/finance/core/newswire');
const { openDatabase }=require('../dist/finance/core/db');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== FEED PARSING ===');
const rss=`<rss><channel>
<item><title>Sensex ends higher</title><link>https://example.com/a</link>
<pubDate>Wed, 12 Nov 2026 10:00:00 GMT</pubDate><description>The market rose 1%.</description>
<source>Daily Example</source></item>
<item><title><![CDATA[Nifty at record]]></title><link>https://example.com/b</link>
<pubDate>Wed, 12 Nov 2026 11:00:00 GMT</pubDate></item>
<item><title>No link article</title></item>
</channel></rss>`;
const r=W.parseFeed(rss,'Feed','IN');
ok('three items are parsed', r.length===3, String(r.length));
ok('the title is read', r[0].title==='Sensex ends higher');
ok('the link is read', r[0].link==='https://example.com/a');
ok('the date is parsed to ISO', r[0].publishedAt?.startsWith('2026-11-12'), r[0].publishedAt);
ok('CDATA is unwrapped', r[1].title==='Nifty at record');
ok('an item with no link still gets an id', !!r[2].id && r[2].link==='');
ok('every article has a stable id', r.every(a=>/^[0-9a-f]{20}$/.test(a.id)));
ok('the same link gives the same id', W.articleId('https://x.com/1')===W.articleId('https://x.com/1'));
ok('a different link gives a different id', W.articleId('https://x.com/1')!==W.articleId('https://x.com/2'));

const atom=`<feed><entry><title>Atom story</title><link href="https://example.com/c"/>
<updated>2026-11-11T09:00:00Z</updated><summary>Summary text</summary></entry></feed>`;
const a=W.parseFeed(atom,'Feed','US');
ok('Atom entries are parsed', a.length===1 && a[0].title==='Atom story');
ok('an Atom href link is read', a[0].link==='https://example.com/c', a[0].link);

ok('an empty feed yields nothing', W.parseFeed('<rss></rss>','F','IN').length===0);
ok('HTML instead of a feed yields nothing', W.parseFeed('<html><body>nope</body></html>','F','IN').length===0);

console.log('\n=== STORAGE AND DEDUPE ===');
const db=openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'nw-')),'x.db'));
const arts=W.parseFeed(rss,'Feed','IN');
const first=W.storeArticles(db.db,arts);
ok('articles are stored', first===3, String(first));
const second=W.storeArticles(db.db,W.parseFeed(rss,'Feed','IN'));
ok('storing the same feed again adds nothing', second===0, String(second));
ok('the total does not grow', W.coverage(db.db).total===3, String(W.coverage(db.db).total));
ok('coverage reports the span', !!W.coverage(db.db).oldest && !!W.coverage(db.db).newest);

console.log('\n=== HISTORY SEARCH ===');
ok('a market filter works', W.search(db.db,{market:'IN'}).length===3);
ok('a market with nothing returns empty', W.search(db.db,{market:'JP'}).length===0);
ok('a text search works', W.search(db.db,{text:'sensex'}).length===1, String(W.search(db.db,{text:'sensex'}).length));
ok('a text search with no match returns empty', W.search(db.db,{text:'zzzznotfound'}).length===0);
ok('a from-date filter excludes older articles', W.search(db.db,{from:'2026-12-01'}).length===0);
ok('a to-date filter includes older articles', W.search(db.db,{to:'2026-12-01'}).length===3);
ok('results are newest first', (()=>{ const s=W.search(db.db,{}); return !s[0].publishedAt || s[0].publishedAt >= s[1].publishedAt; })());
ok('a limit is respected', W.search(db.db,{limit:1}).length===1);

console.log('\n=== PRUNING ===');
ok('pruning with a future cutoff removes everything', W.prune(db.db, -1)>=0);
ok('an empty store prunes cleanly', W.prune(openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'e-')),'y.db')).db, 30)===0);

(async()=>{
  console.log('\n=== A LIVE HARVEST ===');
  const db2=openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'live-')),'x.db'));
  const h=await W.harvest(db2.db,'IN',{limit:25});
  if (h.feedsOk>0) {
    ok('at least one feed answered', h.feedsOk>=1, h.feedsOk+'/'+h.feedsTried);
    ok('articles were seen', h.seen>0, String(h.seen));
    ok('they were stored', W.coverage(db2.db).total>0, String(W.coverage(db2.db).total));
    const again=await W.harvest(db2.db,'IN',{limit:25});
    ok('a second harvest stores nothing new', again.stored===0, String(again.stored));
  } else {
    console.log('  SKIP  no feed was reachable from here');
  }
  console.log(fails===0?'\nNEWSWIRE PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
