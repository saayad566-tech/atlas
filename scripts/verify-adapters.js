// Live adapters: parsers against real payload shapes, then a real fetch where reachable.
const A=require('../dist/finance/core/adapters');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== PARSERS (offline, real shapes) ===');
const bingXml=`<?xml version="1.0"?><rss><channel><item><title>Reliance Q2 results</title><link>https://x/1</link><pubDate>Sat, 01 Nov 2026 06:00:00 GMT</pubDate><News:Source>Reuters</News:Source></item><item><title>Second &amp; third</title><link>https://x/2</link></item></channel></rss>`;
const bing=A.parseBingNews(bingXml);
ok('bing news parses items', bing.length===2, `${bing.length}`);
ok('it reads title, link, publisher', bing[0].title==='Reliance Q2 results' && bing[0].url==='https://x/1' && bing[0].publisher==='Reuters');
ok('it decodes entities', bing[1].title==='Second & third', bing[1].title);
ok('malformed xml yields nothing', A.parseBingNews('<rss></rss>').length===0);
ok('google news parses too', A.parseGoogleNews(bingXml).length===2);

const wb=A.parseWorldBank([{page:1},[{indicator:{value:'GDP'},country:{value:'India'},date:'2025',value:3956067115771.63},{indicator:{value:'GDP'},country:{value:'India'},date:'2024',value:null}]]);
ok('world bank parses points', wb.length===2, `${wb.length}`);
ok('a null value stays null, never invented', wb[1].value===null);
ok('it labels its source', wb[0].source==='worldbank');
ok('a malformed body yields nothing', A.parseWorldBank({}).length===0);

const imf=A.parseImf({values:{NGDP_RPCH:{IND:{2026:6.5,2025:6.3}}}},'NGDP_RPCH');
ok('imf parses points', imf.length===2);
ok('imf sorts newest first', imf[0].year==='2026');
ok('unknown indicator yields nothing', A.parseImf({values:{}}, 'NOPE').length===0);

const wd=A.parseWikidata({results:{bindings:[{itemLabel:{value:'Reliance Industries Limited'},description:{value:'Indian company'},countryLabel:{value:'India'},website:{value:'https://ril.com'}}]}});
ok('wikidata reads itemLabel', wd && wd.name==='Reliance Industries Limited', wd?.name);
ok('it keeps description and country', wd.description==='Indian company' && wd.country==='India');
ok('empty bindings yield null', A.parseWikidata({results:{bindings:[]}})===null);

console.log('\n=== IMPLEMENTED MAP COVERS EVERY TYPE ===');
const R=require('../dist/finance/core/sourceRegistry');
const kinds=R.registrySummary().map(r=>r.kind);
ok('every catalogued type has at least one adapter', kinds.every(k=>(A.IMPLEMENTED[k]||[]).length>0), kinds.filter(k=>!(A.IMPLEMENTED[k]||[]).length).join(',')||'all covered');
ok('news has two adapters', A.IMPLEMENTED.news.length>=2, A.IMPLEMENTED.news.join(','));

console.log('\n=== LIVE FETCH (skips when blocked) ===');
(async()=>{
  const [wbL,imfL,bingL,wdL]=await Promise.all([
    A.fetchWorldBank('IN').catch(()=>null), A.fetchImf('NGDP_RPCH','IND').catch(()=>null),
    A.fetchBingNews('Reliance Industries').catch(()=>null), A.fetchWikidata('Reliance Industries').catch(()=>null)]);
  if (wbL) ok('world bank answers live', wbL.length>0, `${wbL.length} points`); else console.log('  SKIP  world bank unreachable');
  if (imfL) ok('imf answers live', imfL.length>0, `${imfL.length} points`); else console.log('  SKIP  imf unreachable');
  if (bingL) ok('bing news answers live', bingL.length>0, `${bingL.length} items`); else console.log('  SKIP  bing unreachable');
  if (wdL) ok('wikidata answers live', !!wdL.name, wdL.name); else console.log('  SKIP  wikidata unreachable');
  console.log(fails===0?'\nADAPTER CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
