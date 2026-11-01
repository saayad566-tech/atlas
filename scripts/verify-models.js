// Local model manager: device profile, recommendation, install, switch, verify, remove.
const fs=require('fs'),os=require('os'),path=require('path');
const { ModelStore, MODEL_CATALOGUE, deviceProfile, recommendModel } = require('../dist/finance/core/modelmanager');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-'));
  // Build a real GGUF header: magic "GGUF", version 3, one tensor, then padding.
  function makeGguf(file, mb = 2) {
    const buf = Buffer.alloc(mb * 1024 * 1024, 0);
    buf.write('GGUF', 0, 'ascii');
    buf.writeUInt32LE(3, 4);
    buf.writeBigUInt64LE(1n, 8);
    fs.writeFileSync(file, buf);
  }
  const fake = path.join(dir, 'fake.gguf'); makeGguf(fake);  // 2 MB, like a real (small) model

  console.log('=== DEVICE PROFILE ===');
  const d=deviceProfile();
  ok('reads cores and RAM', d.cores>0 && d.ramMb>0, `${d.cores} cores, ${d.ramMb} MB`);
  ok('assigns a tier', ['low','mid','high'].includes(d.tier), d.tier);

  console.log('\n=== RECOMMENDATION ===');
  const rec=recommendModel(d);
  ok('returns a verdict for every model', rec.options.length===MODEL_CATALOGUE.length, `${rec.options.length} models`);
  ok('recommends something that fits', !!rec.best && rec.best.ramNeededMb <= d.ramMb, rec.best?rec.best.name:'none');
  ok('explains the choice', rec.reason.length>30, rec.reason.slice(0,60));
  // small device must not be told to run a 7B
  const small=recommendModel({cores:2,ramMb:2048,freeDiskMb:8000,platform:'android',arch:'arm64',tier:'low'});
  ok('2 GB device is not offered a 7B', !small.best || small.best.ramNeededMb<=2048*0.7, small.best?small.best.name:'none');
  const big=recommendModel({cores:16,ramMb:32768,freeDiskMb:500000,platform:'linux',arch:'x64',tier:'high'});
  ok('32 GB device gets a larger model', !!big.best && big.best.ramNeededMb>2000, big.best?big.best.name:'none');

  console.log('\n=== GGUF VALIDATION ===');
  const { validateGguf, detectRuntime, exportConfig, importConfig } = require('../dist/finance/core/modelmanager');
  const good = validateGguf(fake);
  ok('accepts a real GGUF header', good.ok, `v${good.version}, ${good.tensorCount} tensor(s)`);
  const notGguf = path.join(dir, 'not.gguf'); fs.writeFileSync(notGguf, Buffer.alloc(4096, 9));
  ok('rejects a file without GGUF magic', !validateGguf(notGguf).ok, validateGguf(notGguf).reason);
  const truncated = path.join(dir, 'trunc.gguf');
  const tb = Buffer.alloc(64, 0); tb.write('GGUF',0,'ascii'); tb.writeUInt32LE(3,4); tb.writeBigUInt64LE(0n,8);
  fs.writeFileSync(truncated, tb);
  ok('rejects a zero-tensor header', !validateGguf(truncated).ok, validateGguf(truncated).reason);
  ok('rejects a missing file', !validateGguf(path.join(dir,'nope.gguf')).ok);

  console.log('\n=== RUNTIME DETECTION ===');
  const rts = await detectRuntime();
  ok('probes both runtimes', rts.length === 2, rts.map(r=>r.id).join(','));
  ok('reports availability honestly', rts.every(r=>typeof r.available==='boolean'), rts.map(r=>`${r.id}:${r.available?'up':'down'}`).join(' '));
  ok('gives an install command', rts.every(r=>r.install.length>10));

  console.log('\n=== INSTALL / SWITCH / VERIFY / REMOVE ===');
  const store=new ModelStore(dir);
  ok('starts empty', store.list().length===0);
  const bad=store.installFromFile('qwen2.5-0.5b-q4', '/nope/missing.gguf');
  const notModel = store.installFromFile('qwen2.5-0.5b-q4', notGguf);
  ok('install rejects a non-GGUF file', !notModel.ok && /not a usable model/i.test(notModel.error||''), notModel.error);
  ok('install rejects a missing file', !bad.ok && /not found/i.test(bad.error||''), bad.error);
  const inst=store.installFromFile('qwen2.5-0.5b-q4', fake);
  ok('install from file succeeds', inst.ok && store.list().length===1, inst.ok?'installed':'failed');
  ok('records a sha256', !!store.list()[0].sha256);
  ok('switch to installed model', store.switchTo('qwen2.5-0.5b-q4') && store.activeId()==='qwen2.5-0.5b-q4');
  ok('active model resolves', store.activeModel()?.id==='qwen2.5-0.5b-q4');
  ok('switch to unknown model refused', store.switchTo('does-not-exist')===false);
  ok('verify passes on an untouched file', store.verify('qwen2.5-0.5b-q4').ok);
  // corrupt it and expect verification to fail
  fs.appendFileSync(path.join(dir,'models','qwen2.5-0.5b-q4.gguf'), Buffer.from([1,2,3]));
  ok('verify catches a changed file', !store.verify('qwen2.5-0.5b-q4').ok, store.verify('qwen2.5-0.5b-q4').reason);
  ok('disk usage reported', store.diskUsageMb()>0, `${store.diskUsageMb()} MB`);
  ok('remove deletes the model', store.remove('qwen2.5-0.5b-q4') && store.list().length===0);
  ok('removing the active model clears active', store.activeId()===null);

  console.log('\n=== CONFIG EXPORT / IMPORT ===');
  store.installFromFile('llama3.2-1b-q4', fake);   // re-install so the bundle is not empty
  const bundle = exportConfig(store);
  ok('exports a config bundle', bundle.version===1 && bundle.models.length>0, `${bundle.models.length} model(s)`);
  const store2 = new ModelStore(fs.mkdtempSync(path.join(os.tmpdir(),'mm2-')));
  const imp = importConfig(store2, bundle);
  ok('imports into a fresh store', imp.ok && imp.registered>0, `${imp.registered} registered`);
  ok('rejects a malformed bundle', !importConfig(store2, { nope: true }).ok);

  fs.rmSync(dir,{recursive:true,force:true});
  console.log(fails===0?'\nMODEL CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);

})();
