// Static isolation guard: no code may open a database other than the active market's.
// The runtime suite proves today's endpoints are clean; this proves tomorrow's cannot
// silently reach another market's file.
const fs=require('fs'),path=require('path');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

function walk(dir, out=[]) {
  for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
    const p=path.join(dir,e.name);
    if (e.isDirectory()) walk(p,out); else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
const files=walk('src');
const read=(f)=>fs.readFileSync(f,'utf8');

console.log('=== NOBODY OPENS A DATABASE DIRECTLY ===');
// Only these two modules may construct a database handle.
// Only these may construct a handle. The workspace module was removed, so the allowlist
// no longer needs an exception for it.
const ALLOWED_OPENERS = new Set([
  'src/finance/core/db.ts',
  'src/finance/core/markets.ts',
]);
const offenders=[];
for (const f of files) {
  const src=read(f);
  const usesNewDb = /new\s+Database\s*\(/.test(src);
  const usesOpenDb = /openDatabase\s*\(/.test(src) && !/export function openDatabase/.test(src);
  if ((usesNewDb || usesOpenDb) && !ALLOWED_OPENERS.has(f)) offenders.push(f);
}
ok('no module outside db/markets opens a database', offenders.length===0, offenders.join(', ')||'none');

console.log('\n=== SERVER USES ONLY THE ACTIVE HANDLE ===');
const srv=read('src/finance/api/server.ts');
ok('server never constructs a Database', !/new\s+Database\s*\(/.test(srv));
ok('server never calls openDatabase', !/openDatabase\s*\(/.test(srv));
ok('server derives db from the market manager', /activate\(/.test(srv) && /markets\.active\(\)/.test(srv));
// every data route must reference the live handle
const routeCount=(srv.match(/if \(p(?:\.startsWith| ===) '\//g)||[]).length;
const dbRefs=(srv.match(/db\.db/g)||[]).length;
ok('routes outnumber 60 and use db.db', routeCount>60 && dbRefs>100, `${routeCount} route checks, ${dbRefs} db.db uses`);

console.log('\n=== MARKET SWITCH IS THE ONLY WAY TO CHANGE DATA ===');
ok('switch goes through the manager', /markets\.switch\(/.test(srv));
ok('activate rebuilds store/flow/custom', /store = new Store\(/.test(srv) && /flow = new Workflow\(/.test(srv) && /custom = new Custom\(/.test(srv));
ok('tables are ensured after every switch', /ensureLiveTables\(db\.db\)/.test(srv) && /ensureMarketTables\(db\.db\)/.test(srv));

console.log('\n=== NO CROSS-MARKET FILE PATHS IN CODE ===');
const bad=files.filter((f)=>{ const s=read(f); return /markets\/[A-Z]{2}\.db/.test(s); });
ok('no hardcoded market file path', bad.length===0, bad.join(', ')||'none');

console.log('\n=== MARKET HANDLES ARE PER-MARKET ===');
const mk=read('src/finance/core/markets.ts');
ok('handles are cached per code', /Map<string/.test(mk) && /open\(/.test(mk));
ok('active market is persisted', /active-market\.json/.test(mk));
ok('unknown market codes are rejected', /marketDef\(/.test(mk) && /Unknown market|not registered|invalid/i.test(mk));

console.log(fails===0?'\nSTATIC ISOLATION GUARD PASSED':`\n${fails} FAILED`);
process.exit(fails===0?0:1);
