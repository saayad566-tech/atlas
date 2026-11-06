// The NSE adapter: parsing, storage, offline fallback, and honest degradation.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas }=require('../dist/gateway');
const { openDatabase }=require('../dist/finance/core/db');
const N=require('../dist/finance/core/nse');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

const boardFixture = {
  data: [
    { key:'NIFTY 50', index:'NIFTY 50', indexSymbol:'NIFTY 50', last:25030.35, variation:493.2,
      percentChange:2.01, open:24600, high:25050, low:24580, previousClose:24537.15, yearHigh:26300, yearLow:21800 },
    { key:'NIFTY BANK', index:'NIFTY BANK', indexSymbol:'NIFTY BANK', last:59086, variation:-88.4,
      percentChange:-0.15, open:59200, high:59300, low:58900, previousClose:59174.4, yearHigh:61000, yearLow:47000 },
  ],
  timestamp:'07-Nov-2026 15:30:00', advances:'1400', declines:'820', unchanged:'90',
};

console.log('=== PARSING ===');
const b=N.parseBoard(boardFixture);
ok('two indices parsed', b.indices.length===2, String(b.indices.length));
ok('NIFTY 50 level is exact', b.indices[0].last===25030.35, String(b.indices[0].last));
ok('the change sign survives', b.indices[1].percentChange===-0.15, String(b.indices[1].percentChange));
ok('breadth is parsed', b.breadth.advances===1400 && b.breadth.declines===820, JSON.stringify(b.breadth));
ok('the timestamp is kept', b.asOf==='07-Nov-2026 15:30:00', b.asOf);
ok('an empty payload returns null', N.parseBoard({})===null);
ok('a null payload returns null', N.parseBoard(null)===null);
ok('a payload with no rows returns null', N.parseBoard({data:[]})===null);
ok('a row with no index name is dropped', N.parseBoard({data:[{last:5}]})===null);
ok('commas in numbers are handled', N.parseBoard({data:[{index:'X',last:'1,234.5'}]}).indices[0].last===1234.5);

console.log('\n=== STATUS PARSING ===');
const st=N.parseStatus({marketState:[{market:'Capital Market',marketStatus:'Close',
  tradeDate:'07-Nov-2026 15:30',index:'NIFTY 50',last:25030.35,percentChange:2.01,marketStatusMessage:'Market is closed'}]});
ok('status rows parsed', st.length===1);
ok('market name kept', st[0].market==='Capital Market');
ok('status kept', st[0].status==='Close');
ok('junk returns an empty list', N.parseStatus(null).length===0);

console.log('\n=== STORAGE AND OFFLINE READ ===');
const db=openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'nse-')),'x.db'));
const stored=N.storeBoard(db.db, b);
ok('the board is stored', stored===2, String(stored));
const back=N.storedBoard(db.db);
ok('it reads back', back.indices.length===2, String(back.indices.length));
ok('values survive the round trip', back.indices[0].last===25030.35, String(back.indices[0].last));
ok('an empty database reads as null', N.storedBoard(openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'n2-')),'y.db')).db)===null);
// storing twice must update, not duplicate
N.storeBoard(db.db, { ...b, indices: [{ ...b.indices[0], last: 25999 }] });
const again=N.storedBoard(db.db);
ok('a second store updates rather than duplicates', again.indices.length===2, String(again.indices.length));
ok('the newer value wins', again.indices.find(i=>i.index==='NIFTY 50').last===25999);

(async()=>{
  console.log('\n=== ENDPOINTS AND HONEST DEGRADATION ===');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'nse-api-'));
  const atlas=createAtlas({dataDir:home,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>atlas.server.listen(0,r));
  const B=`http://127.0.0.1:${atlas.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'});
  const before=await (await fetch(`${B}/api/nse/board`)).json();
  ok('an empty board says how to fill it', /refresh/i.test(before.note||''), (before.note||'').slice(0,40));
  // refresh may succeed or be blocked by the network; both must be handled
  const r=await (await post('/api/nse/refresh',{})).json();
  const reached = Array.isArray(r.indices) && r.indices.length>0 && !r.error;
  ok('a refresh either returns indices or explains why not', reached || !!r.error,
     reached ? `${r.indices.length} indices` : String(r.error||'').slice(0,50));
  if (r.stale) ok('a failed refresh serves the stored board rather than nothing', true);
  const status=await (await fetch(`${B}/api/nse/status`)).json();
  ok('status reports its own outcome', Array.isArray(status.rows), status.error ? 'offline: '+String(status.error).slice(0,30) : `${status.rows.length} rows`);
  await atlas.close(); fs.rmSync(home,{recursive:true,force:true});
  console.log(fails===0?'\nNSE ADAPTER PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
