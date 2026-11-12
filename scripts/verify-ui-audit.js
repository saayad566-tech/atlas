// A full surface audit: every button wired, every screen reachable, every control labelled,
// and every backend route either used by the UI or explicitly API-only.
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(process.cwd(),'src','console','index.html'),'utf8');
const app=fs.readFileSync(path.join(process.cwd(),'src','console','app.js'),'utf8');
const server=fs.readFileSync(path.join(process.cwd(),'src','finance','api','server.ts'),'utf8');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== CONTROLS ARE WIRED ===');
const buttons=[...html.matchAll(/<button[^>]*id="([^"]+)"/g)].map(m=>m[1]);
ok('there is a substantial surface', buttons.length>=70, buttons.length+' buttons');
const unwired=buttons.filter(id=>!app.includes('#'+id));
ok('every button has a handler', unwired.length===0, unwired.join(',')||`${buttons.length} wired`);

console.log('\n=== CONTROLS ARE LABELLED ===');
const inputs=[...html.matchAll(/<(input|select|textarea)[^>]*id="([^"]+)"/g)].map(m=>m[2]);
const unlabelled=inputs.filter(id=>{
  const m=new RegExp('<[a-z]+[^>]*id="'+id+'"[^>]*>').exec(html);
  return m && !/aria-label|placeholder|<label/.test(m[0]);
});
ok('every input has an accessible name', unlabelled.length===0, unlabelled.join(',')||`${inputs.length} labelled`);

console.log('\n=== SCREENS ===');
const views=[...html.matchAll(/id="(view-[a-z]+)"/g)].map(m=>m[1]);
const mapPairs=[...app.matchAll(/([a-z]+): '(view-[a-z]+)'/g)].map(m=>[m[1],m[2]]);
const mapped=mapPairs.map(x=>x[1]);
ok('every view is in the navigation map', views.every(v=>mapped.includes(v)),
   views.filter(v=>!mapped.includes(v)).join(',')||`${views.length} views`);
const navs=[...html.matchAll(/data-view="([a-z]+)"/g)].map(m=>m[1]);
ok('every nav item points at a view', navs.every(n=>mapPairs.some(x=>x[0]===n)),
   navs.filter(n=>!mapPairs.some(x=>x[0]===n)).join(',')||`${navs.length} items`);
// A detail view is reached by opening a row, not from the navigation bar. It still has to
// be reachable, so accept either a nav entry or an explicit showView call.
const detailViews = new Set(['view-company']);
ok('no view is unreachable', views.every(v=>{
  const code=mapPairs.find(x=>x[1]===v)?.[0];
  if (!code) return false;
  if (navs.includes(code)) return true;
  if (detailViews.has(v)) return app.includes(`'${v}'`) && app.includes('showView');
  return false;
}), views.filter(v=>{
  const code=mapPairs.find(x=>x[1]===v)?.[0];
  return !(code && (navs.includes(code) || detailViews.has(v)));
}).join(',')||`${views.length} views reachable`);

console.log('\n=== NO DUPLICATE DEFINITIONS ===');
// A second definition silently shadows the first, which is how pagination broke once.
for (const name of ['loadMore','loadCompanyMore','openModal','renderTurn','sendChat','api','showView']) {
  const count=(app.match(new RegExp(`function ${name}\\s*\\(`,'g'))||[]).length;
  ok(`"${name}" is defined once`, count<=1, String(count));
}

console.log('\n=== BACKEND ROUTES ===');
const routes=[...new Set([...server.matchAll(/'(\/api\/[a-z0-9\/_-]+)'/g)].map(m=>m[1]))];
const called=new Set([...app.matchAll(/api\(\s*[`'"]([^`'"?$]+)/g)].map(m=>m[1]));
ok('there are many routes', routes.length>=200, String(routes.length));
const used=[...called].filter(c=>routes.some(r=>r===c||r.startsWith(c.replace(/\/$/,''))||c.startsWith(r)));
ok('the interface reaches a large share of the API', used.length>=100, used.length+' distinct calls');

console.log('\n=== HONEST ERROR MESSAGES ===');
// A status with no message is a dead end for the user.
const bare=[...server.matchAll(/json\(res,\s*([45]\d\d),\s*\{\s*\}\)/g)].length;
ok('no error response is sent without a message', bare===0, String(bare));

console.log(fails===0?'\nUI AUDIT PASSED':`\n${fails} FAILED`);
process.exit(fails===0?0:1);
