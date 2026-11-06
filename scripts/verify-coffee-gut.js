// The Coffee Rule and GUT checklists, implemented exactly as the source documents state.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
const { openDatabase }=require('../dist/finance/core/db');
const C=require('../dist/finance/core/coffee');
const G=require('../dist/finance/core/gut');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== COFFEE RULE: SOURCE FIDELITY ===');
ok('10 scorecard lines, as printed', C.SCORECARD_LINES.length===10, `${C.SCORECARD_LINES.length}`);
ok('line 1 is the business-explanation test', /explain the business in two lines/.test(C.SCORECARD_LINES[0]));
ok('line 6 states D/E below 1 and cover above 3x', /D\/E below 1/.test(C.SCORECARD_LINES[5]) && /3x/.test(C.SCORECARD_LINES[5]));
ok('line 10 is the red-flag line', /red flag/.test(C.SCORECARD_LINES[9]));
const b8=C.verdictFor(8), b5=C.verdictFor(5), b0=C.verdictFor(0);
ok('8-10 = more coffee', b8.verdict==='more coffee');
ok('5-7 = some foam', b5.verdict==='some foam');
ok('0-4 = mostly foam', b0.verdict==='mostly foam');

console.log('\n=== GUT: SOURCE FIDELITY ===');
ok('14 checklist items on page 2', G.CHECKLIST.length===14, `${G.CHECKLIST.length}`);
const byCat={}; G.CHECKLIST.forEach(c=>byCat[c.category]=(byCat[c.category]||0)+1);
ok('3 SETUP', byCat.SETUP===3, String(byCat.SETUP));
ok('3 RISK', byCat.RISK===3, String(byCat.RISK));
ok('2 EXIT', byCat.EXIT===2, String(byCat.EXIT));
ok('3 MARKET CONTEXT', byCat['MARKET CONTEXT']===3, String(byCat['MARKET CONTEXT']));
ok('3 MINDSET', byCat.MINDSET===3, String(byCat.MINDSET));

console.log('\n=== POSITION SIZE: THE DOCUMENT WORKED EXAMPLE ===');
// "capital 5,00,000 with 1% risk gives max loss 5,000. Entry 500, stop 490, risk/share 10.
//  Quantity = 5,000 / 10 = 500 shares."
const s=G.positionSize(500,490,{capital:500000,riskPct:1});
ok('max loss is 5,000', s.maxLossRupees===5000, String(s.maxLossRupees));
ok('risk per share is 10', s.riskPerShare===10, String(s.riskPerShare));
ok('quantity is 500 shares', s.quantity===500, String(s.quantity));
ok('a stop above entry is refused', 'error' in G.positionSize(490,500,{capital:500000,riskPct:1}));
ok('entry equal to stop is refused', 'error' in G.positionSize(500,500,{capital:500000,riskPct:1}));
ok('a max loss below one share is refused', 'error' in G.positionSize(500,490,{maxLossRupees:5}));

console.log('\n=== GUT GATE: ONE MISSING ANSWER MEANS NO TRADE ===');
ok('empty input is blocked', G.gutTest({}).verdict==='blocked');
ok('all three answered is cleared', G.gutTest({reason:'Held the daily level and broke the 5 min range',maxLossRupees:5000,stopPrice:490}).verdict==='cleared');
ok('a vague reason is not an answer', G.gutTest({reason:'lag raha hai upar jayega',maxLossRupees:5000,stopPrice:490}).verdict==='blocked');
ok('two of three answered is still blocked', G.gutTest({reason:'Held the daily level and broke the 5 min range',stopPrice:490}).verdict==='blocked');
ok('it names what is missing', G.gutTest({}).blockedBy.length===3, G.gutTest({}).blockedBy.join(','));

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'cf-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:10});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;

  console.log('\n=== SCORECARD AGAINST REAL DATA ===');
  const card=await (await fetch(`${B}/api/coffee/${encodeURIComponent(sym)}`)).json();
  ok('it returns all ten checks', card.checks.length===10, `${card.checks.length}`);
  ok('the score equals the passes', card.score===card.checks.filter(c=>c.state==='pass').length);
  ok('unanswered checks are unknown, never passed', card.checks.filter(c=>c.state==='unknown').every(c=>!!c.reason), `${card.unknown} unknown`);
  ok('every check carries its rule', card.checks.every(c=>c.rule.length>10));
  ok('every check carries a reading', card.checks.every(c=>c.reading.length>0));
  ok('the verdict matches the band', card.verdictLine===C.verdictFor(card.score).line, card.verdictLine);
  ok('the disclaimer is present', /not investment advice|Educational/i.test(card.note));

  console.log('\n=== A KNOWN-GOOD COMPANY SCORES HIGHER ===');
  const db=openDatabase(path.join(home,'markets','IN-STOCK.db'));
  const id=db.db.prepare('SELECT id FROM latest_metrics WHERE UPPER(symbol)=UPPER(?)').get(sym).id;
  db.db.prepare(`UPDATE latest_metrics SET roe=25, roce=28, debt_to_equity=0.2, interest_coverage=12,
    cfo=1000, net_profit=1000, pledge=0, promoter_holding=60, pe=15 WHERE id=?`).run(id);
  const better=await (await fetch(`${B}/api/coffee/${encodeURIComponent(sym)}`)).json();
  ok('better fundamentals score at least as high', better.score>=card.score, `${card.score} → ${better.score}`);

  console.log('\n=== ENDPOINTS ===');
  const rules=await (await fetch(`${B}/api/coffee/rules`)).json();
  ok('the rule set is published', rules.lines.length===10 && rules.bands.length===3);
  const size=await (await post('/api/gut/size',{entry:500,stop:490,capital:500000,riskPct:1})).json();
  ok('sizing over the API matches the document', size.quantity===500, String(size.quantity));
  ok('an impossible size is a 400', (await post('/api/gut/size',{entry:490,stop:500,capital:500000,riskPct:1})).status===400);
  const gut=await (await post('/api/gut',{reason:'Held the daily level and broke the 5 min range',maxLossRupees:5000,stopPrice:490,entryPrice:500})).json();
  ok('the GUT endpoint clears a complete input', gut.verdict==='cleared');
  ok('it returns the sizing with the verdict', gut.sizing && gut.sizing.quantity===500);
  ok('unknown company is a 404', (await fetch(`${B}/api/coffee/NOPE.XX`)).status===404);

  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nCOFFEE + GUT PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
