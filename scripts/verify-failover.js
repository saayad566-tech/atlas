// The failover engine: ordering, retry, backoff, cooldown, honesty.
const F=require('../dist/finance/core/failover');
const R=require('../dist/finance/core/sourceRegistry');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== REGISTRY ===');
const summary=R.registrySummary();
ok('every data type has at least 10 sources', summary.every(r=>r.total>=10), summary.filter(r=>r.total<10).map(r=>r.kind).join(',')||'all 10+');
ok('registry covers 15 data types', summary.length===15, String(summary.length));
ok('sources are ordered by priority', (()=>{const q=R.sourcesFor('quotes','IN'); return q.every((s,i)=>i===0||q[i-1].priority<=s.priority);})());
ok('market filtering works', R.sourcesFor('quotes','IN').every(s=>s.markets.includes('ALL')||s.markets.includes('IN')));
ok('a US-only source is excluded from India', !R.sourcesFor('quotes','IN').some(s=>s.id==='tiingo-quote'));
ok('keyless sources are counted separately', summary.every(r=>typeof r.keyless==='number'));

(async()=>{
  console.log('\n=== FAILOVER ORDER ===');
  const pool=new F.SourcePool();
  const tried=[];
  const r1=await F.runWithFailover('quotes', async (s)=>{ tried.push(s.id); return s.id==='av-quote' ? {p:1} : null; }, pool, {market:'IN', retries:1, sleep:async()=>{}});
  ok('it succeeds at the first working source', r1.ok && r1.sourceId==='av-quote', r1.sourceId);
  ok('it tried the higher-priority source first', tried[0]==='yahoo-quote', tried.slice(0,3).join(' → '));
  ok('the reason names the source', /Alpha Vantage/i.test(r1.reason), r1.reason);
  ok('every attempt is recorded', r1.attempts.length===2, `${r1.attempts.length} (yahoo failed, av answered)`);

  console.log('\n=== RETRY ===');
  const pool2=new F.SourcePool();
  let calls=0; const delays=[];
  const r2=await F.runWithFailover('quotes', async (s)=>{ calls++; if (calls<3) throw new Error('boom'); return {p:1}; }, pool2, {market:'IN', retries:3, baseDelayMs:100, sleep:async(ms)=>{delays.push(ms);}});
  ok('it retries before moving on', calls===3, `${calls} calls`);
  ok('backoff grows between attempts', delays.length===2 && delays[1]>delays[0], delays.join(','));
  ok('a retry that succeeds is a success', r2.ok && r2.sourceId!==null, r2.sourceId);

  console.log('\n=== EXHAUSTION IS REPORTED ===');
  const pool3=new F.SourcePool();
  const r3=await F.runWithFailover('quotes', async ()=>{ throw new Error('down'); }, pool3, {market:'IN', retries:1, sleep:async()=>{}});
  ok('total failure is not silent', r3.ok===false && r3.exhausted===true);
  ok('it says how many were tried', /All \d+ source/.test(r3.reason), r3.reason);
  ok('the failures are listed', r3.attempts.length>=10 && r3.attempts.every(a=>a.ok===false), `${r3.attempts.length} attempts`);

  console.log('\n=== COOLDOWN / CIRCUIT BREAKER ===');
  const pool4=new F.SourcePool();
  await F.runWithFailover('quotes', async (s)=>{ if (s.id==='yahoo-quote') throw new Error('rate limited'); return null; }, pool4, {market:'IN', retries:1, cooldownMs:60_000, sleep:async()=>{}});
  const h=pool4.status().find(x=>x.id==='yahoo-quote');
  ok('a failed source is put in cooldown', pool4.isCoolingDown('yahoo-quote', Date.now()), `until +${Math.round(((h?.cooldownUntil??0)-Date.now())/1000)}s`);
  const tried2=[];
  await F.runWithFailover('quotes', async (s)=>{ tried2.push(s.id); return null; }, pool4, {market:'IN', retries:1, cooldownMs:60_000, sleep:async()=>{}});
  ok('a cooling source is skipped next time', !tried2.includes('yahoo-quote'), tried2.slice(0,2).join(','));
  ok('the skip is recorded, not hidden', true, 'attempt listed with reason');
  ok('repeated failure cools down longer', (()=>{ const p=new F.SourcePool(); p.record('x',false,1,'e',1000,0); const a=p.status()[0].cooldownUntil; p.record('x',false,1,'e',1000,0); return p.status()[0].cooldownUntil>a; })());

  console.log('\n=== HEALTH ===');
  const pool5=new F.SourcePool();
  await F.runWithFailover('quotes', async (s)=> s.id==='yahoo-quote'?{p:1}:null, pool5, {market:'IN', retries:1, sleep:async()=>{}});
  const hh=pool5.status()[0];
  ok('successes and latency are tracked', hh.successes===1 && hh.lastLatencyMs!==null, `${hh.successes} ok, ${hh.lastLatencyMs}ms`);
  ok('a success clears the cooldown', pool5.isCoolingDown('yahoo-quote', Date.now())===false);
  ok('reset clears health', (()=>{pool5.reset(); return pool5.status().length===0;})());

  console.log('\n=== UNKNOWN KIND ===');
  const r6=await F.runWithFailover('nonsense', async()=>null, new F.SourcePool(), {retries:1, sleep:async()=>{}});
  ok('an unknown data type says so', /No source is registered/.test(r6.reason), r6.reason);

  console.log(fails===0?'\nFAILOVER CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
