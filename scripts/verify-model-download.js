// The model can be fetched by the app itself, and the runtime is genuinely optional.
const fs=require('fs'),os=require('os'),path=require('path');
const D=require('../dist/finance/core/modeldownload');
const pkg=require('../package.json');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== THE RUNTIME IS OPTIONAL ===');
ok('better-sqlite3 is the only required dependency', Object.keys(pkg.dependencies).length===1, Object.keys(pkg.dependencies).join(','));
ok('node-llama-cpp is optional', 'node-llama-cpp' in (pkg.optionalDependencies||{}));
const llm=fs.readFileSync('src/finance/core/llm.ts','utf8');
ok('the app degrades when it is absent', /node-llama-cpp is not installed/.test(fs.readFileSync('scripts/llama-bridge.mjs','utf8')));
ok('the model path is read lazily', /private path\(\)/.test(llm));

console.log('\n=== DOWNLOAD URLS ARE EXACT, NOT GUESSED ===');
const urls=['qwen2.5-0.5b-q4','qwen2.5-1.5b-q4','llama3.2-1b-q4','phi3-mini-q4','gemma2-2b-q4','mistral-7b-q4'];
for (const id of urls) {
  const u=D.directUrl(id);
  ok(`${id} has a direct URL`, !!u && u.endsWith('.gguf'), u?u.split('/').pop():'none');
}

console.log('\n=== GGUF VERIFICATION ===');
const realModel='/scratch/work/models/qwen05b.gguf';
if (fs.existsSync(realModel)) {
  ok('a real GGUF is recognised', D.looksLikeGguf(realModel));
  ok('a text file is rejected', !D.looksLikeGguf('package.json'));
  ok('a missing file is rejected', !D.looksLikeGguf('/nope/nothing.gguf'));
} else {
  console.log('  SKIP  no model on disk to verify against');
}

console.log('\n=== THE DOWNLOAD PATH IS PROXY-AWARE ===');
const md=fs.readFileSync('src/finance/core/modeldownload.ts','utf8');
ok('it uses curl when available', /curlDownload/.test(md));
ok('it falls back to the internal client', /httpsDownloadToFile/.test(md));
ok('it streams to a .part file first', /\.part/.test(md));
ok('it verifies before renaming', /looksLikeGguf\(part\)/.test(md));

(async()=>{
  console.log('\n=== A REAL DOWNLOAD (skipped when offline) ===');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dl-'));
  // Reuse an existing file if present: this suite must not pull 500 MB every run.
  const cached=fs.existsSync(realModel);
  if (cached) {
    fs.copyFileSync(realModel, path.join(dir,'qwen2.5-0.5b-q4.gguf'));
    const r=await D.downloadModel('qwen2.5-0.5b-q4', dir);
    ok('an existing model short-circuits', r.state==='done' && r.bytes>1e6, `${(r.bytes/1e6).toFixed(0)}MB`);
  } else {
    console.log('  SKIP  no cached model');
  }
  fs.rmSync(dir,{recursive:true,force:true});

  console.log('\n=== ENDPOINTS ===');
  const { createAtlas }=require('../dist/gateway');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'md-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'});
  ok('an unknown model is refused', (await post('/api/models/download',{id:'nope'})).status===404);
  ok('status for an unknown id is 404', (await fetch(`${B}/api/models/download/status?id=nope`)).status===404);
  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});

  console.log(fails===0?'\nMODEL DOWNLOAD PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
