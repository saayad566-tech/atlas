// PWA + packager compliance: served assets, manifest, service worker, viewport, zips.
const fs=require('fs'),os=require('os'),path=require('path');
const { execSync } = require('child_process');
const { createAtlas } = require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'pwa-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}`;
  await fetch(`${B}/api/fin/api/seed`,{method:'POST',body:JSON.stringify({companies:5})});

  console.log('=== SERVED ASSETS (relative paths) ===');
  for (const [p,type] of [['/','text/html'],['/index.html','text/html'],['/styles.css','text/css'],['/app.js','javascript'],['/manifest.json','manifest+json'],['/service-worker.js','javascript'],['/icons/icon-192.png','image/png'],['/icons/icon-512.png','image/png']]) {
    const r=await fetch(B+p); const ct=r.headers.get('content-type')||'';
    ok(`GET ${p}`, r.status===200 && ct.includes(type), `${r.status} ${ct.split(';')[0]}`);
  }

  console.log('\n=== MANIFEST ===');
  const m=await (await fetch(`${B}/manifest.json`)).json();
  ok('start_url is ./', m.start_url==='./', m.start_url);
  ok('scope is ./', m.scope==='./');
  ok('display standalone', m.display==='standalone');
  ok('has 192 and 512 icons', m.icons.some(i=>i.sizes==='192x192') && m.icons.some(i=>i.sizes==='512x512'), m.icons.map(i=>i.sizes).join(','));
  ok('has maskable icon', m.icons.some(i=>i.purpose==='maskable'));
  ok('theme + background colour set', !!m.theme_color && !!m.background_color, `${m.theme_color} / ${m.background_color}`);
  for (const i of m.icons) { const r=await fetch(B+i.src.replace('./','/')); ok(`icon resolves ${i.sizes}`, r.status===200 && (r.headers.get('content-type')||'').includes('image/png')); }

  console.log('\n=== HTML HEAD ===');
  const html=await (await fetch(B+'/')).text();
  ok('viewport-fit=cover', /viewport-fit=cover/.test(html));
  ok('manifest linked relatively', /href="\.\/manifest\.json"/.test(html));
  ok('stylesheet relative', /href="\.\/styles\.css"/.test(html));
  ok('script relative', /src="\.\/app\.js"/.test(html));
  ok('service worker registered', /serviceWorker\.register\('\.\/service-worker\.js'\)/.test(html));
  ok('no absolute /console/ paths left', !/\/console\//.test(html));

  console.log('\n=== SERVICE WORKER ===');
  const sw=await (await fetch(B+'/service-worker.js')).text();
  ok('precaches the shell', /SHELL/.test(sw) && /index\.html/.test(sw));
  ok('never caches API responses', /\/api\//.test(sw) && /network|fetch\(req\)/.test(sw));
  ok('handles navigation offline', /mode === 'navigate'/.test(sw));

  console.log('\n=== ANDROID TWA ===');
  const al0 = await fetch(B + '/.well-known/assetlinks.json');
  ok('assetlinks route exists (404 until generated)', al0.status === 404, (await al0.json()).error);
  // generate a temporary one and prove it is served
  const alPath = path.join(process.cwd(), 'packaging', 'android', 'assetlinks.json');
  const tpl = JSON.parse(fs.readFileSync('packaging/android/assetlinks.template.json', 'utf8'));
  tpl[0].target.sha256_cert_fingerprints = ['AA:BB:CC'];
  fs.writeFileSync(alPath, JSON.stringify(tpl, null, 2));
  const al1 = await fetch(B + '/.well-known/assetlinks.json');
  const alBody = await al1.json();
  ok('assetlinks served when generated', al1.status === 200 && alBody[0].target.package_name === 'com.atlas.finance', `${al1.status} ${al1.headers.get('content-type')}`);
  fs.unlinkSync(alPath);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nPWA CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
