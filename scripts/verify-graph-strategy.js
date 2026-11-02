// Graph, storylines, strategy library and the condition builder — the remaining
// AnalyzerX views, rebuilt natively.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'gs-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:20});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;

  console.log('=== GRAPH ===');
  const g=await (await fetch(`${B}/api/graph/${encodeURIComponent(sym)}`)).json();
  ok('it answers', !!g.symbol, g.symbol);
  ok('there is a centre node', g.nodes.some(n=>n.kind==='company'));
  ok('every edge points at a real node', g.edges.every(e=>g.nodes.some(n=>n.id===e.from)&&g.nodes.some(n=>n.id===e.to)), `${g.edges.length} edges`);
  ok('it maps segments', g.summary.segments>0, `${g.summary.segments}`);
  ok('it maps geographies', g.summary.geographies>=0, `${g.summary.geographies}`);
  ok('it maps risks', g.summary.risks>=0, `${g.summary.risks}`);
  ok('every node explains itself', g.nodes.every(n=>typeof n.note==='string'));
  ok('it says how it was built', /stored segments/i.test(g.note), g.note.slice(0,40));
  ok('unknown symbol is 404', (await fetch(`${B}/api/graph/NOPE.XX`)).status===404);

  console.log('\n=== STORYLINES ===');
  const st=await (await fetch(`${B}/api/storylines/${encodeURIComponent(sym)}`)).json();
  ok('it answers', !!st.symbol, st.symbol);
  ok('themes are grouped', Array.isArray(st.lines));
  ok('every theme has a direction', st.lines.every(l=>['intensifying','quietening','steady'].includes(l.direction)));
  ok('every theme states a span', st.lines.every(l=>l.span.length>0));
  ok('it discloses that themes are matched, not assigned', /matched from announcement text/i.test(st.note), st.note.slice(0,40));
  ok('unknown symbol is 404', (await fetch(`${B}/api/storylines/NOPE.XX`)).status===404);

  console.log('\n=== CONDITION BUILDER ===');
  const c1=await (await post('/api/conditions/compile',{conditions:[{field:'ROE',op:'>',value:15},{field:'P/E',op:'<',value:30}]})).json();
  ok('it compiles to an expression', c1.ok===true && /ROE > 15/.test(c1.expression), c1.expression);
  const c2=await (await post('/api/conditions/compile',{conditions:[{field:'ROE',op:'>',value:15},{field:'P/E',op:'<',value:30}],join:'OR'})).json();
  ok('OR joins correctly', /OR/.test(c2.expression), c2.expression);
  const c3=await (await post('/api/conditions/compile',{conditions:[{field:'nope',op:'>',value:1}]})).json();
  ok('an unknown field is refused', c3.ok===false && /Unknown field/.test(c3.error), c3.error);
  const c4=await (await post('/api/conditions/compile',{conditions:[]})).json();
  ok('an empty list is refused', c4.ok===false);
  ok('the compiled expression actually screens', (await (await post('/api/screen',{expression:c1.expression,limit:5})).json()).rows!==undefined);

  console.log('\n=== STRATEGY LIBRARY ===');
  const saved=await (await post('/api/strategies',{name:'Quality momentum',lookbackDays:120,topN:8,rebalanceDays:21,costPct:0.25})).json();
  ok('a strategy saves', saved.ok===true, `id ${saved.id}`);
  const bad=await post('/api/strategies',{name:'!!bad!!'});
  ok('a bad name is refused', bad.status===400, String(bad.status));
  const list=await (await fetch(`${B}/api/strategies`)).json();
  ok('it is listed', list.strategies.length===1, list.strategies[0]?.name);
  const run=await (await post(`/api/strategies/run/${saved.id}`,{})).json();
  ok('it can be re-run', run.result?.ok===true, run.result?.reason||'');
  const after=await (await fetch(`${B}/api/strategies`)).json();
  ok('the run result is remembered', after.strategies[0].lastReturnPct!==null, `${after.strategies[0].lastReturnPct}%`);
  ok('it deletes', (await fetch(`${B}/api/strategies/${saved.id}`,{method:'DELETE'})).status===200);
  ok('the list is empty again', (await (await fetch(`${B}/api/strategies`)).json()).strategies.length===0);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nGRAPH + STRATEGY CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
