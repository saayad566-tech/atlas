// Archive compliance: flat structure, PWA files at root, real PNG icons, no junk.
const fs=require('fs'),path=require('path');
const { execSync } = require('child_process');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
const list=(zip)=>execSync(`unzip -Z1 "${zip}"`,{encoding:'utf8'}).split('\n').filter(Boolean);

for (const [label, zip] of [['platform','/scratch/output/atlas-platform.zip'],['pwa','/scratch/output/atlas-pwa.zip']]) {
  console.log(`\n=== ${label.toUpperCase()} ZIP ===`);
  ok(`${label}: exists`, fs.existsSync(zip), fs.existsSync(zip)?`${(fs.statSync(zip).size/1024).toFixed(0)} KB`:'missing');
  if (!fs.existsSync(zip)) continue;
  const entries=list(zip);
  // A single common top-level directory means the archive has a wrapper folder.
  const tops=new Set(entries.map(e=>e.split('/')[0]));
  const wrapped = tops.size===1 && entries.every(e=>e.includes('/'));
  ok(`${label}: no wrapper folder`, !wrapped, wrapped?`everything under "${[...tops][0]}/"`:'files at archive root');
  ok(`${label}: no node_modules`, !entries.some(e=>e.startsWith('node_modules/')||e.includes('/node_modules/')));
  ok(`${label}: no database files`, !entries.some(e=>e.endsWith('.db')||e.endsWith('.db-wal')||e.endsWith('.db-shm')));
  ok(`${label}: no logs`, !entries.some(e=>e.endsWith('.log')));
}

console.log('\n=== PWA ROOT FILES ===');
const pwa=list('/scratch/output/atlas-pwa.zip');
for (const f of ['index.html','styles.css','app.js','manifest.json','service-worker.js','icons/icon-192.png','icons/icon-512.png']) {
  ok(`pwa: ${f} at root`, pwa.includes(f));
}

console.log('\n=== ICON BYTES ===');
for (const [name,size] of [['icon-192.png',192],['icon-512.png',512]]) {
  const buf=fs.readFileSync(path.join('dist/console/icons',name));
  const isPng = buf[0]===0x89 && buf.toString('ascii',1,4)==='PNG';
  // PNG IHDR: width/height are big-endian uint32 at bytes 16..24
  const w=buf.readUInt32BE(16), h=buf.readUInt32BE(20);
  ok(`${name} is a real ${size}x${size} PNG`, isPng && w===size && h===size, `${w}x${h}, ${buf.length} bytes`);
}

console.log('\n=== MANIFEST ===');
const m=JSON.parse(fs.readFileSync('dist/console/manifest.json','utf8'));
ok('start_url is ./', m.start_url==='./');
ok('icons referenced with ./ paths', m.icons.every(i=>i.src.startsWith('./')));
ok('all referenced icons exist', m.icons.every(i=>fs.existsSync(path.join('dist/console',i.src.replace('./','')))));

console.log('\n=== PLATFORM ROOT ===');
const plat=list('/scratch/output/atlas-platform.zip');
for (const f of ['package.json','tsconfig.json','README.md']) ok(`platform: ${f} at root`, plat.includes(f));
ok('platform: src present', plat.some(e=>e.startsWith('src/')));
ok('platform: dist/console present', plat.some(e=>e.startsWith('dist/console/')));

console.log(fails===0?'\nZIP CHECKS PASSED':`\n${fails} FAILED`);
process.exit(fails===0?0:1);
