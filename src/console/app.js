'use strict';
/* Sift console — vanilla, no build step. */

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

// Financial application API. This build is stock/finance only.
const FIN = '/api/fin';
const WSP = '/api/ws';

const state = {
  prefs: { theme: 'light', density: 'comfortable', columns: [], panels: {} },
  rows: [], total: 0, offset: 0, limit: 100,
  expression: '', sort: 'market_cap', order: 'desc',
  company: null, tab: 'annual',
};

function authToken() { try { return sessionStorage.getItem('atlas.token') || ''; } catch { return ''; } }
function setToken(t) { try { if (t) sessionStorage.setItem('atlas.token', t); else sessionStorage.removeItem('atlas.token'); } catch { /* ignore */ } }

function showLock(msg) {
  const el = $('#lockscreen'); if (!el) return;
  el.hidden = false;
  $('#lock-msg').textContent = msg || '';
  setTimeout(() => $('#lock-pin').focus(), 50);
}

async function unlock() {
  const pin = $('#lock-pin').value.trim();
  if (!pin) return;
  try {
    const r = await fetch(`${FIN}/api/auth/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
    const j = await r.json();
    if (j.ok && j.token) { setToken(j.token); $('#lockscreen').hidden = true; $('#lock-pin').value = ''; location.reload(); }
    else { $('#lock-msg').textContent = j.error || 'Incorrect PIN'; }
  } catch (e) { $('#lock-msg').textContent = e.message; }
}

// ---- resilient fetch -------------------------------------------------------
// One wrapper gives every call the same behaviour: a timeout so nothing hangs, retries
// with backoff for transient failures, no retry for client errors, and a visible banner
// with a Retry button when the device is offline.
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const TIMEOUT_MS = 15000;
let offlineShown = false;

function showNetBanner(message, retry) {
  const el = $('#net-banner');
  if (!el) return;
  el.hidden = false;
  const msg = $('#net-msg'); if (msg) msg.textContent = message;
  const btn = $('#net-retry');
  if (btn) { btn.hidden = !retry; btn.onclick = retry ? () => { el.hidden = true; retry(); } : null; }
}

function hideNetBanner() {
  const el = $('#net-banner');
  if (el) el.hidden = true;
  offlineShown = false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


/** The active market, from the server. Never guess a default — guessing is how one
 *  market's data leaks into another's view. */
function activeMarket() {
  return state.market || document.body.dataset.market || null;
}

/** Build a query string only when we actually know the market; otherwise let the server decide. */
function marketParam(key = 'market') {
  const m = activeMarket();
  return m ? `&${key}=${encodeURIComponent(m)}` : '';
}


// ---- trading session badge -------------------------------------------------
async function loadSession() {
  const el = $('#session-badge');
  if (!el) return;
  try {
    const m = activeMarket();
    const s = m ? await api(`/api/session/${encodeURIComponent(m)}`) : (await api('/api/session')).sessions[0];
    if (!s) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = s.phase === 'open' ? '● Open' : s.phase === 'lunch' ? '◐ Lunch' : s.phase === 'pre' ? '◑ Pre' : s.phase === 'after' ? '◑ After' : '○ Closed';
    el.className = `chip session-${s.phase === 'open' ? 'open' : s.phase === 'lunch' ? 'lunch' : 'closed'}`;
    el.title = `${s.label} · local time ${s.localTime} (${s.timezone})`;
  } catch { el.hidden = true; }
}

// ---- command palette -------------------------------------------------------
let cmdkItems = [];
let cmdkIndex = 0;

function cmdkRender() {
  const list = $('#cmdk-list');
  if (!list) return;
  list.innerHTML = cmdkItems.length
    ? cmdkItems.map((it, i) => `<div class="cmdkitem" data-i="${i}" data-active="${i === cmdkIndex ? '1' : '0'}">
        <span>${esc(it.name)}${it.demo ? ' <span class="demotag">DEMO</span>' : ''}</span>
        <span class="s">${esc(it.symbol)} · ${esc(it.sector || '')}</span></div>`).join('')
    : '<div class="cmdkitem">No match. Try a different name or symbol.</div>';
  list.querySelectorAll('[data-i]').forEach((el) => {
    el.onclick = () => cmdkChoose(Number(el.dataset.i));
  });
}

function cmdkChoose(i) {
  const it = cmdkItems[i];
  if (!it) return;
  cmdkClose();
  openCompany(it.symbol);
}

function cmdkOpen() {
  const el = $('#cmdk');
  if (!el) return;
  el.hidden = false;
  const input = $('#cmdk-input');
  if (input) { input.value = ''; input.focus(); }
  cmdkSearch('');
}

function cmdkClose() {
  const el = $('#cmdk');
  if (el) el.hidden = true;
}

async function cmdkSearch(q) {
  try {
    const r = await api(`/api/directory/search?q=${encodeURIComponent(q)}&limit=12`);
    cmdkItems = (r.results || r.rows || []).map((x) => ({ symbol: x.symbol, name: x.name || x.symbol, sector: x.sector, demo: x.source === 'fixture' }));
  } catch { cmdkItems = []; }
  cmdkIndex = 0;
  cmdkRender();
}

function wireCommandPalette() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdkOpen(); return; }
    const open = $('#cmdk') && !$('#cmdk').hidden;
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); cmdkClose(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdkIndex = Math.min(cmdkIndex + 1, cmdkItems.length - 1); cmdkRender(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); cmdkIndex = Math.max(cmdkIndex - 1, 0); cmdkRender(); }
    if (e.key === 'Enter') { e.preventDefault(); cmdkChoose(cmdkIndex); }
  });
  const input = $('#cmdk-input');
  if (input) {
    let t = null;
    input.oninput = () => { clearTimeout(t); t = setTimeout(() => cmdkSearch(input.value.trim()), 180); };
  }
  const overlay = $('#cmdk');
  if (overlay) overlay.onclick = (e) => { if (e.target === overlay) cmdkClose(); };
}

async function api(path, opts) {
  const tok = authToken();
  const headers = { 'Content-Type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(opts && opts.headers ? opts.headers : {}) };
  const maxAttempts = 3;
  let lastErr = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(FIN + path, { ...(opts || {}), headers, signal: ctrl.signal });
      clearTimeout(timer);

      if (res.status === 401) { showLock('Enter your PIN to continue.'); throw new Error('Locked'); }
      if (res.status === 428) { $('#setup').hidden = false; throw new Error('Choose a market to begin'); }

      const body = await res.json().catch(() => ({}));

      // Client errors are the caller's problem — retrying cannot help.
      if (res.status >= 400 && res.status < 500 && !RETRY_STATUS.has(res.status)) {
        hideNetBanner();
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      if (!res.ok) {
        lastErr = new Error(body.error || `HTTP ${res.status}`);
        if (attempt < maxAttempts - 1) { await sleep(300 * 2 ** attempt); continue; }
        throw lastErr;
      }
      hideNetBanner();
      return body;
    } catch (e) {
      clearTimeout(timer);
      if (e && e.message === 'Locked') throw e;
      const aborted = e && e.name === 'AbortError';
      const network = aborted || (e instanceof TypeError);
      lastErr = new Error(aborted ? `Timed out after ${TIMEOUT_MS / 1000}s` : (e && e.message) || 'Network error');
      if (attempt < maxAttempts - 1) { await sleep(300 * 2 ** attempt); continue; }
      if (network || !navigator.onLine) {
        showNetBanner(aborted ? 'The server did not respond. Retry when ready.' : 'Connection lost — showing stored data.', () => reloadCurrentView());
        offlineShown = true;
      }
      throw lastErr;
    }
  }
  throw lastErr || new Error('Request failed');
}

/** Re-run whatever the user is currently looking at, after a failure or a reconnect. */
function reloadCurrentView() {
  const active = document.querySelector('.view.active');
  const id = active ? active.id : 'view-screener';
  if (id === 'view-screener' && typeof runScreen === 'function') { runScreen({ expression: (state && state.expression) || 'Market Cap > 0' }); return; }
  if (typeof showView === 'function') { const v = (id || '').replace('view-', ''); if (v) showView(v); }
}

// Recover automatically when the device comes back online.
window.addEventListener('online', () => { hideNetBanner(); toast('Back online — refreshing'); reloadCurrentView(); });
window.addEventListener('offline', () => { showNetBanner('You are offline. Stored data stays available.'); });


const cr = (v) => (v === null || v === undefined ? '—' : nf.format(v));
const pct = (v) => (v === null || v === undefined ? '—' : `${nf1.format(v)}%`);
const ratio = (v) => (v === null || v === undefined ? '—' : nf2.format(v));
const money = (v) => `₹${nf2.format(v)}`;
const signed = (v) => (v > 0 ? 'num-pos' : v < 0 ? 'num-neg' : '');

// ---- boot -----------------------------------------------------------------

async function loadStats() {
  try {
    const s = await api('/api/stats');
    const demo = (s.sources.fixture || 0) > 0;
    const chip = $('#dataset-chip');
    chip.textContent = `${nf.format(s.companies)} companies · ${nf.format(s.statements)} statements · ${s.sectors} sectors`;
    chip.title = `Sources: ${Object.entries(s.sources).map(([k, v]) => `${k} ${v}`).join(', ')}`;
    chip.classList.toggle('demo', demo);
    if (demo) chip.textContent += ' · demo data';
  } catch { /* ignore */ }
}

const EXAMPLES = [
  'zero debt, ROE above 20, P/E under 20',
  'large cap with dividend yield above 2',
  'promoter holding above 50 and low debt',
  'sales growth above 15 and profit growth above 15',
  'small cap with ROE above 18',
  'no pledge and interest coverage above 5',
];

function renderExamples() {
  $('#examples').innerHTML = EXAMPLES.map((e) => `<button data-ex="${esc(e)}">${esc(e)}</button>`).join('');
}

// ---- search ---------------------------------------------------------------

let searchTimer = null;
async function doSearch(q) {
  if (!q || q.length < 1) { $('#hits').hidden = true; return; }
  try {
    const { hits } = await api(`/api/search?q=${encodeURIComponent(q)}`);
    if (hits.length) {
      $('#hits').innerHTML = hits.map((h) => `<div data-sym="${esc(h.symbol)}"><b>${esc(h.name)}</b><span class="sym">${esc(h.symbol)}</span> <span class="sym">· ${esc(h.sector)}</span></div>`).join('');
      $('#hits').hidden = false;
      return;
    }
    // Nothing local — ask the live source, so any listed stock can be found.
    $('#hits').innerHTML = '<div class="hint" style="padding:7px 10px">Not in your local set — searching live…</div>';
    $('#hits').hidden = false;
    const live = await api(`/api/live/search?q=${encodeURIComponent(q)}`);
    const rows = live.live || [];
    $('#hits').innerHTML = rows.length
      ? rows.map((h) => `<div data-fetch="${esc(h.symbol)}"><b>${esc(h.name)}</b><span class="sym">${esc(h.symbol)}</span> <span class="sym">· ${esc(h.exchange)}</span> <span class="sym">· fetch &amp; analyse</span></div>`).join('')
      : '<div class="hint" style="padding:7px 10px">No match locally or live. Check the symbol.</div>';
  } catch { $('#hits').hidden = true; }
}

async function fetchLive(symbol) {
  $('#hits').hidden = true;
  $('#search').value = '';
  $('#status').textContent = `Fetching ${symbol} from the live source…`;
  try {
    const r = await api('/api/live/fetch', { method: 'POST', body: JSON.stringify({ symbol }) });
    await loadStats();
    await runScreen({ expression: 'Market Cap > 0' });
    await openCompany(r.symbol);
    toastNote(`${r.symbol} added from live data (${r.pricePoints} price points)`);
  } catch (e) { $('#status').textContent = e.message; }
}

function renderPrice(a) {
  const el = $('#co-price');
  if (!a || a.points === 0) { el.innerHTML = '<div><div class="k">Price history</div><div class="v">—</div></div>'; return; }
  const f = (v, suf = '%') => (v === null || v === undefined ? '—' : `${nf2.format(v)}${suf}`);
  el.innerHTML = [
    ['Last close', a.last === null ? '—' : nf2.format(a.last)],
    ['1 month', f(a.returns.m1)], ['3 months', f(a.returns.m3)], ['6 months', f(a.returns.m6)], ['1 year', f(a.returns.y1)],
    ['Volatility (ann.)', f(a.volatilityPct)], ['Max drawdown', f(a.maxDrawdownPct)],
    ['52w position', a.week52.positionPct === null ? '—' : `${nf1.format(a.week52.positionPct)}%`],
    ['Momentum 12-1', f(a.momentum12_1)],
    ['Sessions', String(a.points)],
  ].map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('');
}

async function loadPrice(symbol) {
  try { renderPrice(await api(`/api/price/${encodeURIComponent(symbol)}`)); }
  catch { renderPrice(null); }
}

// ---- screener -------------------------------------------------------------

function renderNotes(notes, isError) {
  const el = $('#notes');
  if (!notes || !notes.length) { el.innerHTML = ''; return; }
  el.innerHTML = notes.map((n) => `<div class="${isError ? 'err' : 'note'}">${esc(n)}</div>`).join('');
}

const RESULT_COLS = [
  { key: 'name', label: 'Company', l: true, cell: (r) => `<span class="name">${esc(r.name)}</span>${r.source === 'fixture' ? ' <span class="demotag" title="Synthetic demo data — not a real company">demo</span>' : ''}<div class="sub mono">${esc(r.symbol)} · <span class="sec-link" data-sector="${esc(String(r.sector ?? ''))}" title="Show all in this sector">${esc(r.sector)}</span></div>` },
    { key: 'spark', label: 'Trend', cell: () => '<span class="hint">…</span>' },
{ key: 'market_cap', label: 'M.Cap ₹Cr', cell: (r) => cr(r.marketCap) },
  { key: 'price', label: 'Price', cell: (r) => money(r.price) },
  { key: 'pe', label: 'P/E', cell: (r) => ratio(r.pe) },
  { key: 'roe', label: 'ROE', cell: (r) => pct(r.roe) },
  { key: 'roce', label: 'ROCE', cell: (r) => pct(r.roce) },
  { key: 'debt_to_equity', label: 'D/E', cell: (r) => ratio(r.debtToEquity) },
  { key: 'sales', label: 'Sales ₹Cr', cell: (r) => cr(r.sales) },
  { key: 'net_profit', label: 'NP ₹Cr', cell: (r) => `<span class="${signed(r.netProfit)}">${cr(r.netProfit)}</span>` },
  { key: 'opm', label: 'OPM', cell: (r) => pct(r.opm) },
  { key: 'sales_growth_3y', label: 'Sales 3Y', cell: (r) => `<span class="${signed(r.salesGrowth3y)}">${pct(r.salesGrowth3y)}</span>` },
  { key: 'promoter_holding', label: 'Promoter', cell: (r) => pct(r.promoterHolding) },
  { key: 'pledge', label: 'Pledge', cell: (r) => (r.pledge > 0 ? `<span class="num-neg">${pct(r.pledge)}</span>` : '—') },
];

function activeColumns() {
  const byKey = Object.fromEntries(RESULT_COLS.map((c) => [c.key, c]));
  const chosen = (state.prefs.columns || []).map((k) => byKey[k]).filter(Boolean);
  return chosen.length ? chosen : RESULT_COLS;
}

function renderResults() {
  const cols = activeColumns();
  $('#result-head').innerHTML = cols.map((c) => `<th class="${c.l ? 'l' : ''} ${state.sort === c.key ? 'sorted' : ''}" data-sort="${c.key}">${esc(c.label)}${state.sort === c.key ? (state.order === 'asc' ? ' ▲' : ' ▼') : ''}</th>`).join('');
  $('#result-body').innerHTML = state.rows.map((r, i) => `<tr data-i="${i}" data-sym="${esc(r.symbol)}">
      <td class="l"><span class="rowstar" data-star="${esc(r.symbol)}" title="Add to watchlist" role="button" tabindex="0" aria-label="Add ${esc(r.symbol)} to watchlist">★</span></td>
      ${cols.map((c) => `<td class="${c.l ? 'l' : ''}${c.key === 'spark' ? ' spark' : ''}">${c.cell(r)}</td>`).join('')}</tr>`).join('');
  loadSparklines();
  loadScreenAnalysis(state.expression || ($('#expr') ? $('#expr').value : ''));
  loadMarketBriefing();
  $('#result-count').textContent = `${state.rows.length} result(s) in ${state.ms ?? 0} ms`;
  if (state.rows.length === 0) { void showEmptyState(); } else { const e = $('#empty'); if (e) e.hidden = true; }
  $('#empty').hidden = state.rows.length > 0;
  $('#btn-more').hidden = state.rows.length >= state.total;
}

async function runScreen(payload) {
  if (payload && payload.expression) { syncUrlScreen(payload.expression); try { await api('/api/screen/history', { method: 'POST', body: JSON.stringify({ expression: payload.expression, count: 0 }) }); } catch { /* ignore */ } }
  $('#status').textContent = 'Screening…';
  try {
    const res = await api('/api/screen', { method: 'POST', body: JSON.stringify({ ...payload, sort: state.sort, order: state.order, limit: state.limit, offset: 0 }) });
    state.rows = res.rows; state.total = res.total; state.offset = res.rows.length;
    loadScreenHistory();
    state.ms = res.ms ?? (typeof res.tookMs === 'number' ? res.tookMs : null);
    state.expression = res.expression;
    $('#expr').value = res.expression;
    $('#echo').textContent = res.expression;
    renderResults();
    renderStats(res.stats);
    renderNotes(res.notes, false);
    $('#status').textContent = `${nf.format(res.total)} companies · ${res.ms} ms · showing ${state.rows.length}`;
  } catch (e) {
    $('#status').textContent = 'Query failed.';
    renderNotes([e.message], true);
  }
}

async function loadMore() {
  try {
    const res = await api('/api/screen', { method: 'POST', body: JSON.stringify({ expression: state.expression, sort: state.sort, order: state.order, limit: state.limit, offset: state.offset }) });
    state.rows = state.rows.concat(res.rows); state.offset = state.rows.length;
    renderResults();
    $('#status').textContent = `${nf.format(res.total)} companies · showing ${state.rows.length}`;
  } catch (e) { renderNotes([e.message], true); }
}

// ---- views ----------------------------------------------------------------

function showView(id) {
  for (const v of Object.values(VIEWS)) {
    const el = document.getElementById(v); if (el) el.classList.toggle('active', v === id);
  }
  // Per-view loaders. These live here because showView is the function that actually
  // runs on a tab click — the copy inside wire()'s handler never fired.
  try {
    if (id === 'view-intel') { loadSectorPanel(); loadSectorChart(); loadDirectory(''); loadRefreshPanel(); loadPreListing(); loadEvents(); }
    if (id === 'view-store') { loadModels(); }
    if (id === 'view-portfolio') { loadPortfolioPnl(); loadPortfolioAnalysis(); loadJournal(); }
  } catch { /* loader unavailable before boot completes */ }
  document.querySelectorAll('.navbtn').forEach((b) => {
    const map = VIEWS;
    b.classList.toggle('active', map[b.dataset.view] === id || (id === 'view-company' && b.dataset.view === 'screener'));
  });
}

// ---- company --------------------------------------------------------------

const INTEL_TABS = ['overview', 'business', 'orderbook', 'plans', 'facilities', 'risks', 'news'];

const CO_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'business', label: 'Business' },
  { id: 'orderbook', label: 'Order book' },
  { id: 'plans', label: 'Plans & guidance' },
  { id: 'facilities', label: 'Facilities' },
  { id: 'risks', label: 'Risks' },
  { id: 'news', label: 'News & actions' },
  { id: 'annual', label: 'Annual P&L' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'balance', label: 'Balance Sheet' },
  { id: 'cashflow', label: 'Cash Flow' },
  { id: 'ratios', label: 'Ratios' },
  { id: 'shareholding', label: 'Shareholding' },
  { id: 'peers', label: 'Peers' },
];

const CO_COLS = {
  annual: [
    { k: 'period_end', label: 'Year', l: true, f: (v) => String(v).slice(0, 4) },
    { k: 'sales', label: 'Sales ₹Cr', f: cr }, { k: 'expenses', label: 'Expenses', f: cr },
    { k: 'operating_profit', label: 'Op. Profit', f: cr }, { k: 'opm_pct', label: 'OPM %', f: pct },
    { k: 'interest', label: 'Interest', f: cr }, { k: 'depreciation', label: 'Dep.', f: cr },
    { k: 'net_profit', label: 'Net Profit', f: (v) => `<span class="${signed(v)}">${cr(v)}</span>` }, { k: 'eps', label: 'EPS', f: (v) => nf2.format(v) },
  ],
  quarterly: [
    { k: 'period_end', label: 'Quarter', l: true, f: (v) => String(v) },
    { k: 'sales', label: 'Sales ₹Cr', f: cr }, { k: 'operating_profit', label: 'Op. Profit', f: cr },
    { k: 'opm_pct', label: 'OPM %', f: pct }, { k: 'net_profit', label: 'Net Profit', f: (v) => `<span class="${signed(v)}">${cr(v)}</span>` },
    { k: 'eps', label: 'EPS', f: (v) => nf2.format(v) },
  ],
  balance: [
    { k: 'period_end', label: 'Year', l: true, f: (v) => String(v).slice(0, 4) },
    { k: 'equity_capital', label: 'Equity Cap.', f: cr }, { k: 'reserves', label: 'Reserves', f: cr },
    { k: 'borrowings', label: 'Borrowings', f: cr }, { k: 'other_liabilities', label: 'Other Liab.', f: cr },
    { k: 'total_liabilities', label: 'Total Liab.', f: cr }, { k: 'fixed_assets', label: 'Fixed Assets', f: cr },
    { k: 'investments', label: 'Investments', f: cr }, { k: 'total_assets', label: 'Total Assets', f: cr },
  ],
  cashflow: [
    { k: 'period_end', label: 'Year', l: true, f: (v) => String(v).slice(0, 4) },
    { k: 'cfo', label: 'CFO', f: (v) => `<span class="${signed(v)}">${cr(v)}</span>` },
    { k: 'cfi', label: 'CFI', f: (v) => `<span class="${signed(v)}">${cr(v)}</span>` },
    { k: 'cff', label: 'CFF', f: (v) => `<span class="${signed(v)}">${cr(v)}</span>` },
    { k: 'net_cash_flow', label: 'Net Cash', f: (v) => `<span class="${signed(v)}">${cr(v)}</span>` },
  ],
  ratios: [
    { k: 'period_end', label: 'Year', l: true, f: (v) => String(v).slice(0, 4) },
    { k: 'roe', label: 'ROE %', f: pct }, { k: 'roce', label: 'ROCE %', f: pct },
    { k: 'debt_to_equity', label: 'D/E', f: ratio }, { k: 'opm', label: 'OPM %', f: pct }, { k: 'npm', label: 'NPM %', f: pct },
    { k: 'pe', label: 'P/E', f: ratio }, { k: 'pb', label: 'P/B', f: ratio },
    { k: 'dividend_yield', label: 'Div Yld', f: pct }, { k: 'market_cap', label: 'M.Cap ₹Cr', f: cr },
    { k: 'current_ratio', label: 'Curr. Ratio', f: ratio }, { k: 'interest_coverage', label: 'Int. Cover', f: (v) => `${nf1.format(v)}×` },
    { k: 'sales_growth_3y', label: 'Sales 3Y', f: pct }, { k: 'profit_growth_3y', label: 'Profit 3Y', f: pct },
  ],
  shareholding: [
    { k: 'period_end', label: 'As of', l: true, f: (v) => String(v) },
    { k: 'promoter', label: 'Promoter %', f: pct }, { k: 'fii', label: 'FII %', f: pct },
    { k: 'dii', label: 'DII %', f: pct }, { k: 'public', label: 'Public %', f: pct },
    { k: 'pledge_pct', label: 'Pledged %', f: (v) => (v > 0 ? `<span class="num-neg">${pct(v)}</span>` : '—') },
  ],
  peers: [
    { k: 'name', label: 'Peer', l: true, f: (v, row) => `<span class="name">${esc(v)}</span><div class="sub mono">${esc(row.symbol)}</div>` },
    { k: 'market_cap', label: 'M.Cap ₹Cr', f: cr }, { k: 'pe', label: 'P/E', f: ratio }, { k: 'roe', label: 'ROE %', f: pct },
  ],
};

function dataFor(tab) {
  const c = state.company;
  if (!c) return [];
  if (tab === 'annual') return c.annual;
  if (tab === 'quarterly') return c.quarterly;
  if (tab === 'balance') return c.annual;
  if (tab === 'cashflow') return c.annual;
  if (tab === 'ratios') return c.ratios;
  if (tab === 'shareholding') return c.shareholding;
  if (tab === 'peers') return c.peers;
  return [];
}

function renderCompanyTab() {
  document.querySelectorAll('#co-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  if (INTEL_TABS.includes(state.tab)) {
    $('#co-table-wrap').hidden = true;
    $('#co-intel').hidden = false;
    renderIntel(state.tab);
    return;
  }
  $('#co-table-wrap').hidden = false;
  $('#co-intel').hidden = true;
  const cols = CO_COLS[state.tab] || [];
  const rows = dataFor(state.tab);
  $('#co-table-head').innerHTML = cols.map((c) => `<th class="${c.l ? 'l' : ''}">${esc(c.label)}</th>`).join('');
  $('#co-table-body').innerHTML = rows.length
    ? rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.l ? 'l' : ''}">${c.f(r[c.k], r)}</td>`).join('')}</tr>`).join('')
    : `<tr><td class="l" colspan="${cols.length}">No data.</td></tr>`;
}

function renderCompany() {
  const c = state.company;
  if (!c) return;
  const co = c.company;
  const l = c.latest || {};
  const a = c.analysis;
  const cov = c.coverage || { annual: 0, quarterly: 0, years: 0, ready: false };
  const covLabel = cov.annual === 0 ? 'no history yet' : `${cov.annual} annual period${cov.annual > 1 ? 's' : ''} · ${cov.years}y`;
  $('#co-head').innerHTML = `
    <h1>${esc(co.name)}</h1><span class="sym">${esc(co.symbol)}</span>
    <span class="chip">${esc(co.sector)} · ${esc(co.industry)}</span>
    <span class="chip ${co.source === 'fixture' ? 'demo' : ''}">${esc(co.source === 'fixture' ? 'demo data' : co.source)}</span>
    <span class="chip ${cov.ready ? '' : 'demo'}" title="Fundamentals coverage">${esc(covLabel)}</span>`;
  const fh = $('#btn-fetch-history');
  if (fh) fh.hidden = cov.ready;
  // Shareholding is not published by the live source: show "—" rather than a false 0%.
  const hasHoldings = (c.shareholding || []).length > 0;
  const cur = co.currency && co.currency !== 'INR' ? `${co.currency} ` : '₹';
  const metrics = [
    ['Market Cap', `${cur}${cr(l.marketCap)} Cr`], ['Price', `${cur}${nf2.format(l.price)}`], ['P/E', ratio(l.pe)], ['P/B', ratio(l.pb)],
    ['ROE', pct(l.roe)], ['ROCE', pct(l.roce)], ['Debt/Equity', ratio(l.debtToEquity)], ['OPM', pct(l.opm)],
    ['Sales', `${cur}${cr(l.sales)} Cr`], ['Net Profit', `${cur}${cr(l.netProfit)} Cr`],
    ['Promoter', hasHoldings ? pct(l.promoterHolding) : '—'], ['Pledge', hasHoldings ? pct(l.pledge) : '—'],
  ];
  $('#co-metrics').innerHTML = metrics.map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('');

  const flags = a && a.flags.length
    ? `<div class="flags">${a.flags.map((f) => `<div class="flag"><span class="sev ${esc(f.severity)}">${esc(f.severity)}</span><span><b>${esc(f.label)}</b> — ${esc(f.detail)}</span></div>`).join('')}</div>`
    : '<div class="flags"><div class="flag"><span class="sev low">clear</span><span>No red flags detected in the latest annual data.</span></div></div>';
  $('#co-health').innerHTML = a
    ? `<div class="hd"><span class="score">${a.score}</span><span class="verdict ${esc(a.verdict)}">${esc(a.verdict)}</span><span class="summary">${esc(a.summary)}</span></div>${flags}`
    : '<div class="summary">No analysis available.</div>';

  renderScores(c.scores);
  renderDeep(c.metrics);
  renderFactors(c.factors);
  renderValuation(c.valuation);
  renderStrength(c.strength);
  $('#co-note').value = (c.note && c.note.body) || '';
  $('#btn-watch').textContent = c.watched ? '★ Watching' : '☆ Watch';
  $('#btn-watch').dataset.sym = co.symbol;
  renderStars(co.symbol);
  loadValLab(co.symbol, $('#val-scenario').value || 'base');
  loadPrice(co.symbol);
  loadDeep2(co.symbol);
  loadMarket(co.symbol);
  loadAtlasScore(co.symbol);
  loadAsk(co.symbol);
  pushRecent(co.symbol);
  loadFreshness(co.symbol);
  loadTimeline(co.symbol);
  renderIndicatorChart(co.symbol);
  loadExtras(co.symbol);
  loadCompanyBriefing(co.symbol);
  loadHistory(co.symbol);
  loadCorporate(co.symbol);
  loadDataTruth(co.symbol);
  loadGraph(co.symbol);
  loadAlpha(co.symbol);
  loadBackData(co.symbol);
  if ($('#bd-go')) { $('#bd-go').onclick = () => loadBackData(co.symbol); }
  if ($('#ask-go')) { $('#ask-go').onclick = () => askCompany(co.symbol); $('#ask-input').onkeydown = (e) => { if (e.key === 'Enter') askCompany(co.symbol); }; }
  loadNote(co.symbol);
  researchPrompt(co.symbol);
  $('#btn-research').onclick = () => loadResearch(co.symbol);
  loadMore(co.symbol);
  loadNews(co.symbol);
  $('#co-audit').hidden = true;

  $('#co-tabs').innerHTML = CO_TABS.map((t) => `<button role="tab" data-tab="${t.id}">${esc(t.label)}</button>`).join('');
  renderCompanyTab();
}

async function openCompany(symbol) {
  try {
    $('#status').textContent = `Loading ${symbol}…`;
    state.company = await api(`/api/company/${encodeURIComponent(symbol)}`);
    state.intel = await api(`/api/profile/${encodeURIComponent(symbol)}`).catch(() => null);
    state.tab = 'overview';
    showView('view-company');
    renderCompany();
    window.scrollTo({ top: 0 });
  } catch (e) { $('#status').textContent = e.message; }
}

function tbl(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

async function renderStars(symbol) {
  const el = $('#co-stars'); if (!el) return;
  const r = await api(`/api/rating/${encodeURIComponent(symbol)}`).catch(() => ({ rating: null }));
  const mine = r.rating ? r.rating.rating : 0;
  el.innerHTML = [1, 2, 3, 4, 5].map((n) => `<span data-star="${n}" class="${n <= mine ? 'on' : ''}" role="button" aria-label="${n} star">★</span>`).join('');
  el.onclick = async (e) => {
    const t = e.target.closest('[data-star]'); if (!t) return;
    await api(`/api/rating/${encodeURIComponent(symbol)}`, { method: 'POST', body: JSON.stringify({ rating: Number(t.dataset.star), thesis: $('#co-note').value }) });
    renderStars(symbol);
  };
}

// ONE map for view routing. It was duplicated and new views kept landing in only one
// copy, which silently broke three tabs across three rounds.
const VIEWS = {
  screener: 'view-screener', company: 'view-company', watchlist: 'view-watchlist',
  rank: 'view-rank', portfolio: 'view-portfolio',
  macro: 'view-macro', import: 'view-import', intel: 'view-intel',
  compare: 'view-compare', store: 'view-store',
};

function renderDeep2(d) {
  const el = $('#co-deep2');
  if (!d) { el.innerHTML = '<p class="hint">No deep analysis.</p>'; return; }
  const f = (v, suf = '') => (v === null || v === undefined ? '—' : `${nf2.format(v)}${suf}`);
  el.innerHTML = `
    <div class="scorecard grade-${esc(d.scorecard.grade)}">
      <div class="t">Capital efficiency</div>
      <div class="big">${d.scorecard.score}<span class="hint">/100 ${esc(d.scorecard.grade)}</span></div>
      <div class="d">ROIC <b>${f(d.roic, '%')}</b> vs WACC <b>${f(d.wacc, '%')}</b></div>
      <div class="d">EVA <b>${f(d.eva, ' Cr')}</b> · invested capital ${f(d.investedCapital, ' Cr')}</div>
      <div class="d">Reinvestment ${f(d.reinvestmentRate, '%')} · growth quality ${f(d.growthQuality, '%')}</div>
    </div>
    <div class="scorecard"><div class="t">Quality trends</div>
      <div class="d">ROE stability (σ) <b>${f(d.roeStability, ' pts')}</b></div>
      <div class="d">Cash conversion <b>${f(d.cashConversionTrend.at(-1)?.value, '%')}</b></div>
      <div class="d">Working-capital days <b>${f(d.wcDaysTrend.at(-1)?.value, ' d')}</b></div>
      <div class="d">Earnings quality (accruals) <b>${f(d.earningsQualityTrend.at(-1)?.value, '%')}</b></div>
      <div class="d">Data quality <b>${d.dataQuality.score}/100</b>${d.dataQuality.missing.length ? ` <span class="hint">missing: ${esc(d.dataQuality.missing.join(', '))}</span>` : ''}</div>
    </div>
    <div class="scorecard"><div class="t">Capital allocation</div>
      <div class="d">${esc(d.capitalAllocation ? d.capitalAllocation.verdict : '—')}</div>
      <div class="d">CFO ${f(d.capitalAllocation?.cfo, ' Cr')} · capex ${f(d.capitalAllocation?.capex, ' Cr')} · Δdebt ${f(d.capitalAllocation?.debtChange, ' Cr')}</div>
      <div class="d">Anomalies: <b>${d.anomalies.length}</b>${d.anomalies.length ? ` <span class="hint">${esc(d.anomalies.slice(0,2).map((x) => x.metric + ' ' + x.changePct + '%').join(', '))}</span>` : ''}</div>
      <div class="d">P/E vs own median ${d.valuationVsHistory ? `${f(d.valuationVsHistory.currentPe)} vs ${f(d.valuationVsHistory.medianPe)}` : '—'}</div>
    </div>`;
}

function renderMarket(m) {
  const el = $('#co-market');
  if (!m) { el.innerHTML = '<p class="hint">No market data.</p>'; return; }
  const f = (v, suf = '') => (v === null || v === undefined ? '—' : `${nf2.format(v)}${suf}`);
  const n0 = (v) => (v === null || v === undefined ? '—' : nf.format(v));
  el.innerHTML = `
    <div class="scorecard"><div class="t">Analysts</div>
      <div class="big">${esc(m.analysts.consensus || '—')}<span class="hint">${m.analysts.score === null ? '' : ' ' + m.analysts.score + '/5'}</span></div>
      <div class="d">Target ${f(m.analysts.targetMean)} · range ${f(m.analysts.targetLow)}–${f(m.analysts.targetHigh)}</div>
      <div class="d">Upside <b>${f(m.analysts.upsidePct, '%')}</b> · ${n0(m.analysts.analysts)} analysts</div>
      <div class="d">Avg surprise (4q) <b>${f(m.avgSurprisePct, '%')}</b></div>
    </div>
    <div class="scorecard"><div class="t">Dividends</div>
      <div class="big">${f(m.dividends.yieldPct, '%')}<span class="hint"> yield</span></div>
      <div class="d">TTM ${f(m.dividends.ttmAmount)} · last ${f(m.dividends.lastAmount)}</div>
      <div class="d">Growth ${f(m.dividends.growthPct, '%')} · streak ${m.dividends.streakYears}y</div>
      <div class="d">Yield on cost ${f(m.dividends.yieldOnCostPct, '%')}</div>
    </div>
    <div class="scorecard"><div class="t">Ownership</div>
      <div class="d">Institutions <b>${f(m.ownership.institutionsPct, '%')}</b> (${n0(m.ownership.institutionsCount)})</div>
      <div class="d">Insiders <b>${f(m.ownership.insidersPct, '%')}</b></div>
      <div class="d">Insider trades <b>${n0(m.ownership.insiderTrades)}</b> · net ${f(m.ownership.netInsiderValue)}</div>
    </div>
    <div class="scorecard"><div class="t">Risk &amp; liquidity</div>
      <div class="d">Vol 20d <b>${f(m.risk.vol20, '%')}</b> vs 250d ${f(m.risk.vol250, '%')} — ${esc(m.risk.regime || '—')}</div>
      <div class="d">1-day 95% VaR <b>${f(m.risk.var95Pct, '%')}</b></div>
      <div class="d">Momentum (composite) <b>${f(m.momentum.composite, '%')}</b></div>
      <div class="d">Turnover ${f(m.volume.turnoverCr, ' Cr')} — ${esc(m.volume.liquidity || '—')} liquidity</div>
    </div>`;
}

async function loadMarket(symbol) {
  try { renderMarket(await api(`/api/market-intel/${encodeURIComponent(symbol)}`)); }
  catch { renderMarket(null); }
}

async function loadDeep2(symbol) {
  try { renderDeep2(await api(`/api/deep2/${encodeURIComponent(symbol)}`)); }
  catch { renderDeep2(null); }
}

async function runAudit(symbol) {
  const el = $('#co-audit');
  el.hidden = false;
  el.innerHTML = '<p class="hint">Running every feature…</p>';
  try {
    const a = await api(`/api/audit/${encodeURIComponent(symbol)}`);
    el.innerHTML = `<div class="panel"><h4>Feature audit — ${a.passed}/${a.total} passing</h4>
      <table><thead><tr><th>Feature</th><th>Status</th><th>Detail</th></tr></thead><tbody>
      ${a.rows.map((r) => `<tr><td>${esc(r.feature)}</td><td style="color:${r.ok ? 'var(--ok)' : 'var(--warn)'}">${r.ok ? 'pass' : r.status}</td><td class="hint">${esc(r.detail)}</td></tr>`).join('')}
      </tbody></table></div>`;
  } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

function renderIntel(tab) {
  const el = $('#co-intel');
  const d = state.intel;
  if (!d) { el.innerHTML = '<p class="hint">No company intelligence stored for this company.</p>'; return; }
  const p = d.profile || {};
  const kv = (pairs) => `<dl class="kv2">${pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  const src = String(p.source || 'generated');

  if (tab === 'overview') {
    el.innerHTML = `
      <div class="panel"><h4>What the company does <span class="chip ${src === 'generated' ? 'demo' : ''}">${esc(src)}</span></h4>
        <p>${esc(p.description || 'No description stored.')}</p>
        ${kv([['Founded', p.founded_year], ['Headquarters', [p.hq_city, p.hq_country].filter(Boolean).join(', ')], ['Employees', p.employees ? nf.format(p.employees) : ''], ['Business model', p.business_model], ['Auditor', p.auditor], ['Registrar', p.registrar], ['Website', p.website]])}
      </div>
      <div class="panel"><h4>Moat score</h4>
        <div style="display:flex;align-items:center;gap:12px"><span class="big" style="font-size:24px;font-weight:750">${p.moat_score ?? '—'}<span class="hint">/100</span></span>
        <span class="hint">${esc(p.moat_notes || '')}</span></div>
        <div class="bar"><i style="width:${Math.max(0, Math.min(100, Number(p.moat_score) || 0))}%"></i></div>
      </div>
      <div class="panel"><h4>Products & services</h4>
        <p class="hint">${(d.products || []).map((x) => esc(x.name)).join(' · ') || '—'}</p>
      </div>`;
    return;
  }
  if (tab === 'business') {
    el.innerHTML = `
      <div class="split2">
        <div class="panel"><h4>Revenue by segment</h4>${tbl(['Segment', 'Revenue %', 'Margin %', 'Growth %'], (d.segments || []).map((x) => [esc(x.name), nf1.format(x.revenue_pct), nf1.format(x.margin_pct), nf1.format(x.growth_pct)]))}</div>
        <div class="panel"><h4>Revenue by geography</h4>${tbl(['Region', 'Revenue %'], (d.geographies || []).map((x) => [esc(x.region), nf1.format(x.revenue_pct)]))}</div>
      </div>
      <div class="panel"><h4>Subsidiaries & JVs</h4>${tbl(['Name', 'Stake %', 'Country'], (d.subsidiaries || []).map((x) => [esc(x.name), nf1.format(x.stake_pct), esc(x.country)]))}</div>`;
    return;
  }
  if (tab === 'orderbook') {
    const ob = d.orderBook || [];
    el.innerHTML = ob.length
      ? `<div class="panel"><h4>Order book</h4>${tbl(['As of', 'Order book ₹Cr', 'Book to bill', 'Executable in 12m %', 'Note'], ob.map((x) => [esc(x.as_of), nf.format(x.order_book_cr), nf2.format(x.book_to_bill), nf1.format(x.executable_12m_pct), esc(x.notes)]))}</div>`
      : '<div class="panel"><h4>Order book</h4><p class="hint">This business model does not carry an order book (e.g. retail lending, FMCG, telecom subscriptions).</p></div>';
    return;
  }
  if (tab === 'plans') {
    el.innerHTML = `
      <div class="panel"><h4>Management guidance</h4>${tbl(['Period', 'Metric', 'Guided', 'Unit', 'Commentary'], (d.guidance || []).map((x) => [esc(x.period), esc(x.metric), nf2.format(x.guided_value), esc(x.unit), esc(x.commentary)]))}</div>
      <div class="panel"><h4>Guidance vs actual</h4>${tbl(['Metric', 'Guided', 'Actual', 'Variance'], (d.guidanceVsActual || []).map((x) => [esc(x.metric), nf2.format(x.guided), x.actual === null ? '—' : nf2.format(x.actual), x.variancePct === null ? '—' : `${x.variancePct > 0 ? '+' : ''}${nf2.format(x.variancePct)}`]))}</div>`;
    return;
  }
  if (tab === 'facilities') {
    el.innerHTML = `<div class="panel"><h4>Plants & facilities</h4>${tbl(['Name', 'Location', 'Type', 'Capacity'], (d.facilities || []).map((x) => [esc(x.name), esc(x.location), esc(x.kind), esc(x.capacity_note)]))}</div>`;
    return;
  }
  if (tab === 'risks') {
    el.innerHTML = `<div class="panel"><h4>Risk register</h4>${(d.risks || []).map((r) => `<div class="alertrow"><span class="sev ${esc(r.severity)}">${esc(r.severity)}</span><b>${esc(r.code)}</b> <span class="hint">${esc(r.description)}</span></div>`).join('') || '<p class="hint">No risks recorded.</p>'}</div>`;
    return;
  }
  el.innerHTML = `
    <div class="panel"><h4>Announcements</h4>${(d.announcements || []).map((a) => `<div style="margin-bottom:8px"><b>${esc(a.title)}</b> <span class="hint">${esc(a.date)} · ${esc(a.category)}</span><p class="hint" style="margin:2px 0 0">${esc(a.summary)}</p></div>`).join('') || '<p class="hint">No announcements.</p>'}</div>
    <div class="panel"><h4>Corporate actions</h4>${tbl(['Date', 'Type', 'Detail'], (d.corporateActions || []).map((x) => [esc(x.date), esc(x.kind), esc(x.detail)]))}</div>`;
}

function tile(k, v) { return `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`; }

function renderScores(s) {
  const el = $('#co-scores');
  if (!s) { el.innerHTML = '<p class="hint">No scores available.</p>'; return; }
  const p = s.piotroski, a = s.altman, b = s.beneish, c = s.composite;
  const pct = (v) => `${Math.round(v)}`;
  const checks = p ? `<div class="checks">${p.checks.map((ch) => `<div class="checkrow"><span class="${ch.pass ? 'y' : 'n'}">${ch.pass ? '✓' : '✕'}</span><span>${esc(ch.name)} <span class="hint">${esc(ch.detail)}</span></span></div>`).join('')}</div>` : '';
  el.innerHTML = `
    <div class="scorecard grade-${esc(c.grade)}">
      <div class="t">Composite</div><div class="big">${c.score}<span class="hint">/100</span></div>
      <div class="d">Grade ${esc(c.grade)}</div>
      ${Object.entries(c.components).map(([k, v]) => `<div class="d">${esc(k)} <span class="hint">${pct(v)}</span></div><div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>`).join('')}
    </div>
    <div class="scorecard">
      <div class="t">Piotroski F-Score</div><div class="big">${p ? p.score : '—'}<span class="hint">/9</span></div>
      <div class="d">${p ? (p.score >= 7 ? 'Strong fundamentals' : p.score >= 4 ? 'Mixed' : 'Weak') : 'Not enough history'}</div>
      ${checks}
    </div>
    <div class="scorecard">
      <div class="t">Altman Z-Score</div><div class="big">${a ? a.z.toFixed(2) : '—'}</div>
      <div class="d">${a ? esc(a.zone) : 'Not enough data'} · >2.99 safe, <1.81 distress</div>
    </div>
    <div class="scorecard">
      <div class="t">Beneish M-Score</div><div class="big">${b ? b.m.toFixed(2) : '—'}</div>
      <div class="d">${b ? (b.flag ? '⚠ possible earnings manipulation' : 'no manipulation flag') : 'Not enough history'}</div>
      ${b ? '<div class="d hint">Simplified: SGAI neutral, AQI approximated.</div>' : ''}
    </div>`;
}

function renderDeep(m) {
  const el = $('#co-deep');
  if (!m) { el.innerHTML = '<p class="hint">No metrics.</p>'; return; }
  const f = (v, suf = '') => (v === null || v === undefined ? '—' : `${nf2.format(v)}${suf}`);
  const tiles = [
    ['DuPont ROE', f(m.dupont?.roe, '%')], ['Net margin', f(m.dupont?.npm, '%')],
    ['Asset turnover', f(m.dupont?.assetTurnover, '×')], ['Equity multiplier', f(m.dupont?.equityMultiplier, '×')],
    ['Cash cycle', f(m.ccc?.days, ' d')], ['DIO / DSO / DPO', m.ccc ? `${nf.format(m.ccc.dio)}/${nf.format(m.ccc.dso)}/${nf.format(m.ccc.dpo)}` : '—'],
    ['Accruals', f(m.accruals, '%')], ['Earnings volatility', f(m.earningsVolatility, '%')],
    ['Sales CAGR 3Y', f(m.cagr.sales3, '%')], ['Sales CAGR 5Y', f(m.cagr.sales5, '%')],
    ['Profit CAGR 3Y', f(m.cagr.profit3, '%')], ['Profit CAGR 5Y', f(m.cagr.profit5, '%')],
    ['OPM trend /yr', f(m.marginSlope, ' pts')], ['Incremental ROCE', f(m.incrementalRoce, '%')],
    ['FCF payout', f(m.dividendPayout, '%')], ['P/E vs sector', m.valuation ? `${nf2.format(m.valuation.pe)} vs ${nf2.format(m.valuation.sectorMedianPe)}` : '—'],
    ['PEG', m.valuation?.peg ? nf2.format(m.valuation.peg) : '—'], ['Years of data', String(m.years)],
  ];
  const pctTiles = Object.entries(m.percentiles || {}).map(([k, v]) => [k.replace(/([A-Z])/g, ' $1'), `${Math.round(v)}th pct`]);
  el.innerHTML = [...tiles, ...pctTiles].map(([k, v]) => tile(k, v)).join('');
}

function bar(label, v) {
  const pctv = Math.max(0, Math.min(100, Number(v) || 0));
  return `<div class="d">${esc(label)} <span class="hint">${Math.round(pctv)}</span></div><div class="bar"><i style="width:${pctv}%"></i></div>`;
}

function renderFactors(f) {
  const el = $('#co-factors');
  if (!f) { el.innerHTML = '<p class="hint">No factor data.</p>'; return; }
  el.innerHTML = `
    <div class="scorecard"><div class="t">Composite factor</div><div class="big">${f.composite}</div>
      ${bar('Value', f.value)}${bar('Quality', f.quality)}${bar('Growth', f.growth)}</div>
    <div class="scorecard"><div class="t">Other factors</div>
      ${bar('Momentum', f.momentum)}${bar('Low volatility', f.lowVol)}${bar('Size', f.size)}</div>
    <div class="scorecard"><div class="t">Sector z-scores</div>
      ${Object.entries(f.zScores).map(([k, v]) => `<div class="d">${esc(k)} <span class="hint">${v > 0 ? '+' : ''}${nf2.format(v)}σ</span></div>`).join('')}</div>`;
}

function renderValuation(v) {
  const el = $('#co-valuation');
  if (!v) { el.innerHTML = '<p class="hint">No valuation data.</p>'; return; }
  const f = (x, suf = '') => (x === null || x === undefined ? '—' : `${nf2.format(x)}${suf}`);
  const tiles = [
    ['Price', money(v.price)], ['EPS', f(v.eps)], ['Book value/sh', f(v.bookValuePerShare)],
    ['Graham number', f(v.grahamNumber)], ['Margin of safety', f(v.marginOfSafetyPct, '%')],
    ['Earnings yield', f(v.earningsYieldPct, '%')], ['P/E percentile', `${Math.round(v.pePercentile)}th`],
    ['P/B percentile', `${Math.round(v.pbPercentile)}th`],
    ['DCF fair value', v.dcf ? f(v.dcf.fairValue) : '—'], ['DCF upside', v.dcf ? f(v.dcf.upsidePct, '%') : '—'],
    ['EPS if margin −200bps', v.sensitivity ? `${f(v.sensitivity.marginDrop200bps.eps)} (${f(v.sensitivity.marginDrop200bps.deltaPct, '%')})` : '—'],
    ['EPS if margin +200bps', v.sensitivity ? `${f(v.sensitivity.marginRise200bps.eps)} (${f(v.sensitivity.marginRise200bps.deltaPct, '%')})` : '—'],
  ];
  el.innerHTML = tiles.map(([k, val]) => tile(k, val)).join('');
}

function renderStrength(st) {
  const el = $('#co-strength');
  if (!st) { el.innerHTML = '<p class="hint">No strength data.</p>'; return; }
  const f = (x, suf = '') => (x === null || x === undefined ? '—' : `${nf2.format(x)}${suf}`);
  el.innerHTML = `
    <div class="scorecard grade-${st.verdict === 'fortress' ? 'A' : st.verdict === 'fragile' ? 'D' : 'B'}">
      <div class="t">Balance sheet</div><div class="big" style="font-size:17px">${esc(st.verdict)}</div>
      <div class="d">Net debt ₹${nf.format(st.netDebt)} Cr · EBITDA ₹${nf.format(st.ebitda)} Cr</div>
    </div>
    <div class="scorecard"><div class="t">Leverage & cover</div>
      <div class="d">Net debt / EBITDA <b>${f(st.netDebtToEbitda, '×')}</b></div>
      <div class="d">Debt repaid from FCF in <b>${f(st.debtRepaymentYears, ' yrs')}</b></div>
      <div class="d">Interest cover <b>${f(st.interestCover, '×')}</b> ${st.interestCoverTrend !== null ? `<span class="hint">(${st.interestCoverTrend > 0 ? 'improving' : 'weakening'})</span>` : ''}</div>
    </div>
    <div class="scorecard"><div class="t">Cash quality</div>
      <div class="d">Cash conversion <b>${f(st.cashConversionPct, '%')}</b></div>
      <div class="d">Working capital <b>₹${nf.format(st.workingCapital)} Cr</b> (${f(st.workingCapitalIntensityPct, '%')} of sales)</div>
      <div class="d">Current ratio <b>${f(st.currentRatioProxy, '×')}</b></div>
    </div>`;
}

function renderStats(stats) {
  const el = $('#stats-line');
  if (!stats || Object.keys(stats).length === 0) { el.innerHTML = ''; return; }
  const keys = ['pe', 'roe', 'opm', 'debtToEquity', 'salesGrowth3y', 'marketCap'];
  el.innerHTML = keys.filter((k) => stats[k]).map((k) => `<span class="statpill">${esc(k)} median <b>${nf2.format(stats[k].median)}</b> <span class="hint">p25 ${nf2.format(stats[k].p25)} · p75 ${nf2.format(stats[k].p75)}</span></span>`).join('');
}

async function loadRank() {
  try {
    const [r, s, b] = await Promise.all([api('/api/factors/rank?limit=50'), api('/api/analytics/sectors'), api('/api/market/breadth')]);
    $('#breadth').innerHTML = `<span class="statpill">universe <b>${nf.format(b.companies)}</b></span>` +
      `<span class="statpill">with price history <b>${nf.format(b.withPrices)}</b></span>` +
      `<span class="statpill">above 52w low <b>${nf1.format(b.above52wLowPct)}%</b></span>` +
      `<span class="statpill">positive momentum <b>${nf1.format(b.positiveMomentumPct)}%</b></span>` +
      `<span class="statpill">median drawdown <b>${nf1.format(b.medianDrawdownPct)}%</b></span>`;
    $('#rank-body').innerHTML = r.ranked.map((x) => `<tr data-sym="${esc(x.symbol)}"><td class="l"><span class="name">${esc(x.name)}</span><div class="sub mono">${esc(x.symbol)} · ${esc(x.sector)}</div></td><td><b>${x.composite}</b></td><td>${x.value}</td><td>${x.quality}</td><td>${x.growth}</td><td>${cr(x.marketCap)}</td></tr>`).join('');
    $('#sector-body').innerHTML = s.sectors.map((b) => `<tr><td class="l">${esc(b.sector)}</td><td>${b.companies}</td><td>${ratio(b.medianPe)}</td><td>${pct(b.medianRoe)}</td><td>${pct(b.medianOpm)}</td><td>${ratio(b.medianDebtToEquity)}</td><td>${pct(b.medianSalesGrowth)}</td><td>${cr(b.medianMarketCap)}</td></tr>`).join('');
  } catch (e) { $('#rank-body').innerHTML = `<tr><td class="l" colspan="6">${esc(e.message)}</td></tr>`; }
}

// ---- preferences, columns, theme ------------------------------------------

async function loadPrefs() {
  try {
    const r = await api('/api/prefs');
    state.prefs = r.prefs;
    state.allColumns = r.allColumns || [];
    applyPrefs();
  } catch { /* keep defaults */ }
}

function applyPrefs() {
  document.documentElement.setAttribute('data-theme', state.prefs.theme === 'dark' ? 'dark' : 'light');
  state.density = state.prefs.density;
  const grid = $('#ws-grid'); if (grid) grid.classList.toggle('compact', state.prefs.density === 'compact');
  const wsgrid = document.querySelector('#result-body');
  void wsgrid;
  for (const [panel, on] of Object.entries(state.prefs.panels || {})) {
    const map = { scores: '#co-scores', deep: '#co-deep', factors: '#co-factors', valuation: '#co-valuation', strength: '#co-strength', intel: '#co-tabs' };
    const el = document.querySelector(map[panel]);
    if (el) el.hidden = !on;
  }
  if (state.rows.length) renderResults();
}

async function savePrefs(patch) {
  try { const r = await api('/api/prefs', { method: 'PUT', body: JSON.stringify(patch) }); state.prefs = r.prefs; applyPrefs(); }
  catch (e) { toastNote(e.message); }
}

function openColumnsModal() {
  const all = state.allColumns.length ? state.allColumns : (state.prefs.columns || []);
  const label = (k) => (RESULT_COLS.find((c) => c.key === k) || { label: k }).label;
  const chosen = [...(state.prefs.columns || [])];
  const rest = all.filter((k) => !chosen.includes(k));
  const row = (k, on) => `<div class="item-row"><span class="grow">${esc(label(k))}</span>
    <button class="btn sm ghost" data-move="up" data-k="${esc(k)}" ${!on ? 'hidden' : ''}>↑</button>
    <button class="btn sm ghost" data-move="down" data-k="${esc(k)}" ${!on ? 'hidden' : ''}>↓</button>
    <button class="btn sm ${on ? 'danger' : ''}" data-toggle="${esc(k)}">${on ? 'Remove' : 'Add'}</button></div>`;
  openModal({
    title: 'Columns', desc: 'Choose which metrics appear, and their order.',
    bodyHtml: `<div id="col-list">${chosen.map((k) => row(k, true)).join('')}${rest.map((k) => row(k, false)).join('')}</div>`,
    okLabel: 'Done', onOk: async () => { await savePrefs({ columns: chosen }); },
  });
  const list = $('#col-list');
  list.onclick = async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.toggle) {
      const k = t.dataset.toggle;
      const i = chosen.indexOf(k);
      if (i >= 0) chosen.splice(i, 1); else chosen.push(k);
    } else if (t.dataset.move) {
      const k = t.dataset.k; const i = chosen.indexOf(k);
      const j = t.dataset.move === 'up' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < chosen.length) { [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
    }
    await savePrefs({ columns: chosen });
    openColumnsModal();
  };
}

