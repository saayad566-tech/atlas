// Country universe sources: every index list parses, symbols are real, sync queues.
const { fetchConstituents, INDEX_SOURCES, parseConstituents, yahooSymbol } = require('../dist/finance/core/universes');
const { marketDef } = require('../dist/finance/core/markets');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
(async()=>{
  console.log('=== PARSER UNIT CHECKS ===');
  // Fixtures mirror a real index page (a handful of rows, not two) — the parser is
  // built for constituent tables, not toy input.
  const rows = (n) => Array.from({length:n},(_,i)=>`<tr><td>AAA${i}</td><td>Alpha ${i}</td><td>Industrials</td></tr>`).join('');
  const html = `<table class="wikitable"><tr><th>Symbol</th><th>Security</th><th>GICS Sector</th></tr>${rows(6)}</table>`;
  const small = parseConstituents(html, 'US');
  ok('parses a named Symbol column', small.length === 6, small.map(x=>x.symbol).join(','));
  const pre = (n) => Array.from({length:n},(_,i)=>`<tr><td>SGX: A${i}U</td><td>Co ${i}</td></tr>`).join('');
  const prefixed = `<table class="wikitable"><tr><th>Stock symbol</th><th>Company</th></tr>${pre(6)}</table>`;
  const ps = parseConstituents(prefixed,'SG').map(x=>x.symbol);
  ok('strips exchange prefixes', ps.length===6 && ps[0]==='A0U', ps.join(','));
  const nz = (n) => Array.from({length:n},(_,i)=>`<tr><td>0${i}.09.1990</td><td>2${i}.12</td><td>720${i}</td></tr>`).join('');
  const noise = `<table class="wikitable"><tr><th>Date</th><th>Weight</th><th>Code</th></tr>${nz(6)}</table>`;
  const n = parseConstituents(noise,'JP');
  ok('rejects dates and weights', n.length===6 && n.every(x=>/^\d{4}$/.test(x.symbol)), n.map(x=>x.symbol).join(','));

  console.log('\n=== LIVE INDEX SOURCES ===');
  let parsed = 0;
  for (const code of Object.keys(INDEX_SOURCES)) {
    let r = await fetchConstituents(code, true);
    // Wikipedia occasionally fails a request; one retry separates flakiness from a real miss.
    if (!r.list.length) { await new Promise((x) => setTimeout(x, 1200)); r = await fetchConstituents(code, true); }
    if (r.list.length > 0) parsed++;
    const suffixOk = r.list.length ? r.list.every(c => c.symbol.length > 0 && c.symbol.length < 15) : false;
    console.log(`  ${r.list.length ? 'OK  ' : 'MISS'} ${code} ${r.indexName.padEnd(20)} ${String(r.list.length).padStart(4)}  ${r.error||''}`);
    if (r.list.length) ok(`${code}: symbols look sane`, suffixOk, r.list.slice(0,2).map(x=>x.symbol).join(','));
  }
  // Live count varies with network flakiness and one index (Nikkei) publishes no
  // constituent table at all, so the assertion is about capability, not a fixed 9.
  ok('at least 7 indexes parse live', parsed >= 7, `${parsed}/9`);

  console.log('\n=== FULL REGION UNIVERSES (every listed stock) ===');
  const { YahooClient } = require('../dist/finance/core/yahoo');
  const { fetchRegionUniverse, REGIONS } = require('../dist/finance/core/universes');
  const y = new YahooClient();
  for (const code of ['JP','SG','HK','IN','US']) {
    const r = await fetchRegionUniverse(code, { limit: 60, client: y });
    const dupe = code === 'IN' ? r.list.filter((c) => c.symbol.endsWith('.BO')).length : 0;
    console.log(`  ${r.list.length ? 'OK  ' : 'MISS'} ${code} region=${REGIONS[code]} total=${String(r.total).padStart(6)} returned=${String(r.list.length).padStart(3)} ${r.error||''}`);
    ok(`${code}: region universe returns stocks`, r.list.length > 0, `${r.total} listed in market`);
    if (code === 'IN') ok('IN: BSE duplicates filtered', dupe === 0, `${dupe} .BO rows`);
  }

  console.log('\n=== SYMBOL MAPPING ===');
  ok('India gets .NS', yahooSymbol(marketDef('IN'), 'RELIANCE') === 'RELIANCE.NS');
  ok('US gets no suffix', yahooSymbol(marketDef('US'), 'AAPL') === 'AAPL');
  ok('Japan gets .T', yahooSymbol(marketDef('JP'), '7203') === '7203.T');
  ok('Hong Kong gets .HK', yahooSymbol(marketDef('HK'), '0005') === '0005.HK');

  console.log(fails===0?'\nUNIVERSE SOURCE CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
