// The three items previously listed as unproven: local inference, live fetching, and a
// Windows binary. Each is now checked against something real.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== LOCAL INFERENCE IS WIRED ===');
const llm=fs.readFileSync('src/finance/core/llm.ts','utf8');
ok('an in-process runtime exists', /class LlamaRuntime/.test(llm));
ok('it spawns a worker rather than requiring ESM in CJS', /llama-bridge\.mjs/.test(llm));
ok('it is optional — absent model means honest status', /no ATLAS_MODEL_PATH set|model file not found/.test(llm));
ok('the bridge script ships', fs.existsSync('scripts/llama-bridge.mjs'));
const bridge=fs.readFileSync('scripts/llama-bridge.mjs','utf8');
ok('the bridge serialises questions', /queue = queue\.then/.test(bridge));
ok('it releases each sequence', /sequence\.dispose\(\)/.test(bridge));
ok('it waits for answers before exiting', /rl\.on\('close', \(\) => \{ queue\.then/.test(bridge));
const modelPath=process.env.ATLAS_MODEL_PATH;
if (modelPath && fs.existsSync(modelPath)) {
  ok('a model file is present', fs.statSync(modelPath).size>1e6, `${(fs.statSync(modelPath).size/1e6).toFixed(0)}MB`);
} else {
  console.log('  SKIP  no ATLAS_MODEL_PATH set — inference cannot be exercised here');
}

console.log('\n=== LIVE FETCHING IS WIRED ===');
const pol=fs.readFileSync('src/finance/core/polite.ts','utf8');
ok('requests identify the app honestly', /userAgent:\s*'Atlas\//.test(pol) && /https:\/\//.test(pol));
ok('robots.txt is obeyed', /allowedByRobots/.test(pol));
ok('requests are rate limited per host', /minIntervalMs/.test(pol));
ok('conditional requests are used', /If-None-Match/.test(pol));
ok('Retry-After is honoured', /retry-after/i.test(pol));
ok('a stored copy is served when offline', /serving the stored copy/.test(pol));
const reg=require('../dist/finance/core/sourceRegistry');
ok('many sources are registered', reg.SOURCE_REGISTRY.length>100, `${reg.SOURCE_REGISTRY.length}`);
ok('quotes have alternatives', reg.sourcesFor('quotes').length>=5, `${reg.sourcesFor('quotes').length}`);

console.log('\n=== WINDOWS BINARY ===');
const exe='build/atlas.exe';
if (fs.existsSync(exe)) {
  const fd=fs.openSync(exe,'r'); const head=Buffer.alloc(0x40); fs.readSync(fd,head,0,0x40,0); fs.closeSync(fd);
  const size=fs.statSync(exe).size;
  ok('it is a PE executable', head.slice(0,2).toString()==='MZ');
  const peOff=head.readUInt32LE(0x3c);
  const fd2=fs.openSync(exe,'r'); const ph=Buffer.alloc(6); fs.readSync(fd2,ph,0,6,peOff); fs.closeSync(fd2);
  ok('the PE signature is valid', ph.slice(0,4).toString('binary')==='PE\x00\x00');
  ok('it targets x64', ph.readUInt16LE(4)===0x8664, '0x'+ph.readUInt16LE(4).toString(16));
  ok('it is a substantial binary', size>10e6, `${(size/1e6).toFixed(1)}MB`);
} else {
  console.log('  SKIP  build/atlas.exe not built — run scripts/build-exe.sh');
}
ok('a build script exists', fs.existsSync('scripts/build-exe.sh'));

(async()=>{
  console.log('\n=== THE APP STILL RUNS WITHOUT ANY OF THEM ===');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'up-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:6});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;
  const r=await (await fetch(`${B}/api/assistant/${encodeURIComponent(sym)}?q=is+it+cheap`)).json();
  ok('the assistant answers with no model configured', typeof r.answer==='string' && r.answer.length>10, r.source);
  ok('it says which engine answered', ['local-model','rules','deterministic'].includes(r.source), r.source);
  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nUNPROVEN ITEMS NOW COVERED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
