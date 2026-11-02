// Extract the ETF symbol list per market from FinanceDatabase.
//
// Resolution needs to know whether "VOO" is an ETF or a stock. The bundled stock universe
// cannot answer that, so ETFs are bundled separately — symbol, name, category, exchange.
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] || '/scratch/work/findb';
const OUT = path.join(process.cwd(), 'src', 'finance', 'data', 'etfs');
const MARKETS = { IN: ['NSE','BSE'], US: ['NYQ','NMS','ASE','PCX'], GB: ['LSE'], JP: ['JPX'],
                  DE: ['GER'], SG: ['SES'], HK: ['HKG'], AU: ['ASX'], CA: ['TOR'] };

function parseCsv(text) {
  const rows=[]; let f='', r=[], q=false;
  for (let i=0;i<text.length;i++){const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){f+='"';i++;} else q=false; } else f+=c; }
    else if(c==='"') q=true;
    else if(c===','){ r.push(f); f=''; }
    else if(c==='\n'){ r.push(f); rows.push(r); r=[]; f=''; }
    else if(c!=='\r') f+=c; }
  if(f.length||r.length){ r.push(f); rows.push(r); }
  return rows;
}
function root(dir){ for(const e of fs.readdirSync(dir)){ const p=path.join(dir,e);
  if(fs.statSync(p).isDirectory()){ if(fs.existsSync(path.join(p,'database','etfs'))) return path.join(p,'database');
    const d=root(p); if(d) return d; } } return null; }

const db = root(SRC); if(!db){ console.error('not found'); process.exit(1); }
fs.mkdirSync(OUT,{recursive:true});
let total=0;
for (const [code, exchanges] of Object.entries(MARKETS)) {
  const seen=new Set(); const out=[];
  for (const ex of exchanges) {
    const file=path.join(db,'etfs',`${ex}.csv`);
    if(!fs.existsSync(file)) continue;
    const rows=parseCsv(fs.readFileSync(file,'utf8'));
    const head=rows[0]; const col=(n)=>head.indexOf(n);
    const iSym=col('symbol'), iName=col('name'), iCat=col('category'), iGrp=col('category_group'), iCur=col('currency'), iDel=col('delisted');
    for(let r=1;r<rows.length;r++){ const row=rows[r]; if(!row||row.length<4) continue;
      const s=(row[iSym]||'').trim(); if(!s||seen.has(s)) continue;
      if(iDel>=0 && String(row[iDel]).toLowerCase()==='true') continue;
      seen.add(s);
      out.push({ s, n:(row[iName]||'').trim().slice(0,90),
        cat:(iCat>=0?(row[iCat]||'').trim():'')||null,
        grp:(iGrp>=0?(row[iGrp]||'').trim():'')||null,
        cur:(iCur>=0?(row[iCur]||'').trim():'')||null });
    }
  }
  if(!out.length){ console.log(`  ${code}: no ETFs`); continue; }
  fs.writeFileSync(path.join(OUT,`${code}.json`), JSON.stringify({market:code,count:out.length,etfs:out}));
  const kb=Math.round(fs.statSync(path.join(OUT,`${code}.json`)).size/1024);
  total+=out.length;
  console.log(`  ${code}: ${out.length} ETFs, ${kb} KB`);
}
console.log(`\ntotal: ${total} ETFs across ${Object.keys(MARKETS).length} markets`);
