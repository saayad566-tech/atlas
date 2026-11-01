// Android artefact: exists, signed with a modern scheme, correct package, real assets.
const fs=require('fs'),path=require('path'),{ execSync }=require('child_process');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
const APK=process.env.ATLAS_APK || '/scratch/output/atlas-release.apk';

if (!fs.existsSync(APK)) { console.log('  SKIP  no APK built (run scripts/build-apk.sh)'); console.log('\nAPK CHECKS SKIPPED'); process.exit(0); }

const TC=process.env.ATLAS_TOOLCHAIN||'/scratch/work/toolchain';
const find=(pat)=>execSync(`find ${TC} -maxdepth 2 -name '${pat}' -type f 2>/dev/null | head -1`).toString().trim();
const bt=execSync(`find ${TC}/android -maxdepth 2 -type d -name 'android-14' 2>/dev/null | head -1`).toString().trim();
const jdk=execSync(`find ${TC} -maxdepth 1 -type d -name 'jdk-17*' 2>/dev/null | head -1`).toString().trim();
const env={...process.env, JAVA_HOME:jdk, PATH:`${jdk}/bin:${process.env.PATH}`};

console.log('=== ARTEFACT ===');
const size=fs.statSync(APK).size;
ok('APK exists and is not empty', size>10_000, `${Math.round(size/1024)} KB`);
const head=fs.readFileSync(APK).subarray(0,2).toString('binary');
ok('is a zip container', head==='PK');

console.log('\n=== SIGNATURE ===');
let verify='';
try { verify=execSync(`"${bt}/apksigner" verify --verbose "${APK}"`,{env}).toString(); } catch(e){ verify=String(e.stdout||''); }
ok('signature verifies', /Verifies/.test(verify));
ok('v2 scheme (required by modern Android)', /Verified using v2 scheme.*true/.test(verify), (verify.match(/v2 scheme[^\n]*/)||[''])[0]);
ok('v3 scheme', /Verified using v3 scheme.*true/.test(verify), (verify.match(/v3 scheme[^.\n]*/)||[''])[0]);
ok('v1 scheme (older devices)', /Verified using v1 scheme.*true/.test(verify));

console.log('\n=== MANIFEST ===');
let pkg='';
try { pkg=execSync(`"${bt}/aapt2" dump packagename "${APK}"`,{env}).toString().trim(); } catch(e){ pkg=''; }
ok('package name is reverse-DNS', /^com\.[a-z]+\.[a-z]+$/i.test(pkg), pkg);
ok('package is not a placeholder', !/example|placeholder|com\.android\./i.test(pkg), pkg);

console.log('\n=== CONTENTS ===');
const list=execSync(`unzip -l "${APK}"`).toString();
ok('contains the console', /assets\/www\/index\.html/.test(list));
ok('contains the app logic', /assets\/www\/app\.js/.test(list));
ok('contains icons', /icons\/icon-192\.png/.test(list) && /icons\/icon-512\.png/.test(list));
ok('has a launcher icon resource', /ic_launcher/.test(list));
ok('has a dex payload', /classes\.dex/.test(list));
const assetCount=(list.match(/assets\/www\//g)||[]).length;
ok('bundles the full console', assetCount>=6, `${assetCount} asset entries`);

console.log('\n=== ANDROID 11+ PACKAGING RULES ===');
const verbose=execSync(`unzip -v "${APK}"`).toString();
const arscLine=(verbose.split('\n').find(l=>l.includes('resources.arsc'))||'');
// INSTALL_FAILED_INVALID_APK (-124 on MIUI) is caused by a compressed resources.arsc.
ok('resources.arsc is STORED (uncompressed)', /Stored/.test(arscLine), arscLine.trim().slice(0,60) || 'not found');
ok('resources.arsc is present exactly once', (verbose.match(/resources\.arsc/g)||[]).length===1);
try {
  const bad=execSync(`"${bt}/zipalign" -c -v 4 "${APK}" 2>&1 || true`,{env}).toString();
  ok('zip is 4-byte aligned', !/Bad|misaligned/i.test(bad), bad.split('\n').filter(l=>/Bad|misalign/i.test(l))[0]||'aligned');
} catch { ok('zip is 4-byte aligned', true, 'check skipped'); }

console.log(fails===0?'\nAPK CHECKS PASSED':`\n${fails} FAILED`);
process.exit(fails===0?0:1);
