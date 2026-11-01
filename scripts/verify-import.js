// Import coverage: every feature must have at least one usable path.
const fs=require('fs'),os=require('os'),path=require('path');
const { openDatabase } = require('../dist/finance/core/db');
const { ingestFixture } = require('../dist/finance/core/ingest');
const I = require('../dist/finance/core/importers');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
(async()=>{
  const db=openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'imp-')),'i.db'));
  ingestFixture(db.db,{companies:10,seed:7});

  console.log('=== RSS PARSER ===');
  const xml=`<rss><channel><item><title>Reliance Q2 profit rises</title><link>https://x/1</link><pubDate>Mon, 27 Oct 2026 08:00:00 GMT</pubDate></item>
  <item><title><![CDATA[Deal &amp; more]]></title><link>https://x/2</link><pubDate>Sun, 26 Oct 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
  const items=I.parseRss(xml,'test');
  ok('parses RSS items', items.length===2, items.map(i=>i.title).join(' | '));
  ok('decodes CDATA + entities', items[1].title.includes('Deal & more'), items[1].title);

  console.log('\n=== SOURCE STATUS (live probe) ===');
  const sources=await I.checkAllSources();
  for (const s of sources) console.log(`  ${s.status==='live'?'LIVE ':(s.status==='offline-ok'?'OFFL ':'BLOCK')} ${s.name.padEnd(22)} ${s.detail}`);
  const usable = sources.filter(s=>s.status==='live'||s.status==='rate-limited').length;
  ok('at least 3 network sources usable (live or throttled)', usable>=3, `${sources.filter(s=>s.status==='live').length} live + ${sources.filter(s=>s.status==='rate-limited').length} throttled`);
  ok('offline sources always available', sources.filter(s=>s.status==='offline-ok').length>=4);

  console.log('\n=== FEATURE MATRIX ===');
  const mx=await I.matrixWithStatus();
  ok('every feature mapped', mx.length>=25, `${mx.length} features`);
  const deadEnds=mx.filter(f=>!f.paths.some(p=>['live','offline-ok','rate-limited'].includes(p.status)));
  ok('no feature is a dead end', deadEnds.length===0, deadEnds.map(d=>d.feature).join(', ')||'all reachable');
  const liveOnly=mx.filter(f=>f.paths.some(p=>p.status==='live'||p.status==='rate-limited')).length;
  console.log(`  ${liveOnly}/${mx.length} features have at least one LIVE source; the rest fall back to offline paths`);

  console.log('\n=== NEWS IMPORT (live) ===');
  const sym=db.db.prepare('SELECT symbol,name FROM companies ORDER BY id LIMIT 1').get();
  const n=await I.fetchNews(db.db, sym.symbol, sym.name);
  ok('news adapter ran', typeof n.stored==='number', `${n.stored} headlines from ${n.sources.join(', ')||'none reachable'}`);
  const stored=I.listNews(db.db, sym.symbol);
  if (stored.length) console.log('  sample:', stored[0].title.slice(0,80), '·', stored[0].source);

  console.log(fails===0?'\nIMPORT CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
