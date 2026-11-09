// The second-generation chat: comparison, screening, actions, context, rich blocks.
const fs=require('fs'),os=require('os'),path=require('path');
const { openDatabase }=require('../dist/finance/core/db');
const { ingestFixture }=require('../dist/finance/core/ingest');
const C=require('../dist/finance/core/chat2');
const Q=require('../dist/finance/core/quotes');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

const db=openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'c2-')),'x.db'));
ingestFixture(db.db,{companies:14,seed:5});
const syms=db.db.prepare('SELECT symbol FROM companies LIMIT 3').all().map(r=>r.symbol);
const [a,b]=syms;

console.log('=== INTENTS ===');
const help=C.chatReply(db.db,'what can you do?');
ok('help lists the capabilities', help.kind==='help' && help.blocks[0].items.length>=5);
ok('help blocks are a list', help.blocks[0].type==='list');

const cmp=C.chatReply(db.db,`compare ${a} and ${b}`);
ok('two named companies compare', cmp.kind==='compare', cmp.kind);
ok('the comparison is a table', cmp.blocks[0]?.type==='table');
ok('the table has both companies', cmp.blocks[0].rows.length===2);
ok('the comparison carries a caveat', !!cmp.caveat);

const scr=C.chatReply(db.db,'companies with ROE above 15');
ok('a sentence runs a screen', scr.kind==='screen', scr.kind);
ok('the screen returns a table', scr.blocks[0]?.type==='table');
ok('the screen records its filter', /ROE > 15/.test(scr.evidence.join(' ')), scr.evidence.join(' '));
ok('the screen carries a caveat', !!scr.caveat);

const empty=C.chatReply(db.db,'companies with ROE above 999');
ok('an impossible screen says so', /Nothing stored matches/.test(empty.text), empty.text.slice(0,40));

const act=C.chatReply(db.db,`add ${a} to my watchlist`);
ok('an action is performed', act.kind==='action' && act.performed?.ok===true, act.text.slice(0,40));
ok('the action is idempotent', C.chatReply(db.db,`add ${a} to my watchlist`).text.includes('already'));
ok('a removal works', C.chatReply(db.db,`remove ${a} from my watchlist`).performed?.ok===true);

const port=C.chatReply(db.db,'what do i own?');
ok('the portfolio is answered', port.kind==='portfolio', port.kind);

const con=C.chatReply(db.db,'what is a moat?');
ok('a term is explained', con.kind==='concept' && /In Atlas:/.test(con.text));

const comp=C.chatReply(db.db,`is ${a} expensive?`);
ok('a company question is answered', comp.kind==='company');
ok('the answer sets context for the next turn', comp.context?.symbol===a);

const follow=C.chatReply(db.db,'what about its debt?',{context:{symbol:a}});
ok('a follow-up uses the carried context', follow.kind==='company' && /debt/i.test(follow.text), follow.text.slice(0,50));

const advice=C.chatReply(db.db,`should i buy ${a}?`);
ok('an advice-shaped question is caveated', !!advice.caveat && /not investment advice/i.test(advice.caveat));

const unknown=C.chatReply(db.db,'is Reliance expensive?');
ok('an unknown company is named, not guessed', /do not have/.test(unknown.text));

const junk=C.chatReply(db.db,'tell me a joke');
ok('off-topic is refused with a list', junk.kind==='unknown' && junk.blocks[0]?.type==='list');

console.log('\n=== QUOTE PARSING ===');
const chart=JSON.stringify({chart:{result:[{meta:{symbol:'X.NS',regularMarketPrice:100,chartPreviousClose:90,
  currency:'INR',fullExchangeName:'NSE',regularMarketTime:1794000000},
  indicators:{quote:[{high:[105],low:[95],volume:[1234]}]}}]}});
const q=Q.parseQuote('X.NS',chart);
ok('the price is read', q.price===100, String(q.price));
ok('the change is computed', q.change===10, String(q.change));
ok('the change percent is computed', q.changePct===11.11, String(q.changePct));
ok('the day range is read', q.dayHigh===105 && q.dayLow===95);
ok('the volume is read', q.volume===1234);
ok('a malformed body reports an error', Q.parseQuote('X','not json').error!==null);
ok('a source error is surfaced', Q.parseQuote('X',JSON.stringify({chart:{error:{description:'nope'}}})).error!==null);

(async()=>{
  console.log('\n=== LIVE QUOTES ===');
  const live=await Q.fetchQuote('RELIANCE.NS');
  if (!live.error) {
    ok('a live quote returns a price', typeof live.price==='number' && live.price>0, String(live.price));
    ok('the currency is present', live.currency.length>0, live.currency);
    ok('the quote carries its time', !!live.asOf);
  } else {
    console.log('  SKIP  the quote source was unreachable — ' + String(live.error).slice(0,50));
  }
  const bad=await Q.fetchQuote('NOTAREALSYMBOL12345');
  ok('a bad symbol reports rather than inventing', bad.error!==null && bad.price===null);

  console.log('\n=== INTERFACE ===');
  const { chromium }=require('playwright-core');
  const { createAtlas }=require('../dist/gateway');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ui-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const base=`http://127.0.0.1:${atlas.server.address().port}`;
  const post=(p,body)=>fetch(base+'/api/fin'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body??{})});
  await post('/api/setup/complete',{code:'IN'}); await post('/api/seed',{companies:14});

  const br=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});
  const ctx=await br.newContext({viewport:{width:1400,height:900}});
  const pg=await ctx.newPage();
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,90)));
  await pg.goto(base,{waitUntil:'networkidle'}); await pg.waitForTimeout(2000);
  ok('the sidebar is grouped', (await pg.locator('.navgroup-label').count())>=5);
  ok('the greeting renders its list', (await pg.locator('.answer-list li').count())>=3);
  await pg.fill('#chat-input','companies with ROE above 15'); await pg.click('#chat-send');
  await pg.waitForTimeout(1800);
  ok('a screen renders as a table', (await pg.locator('.answer-table').count())>=1);
  ok('the table has body rows', (await pg.locator('.answer-table tbody tr').count())>=1);
  await pg.fill('#chat-input','what about its debt?'); await pg.click('#chat-send');
  await pg.waitForTimeout(1600);
  const last=await pg.locator('#chat-log .msg').last().innerText();
  ok('a follow-up is answered from context', /debt/i.test(last), last.slice(0,40).replace(/\n/g,' '));
  ok('no page errors', errs.length===0, errs[0]||'');
  await ctx.close(); await br.close(); await atlas.close(); fs.rmSync(home,{recursive:true,force:true});

  console.log(fails===0?'\nCHAT V2 PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
