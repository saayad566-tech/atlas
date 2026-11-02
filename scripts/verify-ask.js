// Ask and held review — the last two AnalyzerX views, rebuilt natively.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ak-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:20});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;

  console.log('=== ASK ===');
  for (const [q,intent] of [['is it cheap?','cheap'],['what is the debt?','debt'],['how is growth?','growth'],['should i buy?','buy'],['what is the risk?','risk'],['dividend?','dividend'],['tell me about it','overview']]) {
    const a=await (await fetch(`${B}/api/ask/${encodeURIComponent(sym)}?q=${encodeURIComponent(q)}`)).json();
    ok(`"${q}" is understood as ${intent}`, a.intent===intent && a.answer.length>20, a.intent);
  }
  const a1=await (await fetch(`${B}/api/ask/${encodeURIComponent(sym)}?q=is+it+cheap`)).json();
  ok('answers cite evidence', a1.evidence.length>0, a1.evidence.map(e=>e.label).join(','));
  ok('answers state confidence', ['high','moderate','low'].includes(a1.confidence), a1.confidence);
  ok('investment questions carry a caveat', (await (await fetch(`${B}/api/ask/${encodeURIComponent(sym)}?q=should+i+buy`)).json()).caveat !== null);
  ok('an empty question is refused', (await fetch(`${B}/api/ask/${encodeURIComponent(sym)}?q=`)).status===400);
  ok('unknown symbol is 404', (await fetch(`${B}/api/ask/NOPE.XX?q=cheap`)).status===404);

  console.log('\n=== HELD REVIEW ===');
  await post('/api/portfolio',{symbol:sym,quantity:10,avgCost:100});
  const h=await (await fetch(`${B}/api/held-review`)).json();
  ok('it reviews holdings', h.holdings===1, `${h.holdings} holding(s)`);
  ok('each holding is re-read', h.items[0].stances.length===4, `${h.items[0].stances.length} stances`);
  ok('it reports P&L', typeof h.items[0].pnlPct==='number', `${h.items[0].pnlPct}%`);
  ok('it gives a review sentence', h.items[0].review.length>20, h.items[0].review.slice(0,50));
  ok('it counts what needs attention', typeof h.needsAttention==='number', `${h.needsAttention}`);
  ok('it explains its own rule', /flagged when/i.test(h.note), h.note.slice(0,45));

  console.log('\n=== AUDIT: NO EXPO, NO STALE IDENTIFIERS ===');
  const root=path.join(process.cwd());
  // Exclude this file: it necessarily contains the patterns it searches for.
  const files=require('child_process').execSync("git ls-files 'src/**' 'scripts/**'",{cwd:root}).toString().split('\n')
    .filter(Boolean).filter(f=>!f.endsWith('verify-ask.js'));
  const fsx=require('fs');
  let expo=0, sift=0;
  for (const f of files) {
    const t=fsx.readFileSync(path.join(root,f),'utf8');
    if (/\bexpo\b|react-native|@expo\//.test(t)) expo++;
    if (/SIFT_OLLAMA/.test(t)) sift++;
  }
  ok('no expo or react-native in any source file', expo===0, `${expo} files`);
  ok('no stale SIFT_ identifiers', sift===0, `${sift} files`);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nASK + HELD REVIEW CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
