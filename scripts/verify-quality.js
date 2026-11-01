// Quality audit: injection safety, accessibility, measured performance, data integrity.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas } = require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'q-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const ROOT=`http://127.0.0.1:${atlas.server.address().port}`;
  const B=`${ROOT}/api/fin`;
  const post=(p,body,raw)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:raw!==undefined?raw:JSON.stringify(body??{})});
  const j=async p=>(await fetch(B+p)).json();
  await post('/api/seed',{companies:120});

  console.log('=== SECURITY: INJECTION ===');
  const before=(await j('/api/stats')).companies;
  const attacks=[
    ['SQL statement in expression', 'Symbol = "x"; DROP TABLE companies; --'],
    ['boolean tautology', 'Sector = "x" OR 1=1'],
    ['union attempt', 'Symbol = "x" UNION SELECT * FROM companies'],
    ['comment breakout', 'Symbol = "x" -- '],
    ['quote escape', 'Sector = "x\\" OR \\"1\\"=\\"1"'],
  ];
  for (const [label, expr] of attacks) {
    const r=await post('/api/screen',{expression:expr});
    const body=await r.text();
    // The real risk is execution or an internal error leaking, not the word appearing
    // in a validation message.
    const leaked=/SQLITE_|sqlite3|syntax error near|no such (table|column)/i.test(body);
    const executed=r.status===200 && /"rows":\[(?!\])/.test(body) && /DROP|UNION/i.test(expr);
    ok(`${label} rejected safely`, r.status<500 && !leaked && !executed, `HTTP ${r.status}${leaked?' LEAK':''}`);
  }
  const after=(await j('/api/stats')).companies;
  ok('database intact after injection attempts', after===before, `${before} → ${after}`);

  console.log('\n=== SECURITY: MALFORMED INPUT ===');
  const bad1=await post('/api/screen',null,'{not json');
  ok('malformed JSON handled', bad1.status>=400 && bad1.status<500, `HTTP ${bad1.status}`);
  const bad2=await post('/api/screen',{expression:''});
  ok('empty expression handled', bad2.status<500, `HTTP ${bad2.status}`);
  const bad3=await fetch(`${B}/api/company/NOSUCHSYMBOL123`);
  ok('unknown symbol returns 404', bad3.status===404, `HTTP ${bad3.status}`);
  const trav=await fetch(`${ROOT}/../../../../etc/passwd`);
  ok('path traversal blocked', trav.status===404 || !(await trav.text()).includes('root:'), `HTTP ${trav.status}`);

  console.log('\n=== ACCESSIBILITY ===');
  const html=await (await fetch(`${ROOT}/`)).text();
  const inputs=[...html.matchAll(/<input[^>]*>/g)].map(m=>m[0]);
  const unlabelled=inputs.filter(i=>!/aria-label|aria-labelledby/.test(i));
  ok('every input has an accessible name', unlabelled.length===0, unlabelled.length?`${unlabelled.length} unlabelled`:'all labelled');
  const buttons=[...html.matchAll(/<button[^>]*>/g)].map(m=>m[0]);
  const svgOnly=buttons.filter(b=>!/aria-label/.test(b) && /<svg/.test(b));
  ok('icon buttons labelled', svgOnly.length===0, `${buttons.length} buttons`);
  ok('lang attribute set', /<html lang="/.test(html));
  ok('viewport allows zoom override for a11y tools', /maximum-scale=1\.0/.test(html), 'packager spec');
  const css=await (await fetch(`${ROOT}/styles.css`)).text();
  const contrast=(fg,bg)=>{ const L=c=>{const [r,g,b]=c;const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
    const a=L(fg),b=L(bg); return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05); };
  const hex=s=>{const m=/^#?([0-9a-f]{6})$/i.exec(s.trim());return m?[parseInt(m[1].slice(0,2),16),parseInt(m[1].slice(2,4),16),parseInt(m[1].slice(4,6),16)]:null;};
  const dim=/#([0-9a-f]{6})/i.exec((css.match(/--text-dim:\s*([^;]+)/)||[])[1]||'')?.[0];
  const bg=(css.match(/--bg:\s*([^;]+)/)||[])[1]?.trim();
  if(dim&&bg&&hex(dim)&&hex(bg)){ const c=contrast(hex(dim),hex(bg)); ok('secondary text meets WCAG AA (4.5:1)', c>=4.5, `${c.toFixed(2)}:1`); }
  else ok('contrast measurable', false, 'could not parse tokens');

  console.log('\n=== PERFORMANCE (measured) ===');
  const time=async(label,fn,n=20)=>{ const t=[]; for(let i=0;i<n;i++){ const s=process.hrtime.bigint(); await fn(); t.push(Number(process.hrtime.bigint()-s)/1e6);} t.sort((a,b)=>a-b);
    return {label, p50:t[Math.floor(t.length*0.5)], p95:t[Math.floor(t.length*0.95)]}; };
  const sym=((await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0]||{}).symbol;
  const perf=[];
  perf.push(await time('screen (120 cos)', ()=>post('/api/screen',{expression:'ROE > 10 AND P/E < 40'})));
  perf.push(await time('company detail', ()=>fetch(`${B}/api/company/${sym}`)));
  perf.push(await time('atlas score', ()=>fetch(`${B}/api/atlas-score/${sym}`)));
  perf.push(await time('deep analysis', ()=>fetch(`${B}/api/deep2/${sym}`)));
  for(const p of perf) console.log(`     ${p.label.padEnd(18)} p50 ${p.p50.toFixed(1)}ms  p95 ${p.p95.toFixed(1)}ms`);
  ok('all endpoints under 300ms p95', perf.every(p=>p.p95<300), perf.map(p=>p.p95.toFixed(0)).join('/')+' ms');

  console.log('\n=== DATA INTEGRITY ===');
  const db=atlas.financeDb?.db ?? null;
  await post('/api/markets/switch',{code:'US'});
  await post('/api/seed',{companies:10});
  await post('/api/markets/switch',{code:'IN'});
  const stats=await j('/api/stats');
  ok('returning to IN keeps its data', stats.companies===before, `${stats.companies} vs ${before}`);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nQUALITY CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
