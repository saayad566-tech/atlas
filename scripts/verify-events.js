// Event log + webhook dispatch, with mocked network.
const fs=require('fs'),os=require('os'),path=require('path');
const { openDatabase } = require('../dist/finance/core/db');
const { makeEvent, logEvent, listEvents, validateWebhookUrl, dispatchWebhook, recordEvent, ensureEvents } = require('../dist/finance/core/events');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ev-'));
  const db=openDatabase(path.join(home,'e.db'));

  console.log('=== EVENT LOG ===');
  ensureEvents(db.db);
  ok('starts empty', listEvents(db.db).length===0);
  const e1=makeEvent('TICKER_GRADUATED','EXRB','US','EXRB has graduated',{cik:'0000320193'});
  logEvent(db.db,e1);
  const got=listEvents(db.db);
  ok('event stored and read back', got.length===1 && got[0].type==='TICKER_GRADUATED', got[0]?.type);
  ok('details survive the round trip', got[0].details.cik==='0000320193', JSON.stringify(got[0].details));
  ok('ids are unique', makeEvent('FILED'.length?'PRICED_UPDATE':'PRICED_UPDATE','A','US','x').id !== makeEvent('PRICED_UPDATE','A','US','x').id);
  logEvent(db.db,makeEvent('PRE_LISTING_DISCOVERED','NEWCO','US','new S-1'));
  ok('filter by type', listEvents(db.db,10,'PRE_LISTING_DISCOVERED').length===1);
  ok('newest first', listEvents(db.db)[0].type==='PRE_LISTING_DISCOVERED');
  ok('logging never throws on a bad db', (()=>{ try { logEvent(null, e1); return true; } catch { return false; } })());

  console.log('\n=== URL VALIDATION (SSRF) ===');
  ok('https public URL accepted', validateWebhookUrl('https://hooks.slack.com/x').ok);
  ok('http rejected', !validateWebhookUrl('http://example.com/x').ok, validateWebhookUrl('http://example.com/x').reason);
  ok('localhost rejected', !validateWebhookUrl('https://localhost/x').ok);
  ok('127.0.0.1 rejected', !validateWebhookUrl('https://127.0.0.1/x').ok);
  ok('private 10.x rejected', !validateWebhookUrl('https://10.0.0.5/x').ok);
  ok('private 192.168 rejected', !validateWebhookUrl('https://192.168.1.5/x').ok);
  ok('link-local 169.254 rejected', !validateWebhookUrl('https://169.254.169.254/latest').ok, 'metadata endpoint');
  ok('garbage rejected', !validateWebhookUrl('not a url').ok);
  ok('empty rejected', !validateWebhookUrl('').ok);

  console.log('\n=== DISPATCH (mocked) ===');
  let captured=null;
  const mock=(url,init)=>{ captured={url,init}; return Promise.resolve({ ok:true, status:200 }); };
  const r1=await dispatchWebhook('https://hooks.example.com/a', e1, { fetchImpl: mock });
  ok('successful dispatch', r1.ok && r1.status===200);
  ok('posts JSON with the event', captured.init.method==='POST' && captured.init.body.includes('TICKER_GRADUATED'));
  ok('body carries Slack-style text', JSON.parse(captured.init.body).text.includes('EXRB'));
  ok('no secret header when unset', !captured.init.headers['X-Webhook-Secret']);
  await dispatchWebhook('https://hooks.example.com/a', e1, { secret:'s3cret', fetchImpl: mock });
  ok('secret header sent when configured', captured.init.headers['X-Webhook-Secret']==='s3cret');
  const failMock=()=>Promise.resolve({ ok:false, status:500 });
  const r2=await dispatchWebhook('https://hooks.example.com/a', e1, { fetchImpl: failMock });
  ok('HTTP failure reported, not thrown', !r2.ok && /500/.test(r2.error||''), r2.error);
  const throwMock=()=>Promise.reject(new Error('network down'));
  const r3=await dispatchWebhook('https://hooks.example.com/a', e1, { fetchImpl: throwMock });
  ok('network error caught', !r3.ok && /network down/.test(r3.error||''), r3.error);
  const r4=await dispatchWebhook('http://localhost/x', e1, { fetchImpl: mock });
  ok('invalid URL never reaches the network', !r4.ok && captured.url!=='http://localhost/x');

  console.log('\n=== RECORD (log + push) ===');
  const before=listEvents(db.db).length;
  const rec=await recordEvent(db.db, makeEvent('PRICED_UPDATE','EXRB','US','range set'), { url:'https://hooks.example.com/a', fetchImpl: mock });
  ok('logs and dispatches together', rec.logged && rec.dispatched?.ok);
  ok('event count grew', listEvents(db.db).length===before+1);
  const rec2=await recordEvent(db.db, makeEvent('PRICED_UPDATE','EXRB','US','again'), { url:null, fetchImpl: mock });
  ok('no webhook configured → log only', rec2.logged && rec2.dispatched===null);
  const rec3=await recordEvent(db.db, makeEvent('PRICED_UPDATE','EXRB','US','bad'), { url:'https://hooks.example.com/a', fetchImpl: throwMock });
  ok('failed push still logs the event', rec3.logged && rec3.dispatched && !rec3.dispatched.ok);

  fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nEVENT + WEBHOOK CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
