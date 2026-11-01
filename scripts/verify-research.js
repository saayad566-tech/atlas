// Research report: 16 sections, honest status, no fabricated sections.
const fs=require('fs'),os=require('os'),path=require('path');
const { createAtlas } = require('../dist/gateway');
let fails=0; const ok=(n,c,d)=>{ if(!c) fails++; console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
(async()=>{
  const h=fs.mkdtempSync(path.join(os.tmpdir(),'rr-'));
  const a=createAtlas({dataDir:h,consoleDir:path.join(process.cwd(),'dist','console')});
  await new Promise(r=>a.server.listen(0,r));
  const B=`http://127.0.0.1:${a.server.address().port}/api/fin`;
  const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b??{})});
  await post('/api/setup/complete',{code:'IN'});
  await post('/api/seed',{companies:20});
  const sym=(await (await post('/api/screen',{expression:'Market Cap > 0',limit:1})).json()).rows[0].symbol;
  const r=await (await fetch(`${B}/api/research/${sym}`)).json();

  ok('report has all 20 sections', r.sections.length===20, `${r.sections.length}`);
  ok('every section has a status', r.sections.every(s=>['complete','partial','unavailable'].includes(s.status)));
  ok('unavailable sections carry a gap reason', r.sections.filter(s=>s.status!=='complete').every(s=>!!s.gap), `${r.sections.filter(s=>s.status!=='complete'&&!s.gap).length} without`);
  ok('complete sections cite sources', r.sections.filter(s=>s.status==='complete').every(s=>s.sources.length>0));
  ok('coverage computed', r.coverage.pct>0 && r.coverage.pct<=100, `${r.coverage.pct}%`);
  const fin=r.sections.find(s=>s.n===9);
  ok('financial section has annual data', Array.isArray(fin.data.annual) && fin.data.annual.length>0, `${fin.data.annual.length} periods`);
  const val=r.sections.find(s=>s.n===11);
  ok('valuation section has a blended value', typeof val.data.blended==='number', String(val.data.blended));
  const risk=r.sections.find(s=>s.n===14);
  ok('risk section reports leverage', typeof risk.data.leverage==='object');

  const md=await (await fetch(`${B}/api/research/${sym}.md`)).text();
  ok('markdown export renders', md.length>2000 && md.includes('# ') && md.includes('Status:'), `${Math.round(md.length/1024)} KB`);
  ok('markdown states gaps', /Gap:/.test(md));

  const thesis=r.sections.find(s=>s.n===17);
  ok('thesis has a conditional conclusion', typeof thesis.data.conclusion==='string' && thesis.data.conclusion.length>10, thesis.data.conclusion);
  ok('thesis lists reasons to own and avoid', Array.isArray(thesis.data.reasonsToOwn) && Array.isArray(thesis.data.reasonsToAvoid));
  const audit=r.sections.find(s=>s.n===18);
  ok('source audit lists gaps', Array.isArray(audit.data.gapRegister), `${audit.data.gapRegister.length} gaps`);
  ok('source audit lists sources', Array.isArray(audit.data.sourceRegister) && audit.data.sourceRegister.length>0, `${audit.data.sourceRegister.length}`);
  const rules=r.sections.find(s=>s.n===20);
  ok('rules compliance recorded', rules && typeof rules.data==='object' && Object.keys(rules.data).length>=8);

  // Print-ready HTML + real PDF (uses chromium via playwright-core)
  const html=await (await fetch(`${B}/api/research/${sym}.html`)).text();
  ok('print-ready HTML renders', html.length>5000 && (html.match(/<section>/g)||[]).length===20, `${Math.round(html.length/1024)} KB, 20 sections`);
  const { spawn } = require('child_process');
  const pdfPath = path.join(os.tmpdir(), `atlas-${Date.now()}.pdf`);
  const pdfRun = await new Promise((res) => { const pr=spawn('node',['scripts/report-pdf.js',B.replace('/api/fin',''),sym,pdfPath]); let o=''; pr.stdout.on('data',d=>o+=d); pr.stderr.on('data',d=>o+=d); pr.on('close',c=>res({code:c,out:o.trim()})); });
  const made = fs.existsSync(pdfPath) && fs.readFileSync(pdfPath).subarray(0,5).toString()==='%PDF-';
  ok('PDF export produces a real PDF', made, pdfRun.out.slice(0,60));
  if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

  const missing=await fetch(`${B}/api/research/NOSUCH`);
  ok('unknown symbol returns 404', missing.status===404);

  await a.close(); fs.rmSync(h,{recursive:true,force:true});
  console.log(fails===0?'\nRESEARCH CHECKS PASSED':`\n${fails} FAILED`);
  process.exit(fails===0?0:1);
})();
