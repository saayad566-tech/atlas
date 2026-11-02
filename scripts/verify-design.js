// The design system: tokens exist, dark mode really themes, nothing hardcodes colour.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium }=require('playwright-core');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

const css=fs.readFileSync('src/console/styles.css','utf8');

console.log('=== TOKENS ===');
for (const t of ['--surface-0','--surface-1','--ink-1','--line','--brand','--positive','--negative',
                 '--space-4','--radius-md','--text-md','--shadow-1','--ease','--ring']) {
  ok(`${t} is defined`, css.includes(`${t}:`));
}
ok('a full space scale exists', ['--space-1','--space-4','--space-8'].every(t=>css.includes(`${t}:`)));
ok('a type scale exists', ['--text-xs','--text-md','--text-3xl'].every(t=>css.includes(`${t}:`)));
ok('dark mode redefines the surfaces', /prefers-color-scheme: dark[\s\S]{0,600}--surface-1:/.test(css));
ok('dark mode redefines the ink', /prefers-color-scheme: dark[\s\S]{0,900}--ink-1:/.test(css));

console.log('\n=== NO HARDCODED COLOUR IN COMPONENT RULES ===');
const body = css.split('/* ---- 3. Base')[1] || css;
const stray = (body.match(/#[0-9a-fA-F]{3,6}\b/g) || []).filter(c=>!/^#(fff|ffffff)$/i.test(c));
ok('component rules use tokens, not raw hex', stray.length===0, stray.slice(0,4).join(',')||'none');

console.log('\n=== EVERY CLASS THE MARKUP USES IS STYLED ===');
const html=fs.readFileSync('src/console/index.html','utf8');
const used=new Set();
for (const m of html.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c) used.add(c);
const styled=new Set([...css.matchAll(/\.([a-z][a-z0-9_-]*)/g)].map(m=>m[1]));
const unstyled=[...used].filter(c=>!styled.has(c) && !/^(active|hidden|demo|sm|xs|lg|primary|ghost|l|big|mono|row)$/.test(c));
ok('no class is left unstyled', unstyled.length===0, unstyled.slice(0,6).join(',')||`${used.size} classes`);

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ds-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}`;
  const post=(p,b)=>fetch(`${base}/api/fin${p}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:15});
  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});

  console.log('\n=== DARK MODE ACTUALLY THEMES (measured) ===');
  const read=async(scheme)=>{
    const pg=await br.newPage({viewport:{width:1440,height:900},bypassCSP:true,colorScheme:scheme});
    await pg.goto(base,{waitUntil:'networkidle'});
    await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2,{timeout:20000}).catch(()=>{});
    const v=await pg.evaluate(()=>{
      const g=(s,p)=>{const e=document.querySelector(s);return e?getComputedStyle(e)[p]:null;};
      return {body:g('body','backgroundColor'), ink:g('body','color'),
              card:g('.scorecard','backgroundColor'), th:g('table.dense thead th','color')};
    });
    await pg.close(); return v;
  };
  const light=await read('light');
  const dark=await read('dark');
  ok('the page background changes', light.body!==dark.body, `${light.body} → ${dark.body}`);
  ok('the ink changes', light.ink!==dark.ink, `${light.ink} → ${dark.ink}`);
  ok('cards change', light.card!==dark.card, `${light.card} → ${dark.card}`);
  ok('table headers change', light.th!==dark.th, `${light.th} → ${dark.th}`);
  ok('dark is actually dark', dark.body && parseInt(dark.body.match(/\d+/)[0],10) < 60, dark.body);
  ok('light is actually light', light.body && parseInt(light.body.match(/\d+/)[0],10) > 200, light.body);

  console.log('\n=== CONTENT STILL RENDERS IN BOTH ===');
  for (const scheme of ['light','dark']) {
    const pg=await br.newPage({viewport:{width:1440,height:900},bypassCSP:true,colorScheme:scheme});
    const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,60)));
    await pg.goto(base,{waitUntil:'networkidle'});
    await pg.waitForFunction(()=>document.querySelectorAll('#result-body tr').length>2,{timeout:20000}).catch(()=>{});
    ok(`${scheme}: rows render`, (await pg.locator('#result-body tr').count())>2, `${await pg.locator('#result-body tr').count()}`);
    ok(`${scheme}: no page errors`, errs.length===0, errs.slice(0,1).join(''));
    await pg.close();
  }
  await br.close(); await atlas.close(); fs.rmSync(home,{recursive:true,force:true});

  console.log(fails===0?'\nDESIGN SYSTEM PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