// ---- valuation lab --------------------------------------------------------

function renderValLab(v) {
  const el = $('#co-val2');
  if (!v) { el.innerHTML = '<p class="hint">No valuation available.</p>'; return; }
  const a = v.assumptions;
  const field = (id, label, val, step = '0.1') => `<div><label for="${id}">${esc(label)}</label><input id="${id}" type="number" step="${step}" value="${val}" /></div>`;
  el.innerHTML = `
    <div class="scorecard" style="grid-column: span 2">
      <div class="t">Fair value (${esc(v.scenario)})</div>
      <div class="big">₹${v.blended ?? '—'} <span class="hint">vs price ₹${nf2.format(v.price)}</span></div>
      <div class="d">Upside <b>${v.upsidePct ?? '—'}%</b> · verdict <b>${esc(v.verdict)}</b> · WACC-lite ${v.wacc}%</div>
      <div class="d">Band — bear ₹${v.band.bear ?? '—'} / base ₹${v.band.base ?? '—'} / bull ₹${v.band.bull ?? '—'}</div>
      <div class="d">EV ₹${nf.format(v.ev.ev)} Cr · EV/EBITDA ${v.ev.evEbitda ?? '—'} · EV/Sales ${v.ev.evSales ?? '—'}</div>
      <div class="d">P/E band (10y) ${v.peBand.min} / ${v.peBand.median} / ${v.peBand.max} · sector premium ${v.sector.premiumPct ?? '—'}%</div>
    </div>
    <div class="scorecard" style="grid-column: span 2">
      <div class="t">Your assumptions</div>
      <div class="valgrid">
        ${field('va-growth', 'Growth %', a.growthPct)}
        ${field('va-discount', 'Discount %', a.discountPct)}
        ${field('va-terminal', 'Terminal %', a.terminalPct)}
        ${field('va-years', 'Years', a.years, '1')}
        ${field('va-pe', 'Target P/E', a.targetPe)}
        ${field('va-ev', 'Target EV/EBITDA', a.targetEvEbitda)}
        ${field('va-payout', 'Payout %', a.payoutPct)}
      </div>
    </div>
    <div class="scorecard" style="grid-column: span 2">
      <div class="t">Models</div>
      ${v.models.map((m) => `<div class="d">${esc(m.name)} <b>${m.value === null ? '—' : '₹' + nf2.format(m.value)}</b> <span class="hint">w ${m.weight}</span></div>`).join('')}
    </div>`;
}

