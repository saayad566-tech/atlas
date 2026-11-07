// The chat-first redesign: engine behaviour, layout at both sizes, and the library.
const fs=require('fs'),os=require('os'),path=require('path');
const { chromium }=require('playwright-core');
const { createAtlas }=require('../dist/gateway');
const { openDatabase }=require('../dist/finance/core/db');
const { ingestFixture }=require('../dist/finance/core/ingest');
const C=require('../dist/finance/core/chat');
const B=require('../dist/finance/core/bookingest');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('=== CHAT ENGINE ===');
const db=openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ch-')),'x.db'));
ingestFixture(db.db,{companies:6,seed:1});
const sym=db.db.prepare('SELECT symbol FROM companies LIMIT 1').get().symbol;

const concept=C.chatReply(db.db,'what is a P/E ratio?');
ok('a term is answered from the reference', concept.kind==='concept' && concept.engine==='reference');
ok('the reference explains and says how Atlas uses it', /In Atlas:/.test(concept.text));
ok('a term answer carries a caveat', !!concept.caveat);

const company=C.chatReply(db.db,`is ${sym} expensive?`);
ok('a known company is answered from stored data', company.kind==='company', company.kind);
ok('the answer cites evidence', company.evidence.length>0, company.evidence.length+' items');

const unknown=C.chatReply(db.db,'is Reliance expensive?');
ok('an unknown company is named, not guessed', /do not have/.test(unknown.text), unknown.text.slice(0,50));
ok('it never invents figures for it', unknown.evidence.length===0);

const advice=C.chatReply(db.db,`should i buy ${sym}?`);
ok('an advice-shaped question carries a caveat', !!advice.caveat && /not investment advice/i.test(advice.caveat));

const market=C.chatReply(db.db,'how is the market today?');
ok('a market question is recognised', market.kind==='market');
ok('with no board it says how to get one', /no market board|Fetch/i.test(market.text));

const empty=C.chatReply(db.db,'');
ok('an empty question is handled', empty.kind==='unknown' && empty.text.length>10);

const joke=C.chatReply(db.db,'tell me a joke');
ok('off-topic is refused honestly', /three kinds of question/.test(joke.text));

console.log('\n=== BOOK INGESTION ===');
const doc=[
  'THE QUALITY RULE','',
  'A company should earn a return on equity of at least 15% consistently.',
  'Buy when the P/E is below 20 and the debt to equity is less than 1.',
  'Exit when the operating margin falls below 10 percent.',
  'Stocks ranked in the top decile of the universe should be preferred.',
].join('\n');
const ing=B.ingestDocument(doc,'Quality Rule');
ok('rules are extracted', ing.rules.length>=4, String(ing.rules.length));
ok('two conditions in one sentence become two rules',
   ing.rules.filter(r=>r.expression==='P/E < 20'||r.expression==='Debt to Equity < 1').length===2);
ok('a number is not attached to the wrong field', !ing.rules.some(r=>r.expression==='Debt to Equity < 20'));
ok('every rule carries its source sentence', ing.rules.every(r=>r.source.length>20));
ok('an unexpressible rule is an omission, not a guess',
   ing.rules.some(r=>r.omission && /rank-based/.test(r.omission)));
ok('a screen is built from the conditions', !!ing.screen && ing.screen.runs && /P\/E < 20/.test(ing.screen.expression));
ok('an empty document is handled', B.ingestDocument('').rules.length===0);

(async()=>{
  console.log('\n=== THE CHAT-FIRST LAYOUT ===');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ui-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}`;
  const post=(p,b)=>fetch(base+'/api/fin'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:6});

  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});

  for (const [label,w,h] of [['phone',412,880],['desktop',1400,900]]) {
    const pg=await br.newPage({viewport:{width:w,height:h}});
    const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,80)));
    await pg.goto(base,{waitUntil:'networkidle'}); await pg.waitForTimeout(2000);
    ok(`${label}: chat opens by default`, await pg.locator('#view-chat').isVisible());
    ok(`${label}: the greeting renders`, (await pg.locator('#chat-log .msg').count())>=1);
    ok(`${label}: the composer is usable`, await pg.locator('#chat-input').isVisible());
    // the layout must not push the chat off screen
    const box=await pg.locator('#chat-log').boundingBox();
    ok(`${label}: the chat fills the viewport width`, !!box && box.width>w*0.5, box?Math.round(box.width)+'px':'none');
    await pg.fill('#chat-input','what is a moat?'); await pg.click('#chat-send');
    await pg.waitForTimeout(1500);
    ok(`${label}: an answer arrives`, (await pg.locator('#chat-log .msg').count())>=3);
    ok(`${label}: no page errors`, errs.length===0, errs[0]||'');
    await pg.close();
  }

  const pg=await br.newPage({viewport:{width:412,height:880}});
  await pg.goto(base,{waitUntil:'networkidle'}); await pg.waitForTimeout(1800);
  await pg.click('[data-view="library"]'); await pg.waitForTimeout(400);
  ok('library opens', await pg.locator('#view-library').isVisible());
  await pg.fill('#ingest-text','Buy when the P/E is below 20.');
  await pg.click('#ingest-run'); await pg.waitForTimeout(1500);
  ok('a pasted rule produces a screen', (await pg.locator('#ingest-status').innerText()).includes('rule'));
  ok('the rules are rendered', (await pg.locator('#ingest-result .scorecard').count())>=3);
  await pg.close();

  await br.close(); await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nCHAT UI PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
