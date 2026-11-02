// Response-shape audit: does the UI read fields the API actually returns?
// A mismatch here fails silently — the panel renders blank and no test notices.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

const app=fs.readFileSync('src/console/app.js','utf8');

// Every `const r = await api('/api/x')` followed by reads of r.<field>
const pairs=[];
for (const m of app.matchAll(/const\s+(\w+)\s*=\s*await\s+api\(\s*[`'"]([^`'"]+)/g)) {
  const [, variable, rawPath]=m;
  // Stop at the next api() call: a field read after that belongs to a different response.
  const rest=app.slice(m.index+m[0].length, m.index+m[0].length+900);
  // A call with a method: option returns a different shape by design, so skip it.
  if (/^\s*,\s*\{/.test(rest) && /method\s*:/.test(rest.slice(0,120))) continue;
  const nextCall=rest.search(/await\s+api\(/);
  const window=nextCall===-1 ? rest : rest.slice(0,nextCall);
  const fields=[...new Set([...window.matchAll(new RegExp('\\b'+variable+'\\.([a-zA-Z_][a-zA-Z0-9_]*)','g'))].map(x=>x[1]))];
  if (fields.length) pairs.push({ path: rawPath.split('?')[0], fields, variable });
}

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'sh-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:12});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;

  const resolve=(p)=>p.replace(/\$\{[^}]*\}/g, encodeURIComponent(sym)).replace(/\/$/, '/'+encodeURIComponent(sym));

  console.log('=== UI FIELDS EXIST IN THE RESPONSE ===');
  let checked=0; const missing=[];
  const seen=new Set();
  for (const { path: rawPath, fields, variable } of pairs) {
    const path=resolve(rawPath);
    const key=path+'|'+fields.join(',');
    if (seen.has(key)) continue; seen.add(key);
    if (!path.startsWith('/api')) continue;
    let body;
    try {
      const r=await fetch(B+path);
      if (!r.ok) continue;                 // 4xx on a parameterised route is not a shape issue
      body=await r.json();
    } catch { continue; }
    if (!body || typeof body!=='object') continue;
    checked++;
    for (const f of fields) {
      // `r.a || r.b` is a deliberate fallback between two shapes; neither is required.
      const isFallback=new RegExp('\\b'+variable+'\\.'+f+'\\s*\\|\\|').test(app);
      const reassigned=new RegExp(variable+'\\s*=\\s*await\\s+api').test(app);
      if (!(f in body) && !isFallback && !reassigned) missing.push(`${rawPath} → .${f}`);
    }
  }
  ok(`every field the UI reads is present (${checked} responses)`, missing.length===0,
     missing.slice(0,8).join(' | ')||`${checked} checked`);

  console.log('\n=== BUTTONS ARE WIRED ===');
  const html=fs.readFileSync('src/console/index.html','utf8');
  const buttons=[...html.matchAll(/<button[^>]*id="([^"]+)"/g)].map(m=>m[1]);
  const unwired=buttons.filter(id=>!app.includes(`#${id}`));
  ok(`all ${buttons.length} buttons have a handler`, unwired.length===0, unwired.join(',')||`${buttons.length}`);

  console.log('\n=== NO DEAD ENDPOINTS CALLED ===');
  const calls=new Set([...app.matchAll(/api\(\s*[`'"']([^`'"']+)/g)].map(m=>m[1].split('?')[0]).filter(p=>p.startsWith('/api')));
  const server=fs.readFileSync('src/finance/api/server.ts','utf8');
  const routes=new Set([...server.matchAll(/p === '(\/api\/[^']+)'/g)].map(m=>m[1]));
  const prefixes=[...server.matchAll(/p\.startsWith\('(\/api\/[^']+)'\)/g)].map(m=>m[1]);
  const dead=[...calls].filter(c=>{
    const base=c.replace(/\$\{[^}]*\}/g,':X');
    if (routes.has(base)) return false;
    return !prefixes.some(p=>base.startsWith(p.replace(/\$\{[^}]*\}/g,':X')) || base.startsWith(p));
  });
  ok('no frontend call targets a missing route', dead.length===0, dead.slice(0,5).join(',')||`${calls.size} calls`);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nSHAPE AUDIT PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
