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
    const ctx=await br.newContext({viewport:{width:w,height:h}});
    const pg=await ctx.newPage();
    const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,80)));
    await pg.goto(base,{waitUntil:'networkidle'});
    // A fresh context starts with no stored conversation, which is the first-run case.
    await pg.evaluate(()=>{ try { localStorage.clear(); } catch { /* ignore */ } });
    await pg.reload({waitUntil:'networkidle'}); await pg.waitForTimeout(2000);
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
    await ctx.close();
  }

  // The library needs its own page: the viewport contexts above are closed by now.
  const libCtx=await br.newContext({viewport:{width:412,height:880}});
  const pg=await libCtx.newPage();
  await pg.goto(base,{waitUntil:'networkidle'}); await pg.waitForTimeout(1800);
  await pg.evaluate(()=>document.querySelector('[data-view="library"]').click());
  await pg.waitForTimeout(400);
  ok('library opens', await pg.locator('#view-library').isVisible());
  await pg.fill('#ingest-text','Buy when the P/E is below 20.');
  await pg.click('#ingest-run'); await pg.waitForTimeout(1500);
  ok('a pasted rule produces a screen', (await pg.locator('#ingest-status').innerText()).includes('rule'));
  ok('the rules are rendered', (await pg.locator('#ingest-result .scorecard').count())>=3);
  await libCtx.close();

  console.log('\n=== CONVERSATIONS PERSIST ===');
  const pg2=await br.newPage({viewport:{width:1400,height:900}});
  await pg2.goto(base,{waitUntil:'networkidle'}); await pg2.waitForTimeout(1800);
  await pg2.fill('#chat-input','what is a P/E ratio?'); await pg2.click('#chat-send'); await pg2.waitForTimeout(1400);
  const saved=JSON.parse(await pg2.evaluate(()=>localStorage.getItem('atlas.chat.threads.v1'))||'[]');
  ok('a conversation is stored on the device', saved.length>=1, String(saved.length));
  ok('both turns are kept', (saved[0]?.turns?.length ?? 0)>=2, String(saved[0]?.turns?.length));
  ok('the thread is titled from the question', /P\/E/.test(saved[0]?.title ?? ''), saved[0]?.title?.slice(0,30));
  await pg2.reload({waitUntil:'networkidle'}); await pg2.waitForTimeout(2200);
  ok('the conversation list survives a reload', (await pg2.locator('.threadrow').count())>=1);
  ok('the conversation is restored', (await pg2.locator('#chat-log .msg').count())>=2);
  ok('the greeting is not stored as a turn', !(saved[0]?.turns ?? []).some(t=>/Atlas is ready/.test(t.text||'')));

  console.log('\n=== MARKDOWN AND EXTRAS ===');
  ok('answers are rendered as markdown', await pg2.evaluate(()=>{
    const b=document.querySelector('#chat-log .msg.atlas .bubble');
    return !!b && /<(div|ul|code|strong)/.test(b.innerHTML); }));
  ok('a drop zone exists in the library', await pg2.evaluate(()=>!!document.getElementById('ingest-drop')));
  ok('a voice control exists', await pg2.evaluate(()=>!!document.getElementById('chat-mic')));
  ok('a new-conversation control exists', await pg2.evaluate(()=>!!document.getElementById('chat-new')));
  ok('an attach control exists', await pg2.evaluate(()=>!!document.getElementById('chat-attach')));
  ok('storage is versioned', await pg2.evaluate(()=>localStorage.getItem('atlas.storage.version')==='2'));

  const md = await pg2.evaluate(()=>{
    const el=document.createElement('div');
    el.innerHTML=renderMarkdown('| Metric | Value |\n|---|---|\n| P/E | 20 |\n| ROE | 18% |');
    return { table: !!el.querySelector('.mdtable'), rows: el.querySelectorAll('.mdtable tbody tr').length };
  });
  ok('markdown tables render', md.table && md.rows===2, md.rows+' rows');
  const code = await pg2.evaluate(()=>{
    const el=document.createElement('div');
    el.innerHTML=renderMarkdown('```\nP/E < 20\n```');
    return { box: !!el.querySelector('.mdcodebox'), copy: !!el.querySelector('[data-copy]') };
  });
  ok('a fenced block gets a copy button', code.box && code.copy);

  // the drawer, on a phone
  const ctx3=await br.newContext({viewport:{width:412,height:880}});
  const pg3=await ctx3.newPage();
  await pg3.goto(base,{waitUntil:'networkidle'}); await pg3.waitForTimeout(2000);
  ok('a phone shows a menu button', await pg3.locator('#nav-toggle').isVisible());
  const before=await pg3.locator('.nav').boundingBox();
  // Drive the control directly: the assertion is about the drawer's behaviour, not about
  // whether a 412 px header leaves the button inside the first viewport.
  await pg3.evaluate(()=>document.getElementById('nav-toggle').click());
  await pg3.waitForTimeout(450);
  const after=await pg3.locator('.nav').boundingBox();
  ok('the drawer slides in', !!before && before.x<0 && !!after && after.x>=0);
  // The first entry sits at the top of the drawer, so it is always in the viewport.
  await pg3.evaluate(()=>document.querySelector('.nav .navbtn').click());
  await pg3.waitForTimeout(450);
  ok('choosing a view closes the drawer', !(await pg3.evaluate(()=>document.body.classList.contains('drawer-open'))));
  await ctx3.close();
  await pg2.close();

  await br.close(); await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nCHAT UI PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