async function loadValLab(symbol, scenario) {
  try {
    const q = scenario ? `?scenario=${encodeURIComponent(scenario)}` : '';
    state.val = await api(`/api/valuation2/${encodeURIComponent(symbol)}${q}`);
    renderValLab(state.val);
    if (scenario) $('#val-scenario').value = scenario;
  } catch (e) { $('#co-val2').innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
}

async function saveValLab() {
  const sym = state.company?.company?.symbol; if (!sym) return;
  const body = {
    growthPct: Number($('#va-growth').value), discountPct: Number($('#va-discount').value),
    terminalPct: Number($('#va-terminal').value), years: Number($('#va-years').value),
    targetPe: Number($('#va-pe').value), targetEvEbitda: Number($('#va-ev').value),
    payoutPct: Number($('#va-payout').value), scenario: $('#val-scenario').value,
  };
  try { await api(`/api/valuation2/${encodeURIComponent(sym)}/assumptions`, { method: 'POST', body: JSON.stringify(body) }); await loadValLab(sym, body.scenario); toastNote('Assumptions saved'); }
  catch (e) { toastNote(e.message); }
}

// ---- portfolio ------------------------------------------------------------

async function loadPortfolio() {
  try {
    const p = await api('/api/portfolio');
    const s = p.summary;
    $('#pf-summary').innerHTML = s.holdings === 0
      ? '<span class="hint">No holdings yet — add one below.</span>'
      : `<span class="statpill">holdings <b>${s.holdings}</b></span><span class="statpill">value <b>₹${nf.format(s.value)}</b></span>` +
        `<span class="statpill">P&amp;L <b class="${s.pnl >= 0 ? 'num-pos' : 'num-neg'}">₹${nf.format(s.pnl)} (${nf2.format(s.pnlPct)}%)</b></span>` +
        `<span class="statpill">best <b>${esc(s.best || '—')}</b></span><span class="statpill">worst <b>${esc(s.worst || '—')}</b></span>`;
    $('#pf-body').innerHTML = p.holdings.length
      ? p.holdings.map((h) => `<tr data-sym="${esc(h.symbol)}"><td class="l"><span class="name">${esc(h.name)}</span><div class="sub mono">${esc(h.symbol)}</div></td>
        <td>${nf.format(h.quantity)}</td><td>${nf2.format(h.avgCost)}</td><td>${nf2.format(h.price)}</td>
        <td>${nf.format(h.value)}</td><td class="${h.pnl >= 0 ? 'num-pos' : 'num-neg'}">${nf.format(h.pnl)}</td>
        <td class="${h.pnl >= 0 ? 'num-pos' : 'num-neg'}">${nf2.format(h.pnlPct)}%</td><td>${nf2.format(h.weightPct)}%</td>
        <td><button class="btn sm ghost" data-pf-rm="${esc(h.symbol)}">✕</button></td></tr>`).join('')
      : '<tr><td class="l" colspan="9">No holdings yet.</td></tr>';
  } catch (e) { $('#pf-summary').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
}

// ---- alert rules ----------------------------------------------------------

async function loadRules() {
  try {
    const r = await api('/api/alert-rules');
    $('#rules-list').innerHTML = (r.rules.length ? r.rules.map((x) => `<div class="alertrow"><b>${esc(x.metric)} ${esc(x.op)} ${x.threshold}</b>
      <span class="hint">${x.enabled ? 'active' : 'paused'}</span><span class="spacer"></span>
      <button class="btn sm ghost" data-rule-toggle="${esc(x.id)}" data-on="${x.enabled ? '0' : '1'}">${x.enabled ? 'Pause' : 'Resume'}</button>
      <button class="btn sm ghost" data-rule-rm="${esc(x.id)}">✕</button></div>`).join('') : '<p class="hint">No custom rules.</p>')
      + (r.findings.length ? `<div class="section-h">Triggered</div>` + r.findings.map((f) => `<div class="alertrow"><b>${esc(f.name)}</b> <span class="hint">${esc(f.metric)} ${esc(f.op)} ${f.threshold} · now ${nf2.format(f.actual)}</span></div>`).join('') : '');
  } catch { /* ignore */ }
}


// ---- watchlist & macro ----------------------------------------------------

async function loadWatchlist() {
  try {
    const [w, a] = await Promise.all([api('/api/watchlist'), api('/api/alerts')]);
    $('#watch-body').innerHTML = w.watchlist.length
      ? w.watchlist.map((r) => `<tr data-sym="${esc(r.symbol)}"><td class="l"><span class="name">${esc(r.name)}</span><div class="sub mono">${esc(r.symbol)} · ${esc(r.sector)}</div></td><td>${cr(r.marketCap)}</td><td>${ratio(r.pe)}</td><td>${pct(r.roe)}</td><td>${ratio(r.debtToEquity)}</td><td>${new Date(r.addedAt).toLocaleDateString('en-IN')}</td><td><button class="btn sm ghost" data-unwatch="${esc(r.symbol)}">✕</button></td></tr>`).join('')
      : '<tr><td class="l" colspan="7">Nothing tracked yet — open a company and press “Watch”.</td></tr>';
    loadRules();
    $('#alerts').innerHTML = a.alerts.length
      ? a.alerts.map((x) => `<div class="alertrow"><span class="sev ${esc(x.severity)}">${esc(x.severity)}</span><b>${esc(x.name)}</b> <span class="hint">${esc(x.rule)} · ${esc(x.detail)}</span></div>`).join('')
      : '<p class="hint">No alerts on your watchlist.</p>';
  } catch (e) { $('#alerts').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

function renderAtlasScore(s) {
  const el = $('#co-atlas');
  if (!s) { el.innerHTML = '<p class="hint">No score.</p>'; return; }
  el.innerHTML = `
    <div class="scorecard grade-${esc(s.grade.replace('+',''))}">
      <div class="t">Atlas Score</div>
      <div class="big">${s.score}<span class="hint">/100 ${esc(s.grade)}</span></div>
      <div class="d">${esc(s.verdict)}</div>
      <div class="d hint">${s.coverage}% of the score had real data</div>
    </div>
    <div class="scorecard"><div class="t">Why</div>
      ${s.parts.map((p) => `<div class="d">${esc(p.name)} <b>${p.score === null ? '—' : p.score}</b> <span class="hint">${esc(p.raw)}</span></div>`).join('')}
    </div>`;
}

async function loadAtlasScore(symbol) {
  try { renderAtlasScore(await api(`/api/atlas-score/${encodeURIComponent(symbol)}`)); }
  catch { renderAtlasScore(null); }
}

async function loadIntel() {
  try {
    const [b, r, c, f] = await Promise.all([
      api('/api/universe/breadth'), api('/api/universe/rotation'),
      api('/api/universe/coverage'), api('/api/universe/freshness'),
    ]);
    $('#intel-cards').innerHTML = `
      <div class="scorecard"><div class="t">Market breadth</div>
        <div class="big">${b.pctAdvancing}%<span class="hint"> advancing</span></div>
        <div class="d">${b.advancers} up · ${b.decliners} down · ${b.unchanged} flat</div></div>
      <div class="scorecard"><div class="t">Coverage</div>
        <div class="d">Prices <b>${c.pct.prices}%</b> · History <b>${c.pct.history}%</b></div>
        <div class="d">Analysts <b>${c.pct.analysts}%</b> · Dividends <b>${c.pct.dividends}%</b></div>
        <div class="d">Calendar <b>${c.pct.calendar}%</b> of ${c.companies} companies</div></div>
      <div class="scorecard"><div class="t">Freshness</div>
        <div class="big">${f.companies.filter((x) => x.stale).length}<span class="hint"> stale</span></div>
        <div class="d">of ${f.companies.length} companies</div></div>`;
    $('#intel-rotation').innerHTML = r.sectors.map((s) => `<tr>
      <td class="l">${esc(s.sector)}</td><td>${s.companies}</td>
      <td>${s.m1 === null ? '—' : s.m1 + '%'}</td><td>${s.m3 === null ? '—' : s.m3 + '%'}</td><td>${s.y1 === null ? '—' : s.y1 + '%'}</td></tr>`).join('');
    $('#intel-fresh').innerHTML = f.companies.slice(0, 40).map((x) => `<tr>
      <td class="l">${esc(x.symbol)}</td>
      <td>${x.priceAgeDays === null ? '—' : x.priceAgeDays + 'd'}</td>
      <td>${x.statementAgeDays === null ? '—' : x.statementAgeDays + 'd'}</td>
      <td style="color:${x.stale ? 'var(--warn)' : 'var(--ok)'}">${x.stale ? 'stale' : 'fresh'}</td></tr>`).join('');
  } catch (e) { $('#intel-cards').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}


// ---- more intelligence, news, compare, correlation, jobs, tools --------------

async function loadMore(symbol) {
  const el = $('#co-more');
  el.innerHTML = '<p class="hint">Loading…</p>';
  const safe = async (path, fallback) => { try { return await api(path); } catch { return fallback; } };
  const [ex, inv, rk, tr, er, pr, st, val1] = await Promise.all([
    safe(`/api/explain/${encodeURIComponent(symbol)}`, null),
    safe(`/api/investability/${encodeURIComponent(symbol)}`, null),
    safe(`/api/risk/${encodeURIComponent(symbol)}`, null),
    safe(`/api/total-return/${encodeURIComponent(symbol)}`, null),
    safe(`/api/earnings-reaction/${encodeURIComponent(symbol)}`, null),
    safe(`/api/peers/${encodeURIComponent(symbol)}`, null),
    safe(`/api/strength/${encodeURIComponent(symbol)}`, null),
    safe(`/api/valuation/${encodeURIComponent(symbol)}`, null),
  ]);
  const f = (v, s = '') => (v === null || v === undefined ? '—' : `${nf2.format(v)}${s}`);
  el.innerHTML = `
    <div class="scorecard"><div class="t">Investability</div>
      <div class="big">${inv ? inv.score : '—'}<span class="hint">${inv ? '/' + inv.grade : ''}</span></div>
      ${inv ? Object.entries(inv.parts).map(([k, v]) => `<div class="d">${esc(k)} <b>${v === null ? '—' : v}</b></div>`).join('') : '<div class="d hint">no data</div>'}
    </div>
    <div class="scorecard"><div class="t">Risk &amp; return</div>
      <div class="d">Volatility <b>${f(rk && rk.annualVolPct, '%')}</b> · Sharpe <b>${f(rk && rk.sharpe)}</b></div>
      <div class="d">Recovery <b>${rk && rk.recoveryDays !== null ? rk.recoveryDays + ' sessions' : 'not recovered'}</b></div>
      <div class="d">Total return <b>${f(tr && tr.totalReturnPct, '%')}</b> <span class="hint">price ${f(tr && tr.priceReturnPct, '%')} + dividends ${f(tr && tr.dividendReturnPct, '%')}</span></div>
      <div class="d">Graham number <b>${val1 && val1.grahamNumber ? nf2.format(val1.grahamNumber) : '—'}</b> <span class="hint">DCF ${val1 && val1.dcf && val1.dcf.fairValue ? nf2.format(val1.dcf.fairValue) : '—'}</span></div>
      <div class="d">Balance sheet <b>${st ? esc(st.verdict) : '—'}</b> <span class="hint">net debt/EBITDA ${st && st.netDebtToEbitda !== null ? nf2.format(st.netDebtToEbitda) : '—'}</span></div>
      <div class="d">Earnings-day move <b>${er && er.reactions && er.reactions[0] ? f(er.reactions[0].movePct, '%') : '—'}</b></div>
    </div>
    <div class="scorecard"><div class="t">Why these numbers</div>
      ${ex ? ex.lines.slice(0, 6).map((l) => `<div class="d"><b>${esc(l.label)}</b> ${esc(l.value)} <span class="hint">${esc(l.why)}</span></div>`).join('') : '<div class="d hint">no explainer</div>'}
    </div>
    ${pr && pr.peers ? `<div class="scorecard"><div class="t">Peers</div>${pr.peers.slice(0, 6).map((x) => `<div class="d">${esc(x.symbol)} <span class="hint">P/E ${x.pe === null ? '—' : nf2.format(x.pe)} · ROE ${x.roe === null ? '—' : nf2.format(x.roe) + '%'}</span></div>`).join('')}</div>` : ''}`;
}

async function loadNews(symbol) {
  const el = $('#co-news');
  try {
    const r = await api(`/api/news/${encodeURIComponent(symbol)}`);
    el.innerHTML = r.items.length
      ? `<table class="dense"><tbody>${r.items.slice(0, 12).map((n) => `<tr><td class="l">${esc(n.date)}</td><td class="l">${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)}</td><td class="l hint">${esc(n.source)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="hint">No headlines stored. Use “Fetch headlines”.</p>';
  } catch { el.innerHTML = '<p class="hint">No headlines stored.</p>'; }
}

async function loadCompare() {
  const syms = ($('#compare-symbols').value || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (syms.length < 2) { $('#compare-body').innerHTML = '<tr><td colspan="5">Enter at least two symbols.</td></tr>'; return; }
  try {
    const r = await api(`/api/compare?symbols=${encodeURIComponent(syms.join(','))}`);
    const rows = r.rows.filter((x) => !x.missing);
    if (!rows.length) { $('#compare-body').innerHTML = '<tr><td colspan="5">None of those symbols are in the database — fetch them first.</td></tr>'; return; }
    const cols = ['symbol', 'sector', 'marketCap', 'pe', 'roe', 'debtToEquity', 'opm', 'salesGrowth3y', 'dividendYield', 'analystUpside', 'investability', 'grade'];
    $('#compare-head').innerHTML = `<tr><th class="l">Metric</th>${rows.map((x) => `<th>${esc(x.symbol)}</th>`).join('')}</tr>`;
    $('#compare-body').innerHTML = cols.slice(1).map((c) => `<tr><td class="l">${esc(c)}</td>${rows.map((x) => `<td>${x[c] === null || x[c] === undefined ? '—' : (typeof x[c] === 'number' ? nf2.format(x[c]) : esc(String(x[c])))}</td>`).join('')}</tr>`).join('');
  } catch (e) { $('#compare-body').innerHTML = `<tr><td colspan="5">${esc(e.message)}</td></tr>`; }
}

async function loadCorrelation() {
  try {
    const list = await api('/api/screen', { method: 'POST', body: JSON.stringify({ expression: 'Market Cap > 0', limit: 6 }) });
    const syms = list.rows.map((r) => r.symbol).slice(0, 6);
    const c = await api(`/api/universe/correlation?symbols=${encodeURIComponent(syms.join(','))}`);
    $('#intel-corr').innerHTML = `<thead><tr><th class="l"></th>${c.symbols.map((s) => `<th>${esc(s)}</th>`).join('')}</tr></thead><tbody>${c.matrix.map((row, i) => `<tr><td class="l">${esc(c.symbols[i])}</td>${row.map((v) => `<td>${v === null ? '—' : v}</td>`).join('')}</tr>`).join('')}</tbody>`;
  } catch (e) { $('#intel-corr').innerHTML = `<tbody><tr><td>${esc(e.message)}</td></tr></tbody>`; }
}

async function loadJobs() {
  try {
    const j = await api('/api/jobs');
    $('#intel-jobs').innerHTML = `<div class="scorecard"><div class="t">Queue</div>
      <div class="d">Queued <b>${j.queued}</b> · Running <b>${j.running}</b></div>
      <div class="d">Done <b>${j.done}</b> · Failed <b>${j.failed}</b></div></div>`;
  } catch (e) { $('#intel-jobs').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

async function loadTools() {
  $('#intel-tools').innerHTML = `<div class="scorecard"><div class="t">Database</div>
    <div class="d">Export a full JSON backup, or restore one.</div>
    <div class="d"><button class="btn sm" id="btn-backup">Download backup</button></div>
    <div class="d"><input type="file" id="restore-file" accept="application/json" class="input sm" /></div></div>`;
  $('#btn-backup').onclick = () => window.open(`${FIN}/api/backup`, '_blank');
  $('#restore-file').onchange = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      await api('/api/restore', { method: 'POST', body: text });
      alert('Database restored.');
      location.reload();
    } catch (e) { alert('Restore failed: ' + e.message); }
  };
}

async function bootSetup() {
  try {
    const st = await fetch(`${FIN}/api/setup/status`).then((r) => r.json());
    if (st.configured) { $('#setup').hidden = true; return true; }
    $('#setup').hidden = false;
    $('#setup-grid').innerHTML = st.markets.map((m) => `
      <button class="setupopt" data-code="${esc(m.code)}" aria-pressed="false">
        <div class="flag">${m.flag}</div>
        <div class="nm">${esc(m.name)}</div>
        <div class="sub">${esc(m.currency)} · ${esc(m.exchanges.join(', '))} · ${esc(m.bundleNote)}</div>
      </button>`).join('');
    for (const b of document.querySelectorAll('.setupopt')) {
      b.onclick = async () => {
        document.querySelectorAll('.setupopt').forEach((x) => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        $('#setup-msg').textContent = `Setting up ${b.dataset.code}…`;
        try {
          await fetch(`${FIN}/api/setup/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: b.dataset.code }) });
          $('#setup-msg').textContent = 'Market ready. Loading…';
          location.reload();
        } catch (e) { $('#setup-msg').textContent = e.message; }
      };
    }
    return false;
  } catch { return true; }
}

// ---- wall: the same stock view on several displays ----------------------------
function wallUrl(kind, value) {
  const u = new URL(location.href);
  u.search = '';
  if (kind === 'company') u.searchParams.set('wall', 'company');
  else u.searchParams.set('wall', 'screen');
  if (value) u.searchParams.set(kind === 'company' ? 'symbol' : 'expr', value);
  return u.toString();
}

function openWall(kind, value) {
  const n = Math.min(Math.max(Number(prompt('How many screens?', '4') || '0'), 1), 12);
  if (!n) return;
  const url = wallUrl(kind, value);
  let opened = 0;
  for (let i = 0; i < n; i++) {
    // Slight delay so browsers do not treat them as pop-ups.
    setTimeout(() => { const w = window.open(url, `atlas-wall-${i}`, 'width=1280,height=800'); if (w) opened++; }, i * 220);
  }
  toast(`Opening ${n} wall screen(s) — allow pop-ups for this site`);
}

/** Apply wall mode from the URL: hide chrome, render the requested view, auto-refresh. */
function applyWallMode() {
  const params = new URLSearchParams(location.search);
  const wall = params.get('wall');
  if (!wall) return false;
  document.body.classList.add('wall');
  if (wall === 'company' && params.get('symbol')) {
    openCompany(params.get('symbol'));
    setInterval(() => { try { openCompany(params.get('symbol')); } catch { /* ignore */ } }, 60_000);
  } else if (params.get('expr')) {
    $('#expr').value = params.get('expr');
    runScreen({ expression: params.get('expr') });
    setInterval(() => { try { runScreen({ expression: params.get('expr') }); } catch { /* ignore */ } }, 60_000);
  }
  return true;
}


// ---- portfolio editing, global search, help, number format --------------------
let numberFormat = 'crore';
try { numberFormat = localStorage.getItem('atlas.format') || 'crore'; } catch { /* ignore */ }

async function addHolding() {
  const symbol = ($('#pf-symbol').value || '').trim();
  const quantity = Number($('#pf-qty').value || 0);
  const avgCost = Number($('#pf-cost').value || 0);
  const msg = $('#pf-msg');
  if (!symbol || !quantity || !avgCost) { if (msg) msg.textContent = 'Symbol, quantity and cost are required.'; return; }
  try {
    await api('/api/portfolio', { method: 'POST', body: JSON.stringify({ symbol, quantity, avgCost }) });
    if (msg) msg.textContent = `Added ${quantity} x ${symbol}`;
    $('#pf-symbol').value = ''; $('#pf-qty').value = ''; $('#pf-cost').value = '';
    loadPortfolioPnl();
  } catch (e) { if (msg) msg.textContent = e.message; }
}

function initGlobalSearch() {
  const input = $('#global-search');
  if (!input || input.dataset.wired) return;
  input.dataset.wired = '1';
  let timer = null; let box = null;
  const close = () => { if (box) { box.remove(); box = null; } };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    close();
    if (q.length < 2) return;
    timer = setTimeout(async () => {
      try {
        const r = await api(`/api/search?q=${encodeURIComponent(q)}&limit=8`);
        if (!r.hits || !r.hits.length) return;
        box = document.createElement('div');
        box.className = 'searchbox';
        box.innerHTML = r.hits.map((h) => `<div class="hit" data-sym="${esc(h.symbol)}"><b>${esc(h.symbol)}</b> <span class="hint">${esc(h.name)}</span></div>`).join('');
        if (input.parentElement) { input.parentElement.style.position = 'relative'; input.parentElement.appendChild(box); }
        box.querySelectorAll('[data-sym]').forEach((el2) => { el2.onclick = () => { close(); input.value = ''; openCompany(el2.dataset.sym); }; });
      } catch { /* ignore */ }
    }, 220);
  });
  input.addEventListener('blur', () => setTimeout(close, 180));
}

function showHelp() {
  let el = $('#help-overlay');
  if (el) { el.remove(); return; }
  const rows = [['/', 'focus search'], ['g then s', 'screener'], ['g then w', 'watchlist'], ['g then p', 'portfolio'],
    ['g then i', 'intelligence'], ['g then c', 'compare'], ['g then m', 'macro'], ['g then a', 'AI store'], ['Esc', 'close builder']];
  el = document.createElement('div');
  el.id = 'help-overlay'; el.className = 'helpbox';
  el.innerHTML = `<div class="t">Keyboard shortcuts</div>${rows.map(([k, d]) => `<div class="d"><b>${esc(k)}</b> — ${esc(d)}</div>`).join('')}<div class="d hint">Press ? again to close</div>`;
  document.body.appendChild(el);
}

function initExtraControls() {
  if ($('#btn-pf-add')) $('#btn-pf-add').onclick = addHolding;
  if ($('#btn-help')) $('#btn-help').onclick = showHelp;
  if ($('#btn-format')) {
    $('#btn-format').textContent = numberFormat === 'crore' ? 'Cr' : 'M';
    $('#btn-format').onclick = () => {
      numberFormat = numberFormat === 'crore' ? 'million' : 'crore';
      try { localStorage.setItem('atlas.format', numberFormat); } catch { /* ignore */ }
      $('#btn-format').textContent = numberFormat === 'crore' ? 'Cr' : 'M';
      toast(`Numbers in ${numberFormat}`); renderResults();
    };
  }
  initGlobalSearch();
  if ($('#dir-q')) {
    let dt = null;
    $('#dir-q').addEventListener('input', () => {
      clearTimeout(dt);
      const q = $('#dir-q').value.trim();
      dt = setTimeout(() => { if (q.length >= 2 || q.length === 0) loadDirectory(q); }, 250);
    });
  }
  if ($('#btn-webhook-save')) $('#btn-webhook-save').onclick = async () => {
    const msg = $('#webhook-msg');
    try {
      const r = await api('/api/webhook', { method: 'POST', body: JSON.stringify({ url: $('#webhook-url').value.trim() }) });
      if (msg) msg.textContent = r.cleared ? 'Webhook cleared' : 'Saved';
      loadEvents();
    } catch (e) { if (msg) msg.textContent = e.message; }
  };
  if ($('#btn-enrich')) $('#btn-enrich').onclick = queueEnrichment;
  if ($('#btn-bulk-sync')) $('#btn-bulk-sync').onclick = runBulkSync;
  if ($('#btn-copy-tsv')) $('#btn-copy-tsv').onclick = copyTableTsv;
  if ($('#btn-export-xlsx')) $('#btn-export-xlsx').onclick = exportXlsx;
  if ($('#btn-ratio')) $('#btn-ratio').onclick = () => { const p = $('#ratio-panel'); if (p) { p.hidden = !p.hidden; if (!p.hidden) loadRatios(); } };
  if ($('#ratio-save')) $('#ratio-save').onclick = saveRatioFromForm;
  if ($('#btn-empty-demo')) $('#btn-empty-demo').onclick = async () => {
    const msg = $('#empty-msg'); if (msg) msg.textContent = 'Seeding demo data…';
    try { const r = await api('/api/seed', { method: 'POST', body: JSON.stringify({ companies: 60 }) }); if (msg) msg.textContent = `Loaded ${r.companies ?? 60} demo companies`; runScreen({ expression: 'Market Cap > 0' }); }
    catch (e) { if (msg) msg.textContent = e.message; }
  };
  if ($('#btn-empty-dir')) $('#btn-empty-dir').onclick = async () => {
    const msg = $('#empty-msg'); if (msg) msg.textContent = 'Syncing directory — this takes a minute…';
    try { const r = await api('/api/directory/sync/' + (activeMarket() || ''), { method: 'POST', body: '{}' }); if (msg) msg.textContent = `${r.symbols} symbols listed. Use Enrich to load their data.`; }
    catch (e) { if (msg) msg.textContent = e.message; }
  };
  if ($('#btn-empty-fetch')) $('#btn-empty-fetch').onclick = async () => {
    const sym = prompt('Symbol to fetch (e.g. RELIANCE.NS)'); if (!sym) return;
    const msg = $('#empty-msg'); if (msg) msg.textContent = `Fetching ${sym}…`;
    try { await api('/api/live/fetch', { method: 'POST', body: JSON.stringify({ symbol: sym }) }); if (msg) msg.textContent = `Fetched ${sym}`; runScreen({ expression: 'Market Cap > 0' }); }
    catch (e) { if (msg) msg.textContent = e.message; }
  };
  if ($('#btn-dir-sync')) $('#btn-dir-sync').onclick = async () => {
    const msg = $('#dir-msg');
    if (msg) msg.textContent = 'Syncing… this can take a minute';
    try { const r = await api('/api/directory/sync/' + (activeMarket() || ''), { method: 'POST', body: '{}' }); if (msg) msg.textContent = `${r.symbols} symbols in ${Math.round(r.ms / 1000)}s`; loadDirectory($('#dir-q').value.trim()); }
    catch (e) { if (msg) msg.textContent = e.message; }
  };
  // Boot-time loaders can run before the API base is resolved; retry once it is.
  setTimeout(() => { try { loadSectors(); } catch { /* ignore */ } }, 1500);
}

async function loadQuickFilters() {
  const el = $('#quick-filters');
  if (!el) return;
  try {
    const r = await api('/api/quick-filters');
    el.innerHTML = `<span class="hint">Quick:</span> ` + r.filters.map((f) => `<button class="chip" data-qf="${esc(f.expression)}" title="${esc(f.why)}">${esc(f.label)}</button>`).join('');
    el.querySelectorAll('[data-qf]').forEach((b) => { b.onclick = () => { $('#expr').value = b.dataset.qf; runScreen({ expression: b.dataset.qf }); }; });
  } catch { el.innerHTML = ''; }
}

async function loadScreenHistory() {
  const el = $('#screen-history');
  if (!el) return;
  try {
    const r = await api('/api/screen/history');
    el.innerHTML = r.history.length
      ? `<span class="hint">Recent screens:</span> ` + r.history.slice(0, 5).map((h) => `<button class="chip" data-hist="${esc(h.expression)}" title="${h.lastCount} results">${esc(h.expression.slice(0, 42))}</button>`).join('')
      : '';
    el.querySelectorAll('[data-hist]').forEach((b) => { b.onclick = () => { $('#expr').value = b.dataset.hist; runScreen({ expression: b.dataset.hist }); }; });
  } catch { el.innerHTML = ''; }
}

async function loadNote(symbol) {
  const el = $('#co-note');
  if (!el) return;
  try {
    const [n, r] = await Promise.all([api(`/api/notes/${encodeURIComponent(symbol)}`).catch(() => ({ body: '' })), api(`/api/rating/${encodeURIComponent(symbol)}`).catch(() => ({ rating: 0 }))]);
    el.innerHTML = `<div class="scorecard"><div class="t">Rating</div>
        <div class="d">${[1,2,3,4,5].map((i) => `<span class="rowstar ${i <= (r.rating||0) ? 'on' : ''}" data-rate="${i}" role="button" tabindex="0" aria-label="Rate ${i}">★</span>`).join('')}</div></div>
      <div class="scorecard"><div class="t">Note</div>
        <textarea id="note-box" class="input" rows="3" style="width:100%" placeholder="Why did you shortlist this?">${esc(n.body || '')}</textarea>
        <div class="d"><button class="btn sm" id="btn-note-save">Save note</button></div></div>`;
    el.querySelectorAll('[data-rate]').forEach((s) => { s.onclick = async () => { await api(`/api/rating/${encodeURIComponent(symbol)}`, { method: 'POST', body: JSON.stringify({ rating: Number(s.dataset.rate) }) }); toast(`Rated ${s.dataset.rate}/5`); loadNote(symbol); }; });
    const btn = $('#btn-note-save');
    if (btn) btn.onclick = async () => { await api(`/api/notes/${encodeURIComponent(symbol)}`, { method: 'POST', body: JSON.stringify({ body: $('#note-box').value }) }); toast('Note saved'); };
  } catch { el.innerHTML = ''; }
}

async function loadMovers() {
  const mv = await api('/api/movers');
  const el = $('#intel-movers');
  if (el) el.innerHTML = `<div class="scorecard"><div class="t">Gainers</div>${mv.gainers.slice(0,5).map((g)=>`<div class="d"><b>${esc(g.symbol)}</b> <span style="color:var(--ok)">+${g.changePct}%</span> <span class="hint">${nf2.format(g.price)}</span></div>`).join('')}</div>
    <div class="scorecard"><div class="t">Losers</div>${mv.losers.slice(0,5).map((g)=>`<div class="d"><b>${esc(g.symbol)}</b> <span style="color:var(--err)">${g.changePct}%</span> <span class="hint">${nf2.format(g.price)}</span></div>`).join('')}</div>`;
}

async function loadSectorBreadth() {
  const r = await api('/api/sector-breadth');
  const el = $('#intel-breadth');
  if (el) el.innerHTML = r.sectors.slice(0,8).map((s)=>`<div class="scorecard"><div class="t">${esc(s.sector)}</div>
    <div class="d">${s.up} up · ${s.down} down</div>
    <div class="d" style="color:${s.pctUp>=50?'var(--ok)':'var(--err)'}">${s.pctUp}% advancing</div></div>`).join('');
}

async function loadTimeline(symbol) {
  const el = $('#co-timeline');
  if (!el) return;
  try {
    const t = await api(`/api/timeline/${encodeURIComponent(symbol)}`);
    el.innerHTML = t.events.length
      ? `<div class="scorecard"><div class="t">Recent events</div>${t.events.slice(0,10).map((e)=>`<div class="d"><span class="hint">${esc(e.date)}</span> ${esc(e.kind)} — ${esc(e.detail)}</div>`).join('')}</div>`
      : '<div class="scorecard"><div class="t">Timeline</div><div class="d hint">No stored events yet — fetch news or live data.</div></div>';
  } catch { el.innerHTML = ''; }
}

async function loadWatchCalendar() {
  const el = $('#wl-calendar');
  if (!el) return;
  try {
    const c = await api('/api/watchlist/calendar');
    if (!c.earnings.length && !c.exDividend.length) { el.innerHTML = '<div class="scorecard"><div class="t">Upcoming</div><div class="d hint">No upcoming events for watchlist companies.</div></div>'; return; }
    el.innerHTML = `<div class="scorecard"><div class="t">Upcoming earnings</div>${c.earnings.slice(0,6).map((e)=>`<div class="d">${esc(e.symbol)} — ${esc(e.date)}</div>`).join('') || '<div class="d hint">None</div>'}</div>
      <div class="scorecard"><div class="t">Ex-dividend</div>${c.exDividend.slice(0,6).map((e)=>`<div class="d">${esc(e.symbol)} — ${esc(e.date)}</div>`).join('') || '<div class="d hint">None</div>'}</div>`;
  } catch { el.innerHTML = ''; }
}

async function loadUniverse() {
  const el = $('#intel-universe');
  el.innerHTML = '<p class="hint">Fetching the index constituent list…</p>';
  try {
    const mk = await api('/api/markets');
    const code = mk.active || 'IN';
    const r = await api(`/api/universe/constituents/${code}`);
    if (!r.count) {
      el.innerHTML = `<div class="scorecard"><div class="t">${esc(r.indexName)}</div><div class="d hint">No constituent table could be parsed for this index (${esc(r.error || 'unknown')}).</div></div>`;
      return;
    }
    el.innerHTML = `<div class="scorecard"><div class="t">${esc(r.indexName)}</div>
      <div class="big">${r.count}<span class="hint"> stocks</span></div>
      <div class="d hint">${esc(r.constituents.slice(0, 6).map((c) => c.symbol).join(', '))}…</div>
      <div class="d"><button class="btn sm" id="btn-universe-sync">Queue all ${r.count} for download</button></div></div>`;
    $('#btn-universe-sync').onclick = async () => {
      try {
        const s = await api(`/api/universe/sync/${code}`, { method: 'POST', body: '{}' });
        el.insertAdjacentHTML('beforeend', `<div class="scorecard"><div class="t">Queued</div><div class="d">${s.queued} of ${s.constituents} stocks queued for ${esc(s.market)}</div><div class="d hint">Run the queue in the Jobs panel to fetch them.</div></div>`);
      } catch (e) { alert(e.message); }
    };
  } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

async function loadModels() {
  const panel = $('#model-panel');
  const rows = $('#model-rows');
  if (!panel || !rows) return;
  try {
    const [rec, inst] = await Promise.all([api('/api/models/recommend'), api('/api/models/installed')]);
    const d = rec.device;
    const activeId = inst.active;
    panel.innerHTML = `<div class="scorecard"><div class="t">This device</div>
        <div class="d">${d.ramMb} MB RAM · ${d.cores} cores · ${d.tier} tier</div>
        <div class="d hint">${esc(d.platform)}/${esc(d.arch)} · ${d.freeDiskMb} MB free disk</div></div>
      <div class="scorecard"><div class="t">Recommended</div>
        <div class="d"><b>${esc(rec.best ? rec.best.name : 'No model fits')}</b></div>
        <div class="d hint">${esc(rec.reason)}</div></div>
      <div class="scorecard"><div class="t">Installed</div>
        <div class="d">${inst.installed.length} model(s) · ${inst.diskUsageMb} MB</div>
        <div class="d hint">${inst.installed.length ? 'Active: ' + esc(activeId || 'none') : 'Nothing installed — the deterministic engine answers meanwhile.'}</div></div>`;

    const byId = Object.fromEntries((rec.options || []).map((o) => [o.model.id, o]));
    rows.innerHTML = rec.options.map(({ model: m, verdict, note }) => {
      const isInstalled = inst.installed.some((i) => i.id === m.id);
      const isActive = activeId === m.id;
      const action = isActive ? '<span class="hint">active</span>'
        : isInstalled ? `<button class="btn sm" data-switch="${esc(m.id)}">Use</button> <button class="btn sm ghost" data-remove="${esc(m.id)}">Remove</button>`
        : `<button class="btn sm ghost" data-pick="${esc(m.id)}">Select</button>`;
      return `<tr><td class="l">${esc(m.name)}</td><td>${esc(m.params)}</td><td>${esc(m.quant)}</td>
        <td>${m.sizeMb} MB</td><td>~${m.ramNeededMb} MB</td>
        <td style="color:${verdict === 'fits' ? 'var(--ok)' : verdict === 'tight' ? 'var(--accent)' : 'var(--err)'}" title="${esc(note)}">${verdict}</td>
        <td class="l">${action}</td></tr>`;
    }).join('');

    rows.querySelectorAll('[data-switch]').forEach((b) => { b.onclick = async () => { await api(`/api/models/switch/${encodeURIComponent(b.dataset.switch)}`, { method: 'POST', body: '{}' }); toast(`Now using ${b.dataset.switch}`); loadModels(); }; });
    rows.querySelectorAll('[data-remove]').forEach((b) => { b.onclick = async () => { await api(`/api/models/remove/${encodeURIComponent(b.dataset.remove)}`, { method: 'POST', body: '{}' }); toast('Removed'); loadModels(); }; });
    rows.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => { const el = $('#model-path'); if (el) { el.value = ''; el.placeholder = `Path to ${b.dataset.pick}.gguf`; el.dataset.id = b.dataset.pick; el.focus(); } }; });
  } catch (e) { panel.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

async function loadStore() {
  try {
    const r = await api('/api/store');
    const installed = r.packs.filter((p) => p.status === 'installed');
    const totalMb = installed.reduce((s, p) => s + p.sizeMb, 0);
    $('#store-summary').innerHTML = `
      <div class="scorecard"><div class="t">Installed</div>
        <div class="big">${installed.length}<span class="hint">/${r.packs.length}</span></div>
        <div class="d">${totalMb} MB on disk</div></div>
      <div class="scorecard"><div class="t">Capabilities</div>
        <div class="d">${r.installed.length ? esc(r.installed.slice(0, 6).join(' · ')) : 'none yet'}</div></div>`;
    const colour = (s) => s === 'installed' ? 'var(--ok)' : s === 'available' ? 'var(--accent)' : 'var(--warn)';
    $('#store-body').innerHTML = r.packs.map((p) => `<tr>
      <td class="l"><b>${esc(p.name)}</b><div class="sub hint">${esc(p.summary)}</div></td>
      <td>${esc(p.kind)}</td><td>${p.sizeMb >= 1024 ? (p.sizeMb / 1024).toFixed(1) + ' GB' : p.sizeMb + ' MB'}</td>
      <td>${esc(p.licence)}</td>
      <td style="color:${colour(p.status)}">● ${esc(p.status)}</td>
      <td class="l hint">${esc(p.unlocks.join(', '))}</td>
      <td>${p.status === 'installed'
        ? `<button class="btn sm ghost" data-store-remove="${esc(p.id)}">Remove</button>`
        : `<button class="btn sm" data-store-install="${esc(p.id)}">Install</button>`}</td></tr>`).join('');
    for (const b of document.querySelectorAll('[data-store-install]')) {
      b.onclick = async () => {
        try {
          const res = await api('/api/store/install', { method: 'POST', body: JSON.stringify({ id: b.dataset.storeInstall }) });
          alert(res.note || 'Installed');
          loadStore();
        } catch (e) { alert(e.message); }
      };
    }
    for (const b of document.querySelectorAll('[data-store-remove]')) {
      b.onclick = async () => {
        try { await api('/api/store/uninstall', { method: 'POST', body: JSON.stringify({ id: b.dataset.storeRemove }) }); loadStore(); }
        catch (e) { alert(e.message); }
      };
    }
  } catch (e) { $('#store-body').innerHTML = `<tr><td colspan="7">${esc(e.message)}</td></tr>`; }
}

// ---- block query builder -----------------------------------------------------
let builderFields = [];

function addBuilderRow(field = '', op = '>', value = '') {
  const rows = $('#builder-rows');
  const row = document.createElement('div');
  row.className = 'brow';
  row.innerHTML = `
    <select class="input sm b-field" aria-label="Field">
      <option value="">Field…</option>
      ${builderFields.map((f) => `<option value="${esc(f)}" ${f === field ? 'selected' : ''}>${esc(f)}</option>`).join('')}
    </select>
    <select class="input sm b-op" aria-label="Operator" style="max-width:80px">
      ${['>', '>=', '<', '<=', '=', '!='].map((o) => `<option ${o === op ? 'selected' : ''}>${o}</option>`).join('')}
    </select>
    <input class="input sm b-val" aria-label="Value" placeholder="Value" value="${esc(String(value))}" />
    <button class="rm" title="Remove" aria-label="Remove condition">×</button>`;
  row.querySelector('.rm').onclick = () => row.remove();
  rows.appendChild(row);
}

function builderExpression() {
  const op = $('#builder-op').value;
  const parts = [];
  for (const row of document.querySelectorAll('#builder-rows .brow')) {
    const f = row.querySelector('.b-field').value;
    const o = row.querySelector('.b-op').value;
    const v = row.querySelector('.b-val').value.trim();
    if (!f || !v) continue;
    const isNum = /^-?\d+(\.\d+)?$/.test(v);
    parts.push(`${f} ${o} ${isNum ? v : `"${v.replace(/"/g, '')}"`}`);
  }
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0] : parts.map((p) => `(${p})`).join(` ${op} `);
}

async function initBuilder() {
  if (!builderFields.length) {
    try { const r = await api('/api/fields'); builderFields = (r.fields || []).map((f) => f.label || f.column); } catch { builderFields = []; }
  }
  if (!document.querySelector('#builder-rows .brow')) addBuilderRow();
}

// ---- user features: recents, shortcuts, shareable URLs, offline, drill-down -----

const RECENT_KEY = 'atlas.recent';
function pushRecent(symbol) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const next = [symbol, ...list.filter((s) => s !== symbol)].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage blocked */ }
}

function applyUrlScreen() {
  const expr = new URLSearchParams(location.search).get('expr');
  if (!expr) return false;
  $('#expr').value = expr;
  runScreen({ expression: expr });
  return true;
}

function syncUrlScreen(expression) {
  try {
    const url = new URL(location.href);
    if (expression) url.searchParams.set('expr', expression); else url.searchParams.delete('expr');
    history.replaceState(null, '', url.toString());
  } catch { /* ignore */ }
}

function initOfflineBanner() {
  const el = $('#offline-banner');
  const update = () => { if (el) el.hidden = navigator.onLine; };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function initShortcuts() {
  let pendingG = false;
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = /INPUT|TEXTAREA|SELECT/.test(tag);
    if (e.key === '/' && !typing) {
      e.preventDefault();
      // Take the user to the screener first — focusing a hidden input does nothing.
      const tab = document.querySelector('.navbtn[data-view="screener"]');
      if (tab && !document.querySelector('#view-screener.active')) tab.click();
      const nl = $('#nl');
      if (nl) { nl.focus(); nl.select && nl.select(); }
      return;
    }
    if (e.key === 'Escape') { const b = $('#builder'); if (b && !b.hidden) { b.hidden = true; $('#btn-builder').setAttribute('aria-expanded','false'); } return; }
    if (typing) return;
    if (e.key === 'g') { pendingG = true; setTimeout(() => { pendingG = false; }, 900); return; }
    if (pendingG) {
      const map = { s: 'screener', w: 'watchlist', p: 'portfolio', i: 'intel', c: 'compare', m: 'macro', a: 'store' };
      const view = map[e.key];
      if (view) { e.preventDefault(); const btn = document.querySelector(`.navbtn[data-view="${view}"]`); if (btn) btn.click(); }
      pendingG = false;
    }
  });
}

function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

async function toggleWatch(symbol, el) {
  try {
    const r = await api('/api/watchlist/bulk', { method: 'POST', body: JSON.stringify({ symbols: [symbol] }) });
    if (el) el.classList.add('on');
    toast(r.added ? `${symbol} added to watchlist` : `${symbol} already on watchlist`);
  } catch (e) { toast(e.message); }
}

async function addAllToWatchlist() {
  const symbols = (state.rows || []).map((r) => r.symbol);
  if (!symbols.length) return toast('Run a screen first');
  try {
    const r = await api('/api/watchlist/bulk', { method: 'POST', body: JSON.stringify({ symbols }) });
    toast(`Added ${r.added}, already present ${r.already}`);
    document.querySelectorAll('#result-body [data-star]').forEach((s) => s.classList.add('on'));
  } catch (e) { toast(e.message); }
}

function showRecents() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { list = []; }
  const el = $('#recents');
  if (!el) return;
  el.innerHTML = list.length
    ? `<span class="hint">Recent:</span> ${list.slice(0, 8).map((s) => `<button class="chip" data-recent="${esc(s)}">${esc(s)}</button>`).join('')}`
    : '';
  el.querySelectorAll('[data-recent]').forEach((b) => { b.onclick = () => openCompany(b.dataset.recent); });
}

function copyText(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast(`Copied ${text}`)).catch(() => toast(text));
  else toast(text);
}

async function loadPortfolioPnl() {
  const el = $('#portfolio-pnl');
  if (!el) return;
  try {
    const r = await api('/api/portfolio/pnl');
    if (!r.holdings.length) { el.innerHTML = '<div class="scorecard"><div class="t">Portfolio P&L</div><div class="d hint">No holdings yet — add one below.</div></div>'; return; }
    el.innerHTML = `<div class="scorecard"><div class="t">Portfolio P&L</div>
      <div class="big" style="color:${r.totalPnl >= 0 ? 'var(--ok)' : 'var(--err)'}">${r.totalPnl >= 0 ? '+' : ''}${nf2(r.totalPnl)}<span class="hint"> ${r.totalPnlPct}%</span></div>
      <div class="d">Value ${nf2(r.totalValue)} · Cost ${nf2(r.totalCost)}</div>
      <div class="d hint">Best ${esc(r.best ? r.best.symbol + ' ' + r.best.pnlPct + '%' : '—')} · Worst ${esc(r.worst ? r.worst.symbol + ' ' + r.worst.pnlPct + '%' : '—')}</div>
      <div class="d"><a href="${FIN}/api/export/portfolio.csv" target="_blank" rel="noopener">Export CSV</a></div></div>
      ${r.holdings.map((h) => `<div class="scorecard"><div class="t">${esc(h.symbol)}</div>
        <div class="d">${h.quantity} @ ${nf2(h.avgCost)} → ${nf2(h.price)}</div>
        <div class="d" style="color:${h.pnl >= 0 ? 'var(--ok)' : 'var(--err)'}">${h.pnl >= 0 ? '+' : ''}${nf2(h.pnl)} (${h.pnlPct}%)</div>
        <div class="d hint">${h.weightPct}% of portfolio</div></div>`).join('')}`;
  } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

async function loadFreshness(symbol) {
  const el = $('#co-fresh');
  if (!el) return;
  try {
    const f = await api(`/api/company/${encodeURIComponent(symbol)}/freshness`);
    el.innerHTML = `<div class="scorecard"><div class="t">Data age</div>
      ${f.sources.map((s) => `<div class="d ${s.stale ? 'err' : ''}">${esc(s.source)}: ${s.asOf ?? 'not stored'}${s.ageDays !== null ? ` · ${s.ageDays}d` : ''}${s.stale ? ' · stale' : ''}</div>`).join('')}
      <div class="d hint">${f.news} stored headline(s)</div></div>`;
  } catch { el.innerHTML = ''; }
}

async function drillSector(name) {
  const expr = `Sector = "${name}"`;
  $('#expr').value = expr;
  syncUrlScreen(expr);
  const btn = document.querySelector('.navbtn[data-view="screener"]');
  if (btn) btn.click();
  runScreen({ expression: expr });
}

function initUserFeatures() {
  initOfflineBanner();
  initShortcuts();
}

async function loadMarkets() {
  try {
    const r = await api('/api/markets');
    const sel = $('#market-select');
    if (!sel) return;
    sel.innerHTML = r.markets.map((m) =>
      `<option value="${m.code}" ${m.active ? 'selected' : ''}>${m.flag} ${m.name}${m.hasData ? '' : ' — download'}</option>`).join('');
    sel.onchange = async () => {
      const code = sel.value;
      try {
        const res = await api('/api/markets/switch', { method: 'POST', body: JSON.stringify({ code }) });
        document.body.dataset.market = res.active;
        if ($('#echo')) $('#echo').textContent = `Switched to ${res.market.name} (${res.market.currency}) — this market's data only.`;
        location.reload();
      } catch (e) { alert(e.message); }
    };
  } catch { /* optional */ }
}

function researchPrompt(symbol) {
  const el = $('#co-research');
  if (el && !el.innerHTML.trim()) el.innerHTML = `<div class="scorecard"><div class="t">Research report</div><div class="d hint">20 sections from local data. Click "Generate report" above.</div></div>`;
}

async function loadResearch(symbol) {
  const el = $('#co-research');
  el.innerHTML = '<p class="hint">Building the 16-section report…</p>';
  try {
    const r = await api(`/api/research/${encodeURIComponent(symbol)}`);
    const colour = (s) => s === 'complete' ? 'var(--ok)' : s === 'partial' ? 'var(--accent)' : 'var(--warn)';
    el.innerHTML = `<div class="scorecard"><div class="t">Coverage</div>
        <div class="big">${r.coverage.pct}%<span class="hint"> of 16 sections</span></div>
        <div class="d">${r.coverage.complete} complete · ${r.coverage.partial} partial · ${r.coverage.unavailable} unavailable</div>
        <div class="d"><a href="${FIN}/api/research/${encodeURIComponent(symbol)}.md" target="_blank" rel="noopener">Download Markdown report</a></div></div>
      <div class="scorecard"><div class="t">Sections</div>
        ${r.sections.map((s) => `<div class="d" style="color:${colour(s.status)}">${s.n}. ${esc(s.title)} <span class="hint">${esc(s.status)}</span></div>`).join('')}</div>`;
  } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

async function loadAsk(symbol) {
  const el = $('#co-ask');
  if (!el) return;
  el.innerHTML = `<div class="scorecard"><div class="t">Ask</div>
    <div class="d"><input id="ask-q" class="input" placeholder="e.g. Is the debt comfortable? Is it cheap?" /></div>
    <div class="d"><button class="btn sm primary" id="btn-ask">Ask</button> <span class="hint" id="ask-status"></span></div>
    <div id="ask-out" class="hint"></div></div>`;
  try {
    const st = await api('/api/llm/status');
    $('#ask-status').textContent = st.available ? `local model: ${st.model}` : 'no local model — answering deterministically';
  } catch { /* ignore */ }
  const run = async () => {
    const q = $('#ask-q').value.trim();
    if (!q) return;
    $('#ask-out').textContent = 'Thinking…';
    try {
      const r = await api('/api/llm/ask', { method: 'POST', body: JSON.stringify({ symbol, question: q }) });
      const badge = r.verified
        ? '<span style="color:var(--ok)">✓ every figure matches the computed facts</span>'
        : `<span style="color:var(--warn)">⚠ ${r.unsupportedNumbers.length} figure(s) not in the facts: ${esc(r.unsupportedNumbers.join(', '))}</span>`;
      $('#ask-out').innerHTML = `<div>${esc(r.answer)}</div><div class="hint" style="margin-top:6px">${badge} · source: ${esc(r.source)}</div>`;
    } catch (e) { $('#ask-out').textContent = e.message; }
  };
  $('#btn-ask').onclick = run;
  $('#ask-q').onkeydown = (e) => { if (e.key === 'Enter') run(); };
}


/** All-sectors panel: counts and averages for the active market. */


// ---- derived metrics + screener analysis + command palette --------------------

// ---- morning briefing -------------------------------------------------------



async function loadNewsroom() {
  const el = $('#newsroom-panel');
  if (!el) return;
  try {
    const r = await api(`/api/newsroom?limit=8${marketParam()}`);
    const when = (d) => { const t = new Date(d); return Number.isNaN(t.getTime()) ? '' : t.toLocaleString(); };
    el.innerHTML = r.items.length
      ? r.items.map((n) => `<div class="scorecard"><div class="t">${esc(n.title.slice(0, 90))}</div>
          <div class="d hint">${esc(n.publisher || n.source)} · ${esc(when(n.publishedAt))}</div>
          ${n.url ? `<div class="d"><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">Open</a></div>` : ''}</div>`).join('')
      : `<div class="scorecard"><div class="t">NO HEADLINES</div><div class="d hint">${esc(r.note || 'No source answered.')}</div></div>`;
    el.insertAdjacentHTML('beforeend', `<div class="scorecard"><div class="t">SOURCES</div>
      <div class="d hint">${esc(r.sources.join(', ') || 'none')} · ${r.fromCache ? 'cached' : 'fresh'} · as of ${esc(when(r.fetchedAt))}</div></div>`);
  } catch (e) {
    el.innerHTML = `<div class="scorecard"><div class="t">NEWSROOM</div><div class="d hint">${esc(e.message)}</div></div>`;
  }
}

async function loadAdvisors() {
  const el = $('#advisors-panel');
  if (!el) return;
  try {
    const r = await api(`/api/advisors?${(activeMarket() ? `country=${encodeURIComponent(activeMarket())}` : '')}`);
    el.innerHTML = r.advisors.map((a) => `<div class="scorecard">
        <div class="t">${esc(a.name)} <span class="hint">${esc(a.country)} · ${esc(a.era)}</span></div>
        <div class="d">${esc(a.approach)}</div>
        <div class="d hint">${esc(a.criteria.map((c) => `${c.field} ${c.op} ${c.value}`).join(' · '))}</div>
        <div class="exprrow" style="margin-top:6px">
          <button class="btn xs" data-advisor="${esc(a.id)}">Apply to this market</button>
          <span class="hint" data-advisor-out="${esc(a.id)}"></span>
        </div>
        <div class="d hint">${esc(a.confidence === 'documented' ? 'Documented approach' : 'Characterisation, not a published rule set')}</div></div>`).join('')
      + `<div class="scorecard"><div class="t">COVERAGE</div><div class="d hint">${r.all} methods across ${r.coverage.length} markets: ${esc(r.coverage.map((c) => c.country + ' ' + c.count).join(' · '))}</div></div>`;
    el.querySelectorAll('[data-advisor]').forEach((b) => {
      b.onclick = async () => {
        const out = el.querySelector(`[data-advisor-out="${b.dataset.advisor}"]`);
        if (out) out.textContent = 'running…';
        try {
          const res = await api(`/api/advisors/${encodeURIComponent(b.dataset.advisor)}/run`);
          if (out) out.textContent = `${res.matches} of ${res.total} match (${res.sharePct}%)`;
        } catch (e) { if (out) out.textContent = e.message; }
      };
    });
  } catch { el.innerHTML = ''; }
}

async function loadDiscover() {
  const secEl = $('#discover-sectors'); const pickEl = $('#discover-picks');
  if (!secEl || !pickEl) return;
  try {
    const [s, r] = await Promise.all([api('/api/discover/sectors'), api('/api/discover/recommendations?limit=6')]);
    const tone = (p) => p === 'improving' ? 'var(--ok)' : p === 'leading' ? 'var(--accent)' : p === 'weakening' ? '#f59e0b' : p === 'lagging' ? 'var(--err)' : 'var(--muted)';
    secEl.innerHTML = s.sectors.slice(0, 6).map((x) => `<div class="scorecard">
      <div class="t" style="color:${tone(x.phase)}">${esc(x.phase.toUpperCase())} · ${esc(x.sector)}</div>
      <div class="d">${esc(x.evidence)}</div>
      <div class="d hint">${x.companies} companies · ${x.breadthPct}% up over the year</div></div>`).join('');
    pickEl.innerHTML = r.candidates.map((c) => `<div class="scorecard">
      <div class="t">${esc(c.symbol)} <span class="hint">${c.composite} · ${esc(c.confidence)} confidence</span></div>
      <div class="d"><b style="color:var(--ok)">For:</b> ${c.forIt.map(esc).join(' · ')}</div>
      <div class="d"><b style="color:var(--err)">Against:</b> ${c.againstIt.map(esc).join(' · ')}</div>
      <div class="d hint">${esc(c.falsifier)}</div></div>`).join('');
  } catch { secEl.innerHTML = ''; pickEl.innerHTML = ''; }
}

async function loadMarketBriefing() {
  const el = $('#market-briefing');
  if (!el) return;
  try {
    const b = await api('/api/briefing');
    el.hidden = false;
    $('#mb-greeting').textContent = b.greeting;
    $('#mb-when').textContent = new Date(b.generatedAt).toLocaleString();
    $('#mb-headline').textContent = b.headline;
    $('#mb-body').innerHTML = b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
    $('#mb-confidence').textContent = `Confidence: ${b.confidence.level} — ${b.confidence.reason}`;
  } catch { el.hidden = true; }
}







async function loadBackData(symbol) {
  const rows = $('#bd-rows'); const stats = $('#bd-stats'); const note = $('#bd-note');
  if (!rows) return;
  const from = $('#bd-from').value || undefined;
  const to = $('#bd-to').value || undefined;
  const interval = $('#bd-interval').value || 'day';
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  qs.set('interval', interval);
  try {
    const d = await api(`/api/prices/${encodeURIComponent(symbol)}?${qs.toString()}`);
    const s = d.stats;
    stats.innerHTML = [
      ['Change', s.changePct === null ? '—' : `${s.changePct}%`],
      ['High', s.high ?? '—'], ['Low', s.low ?? '—'],
      ['Volatility', s.volatilityPct === null ? '—' : `${s.volatilityPct}%`],
      ['Best bar', s.bestDayPct === null ? '—' : `${s.bestDayPct}%`],
      ['Worst bar', s.worstDayPct === null ? '—' : `${s.worstDayPct}%`],
    ].map(([k, v]) => `<div class="scorecard"><div class="t">${esc(k.toUpperCase())}</div><div class="d big">${esc(String(v))}</div></div>`).join('');
    rows.innerHTML = d.bars.slice().reverse().slice(0, 200).map((b) => `<tr>
      <td class="mono">${esc(b.date)}</td><td>${b.open}</td><td>${b.high}</td>
      <td>${b.low}</td><td>${b.close}</td><td>${b.volume.toLocaleString()}</td></tr>`).join('');
    if (note) note.textContent = d.note;
  } catch (e) { if (note) note.textContent = e.message; }
}

async function askCompany(symbol) {
  const input = $('#ask-input'); const out = $('#ask-answer');
  if (!input || !out) return;
  const q = input.value.trim();
  if (!q) { out.textContent = 'Type a question first.'; return; }
  out.textContent = 'Reading the numbers…';
  try {
    const r = await api(`/api/ask/${encodeURIComponent(symbol)}?q=${encodeURIComponent(q)}`);
    out.innerHTML = `<div class="d"><b>${esc(r.answer)}</b></div>
      <div class="d hint">${r.evidence.map((e) => `${esc(e.label)}: ${esc(e.value)}`).join(' · ')}</div>
      <div class="d hint">Confidence: ${esc(r.confidence)}${r.caveat ? ' — ' + esc(r.caveat) : ''}</div>`;
  } catch (e) { out.textContent = e.message; }
}


async function loadAlpha(symbol) {
  const el = $('#co-alpha');
  if (!el) return;
  try {
    const r = await api(`/api/alpha/${encodeURIComponent(symbol)}`);
    if (!r.factors || !r.factors.length) { el.innerHTML = '<div class="scorecard"><div class="t">NO FACTORS</div><div class="d hint">Not enough price history.</div></div>'; return; }
    const fmt = (v) => v === null ? '—' : (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(4));
    el.innerHTML =
      `<div class="scorecard"><div class="t">FACTOR SET · ${r.factors.length}</div>
        <div class="d hint">${esc(r.note)}</div>
        <div class="d hint">${esc(Object.entries(r.byGroup).map(([k, v]) => `${k} ${v}`).join(' · '))}</div></div>`
      + `<div class="scorecard"><div class="t">STRONGEST READINGS</div>`
      + r.strongest.map((f) => `<div class="d">${esc(f.name)} <b>${esc(fmt(f.value))}</b> <span class="hint">${esc(f.note.slice(0, 44))}</span></div>`).join('')
      + `</div>`;
  } catch { el.innerHTML = ''; }
}

async function loadGraph(symbol) {
  const gEl = $('#co-graph'); const sEl = $('#co-storylines');
  if (gEl) {
    try {
      const g = await api(`/api/graph/${encodeURIComponent(symbol)}`);
      const kinds = ['segment', 'geography', 'subsidiary', 'product', 'risk'];
      gEl.innerHTML = kinds.filter((k) => g.nodes.some((n) => n.kind === k)).map((k) => {
        const items = g.nodes.filter((n) => n.kind === k);
        return `<div class="scorecard"><div class="t">${esc(k.toUpperCase())}S · ${items.length}</div>
          ${items.slice(0, 5).map((n) => `<div class="d">${esc(n.label)} <span class="hint">${esc((n.note || '').slice(0, 40))}</span></div>`).join('')}</div>`;
      }).join('') + `<div class="scorecard"><div class="t">HOW THIS MAP IS BUILT</div><div class="d hint">${esc(g.note)}</div></div>`;
    } catch { gEl.innerHTML = ''; }
  }
  if (sEl) {
    try {
      const s = await api(`/api/storylines/${encodeURIComponent(symbol)}`);
      const tone = (d) => d === 'intensifying' ? 'var(--accent)' : d === 'quietening' ? 'var(--muted)' : 'var(--muted)';
      sEl.innerHTML = s.lines.length
        ? s.lines.map((l) => `<div class="scorecard"><div class="t" style="color:${tone(l.direction)}">${esc(l.theme.toUpperCase())} · ${esc(l.direction)}</div>
            <div class="d">${l.count} disclosure(s) · ${esc(l.span)}</div>
            <div class="d hint">${esc(l.note)}</div></div>`).join('')
        : '<div class="scorecard"><div class="t">NO STORYLINES</div><div class="d hint">No themed disclosures stored for this company.</div></div>';
    } catch { sEl.innerHTML = ''; }
  }
}

async function loadDataTruth(symbol) {
  const el = $('#co-datatruth');
  if (!el) return;
  try {
    const t = await api(`/api/data-truth/${encodeURIComponent(symbol)}`);
    const tone = (c) => c === 'present' ? 'var(--ok)' : c === 'partial' ? '#f59e0b' : 'var(--err)';
    el.innerHTML =
      `<div class="scorecard"><div class="t">SUPPORT · ${esc(t.verdict.toUpperCase())}</div>
         <div class="d big">${t.completenessPct}%<span class="hint"> complete</span></div>
         <div class="d hint">${t.freshnessDays === null ? 'no price data' : `prices ${t.freshnessDays} day(s) old`}</div></div>`
      + t.types.map((x) => `<div class="scorecard"><div class="t" style="color:${tone(x.coverage)}">${esc(x.label.toUpperCase())}</div>
           <div class="d">${esc(x.coverage)} · ${x.rows} row(s)</div>
           <div class="d hint">${esc(x.note)}</div></div>`).join('')
      + (t.warnings.length ? `<div class="scorecard"><div class="t" style="color:var(--err)">WARNINGS</div>${t.warnings.map((w) => `<div class="d">${esc(w)}</div>`).join('')}</div>` : '');
  } catch { el.innerHTML = ''; }
}

async function loadCorporate(symbol) {
  const rows = $('#co-timeline-panel'); const flows = $('#co-flows');
  if (rows) {
    try {
      const t = await api(`/api/timeline/${encodeURIComponent(symbol)}?limit=25`);
      rows.innerHTML = t.events.length
        ? t.events.map((e) => `<tr>
            <td class="mono">${esc(e.date)}</td>
            <td class="l">${e.significance === 'high' ? '<b>' : ''}${esc(e.title)}${e.significance === 'high' ? '</b>' : ''}<div class="hint">${esc(e.kind)}</div></td>
            <td class="l">${esc((e.detail || '').slice(0, 90))}</td></tr>`).join('')
        : '<tr><td colspan="3" class="hint">No disclosures stored for this company.</td></tr>';
    } catch { rows.innerHTML = ''; }
  }
  if (flows) {
    try {
      const f = await api(`/api/flows/${encodeURIComponent(symbol)}`);
      const i = f.insider;
      const tone = i.netDirection === 'net buying' ? 'var(--ok)' : i.netDirection === 'net selling' ? 'var(--err)' : 'var(--muted)';
      flows.innerHTML = `<div class="scorecard"><div class="t" style="color:${tone}">INSIDER FLOW · ${esc(i.netDirection.toUpperCase())}</div>
          <div class="d">${i.buys} buys vs ${i.sells} sells over ${i.windowDays} days</div>
          <div class="d hint">${esc(i.largest ? `Largest: ${i.largest.name} on ${i.largest.date}` : 'No trades recorded')}</div></div>
        ${f.ownership ? `<div class="scorecard"><div class="t">OWNERSHIP</div>
          <div class="d">Institutions ${f.ownership.institutionsPct ?? '—'}% · Insiders ${f.ownership.insidersPct ?? '—'}%</div>
          <div class="d hint">${esc(f.ownership.verdict)}</div></div>` : ''}
        <div class="scorecard"><div class="t">How to read this</div><div class="d hint">${esc(f.note)}</div></div>`;
    } catch { flows.innerHTML = ''; }
  }
}

async function loadHistory(symbol) {
  const el = $('#co-history');
  if (!el) return;
  try {
    const r = await api(`/api/history/${encodeURIComponent(symbol)}`);
    const tone = (d) => d === 'improving' ? 'var(--ok)' : d === 'deteriorating' ? 'var(--err)' : 'var(--muted)';
    el.innerHTML = r.trends.map((t) => `<div class="scorecard">
        <div class="t" style="color:${tone(t.direction)}">${esc(t.label.toUpperCase())} · ${esc(t.direction)}</div>
        <div class="d">${esc(t.verdict)}</div>
        <div class="d hint">${t.first ?? '—'} → ${t.last ?? '—'}${t.cagrPct !== null ? ` · ${t.cagrPct}% a year` : ''}</div></div>`).join('')
      + `<div class="scorecard"><div class="t">History</div><div class="d">${r.years.length} years: ${esc(r.years[0])}–${esc(r.years[r.years.length-1])}</div><div class="d hint">${esc(r.note)}</div></div>`;
  } catch { el.innerHTML = ''; }
}

async function loadCompanyBriefing(symbol) {
  const el = $('#co-briefing');
  if (!el) return;
  try {
    const b = await api(`/api/briefing/${encodeURIComponent(symbol)}`);
    el.hidden = false;
    $('#cb-headline').textContent = b.headline;
    $('#cb-body').innerHTML = b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
    $('#cb-dissent').innerHTML = b.dissent.length
      ? b.dissent.map((d) => `<div class="dissent ${d.severity}">${esc(d.message)}</div>`).join('')
      : '';
    $('#cb-falsify').innerHTML = b.falsifiers.length
      ? `<div class="falsify"><b>What would change this view</b><ul>${b.falsifiers.map((f) => `<li>${esc(f.claim)} — if ${esc(f.wouldChangeIf)}</li>`).join('')}</ul></div>`
      : '';
    const watch = b.watch.length ? ` · Next: ${b.watch.map((w) => `${w.what} on ${w.when}`).join(', ')}` : '';
    $('#cb-confidence').textContent = `Confidence: ${b.confidence.level} — ${b.confidence.reason}${watch}`;
  } catch { el.hidden = true; }
}

async function loadScreenAnalysis(expression) {
  const el = $('#screen-analysis');
  if (!el) return;
  try {
    const prev = (state.lastSymbols || []);
    const r = await api('/api/screen/analysis', { method: 'POST', body: JSON.stringify({ expression, limit: 300, previous: prev }) });
    state.lastSymbols = (state.rows || []).map((x) => x.symbol);
    const maxCount = Math.max(1, ...r.histogram.map((b) => b.count));
    el.innerHTML = `<div class="scorecard chartcard"><div class="t">Market-cap distribution</div>
        ${r.histogram.map((b) => `<div class="d" style="display:flex;align-items:center;gap:8px">
          <span class="hint" style="width:120px">${nf.format(b.from)}–${nf.format(b.to)}</span>
          <span style="flex:1;background:var(--bg-2);height:9px;border-radius:5px;overflow:hidden">
            <span style="display:block;height:9px;width:${Math.round((b.count / maxCount) * 100)}%;background:var(--accent)"></span></span>
          <span class="hint" style="width:40px;text-align:right">${b.count}</span></div>`).join('')}
        <div class="d hint">${r.count} companies · ${Object.entries(r.categories).map(([k, v]) => `${k} ${v}`).join(' · ')}</div></div>
      <div class="scorecard"><div class="t">Sector mix</div>
        ${r.sectors.slice(0, 6).map((s) => `<div class="d">${esc(s.sector)} <span class="hint">${s.count}</span></div>`).join('')}</div>
      ${r.diff ? `<div class="scorecard"><div class="t">Changed since last run</div>
        <div class="d"><span style="color:var(--ok)">+${r.diff.added.length} new</span></div>
        <div class="d"><span style="color:var(--err)">−${r.diff.removed.length} dropped</span></div>
        <div class="d hint">${r.diff.kept} unchanged</div></div>` : ''}`;
  } catch { el.innerHTML = ''; }
}



async function loadJournal() {
  const rows = $('#journal-rows'); const score = $('#journal-score');
  if (!rows) return;
  try {
    const r = await api('/api/journal');
    if (!r.entries.length) {
      rows.innerHTML = '<tr><td colspan="6" class="hint">No entries yet. Record why you buy — the app will grade your reasoning later.</td></tr>';
      if (score) score.hidden = true;
      return;
    }
    const colour = (v) => v === 'right' ? 'var(--ok)' : v === 'wrong' ? 'var(--err)' : 'var(--muted)';
    rows.innerHTML = r.entries.map((e) => `<tr>
      <td class="l">${esc(e.symbol)}</td>
      <td class="l">${esc(e.thesis.slice(0, 70))}${e.thesis.length > 70 ? '…' : ''}</td>
      <td>${esc(e.expectation)} · ${e.horizonDays}d</td>
      <td>${e.priceAtEntry ? money(e.priceAtEntry) : '—'}</td>
      <td>${e.currentPrice ? money(e.currentPrice) : '—'}</td>
      <td style="color:${colour(e.verdict)}">${esc(e.verdict)}<div class="hint">${esc(e.note)}</div></td></tr>`).join('');
    if (score) {
      const s = r.scorecard;
      score.hidden = false;
      score.innerHTML = `<div class="bhead">Your record</div>
        <div class="bheadline">${s.accuracy === null ? 'No resolved calls yet' : `${s.accuracy}% right — ${s.right} of ${s.graded}`}</div>
        <p>${esc(s.insight)}</p>
        <div class="bfoot hint">${s.total} entries · ${s.early} still running · ${s.flat} flat</div>`;
    }
  } catch { rows.innerHTML = ''; }
}

async function loadPortfolioAnalysis() {
  const el = $('#pf-analysis');
  if (!el) return;
  try {
    const r = await api('/api/portfolio/analysis');
    if (!r.holdings) { el.innerHTML = '<div class="scorecard"><div class="t">Portfolio analysis</div><div class="d hint">Add holdings to see allocation and concentration.</div></div>'; return; }
    el.innerHTML = `<div class="scorecard"><div class="t">Sector allocation</div>
        ${r.allocation.map((s) => `<div class="d">${esc(s.sector)} <span class="hint">${s.pct}%</span></div>`).join('')}</div>
      <div class="scorecard"><div class="t">Diversification</div>
        <div class="d big">${r.diversification ?? '—'}<span class="hint"> / 100</span></div>
        <div class="d hint">${r.diversification === null ? 'needs two or more holdings' : r.diversification > 70 ? 'well spread' : r.diversification > 40 ? 'moderate' : 'concentrated'}</div></div>
      ${r.warnings.length ? `<div class="scorecard"><div class="t">Warnings</div>${r.warnings.map((w) => `<div class="d" style="color:var(--err)">${esc(w)}</div>`).join('')}</div>` : ''}
      <div class="scorecard"><div class="t">Rebalance</div>
        ${r.rebalance.slice(0, 4).map((h) => `<div class="d">${esc(h.symbol)} <span class="hint">${h.currentPct}% → ${h.targetPct}%</span> <b>${esc(h.action)}</b></div>`).join('')}</div>`;
  } catch { el.innerHTML = ''; }
}

async function loadExtras(symbol) {
  const el = $('#co-extras');
  if (!el) return;
  try {
    const r = await api(`/api/extras/${encodeURIComponent(symbol)}`);
    const x = r.extras || {};
    const cell = (label, value, hint) => `<div class="scorecard"><div class="t">${esc(label)}</div>
      <div class="d big">${value === null || value === undefined ? '—' : esc(String(value))}</div>
      <div class="d hint">${esc(hint)}</div></div>`;
    el.innerHTML =
      cell('Earnings yield', x.earningsYield !== null ? `${x.earningsYield}%` : null, 'inverse of P/E') +
      cell('PEG', x.peg, 'P/E divided by growth; under 1 is cheap for the growth') +
      cell('Graham number', x.graham, 'conservative fair-value floor') +
      cell('Cash conversion', x.cashConversion !== null ? `${x.cashConversion}%` : null, 'operating cash as a share of profit') +
      cell('Quality grade', x.quality, 'returns, leverage and margin together') +
      cell('Size', x.capCategory, 'market-cap category');
  } catch { el.innerHTML = ''; }
}


// ---- custom ratios + excel export -------------------------------------------
async function loadRatios() {
  const list = $('#ratio-list');
  if (!list) return;
  try {
    const r = await api('/api/ratios');
    list.innerHTML = r.ratios.length
      ? r.ratios.map((x) => `<div class="d"><b>${esc(x.name)}</b> <span class="mono hint">= ${esc(x.formula)}</span> <button class="btn xs ghost" data-del-ratio="${x.id}">remove</button></div>`).join('')
      : '<div class="d hint">No custom ratios yet. A ratio is arithmetic over existing fields — it then behaves like a built-in.</div>';
    list.querySelectorAll('[data-del-ratio]').forEach((b) => { b.onclick = async () => { await fetch(`${FIN}/api/ratios/${b.dataset.delRatio}`, { method: 'DELETE' }); loadRatios(); }; });
  } catch { list.innerHTML = ''; }
}

async function saveRatioFromForm() {
  const name = $('#ratio-name').value.trim();
  const formula = $('#ratio-formula').value.trim();
  const msg = $('#ratio-msg');
  if (!name || !formula) { if (msg) msg.textContent = 'Name and formula are both required.'; return; }
  try {
    const res = await fetch(`${FIN}/api/ratios`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, formula }) });
    const body = await res.json();
    if (!res.ok) { if (msg) msg.textContent = body.error || 'Rejected'; return; }
    if (msg) msg.textContent = `Saved "${name}".`;
    $('#ratio-name').value = ''; $('#ratio-formula').value = '';
    loadRatios();
  } catch (e) { if (msg) msg.textContent = e.message; }
}

async function exportXlsx() {
  const rows = (state.rows || []).map((r) => ({ symbol: r.symbol, name: r.name, sector: r.sector, price: r.price, marketCap: r.marketCap, pe: r.pe, roe: r.roe }));
  if (!rows.length) { toast('Nothing to export'); return; }
  try {
    const res = await fetch(`${FIN}/api/export/xlsx`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, name: 'Screen' }) });
    if (!res.ok) { toast('Export failed'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'atlas-screen.xlsx'; a.click();
    URL.revokeObjectURL(url);
    toast(`${rows.length} rows exported to Excel`);
  } catch (e) { toast(e.message); }
}

async function copyTableTsv() {
  const rows = (state.rows || []).map((r) => ({ symbol: r.symbol, name: r.name, sector: r.sector, price: r.price, marketCap: r.marketCap, pe: r.pe, roe: r.roe }));
  try {
    const res = await fetch(`${FIN}/api/export/tsv`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) });
    const text = await res.text();
    if (navigator.clipboard) { await navigator.clipboard.writeText(text); toast(`${rows.length} rows copied as TSV`); }
    else toast('Clipboard unavailable');
  } catch (e) { toast(e.message); }
}

// ---- charts (inline SVG, no library) -----------------------------------------
function chartPath(values, w, h, min, max) {
  if (!values.length) return '';
  const span = (max - min) || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(' ');
}


// ---- timeframe + indicator controls ------------------------------------------
let chartTf = '1D';
let chartSet = ['sma50'];
let chartType = 'line';

const CHART_INDICATORS = [
  ['sma20', 'SMA20'], ['sma50', 'SMA50'], ['sma200', 'SMA200'], ['ema20', 'EMA20'],
  ['bollinger', 'BOLL'], ['rsi14', 'RSI'], ['macd', 'MACD'], ['roc10', 'ROC'],
];


// ---- candlestick + volume rendering ------------------------------------------
function candleSvg(bars, W, H, min, max) {
  if (!bars.length) return '';
  const span = (max - min) || 1;
  const step = W / bars.length;
  const bw = Math.max(1, step * 0.6);
  const y = (v) => H - ((v - min) / span) * H;
  return bars.map((b, i) => {
    const x = i * step + step / 2;
    const up = b.close >= b.open;
    const colour = up ? '#16a34a' : '#dc2626';
    const top = y(Math.max(b.open, b.close));
    const bot = y(Math.min(b.open, b.close));
    const h = Math.max(1, bot - top);
    return `<line x1="${x.toFixed(1)}" y1="${y(b.high).toFixed(1)}" x2="${x.toFixed(1)}" y2="${y(b.low).toFixed(1)}" stroke="${colour}" stroke-width="1"/>`
      + `<rect x="${(x - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${colour}"/>`;
  }).join('');
}

function volumeSvg(bars, W, H) {
  if (!bars.length) return '';
  const maxV = Math.max(...bars.map((b) => b.volume || 0)) || 1;
  const step = W / bars.length;
  const bw = Math.max(1, step * 0.6);
  return bars.map((b, i) => {
    const h = ((b.volume || 0) / maxV) * H;
    const x = i * step + step / 2;
    const up = b.close >= b.open;
    return `<rect x="${(x - bw / 2).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${up ? '#16a34a' : '#dc2626'}" opacity="0.45"/>`;
  }).join('');
}

async function renderIndicatorChart(symbol) {
  const el = $('#co-chart');
  if (!el) return;
  try {
    const q = `/api/indicators/${encodeURIComponent(symbol)}?tf=${chartTf}&set=${chartSet.join(',')}`;
    const r = await api(q);
    const closes = r.bars.map((b) => b.close);
    const W = 720, H = 200;
    const overlays = [];
    const series = {};
    for (const [id] of CHART_INDICATORS) {
      const v = r.indicators[id];
      if (Array.isArray(v)) series[id] = v;
      else if (v && v.upper) { series['bollU'] = v.upper; series['bollL'] = v.lower; }
      else if (v && v.macd) { series['macd'] = v.macd; series['macdSig'] = v.signal; }
    }
    const allVals = closes.concat(...Object.values(series).filter(Array.isArray).map((s) => s.filter((v) => v !== null)));
    const min = Math.min(...allVals), max = Math.max(...allVals);
    const up = closes[closes.length - 1] >= closes[0];
    const colour = up ? 'var(--ok)' : 'var(--err)';
    const colOf = { sma20: '#f59e0b', sma50: '#f59e0b', sma200: '#6366f1', ema20: '#0ea5e9', bollU: '#94a3b8', bollL: '#94a3b8', macd: '#6366f1', macdSig: '#f59e0b' };

    const tfBtn = (t) => `<button class="chip${chartTf === t ? ' on' : ''}" data-tf="${t}">${t}</button>`;
    const indBtn = ([id, label]) => {
      const off = r.unavailable.find((u) => u.id === id);
      return `<button class="chip${chartSet.includes(id) ? ' on' : ''}${off ? ' disabled' : ''}" data-ind="${id}" ${off ? `title="${esc(off.reason)}"` : ''}>${label}${off ? ' ⓘ' : ''}</button>`;
    };

    el.innerHTML = `<div class="scorecard chartcard">
      <div class="t">${esc(r.symbol)} <span class="hint">${r.bars.length} ${r.timeframe} bars</span></div>
      <div class="exprrow" style="margin:6px 0">
        ${['1D', '1W', '1M'].map(tfBtn).join('')} <span class="hint">·</span>
        <button class="chip${chartType === 'line' ? ' on' : ''}" data-ctype="line">Line</button>
        <button class="chip${chartType === 'candles' ? ' on' : ''}" data-ctype="candles">Candles</button>
        <span class="hint">·</span> ${CHART_INDICATORS.map(indBtn).join('')}
      </div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Chart for ${esc(r.symbol)} with indicators">
        ${chartType === 'candles'
          ? candleSvg(r.bars, W, H, min, max)
          : `<path d="${chartPath(closes, W, H, min, max)}" fill="none" stroke="${colour}" stroke-width="2"/>`}
        ${Object.entries(series).filter(([k]) => k !== 'macd' && k !== 'macdSig').map(([k, v]) => {
          const pts = v.map((x) => x).filter((x) => x !== null);
          if (pts.length < 2) return '';
          return `<path d="${chartPath(pts, W, H, min, max)}" fill="none" stroke="${colOf[k] || '#94a3b8'}" stroke-width="1.2" opacity="0.85"/>`;
        }).join('')}
      </svg>
      ${r.bars.some((b) => b.volume > 0) ? `<svg viewBox="0 0 ${W} 60" width="100%" height="60" role="img" aria-label="Volume for ${esc(r.symbol)}">${volumeSvg(r.bars, W, 60)}</svg>` : ''}
      <div class="d hint">${r.bars[0]?.date || ''} → ${r.bars[r.bars.length - 1]?.date || ''} · range ${nf2.format(min)}–${nf2.format(max)}</div>
      ${r.unavailable.length ? `<div class="d hint">Not computable here: ${r.unavailable.map((u) => `${u.id} (${u.reason})`).join('; ')}</div>` : ''}
      <div class="d" id="ind-readout"></div>
    </div>`;

    // latest values for the selected studies
    const latest = (arr) => { const f = (arr || []).filter((v) => v !== null); return f.length ? f[f.length - 1] : null; };
    const readout = [];
    for (const id of chartSet) {
      const v = r.indicators[id];
      if (Array.isArray(v)) { const l = latest(v); if (l !== null) readout.push(`${id.toUpperCase()} ${l}`); }
      else if (v && v.macd) { readout.push(`MACD ${latest(v.macd) ?? '—'} · signal ${latest(v.signal) ?? '—'}`); }
      else if (v && v.upper) { readout.push(`BOLL ${latest(v.lower) ?? '—'} – ${latest(v.upper) ?? '—'}`); }
    }
    const rd = el.querySelector('#ind-readout');
    if (rd) rd.textContent = readout.join(' · ');

    el.querySelectorAll('[data-tf]').forEach((b) => { b.onclick = () => { chartTf = b.dataset.tf; renderIndicatorChart(symbol); }; });
    el.querySelectorAll('[data-ctype]').forEach((b) => { b.onclick = () => { chartType = b.dataset.ctype; renderIndicatorChart(symbol); }; });
    el.querySelectorAll('[data-ind]').forEach((b) => {
      if (b.classList.contains('disabled')) return;
      b.onclick = () => {
        const id = b.dataset.ind;
        chartSet = chartSet.includes(id) ? chartSet.filter((x) => x !== id) : chartSet.concat(id);
        renderIndicatorChart(symbol);
      };
    });
  } catch (e) {
    el.innerHTML = `<div class="scorecard"><div class="t">Price history</div><div class="d hint">${esc(e.message)}</div></div>`;
  }
}



async function loadSectorChart() {
  const el = $('#intel-sector-chart');
  if (!el) return;
  try {
    const r = await api('/api/chart/sectors');
    if (!r.sectors.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="scorecard chartcard"><div class="t">Advancing share by sector</div>
      ${r.sectors.map((s) => `<div class="d" style="display:flex;align-items:center;gap:8px">
        <span style="width:150px">${esc(s.sector)}</span>
        <span style="flex:1;background:var(--bg-2);height:10px;border-radius:5px;overflow:hidden">
          <span style="display:block;height:10px;width:${s.pctUp}%;background:${s.pctUp >= 50 ? 'var(--ok)' : 'var(--err)'}"></span>
        </span>
        <span class="hint" style="width:96px;text-align:right">${s.pctUp}% (${s.up}/${s.up + s.down})</span>
      </div>`).join('')}</div>`;
  } catch { el.innerHTML = ''; }
}



// Sparkline column: trends for the visible rows, drawn from stored prices.

/** One empty state, two situations: an empty market, or a screen that matched nothing. */
async function showEmptyState() {
  const el = $('#empty');
  if (!el) return;
  let total = 0;
  try { const s = await api('/api/stats'); total = s.companies ?? s.total ?? 0; } catch { /* unknown */ }
  const fresh = total === 0;
  el.hidden = false;
  const t = $('#empty-title'); const b = $('#empty-body'); const acts = $('#empty-actions');
  if (t) t.textContent = fresh ? 'Nothing in this market yet' : 'No companies match';
  if (b) b.textContent = fresh
    ? 'A fresh country bundle starts empty — nothing is pre-loaded, so every number you see is real. Load demo data, sync the symbol directory, or fetch one company.'
    : 'Try widening the filters, or clear the expression.';
  if (acts) acts.hidden = !fresh;
}

async function loadSparklines() {
  const body = $('#result-body');
  if (!body || !state.rows || !state.rows.length) return;
  const symbols = state.rows.slice(0, 60).map((r) => r.symbol);
  try {
    const r = await api('/api/sparklines', { method: 'POST', body: JSON.stringify({ symbols }) });
    const svgs = r.svgs || {};
    body.querySelectorAll('tr[data-sym]').forEach((tr) => {
      const cell = tr.querySelector('td.spark');
      if (cell && svgs[tr.dataset.sym]) cell.innerHTML = svgs[tr.dataset.sym];
    });
  } catch { /* optional */ }
}

async function runBulkSync() {
  const el = $('#dir-msg');
  try {
    const st = await api('/api/bulk/status');
    if (el) el.textContent = `Bulk source: ${st.primary} — working…`;
    const r = await api('/api/bulk/sync', { method: 'POST', body: '{}' });
    const n = r.symbols ?? r.added ?? 0;
    if (el) el.textContent = `Bulk sync (${r.source || st.primary}): ${n.toLocaleString()} symbols`;
    toast(`Bulk sync complete — ${n.toLocaleString()} symbols`);
  } catch (e) { if (el) el.textContent = e.message; toast(e.message); }
}

// ---- full directory + auto-update -------------------------------------------

// ---- upcoming listings (pre-IPO) ---------------------------------------------

// ---- activity log + webhook ---------------------------------------------------
async function loadEvents() {
  const panel = $('#events-panel');
  const rows = $('#events-rows');
  if (!panel || !rows) return;
  try {
    const [ev, wh] = await Promise.all([api('/api/events?limit=25'), api('/api/webhook')]);
    const counts = {};
    for (const e of ev.events) counts[e.type] = (counts[e.type] || 0) + 1;
    panel.innerHTML = `<div class="scorecard"><div class="t">Events logged</div>
        <div class="d big">${ev.events.length}</div>
        <div class="d hint">${Object.entries(counts).slice(0,3).map(([k,v])=>`${esc(k)} ${v}`).join(' · ') || 'nothing yet'}</div></div>
      <div class="scorecard"><div class="t">Webhook</div>
        <div class="d">${wh.url ? '<span style="color:var(--ok)">configured</span>' : 'not set'}</div>
        <div class="d hint">${wh.url ? esc(wh.url).slice(0,42) : 'add a URL below to push alerts'}</div></div>`;
    rows.innerHTML = ev.events.map((e) =>
      `<tr><td class="l">${esc(new Date(e.createdAt).toLocaleString())}</td><td class="l"><b>${esc(e.type)}</b></td><td class="l">${esc(e.title)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="hint">No events yet. They appear when the app discovers symbols or a ticker graduates.</td></tr>';
    if (wh.url && $('#webhook-url')) $('#webhook-url').value = wh.url;
  } catch { panel.innerHTML = ''; }
}

async function loadPreListing() {
  const panel = $('#prelisting-panel');
  const rows = $('#prelisting-rows');
  if (!panel || !rows) return;
  try {
    const [sum, list] = await Promise.all([api('/api/prelisting/summary'), api('/api/prelisting?limit=25')]);
    panel.innerHTML = `<div class="scorecard"><div class="t">Filed</div><div class="d big">${sum.filed}</div>
        <div class="d hint">registered, not yet priced</div></div>
      <div class="scorecard"><div class="t">Priced</div><div class="d big">${sum.priced}</div>
        <div class="d hint">ticker assigned · ${sum.withdrawn} withdrawn</div></div>
      <div class="scorecard"><div class="t">Newest filing</div>
        <div class="d">${esc(sum.newest || '—')}</div>
        <div class="d hint">${sum.filed + sum.priced === 0 ? 'No filings stored — the filing sources are unreachable from this environment.' : 'source: SEC EDGAR / IPO calendar'}</div></div>`;
    rows.innerHTML = (list.rows || []).map((x) =>
      `<tr><td class="l"><b>${esc(x.name)}</b></td><td>${esc(x.formType)}</td><td>${esc(x.filedAt)}</td>
        <td style="color:${x.status === 'PRICED' ? 'var(--ok)' : x.status === 'WITHDRAWN' ? 'var(--err)' : 'var(--accent)'}">${esc(x.status)}</td>
        <td>${esc(x.ticker || '—')}</td><td>${x.priceLow !== null ? `${x.priceLow}–${x.priceHigh ?? x.priceLow}` : '—'}</td></tr>`).join('')
      || '<tr><td colspan="6" class="hint">No pre-listing records. Discovery runs during the maintenance pass when the filing sources are reachable.</td></tr>';
  } catch { panel.innerHTML = ''; }
}


async function loadEnrichStatus() {
  const el = $('#dir-msg');
  if (!el) return null;
  try {
    const s = await api('/api/enrich/status');
    el.textContent = `${s.enriched.toLocaleString()} of ${s.listed.toLocaleString()} enriched (${s.pct}%)${s.queued ? ` · ${s.queued} queued` : ''}`;
    return s;
  } catch { return null; }
}

async function queueEnrichment() {
  const el = $('#dir-msg');
  try {
    const r = await api('/api/enrich/queue', { method: 'POST', body: JSON.stringify({ count: 100 }) });
    toast(`Queued ${r.queued} stock(s) for full data`);
    if (el) el.textContent = `Queued ${r.queued} — working through them…`;
    const poll = setInterval(async () => {
      const s = await loadEnrichStatus();
      if (!s || s.queued === 0) clearInterval(poll);
    }, 4000);
  } catch (e) { toast(e.message); }
}

async function loadDirectory(q) {
  const panel = $('#directory-panel');
  const rows = $('#dir-rows');
  if (!panel || !rows) return;
  try {
    const cov = await api('/api/directory/coverage');
    panel.innerHTML = `<div class="scorecard"><div class="t">Listed symbols</div>
        <div class="d big">${cov.listed.toLocaleString()}</div>
        <div class="d hint">${cov.ingested.toLocaleString()} with full data (${cov.pct}%)</div></div>
      <div class="scorecard"><div class="t">Sectors covered</div>
        <div class="d">${cov.sectors.length} sectors</div>
        <div class="d hint">${cov.sectors.slice(0,3).map((s)=>`${esc(s.sector)} ${s.listed}`).join(' · ')}</div></div>`;
    loadEnrichStatus();
    if (!q) { rows.innerHTML = '<tr><td colspan="4" class="hint">Type at least 2 characters to search every listed symbol.</td></tr>'; return; }
    const r = await api(`/api/directory/search?q=${encodeURIComponent(q)}&limit=25`);
    rows.innerHTML = (r.results || []).map((x) =>
      `<tr data-sym="${esc(x.symbol)}"><td class="l"><b>${esc(x.symbol)}</b></td><td class="l">${esc(x.name)}</td>
        <td>${esc(x.sector)}</td><td>${x.ingested ? '<span style="color:var(--ok)">loaded</span>' : '<button class="chip" data-fetch="${esc(x.symbol)}">Fetch</button>'}</td></tr>`).join('')
      || '<tr><td colspan="4" class="hint">No symbols matched.</td></tr>';
    rows.querySelectorAll('[data-fetch]').forEach((b) => {
      b.onclick = async (e) => { e.stopPropagation(); b.textContent = '…'; try { await api(`/api/live/fetch`, { method: 'POST', body: JSON.stringify({ symbol: b.dataset.fetch }) }); toast(`Fetched ${b.dataset.fetch}`); loadDirectory(q); } catch (err) { toast(err.message); b.textContent = 'Fetch'; } };
    });
    rows.querySelectorAll('tr[data-sym]').forEach((tr) => { tr.onclick = () => { const x = (r.results || []).find((y) => y.symbol === tr.dataset.sym); if (x && x.ingested) openCompany(x.symbol); }; });
  } catch (e) { panel.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

async function loadRefreshPanel() {
  const el = $('#refresh-panel');
  if (!el) return;
  try {
    const s = await api('/api/refresh/status');
    const next = s.nextRunAt ? new Date(s.nextRunAt).toLocaleTimeString() : '—';
    el.innerHTML = `<div class="scorecard"><div class="t">Auto-update</div>
        <div class="d"><b style="color:${s.running ? 'var(--ok)' : 'var(--err)'}">${s.running ? 'running' : 'stopped'}</b></div>
        <div class="d hint">every ${Math.round(s.intervalMs / 60000)} min · ${s.batch} per pass · next ${esc(next)}</div>
        <div class="d"><button class="chip" data-ref="start">Start</button><button class="chip" data-ref="stop">Stop</button><button class="chip" data-ref="now">Run now</button></div></div>
      <div class="scorecard"><div class="t">Last pass</div>
        <div class="d">${s.lastRunAt ? new Date(s.lastRunAt).toLocaleTimeString() : 'never'}</div>
        <div class="d hint">${s.lastUpdated} updated · ${s.lastFailed} failed · ${s.ticks} total pass(es)</div></div>`;
    el.querySelectorAll('[data-ref]').forEach((b) => {
      b.onclick = async () => { await api(`/api/refresh/${b.dataset.ref}`, { method: 'POST', body: '{}' }); toast(`Auto-update ${b.dataset.ref}`); loadRefreshPanel(); };
    });
  } catch { el.innerHTML = ''; }
}

async function loadSectorPanel() {
  const el = $('#intel-sectors');
  if (!el) return;
  try {
    const r = await api('/api/sectors/summary');
    const rows = (r && r.sectors) || [];
    if (!rows.length) { el.innerHTML = '<div class="scorecard"><div class="t">All sectors</div><div class="d hint">No sector data in this market yet.</div></div>'; return; }
    el.innerHTML = rows.slice(0, 12).map((s) =>
      `<div class="scorecard"><div class="t">${esc(s.sector)}</div>
        <div class="d">${s.companies} companies · ${s.pct}%</div>
        <div class="d hint">P/E ${s.avgPe ?? '—'} · ROE ${s.avgRoe ?? '—'}%</div>
        <div class="d"><button class="chip" data-sector-jump="${esc(s.sector)}">Screen</button></div></div>`).join('');
    el.querySelectorAll('[data-sector-jump]').forEach((b) => {
      b.onclick = () => { try { drillSector(b.dataset.sectorJump); } catch { /* drillSector optional */ } };
    });
  } catch (e) { el.innerHTML = `<p class="err">Sectors unavailable: ${esc(e.message)}</p>`; }
}

async function loadSectors() {
  try {
    const r = await api('/api/sectors');
    const sel = $('#sector-filter');
    if (!sel) return;
    sel.innerHTML = '<option value="">All sectors</option>' + r.sectors.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    sel.onchange = () => {
      const base = $('#expr').value.trim();
      const expr = sel.value ? `Sector = "${sel.value}"${base && !/Sector\s*=/.test(base) ? ' AND (' + base + ')' : ''}` : base.replace(/^Sector\s*=\s*"[^"]*"\s*(AND\s*)?/i, '');
      if (expr) { $('#expr').value = expr; $('#btn-apply').click(); }
    };
  } catch { /* optional */ }
}

async function loadFields() {
  try {
    const r = await api('/api/fields');
    const dl = $('#field-list');
    if (!dl) return;
    // /api/fields returns [{ column, label, kind, unit }] — the label is what the
    // expression language accepts, so that is what goes in the datalist.
    const names = Array.isArray(r.fields)
      ? r.fields.map((f) => (typeof f === 'string' ? f : (f.label || f.name || f.column)))
      : Object.keys(r.fields || {});
    dl.innerHTML = names.filter(Boolean).map((n) => `<option value="${esc(String(n))}"></option>`).join('');
  } catch { /* optional */ }
}

async function loadHealth() {
  try {
    const h = await api('/api/health');
    const el = $('#health-line');
    if (el) el.textContent = `v${h.version} · ${h.db.companies} companies · auth ${h.authConfigured ? 'PIN set' : 'open'} · jobs ${h.jobs.queued} queued, ${h.jobs.failed} failed · up ${Math.round(h.uptimeMs / 60000)}m`;
  } catch { /* optional */ }
}

async function loadAdmin() {
  const el = $('#intel-admin');
  if (!el) return;
  el.innerHTML = `<div class="scorecard"><div class="t">Data actions</div>
    <div class="d"><button class="btn sm ghost" id="btn-admin-seed">Re-seed demo pack</button></div>
    <div class="d"><button class="btn sm ghost" id="btn-admin-profiles">Regenerate profiles</button></div>
    <div class="d"><button class="btn sm ghost" id="btn-admin-quotes">Refresh quotes</button></div>
    <div class="d hint">Demo re-seed replaces fixture companies only.</div></div>`;
  $('#btn-admin-seed').onclick = async () => { if (!confirm('Re-seed the demo pack?')) return; try { await api('/api/seed', { method: 'POST', body: '{}' }); alert('Seeded.'); location.reload(); } catch (e) { alert(e.message); } };
  $('#btn-admin-profiles').onclick = async () => { try { await api('/api/profiles/seed', { method: 'POST', body: '{}' }); alert('Profiles regenerated.'); } catch (e) { alert(e.message); } };
  $('#btn-admin-quotes').onclick = async () => { try { await api('/api/quotes/refresh', { method: 'POST', body: '{}' }); alert('Quotes refreshed.'); } catch (e) { alert(e.message); } };
}

async function loadSavedScreens() {
  try {
    const r = await api('/api/saved-screens');
    const sel = $('#saved-screens');
    if (!sel) return;
    const list = Array.isArray(r) ? r : (r.screens || []);
    sel.innerHTML = '<option value="">Saved screens…</option>' + list.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
    sel.onchange = () => {
      const found = list.find((s) => s.name === sel.value);
      if (found && found.expression) { $('#expr').value = found.expression; $('#btn-apply').click(); }
    };
  } catch { /* optional */ }
}

async function loadImport() {
  try {
    const [src, mx] = await Promise.all([api('/api/import/sources'), api('/api/import/matrix')]);
    const dot = (s) => s === 'live' ? 'var(--ok)' : s === 'offline-ok' ? 'var(--accent)' : s === 'rate-limited' ? '#d29922' : 'var(--err)';
    $('#src-body').innerHTML = src.sources.map((s) => `<tr>
      <td class="l"><b>${esc(s.name)}</b><div class="sub mono">${esc(s.id)}</div></td>
      <td>${esc(s.kind)}</td>
      <td style="color:${dot(s.status)}">● ${esc(s.status)}</td>
      <td class="l hint">${esc(s.provides.join(', '))}</td>
      <td class="l hint">${esc(s.note)}</td></tr>`).join('');
    $('#matrix-body').innerHTML = mx.matrix.map((m) => `<tr>
      <td class="l">${esc(m.feature)}</td>
      <td class="l hint">${esc(m.screen)}</td>
      <td class="l">${m.paths.map((p) => `<span class="statpill" style="color:${dot(p.status)}">● ${esc(p.source)}</span>`).join(' ')}</td></tr>`).join('');
  } catch (e) { $('#src-body').innerHTML = `<tr><td colspan="5">${esc(e.message)}</td></tr>`; }
}

async function loadMacro() {
  try {
    const { series } = await api('/api/macro');
    $('#macro-cards').innerHTML = series.length
      ? series.map((s) => {
        const last = s.points[s.points.length - 1];
        const prev = s.points[s.points.length - 2];
        const delta = prev ? last.value - prev.value : 0;
        return `<div class="scorecard"><div class="t">${esc(s.label)}</div><div class="big">${nf2.format(last.value)}</div><div class="d">${last.year} · ${delta >= 0 ? '▲' : '▼'} ${nf2.format(Math.abs(delta))}</div></div>`;
      }).join('')
      : '<p class="hint">No macro data yet — press Refresh (needs network).</p>';
  } catch { /* ignore */ }
}

// ---- wiring ---------------------------------------------------------------

function wire() {
  $('#search').addEventListener('input', (e) => { clearTimeout(searchTimer); const v = e.target.value; searchTimer = setTimeout(() => doSearch(v), 160); });
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = document.querySelector('#hits div'); if (first) first.click(); }
    if (e.key === 'Escape') { $('#hits').hidden = true; e.target.blur(); }
  });
  $('#hits').addEventListener('click', (e) => {
    const f = e.target.closest('[data-fetch]');
    if (f) { fetchLive(f.dataset.fetch); return; }
    const d = e.target.closest('[data-sym]');
    if (d) { $('#hits').hidden = true; $('#search').value = ''; openCompany(d.dataset.sym); }
  });

  // Show what the parser understood before running — silent misparses are the worst UX.
  $('#btn-run-nl').onclick = async () => {
    const text = $('#nl').value.trim();
    if (!text) return;
    try {
      const parsed = await api('/api/nl', { method: 'POST', body: JSON.stringify({ text }) });
      if (parsed && parsed.expression) {
        $('#expr').value = parsed.expression;
        if ($('#echo')) $('#echo').textContent = `Understood as: ${parsed.expression}`;
        runScreen({ expression: parsed.expression });
        return;
      }
    } catch { /* fall back to the screen endpoint */ }
    runScreen({ text });
  };
  $('#nl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-run-nl').click(); });
  $('#btn-apply').onclick = () => { const expression = $('#expr').value.trim(); if (expression) runScreen({ expression }); };
  $('#expr').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-apply').click(); });
  $('#btn-csv').onclick = () => { if (state.expression) window.open(`${FIN}/api/export.csv?expression=${encodeURIComponent(state.expression)}`, '_blank'); };
  $('#btn-more').onclick = () => loadMore();

  $('#examples').addEventListener('click', (e) => { const b = e.target.closest('[data-ex]'); if (b) { $('#nl').value = b.dataset.ex; $('#btn-run-nl').click(); } });

  $('#result-head').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]'); if (!th) return;
    const key = th.dataset.sort;
    if (state.sort === key) state.order = state.order === 'asc' ? 'desc' : 'asc';
    else { state.sort = key; state.order = key === 'name' ? 'asc' : 'desc'; }
    if (state.expression) runScreen({ expression: state.expression });
  });
  $('#result-body').addEventListener('click', async (e) => {
    const star = e.target.closest('[data-star]');
    if (star) { e.stopPropagation(); await toggleWatch(star.dataset.star, star); return; }
    const sec = e.target.closest('[data-sector]');
    if (sec) { e.stopPropagation(); drillSector(sec.dataset.sector); return; }
    const tr = e.target.closest('tr[data-sym]');
    if (tr) openCompany(tr.dataset.sym);
  });

  $('#btn-back').onclick = () => showView('view-screener');
  document.querySelectorAll('.navbtn').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.view;
      const target = VIEWS[v];
      showView(target);
      if (v === 'watchlist') { loadWatchlist(); loadWatchCalendar(); }
      if (v === 'rank') loadRank();
      if (v === 'portfolio') { loadPortfolio(); loadPortfolioPnl(); }
      if (v === 'import') loadImport();
      if (v === 'intel') { loadIntel(); loadJobs(); loadTools(); loadAdmin(); loadUniverse(); loadMovers(); loadSectorBreadth();  loadSectors(); loadDiscover(); loadAdvisors(); loadNewsroom(); }
      if (v === 'store') { loadStore(); loadModels(); }
      if (v === 'macro') loadMacro();
    };
  });
  $('#btn-save-note').onclick = async () => {
    const sym = $('#btn-watch').dataset.sym; if (!sym) return;
    try { await api(`/api/notes/${encodeURIComponent(sym)}`, { method: 'PUT', body: JSON.stringify({ body: $('#co-note').value }) }); toastNote('Note saved'); } catch (e) { toastNote(e.message); }
  };
  $('#btn-watch').onclick = async () => {
    const sym = $('#btn-watch').dataset.sym; if (!sym) return;
    const watching = $('#btn-watch').textContent.includes('Watching');
    try {
      if (watching) await api(`/api/watchlist/${encodeURIComponent(sym)}`, { method: 'DELETE' });
      else await api('/api/watchlist', { method: 'POST', body: JSON.stringify({ symbol: sym }) });
      $('#btn-watch').textContent = watching ? '☆ Watch' : '★ Watching';
    } catch (e) { toastNote(e.message); }
  };
  $('#btn-macro-refresh').onclick = async () => {
    $('#btn-macro-refresh').textContent = 'Refreshing…';
    try { const r = await api('/api/macro/refresh', { method: 'POST', body: JSON.stringify({ country: 'IN' }) }); await loadMacro(); $('#btn-macro-refresh').textContent = `Refresh (${r.inserted} points)`; }
    catch { $('#btn-macro-refresh').textContent = 'Refresh failed'; }
  };
  $('#btn-import').onclick = async () => {
    const csv = $('#csv-text').value.trim(); if (!csv) return;
    $('#import-status').textContent = 'Importing…';
    try { const r = await api('/api/import/csv', { method: 'POST', body: JSON.stringify({ csv }) }); $('#import-status').textContent = `Imported ${r.statements} statement(s), ${r.companies} new company(ies)${r.errors.length ? ` · ${r.errors.length} warning(s)` : ''}`; await loadStats(); }
    catch (e) { $('#import-status').textContent = e.message; }
  };
  // round 3 wiring: theme, columns, valuation lab, portfolio, rules
  $('#lock-unlock').onclick = () => unlock();
  $('#lock-pin').onkeydown = (e) => { if (e.key === 'Enter') unlock(); };
  $('#btn-builder').onclick = async () => {
    const el = $('#builder');
    el.hidden = !el.hidden;
    $('#btn-builder').setAttribute('aria-expanded', String(!el.hidden));
    if (!el.hidden) await initBuilder();
  };
  $('#btn-builder-add').onclick = () => addBuilderRow();
  $('#btn-builder-apply').onclick = () => {
    const expr = builderExpression();
    if (!expr) { $('#builder-msg').textContent = 'Add at least one complete condition.'; return; }
    $('#expr').value = expr;
    $('#builder-msg').textContent = `Expression: ${expr}`;
    runScreen({ expression: expr });
  };
  $('#btn-store-refresh').onclick = () => { loadStore(); loadModels(); };
  if ($('#btn-model-install')) $('#btn-model-install').onclick = async () => {
    const el = $('#model-path');
    const p = (el.value || '').trim();
    if (!p) return toast('Enter the path to a .gguf file');
    try {
      const r = await api('/api/models/install', { method: 'POST', body: JSON.stringify({ id: el.dataset.id || 'qwen2.5-0.5b-q4', path: p }) });
      if (r.ok) { toast('Installed'); await api(`/api/models/switch/${encodeURIComponent(el.dataset.id || 'qwen2.5-0.5b-q4')}`, { method: 'POST', body: '{}' }); loadModels(); }
      else toast(r.error || 'Install failed');
    } catch (e) { toast(e.message); }
  };
  initUserFeatures();
  if ($('#btn-watch-all')) $('#btn-watch-all').onclick = addAllToWatchlist;
  if ($('#btn-watch-csv')) $('#btn-watch-csv').onclick = () => window.open(`${FIN}/api/export/watchlist.csv`, '_blank');
  if ($('#btn-copy-sym')) $('#btn-copy-sym').onclick = () => { const s = state.company && state.company.company ? state.company.company.symbol : null; if (s) copyText(s); };
  if ($('#btn-print')) $('#btn-print').onclick = () => window.print();
  showRecents();
  loadQuickFilters();
  initExtraControls();
  loadScreenHistory();
  if ($('#btn-theme')) $('#btn-theme').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    try { localStorage.setItem('atlas.theme', cur); } catch { /* ignore */ }
    toast(`${cur} theme`);
  };
  try { const saved = localStorage.getItem('atlas.theme'); if (saved) document.documentElement.setAttribute('data-theme', saved); } catch { /* ignore */ }
  if (!applyWallMode()) applyUrlScreen();
  if ($('#btn-wall')) $('#btn-wall').onclick = () => openWall(state.expression ? 'screen' : 'screen', state.expression || $('#expr').value.trim());
  $('#btn-intel-refresh').onclick = () => { loadIntel(); loadUniverse(); };
  $('#btn-universe').onclick = () => loadUniverse();
  $('#btn-corr').onclick = () => loadCorrelation();
  $('#btn-jobs-refresh').onclick = async () => { try { await api('/api/jobs/refresh', { method: 'POST', body: '{}' }); loadJobs(); } catch (e) { alert(e.message); } };
  $('#btn-jobs-drain').onclick = async () => { try { await api('/api/jobs/drain', { method: 'POST', body: '{}' }); loadJobs(); } catch (e) { alert(e.message); } };
  $('#btn-compare').onclick = () => loadCompare();
  $('#btn-news').onclick = async () => { const s = state.company && state.company.company ? state.company.company.symbol : null; if (!s) return; try { const r = await api(`/api/import/news/${encodeURIComponent(s)}`, { method: 'POST', body: '{}' }); loadNews(s); alert(`Stored ${r.stored} headline(s) from ${r.sources.join(', ') || 'no reachable feed'}`); } catch (e) { alert(e.message); } };
  $('#btn-csv-rich').onclick = () => window.open(`${FIN}/api/export/enriched.csv?expression=${encodeURIComponent($('#expr').value || 'Market Cap > 0')}`, '_blank');
  $('#btn-save-screen').onclick = async () => { const name = prompt('Name this screen:'); if (!name) return; try { await api('/api/saved-screens', { method: 'POST', body: JSON.stringify({ name, expression: $('#expr').value }) }); loadSavedScreens(); } catch (e) { alert(e.message); } };
  void (async () => {
  try {
    const mk = await api('/api/markets');
    const active = mk.active || (mk.markets || []).find((m) => m.active)?.code || null;
    if (active) { state.market = active; document.body.dataset.market = active; }
  } catch { /* the market is unknown; server defaults apply */ }
})();
wireCommandPalette();
void bootSetup().then((ready) => { if (ready) { loadSavedScreens(); loadSectors(); loadFields(); loadMarkets(); loadHealth(); } });
  if (false) loadSavedScreens();
  loadSectors();
  loadMarkets();
  loadFields();
  loadHealth();
  $('#btn-recheck').onclick = () => { $('#src-body').innerHTML = '<tr><td colspan="5" class="hint">Checking sources…</td></tr>'; loadImport(); };
  $('#btn-theme').onclick = () => savePrefs({ theme: state.prefs.theme === 'dark' ? 'light' : 'dark' });
  $('#btn-columns').onclick = () => openColumnsModal();
  $('#val-scenario').onchange = () => { const sym = state.company && state.company.company ? state.company.company.symbol : null; if (sym) loadValLab(sym, $('#val-scenario').value); };
  $('#btn-val-save').onclick = () => saveValLab();
  $('#btn-val-reset').onclick = async () => {
    const sym = state.company && state.company.company ? state.company.company.symbol : null; if (!sym) return;
    try { await api(`/api/valuation2/${encodeURIComponent(sym)}/reset`, { method: 'POST' }); await loadValLab(sym, 'base'); toastNote('Assumptions reset'); } catch (e) { toastNote(e.message); }
  };
  $('#btn-val-md').onclick = () => { const sym = state.company && state.company.company ? state.company.company.symbol : null; if (sym) window.open(`${FIN}/api/valuation2/${encodeURIComponent(sym)}/report.md`, '_blank'); };
  $('#btn-audit').onclick = () => { const s = state.company && state.company.company ? state.company.company.symbol : null; if (s) runAudit(s); };
  $('#btn-fetch-history').onclick = async () => {
    const sym = state.company && state.company.company ? state.company.company.symbol : null; if (!sym) return;
    const b = $('#btn-fetch-history'); b.textContent = 'Fetching…'; b.disabled = true;
    try {
      const r = await api(`/api/live/history/${encodeURIComponent(sym)}`, { method: 'POST' });
      await openCompany(sym);
      toastNote(`History: ${r.annual} annual + ${r.quarterly} quarterly periods`);
    } catch (e) { toastNote(e.message); }
    finally { b.textContent = 'Fetch history'; b.disabled = false; }
  };
  $('#btn-pf-add').onclick = async () => {
    try {
      await api('/api/portfolio', { method: 'POST', body: JSON.stringify({ symbol: $('#pf-sym').value.trim(), quantity: Number($('#pf-qty').value), avgCost: Number($('#pf-cost').value) }) });
      $('#pf-status').textContent = 'Added';
      $('#pf-sym').value = ''; $('#pf-qty').value = ''; $('#pf-cost').value = '';
      await loadPortfolio();
    } catch (e) { $('#pf-status').textContent = e.message; }
  };
  $('#btn-rule-add').onclick = async () => {
    try { await api('/api/alert-rules', { method: 'POST', body: JSON.stringify({ metric: $('#rule-metric').value, op: $('#rule-op').value, threshold: Number($('#rule-threshold').value) }) }); await loadRules(); }
    catch (e) { alert(e.message); }
  };
  $('#pf-body').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-pf-rm]');
    if (rm) { api(`/api/portfolio/${encodeURIComponent(rm.dataset.pfRm)}`, { method: 'DELETE' }).then(loadPortfolio); return; }
    const tr = e.target.closest('tr[data-sym]'); if (tr) openCompany(tr.dataset.sym);
  });
  $('#rules-list').addEventListener('click', (e) => {
    const tg = e.target.closest('[data-rule-toggle]');
    if (tg) { api(`/api/alert-rules/${tg.dataset.ruleToggle}/toggle`, { method: 'POST', body: JSON.stringify({ enabled: tg.dataset.on === '1' }) }).then(loadRules); return; }
    const rm = e.target.closest('[data-rule-rm]');
    if (rm) { api(`/api/alert-rules/${rm.dataset.ruleRm}`, { method: 'DELETE' }).then(loadRules); }
  });
  $('#rank-body').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-sym]'); if (tr) openCompany(tr.dataset.sym); });
  $('#watch-body').addEventListener('click', (e) => {
    const un = e.target.closest('[data-unwatch]');
    if (un) { api(`/api/watchlist/${encodeURIComponent(un.dataset.unwatch)}`, { method: 'DELETE' }).then(loadWatchlist); return; }
    const tr = e.target.closest('tr[data-sym]'); if (tr) openCompany(tr.dataset.sym);
  });
  $('#co-tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) { state.tab = b.dataset.tab; renderCompanyTab(); } });

  document.addEventListener('keydown', (e) => {
    const el = e.target;
    const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    if (!typing && !e.ctrlKey && !e.metaKey && e.key === '/') { e.preventDefault(); $('#search').focus(); }
    if (e.key === 'Escape') { $('#hits').hidden = true; }
  });
}

function toastNote(msg) { $('#notes').innerHTML = `<div class="note">${esc(msg)}</div>`; setTimeout(() => { if ($('#notes').innerHTML.includes(esc(msg))) $('#notes').innerHTML = ''; }, 2500); }

async function loadPresets() {
  try {
    const { presets } = await api('/api/presets');
    $('#presets').innerHTML = presets.map((p) => `<button data-preset="${esc(p.expression)}" title="${esc(p.idea)}">${esc(p.name)}</button>`).join('');
    $('#presets').addEventListener('click', (e) => { const b = e.target.closest('[data-preset]'); if (b) { $('#expr').value = b.dataset.preset; runScreen({ expression: b.dataset.preset }); } });
  } catch { /* ignore */ }
}

async function boot() {
  wire();
  await loadPrefs();
  renderExamples();
  loadPresets();
  await loadStats();
  await runScreen({ expression: 'Market Cap > 0' });
}

document.addEventListener('DOMContentLoaded', boot);


// The global search box must work regardless of whether wire() has run.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { try { initGlobalSearch(); } catch { /* ignore */ } });
else { try { initGlobalSearch(); } catch { /* ignore */ } }
