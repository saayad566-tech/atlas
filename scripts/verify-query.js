// Query layer: AST validation, expression round-trip, FTS search, materialised metrics,
// and measured screening performance.
const fs=require('fs'),os=require('os'),path=require('path');
const { openDatabase, refreshLatest } = require('../dist/finance/core/db');
const { ingestFixture } = require('../dist/finance/core/ingest');
const { Store } = require('../dist/finance/core/store');
const { compileAst, expressionToAst, validateAst, ALLOWED_FIELDS, AST_SCHEMA } = require('../dist/finance/core/ast');
const { importStatementCsv } = require('../dist/finance/core/sources');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

const db=openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'q-')),'q.db'));
ingestFixture(db.db,{companies:300,seed:11});
const store=new Store(db.db);

console.log('=== AST VALIDATION ===');
const good=compileAst({operator:'AND',conditions:[{field:'ROE',op:'>',value:15},{field:'Debt to Equity',op:'<',value:0.5}]});
ok('valid AST compiles to an expression', good.valid && good.expression==='(ROE > 15) AND (Debt to Equity < 0.5)', good.expression||'');
ok('unknown field rejected', !compileAst({operator:'AND',conditions:[{field:'DROP TABLE',op:'>',value:1}]}).valid);
ok('bad operator rejected', !compileAst({operator:'AND',conditions:[{field:'ROE',op:';--',value:1}]}).valid);
ok('bad value type rejected', !compileAst({operator:'AND',conditions:[{field:'ROE',op:'>',value:{}}]}).valid);
ok('empty conditions rejected', !compileAst({operator:'AND',conditions:[]}).valid);
ok('schema lists allowed fields', Array.isArray(ALLOWED_FIELDS) && ALLOWED_FIELDS.length>20, `${ALLOWED_FIELDS.length} fields`);
ok('schema is machine-checkable', AST_SCHEMA && AST_SCHEMA.type==='object');

console.log('\n=== EXPRESSION ROUND TRIP ===');
const rt=expressionToAst('(ROE > 15) AND (P/E < 20)');
ok('expression parses to AST', rt.valid && rt.ast.conditions.length===2, JSON.stringify(rt.ast?.conditions?.map(c=>c.field)));
ok('round trip is stable', compileAst(rt.ast).expression===rt.expression, compileAst(rt.ast).expression||'');

console.log('\n=== FULL-TEXT SEARCH ===');
const any=db.db.prepare('SELECT name FROM companies LIMIT 1').get().name;
const hits=store.search(any.split(' ')[0], 5);
ok('FTS returns hits', hits.length>0, `${hits.length} for "${any.split(' ')[0]}"`);
ok('symbol search works', store.search(hits[0].symbol.slice(0,4), 5).length>0);

console.log('\n=== MATERIALISED METRICS ===');
const n1=(db.db.prepare('SELECT COUNT(*) AS n FROM latest_metrics').get()).n;
ok('latest_metrics populated', n1>0, `${n1} rows`);
importStatementCsv(db.db,'symbol,name,sector,period_end,sales,net_profit,eps,equity_capital,reserves,total_assets,borrowings,cash,operating_profit,interest,depreciation,cfo,receivables,inventory,payables\nQTEST1,Query Test,Tech,2026-03-31,5000,600,12,100,2000,4000,800,300,900,50,100,700,400,300,200\n');
const row=db.db.prepare("SELECT sales, roe FROM v_latest WHERE symbol='QTEST1'").get();
ok('new company appears immediately (no staleness)', !!row && row.sales===5000, row?`sales ${row.sales}`:'missing');
const n2=(db.db.prepare('SELECT COUNT(*) AS n FROM latest_metrics').get()).n;
ok('row count grew', n2===n1+1, `${n1} → ${n2}`);

console.log('\n=== PERFORMANCE (measured) ===');
store.screener('Market Cap > 0');
const t=[]; for(let i=0;i<20;i++){ const s=process.hrtime.bigint(); store.screener('ROE > 10 AND P/E < 40 AND Debt to Equity < 1'); t.push(Number(process.hrtime.bigint()-s)/1e6); }
t.sort((a,b)=>a-b);
const p50=t[Math.floor(t.length*0.5)], p95=t[Math.floor(t.length*0.95)];
console.log(`     300 companies: screen p50 ${p50.toFixed(2)}ms  p95 ${p95.toFixed(2)}ms`);
ok('screening under 20ms p95 at 300 companies', p95<20, `${p95.toFixed(1)}ms`);
const ts=[]; for(let i=0;i<50;i++){ const s=process.hrtime.bigint(); store.search('a',5); ts.push(Number(process.hrtime.bigint()-s)/1e6); }
ts.sort((a,b)=>a-b);
ok('search under 5ms p95', ts[Math.floor(ts.length*0.95)]<5, `${ts[Math.floor(ts.length*0.95)].toFixed(2)}ms`);

console.log(fails===0?'\nQUERY CHECKS PASSED':`\n${fails} FAILED`);
process.exit(fails===0?0:1);
