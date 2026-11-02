// HTTP API + static console. Dependency-free (node:http), same shape as aegis.
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import type { Db } from '../core/db';
import { Store } from '../core/store';
import { analyseCompany } from '../core/analysis';
import { parseQuery, parseQueryWithLlm } from '../core/nl';
import { FIELDS } from '../core/expr';
import { ingestFixture } from '../core/ingest';
import { deepMetrics, peerMatrix } from '../core/metrics';
import { scores } from '../core/scores';
import { PRESETS } from '../core/presets';
import { Workflow } from '../core/workflow';
import { fetchWorldBank, macroSeries, refreshQuote, importStatementCsv, WORLD_BANK_CATALOGUE, exportDatabase, importDatabase } from '../core/sources';
import { factorsFor, rankUniverse } from '../core/factors';
import { valuation } from '../core/valuation';
import { strength } from '../core/strength';
import { screenStats, sectorBenchmarks, metricSeries, SERIES_METRIC_NAMES } from '../core/analytics';
import { companyIntelligence, importIntelligence, fetchWikipediaProfile, ensureProfiles } from '../core/profile';
import { valuationReport, saveAssumptions, resetAssumptions, DEFAULT_ASSUMPTIONS, type Scenario } from '../core/valuation2';
import { Custom, ALL_COLUMNS } from '../core/custom';
import { YahooClient } from '../core/yahoo';
import { upsertLiveCompany, storePrices, priceAnalytics, marketBreadth, liveCompanies, ensureLiveTables } from '../core/live';
import { fetchAndStoreHistory, coverage } from '../core/fundamentals';
import { auditCompany } from '../core/audit';
import { coverageReport, breadth2, sectorRotation, freshness, correlationMatrix, riskProfile, investability, compare, portfolioAnalytics, watchlistDigest, totalReturn, earningsReaction } from '../core/universe';
import { Security, errorBody } from '../core/security';
import { atlasScore, explainMatch } from '../core/intel';
import { MarketManager, MARKETS, marketDef } from '../core/markets';
import { LocalLlm } from '../core/llm';
import { AiStore } from '../core/aistore';
import { ModelStore, MODEL_CATALOGUE, deviceProfile, recommendModel, detectRuntime, validateGguf, exportConfig, importConfig } from '../core/modelmanager';
import { portfolioPnl, dataFreshness, sectorCompanies, explainScreen, toCsv, bulkWatchlist, newsCount, topMovers, sectorBreadth, companyTimeline, watchlistCalendar } from '../core/userfeatures';
import { priceSeries, sparklines, sectorBars, sparkSvg } from '../core/chart';
import { computeIndicators, resample, INDICATORS, type Bar, type IndicatorId } from '../core/indicators';
import { QUICK_FILTERS, watchlistTable, removeFromWatchlist, recordScreen, screenHistory, getNote, setNote } from '../core/features2';
import { refreshLatest } from '../core/db';
import { AST_SCHEMA, AST_SYSTEM_PROMPT, ALLOWED_FIELDS, compileAst, expressionToAst } from '../core/ast';
import { researchReport, researchMarkdown } from '../core/research';
import { fetchConstituents, yahooSymbol, INDEX_SOURCES, fetchRegionUniverse, REGIONS } from '../core/universes';
import { checkAllSources, matrixWithStatus, fetchNews, listNews, SOURCES } from '../core/importers';
import { JobQueue } from '../core/jobs';
import { parseRecommendationTrend, parseMajorHolders, parseInsiderTransactions, parseEarningsTrend, parseEarningsHistory, parseCalendarEvents, parseChartExtras, storeMarketData, marketIntel, ensureMarketTables } from '../core/marketdata';
import { deep2 } from '../core/deep2';
import { syncDirectory, searchDirectory, directoryCoverage, ensureDirectory } from '../core/directory';
import { parseEdgarSubmissions, parseIpoCalendar, storePreListing, listPreListing, preListingSummary, ensurePreListing, graduateListed } from '../core/prelisting';
import { fetchEdgarSubmissions, fetchIpoCalendar } from '../core/prelistingfetch';
import { makeEvent, recordEvent, listEvents, validateWebhookUrl, ensureEvents, type FetchLike } from '../core/events';
import { fetchSecBulkManifest, syncBulkManifest, parseCompanyTickers } from '../core/bulkmanifest';
import { briefCompany, briefMarket } from '../core/briefing';
import { addEntry, listJournal, closeEntry, journalScorecard } from '../core/journal';
import { trendingSectors, rankCandidates, peerPercentiles } from '../core/discover';
import { metricHistory, earningsSurprises } from '../core/history';
import { loadSeries, backtest } from '../core/backtest';
import { corporateTimeline, insiderFlows } from '../core/corporate';
import { companyTruth, marketTruth } from '../core/datatruth';
import { companyGraph, storylines } from '../core/graph';
import { ask } from '../core/ask';
import { ADVISORS, advisorsFor, findAdvisor, runMethod, libraryCoverage, methodExpression } from '../core/advisors';
import { priceHistory, dataCoverage, type Interval } from '../core/pricehistory';
import { listStrategies, saveStrategy, deleteStrategy, recordStrategyResult, compileConditions } from '../core/strategy';
import { registrySummary, sourcesFor, SOURCE_REGISTRY } from '../core/sourceRegistry';
import { SourcePool, runWithFailover } from '../core/failover';
import { listRatios, saveRatio, deleteRatio, applyRatios, validateFormula, allowedFields, RatioError } from '../core/customRatios';
import { buildXlsx } from '../core/xlsx';
import { reverseDcf, scenarios, sensitivityGrid, marginOfSafety } from '../core/valuationDeep';
import { dcfPerShare } from '../core/valuation';
import { ownerEarnings, cashConversionCycle, dilution, commonSize, incrementalRoic, dividendSafety, reinvestmentRate } from '../core/fundamentalExtras';
import { fetchBingNews, fetchGoogleNews, fetchWorldBank as wbFetch, fetchImf, fetchWikidata, IMPLEMENTED } from '../core/adapters';
import { companyExtras, histogram, sectorBreakdown, screenDiff, similarCompanies, toTsv, capCategory, rangePosition, analystDispersion, qualityGrade, pegRatio, revenuePerEmployee, marginTrend, workingCapitalTrend, sectorAllocation, concentrationWarnings, diversificationScore, rebalanceHints, maxDrawdown, volatility } from '../core/extras';
import { RefreshScheduler } from '../core/scheduler';

export interface ServerOptions { dbFile?: string; port?: number; consoleDir?: string }

function json(res: http.ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

export function createServer(initialDb: Db, consoleDir: string, dataDir?: string): http.Server {
  // One database file per market: switching cannot leak rows between countries.
  const markets = new MarketManager(dataDir ?? path.join(process.cwd(), 'data'), 'IN');
  let db: Db = initialDb;
  let store = new Store(db.db);
  let flow = new Workflow(db.db);
  let custom = new Custom(db.db);
  const llm = new LocalLlm();
  const aiStore = new AiStore(dataDir ?? path.join(process.cwd(), 'data'));
  const models = new ModelStore(dataDir ?? path.join(process.cwd(), 'data'));
  // Auto-update: refresh the stalest live companies on a timer.
  const scheduler = new RefreshScheduler({
    refresh: async (symbol: string): Promise<boolean> => {
      const summary = await yahoo.summary(symbol);
      if (!summary) return false;
      upsertLiveCompany(db.db, summary);
      const chart = await yahoo.chart(symbol, '1mo');
      if (chart) storePrices(db.db, symbol, chart.points);
      return true;
    },
    // Self-update across EVERY market, not just the active one. Each pass takes the next
    // market in rotation, opens its own database handle, sweeps one sector, and enriches a
    // few newly discovered symbols with full company data. Because it writes through that
    // market's handle — never through db.db — nothing can cross between countries.
    maintenance: async (): Promise<{ newSymbols: number; eventsRefreshed: number; enriched?: number; market?: string }> => {
      const codes = MARKETS.map((m) => m.code);
      const market = codes[schedulerTick % codes.length] ?? 'IN';
      const sector = SECTOR_ROTATION[schedulerTick % SECTOR_ROTATION.length] ?? 'Energy';
      let sectorUsed = sector;
      schedulerTick++;
      let newSymbols = 0;
      let eventsRefreshed = 0;
      let enriched = 0;
      let handle: ReturnType<typeof markets.open> | null = null;
      try { handle = markets.open(market); } catch { return { newSymbols: 0, eventsRefreshed: 0, enriched: 0, market }; }

      // 1. discover newly listed symbols in this market
      try {
        // The previous pass may have left the source throttling, so retry before concluding
        // this market has nothing.
        let res = { total: 0, symbols: [] as Array<{ symbol: string; name: string; exchange: string }> };
        const exchanges = EXCHANGE_ROTATION[market] ?? [];
        // Exchange sweep first where the source supports it (it covers the whole market
        // without the sector gaps), then fall back to sectors.
        if (exchanges.length) {
          const ex = exchanges[schedulerTick % exchanges.length]!;
          for (let attempt = 0; attempt < 2; attempt++) {
            try { res = await yahoo.screenExchange(market.toLowerCase(), ex, 0, 50); } catch { res = { total: 0, symbols: [] }; }
            if (res.symbols.length) { sectorUsed = `exchange:${ex}`; break; }
            await new Promise((r) => setTimeout(r, 500));
          }
        }
        if (!res.symbols.length) {
          for (let offset = 0; offset < 3; offset++) {
            const sec = SECTOR_ROTATION[(schedulerTick + offset) % SECTOR_ROTATION.length] ?? sector;
            for (let attempt = 0; attempt < 2; attempt++) {
              try { res = await yahoo.screenSector(market.toLowerCase(), sec, 0, 50); } catch { res = { total: 0, symbols: [] }; }
              if (res.symbols.length) break;
              await new Promise((r) => setTimeout(r, 500));
            }
            if (res.symbols.length) { sectorUsed = sec; break; }
          }
        }
        ensureDirectory(handle.db);
        const ins = handle.db.prepare(`INSERT OR IGNORE INTO universe_symbols (market,symbol,name,sector,exchange,source,added_at) VALUES (?,?,?,?,?,?,?)`);
        for (const x of res.symbols) {
          const r = ins.run(market, x.symbol, x.name || x.symbol, sector, x.exchange || '', 'yahoo-screener', Date.now());
          if (r.changes > 0) newSymbols++;
        }
      } catch { /* network */ }

      // 2. enrich a few directory symbols that have no company record yet
      try {
        const fresh = handle.db.prepare(`
          SELECT u.symbol FROM universe_symbols u
          WHERE u.market=? AND NOT EXISTS (SELECT 1 FROM companies c WHERE UPPER(c.symbol)=UPPER(u.symbol))
          ORDER BY u.added_at DESC LIMIT 2`).all(market) as Array<{ symbol: string }>;
        for (const f of fresh) {
          try {
            const summary = await yahoo.summary(f.symbol);
            if (!summary) continue;
            upsertLiveCompany(handle.db, summary);
            const chart = await yahoo.chart(f.symbol, '1y');
            if (chart) storePrices(handle.db, f.symbol, chart.points);
            await fetchAndStoreHistory(handle.db, yahoo, f.symbol, summary.price || chart?.price || 0).catch(() => ({ annual: 0, quarterly: 0, periods: 0 }));
            enriched++;
          } catch { /* skip this symbol */ }
        }
      } catch { /* table missing */ }

      // 3. lifecycle: a priced listing that now trades is no longer upcoming
      try {
        ensurePreListing(handle.db);
        const beforeGrad = (handle.db.prepare(`SELECT ticker FROM prelisting WHERE market=? AND status='PRICED' AND ticker IS NOT NULL`).all(market) as Array<{ ticker: string }>).map((r) => r.ticker);
        const graduated = graduateListed(handle.db, market);
        if (graduated > 0) {
          const nowGrad = new Set((handle.db.prepare(`SELECT ticker FROM prelisting WHERE market=? AND status='GRADUATED'`).all(market) as Array<{ ticker: string }>).map((r) => r.ticker));
          for (const t of beforeGrad) if (nowGrad.has(t)) await fireEvent(makeEvent('TICKER_GRADUATED', t, market, `${t} has graduated to live trading`, { market }));
        }
      } catch { /* table missing */ }

      if (newSymbols > 0) await fireEvent(makeEvent('DIRECTORY_GROWTH', sectorUsed, market, `${newSymbols} new symbol(s) discovered in ${market} · ${sectorUsed}`, { market, sector: sectorUsed, newSymbols, enriched }));
      return { newSymbols, eventsRefreshed, enriched, market };
    },
    due: (limit: number): string[] => {
      try {
        return (db.db.prepare(`
          SELECT c.symbol FROM companies c
          LEFT JOIN (SELECT company_id, MAX(date) AS d FROM price_history GROUP BY company_id) p ON p.company_id = c.id
          WHERE c.source = 'yahoo'
          ORDER BY COALESCE(p.d, '') ASC LIMIT ?`).all(limit) as Array<{ symbol: string }>).map((r) => r.symbol);
      } catch { return []; }
    },
  }, 15 * 60 * 1000, 5);
  let schedulerTick = 0;
  // Yahoo returns empty results for several US sectors, so the US sweeps by exchange.
  // Exchange sweeps give complete coverage where sectors have gaps. India is absent
  // because Yahoo returns nothing for NSI/BSE — it keeps the sector sweep instead.
  const EXCHANGE_ROTATION: Record<string, string[]> = {
    US: ['NMS', 'NYQ', 'ASE', 'PCX', 'NGM', 'NCM'],
    GB: ['LSE'], JP: ['JPX'], DE: ['GER'], SG: ['SES'],
    HK: ['HKG'], AU: ['ASX'], CA: ['TOR'],
  };
  const SECTOR_ROTATION = ['Basic Materials', 'Communication Services', 'Consumer Cyclical', 'Consumer Defensive', 'Energy', 'Financial Services', 'Healthcare', 'Industrials', 'Real Estate', 'Technology', 'Utilities'];
  ensureEvents(db.db);
  const getWebhook = (): { url: string | null; secret: string | null } => {
    try {
      const u = db.db.prepare(`SELECT value FROM prefs WHERE key='webhook:url'`).get() as { value: string } | undefined;
      const k = db.db.prepare(`SELECT value FROM prefs WHERE key='webhook:secret'`).get() as { value: string } | undefined;
      return { url: u?.value ?? null, secret: k?.value ?? null };
    } catch { return { url: null, secret: null }; }
  };
  const fireEvent = async (e: ReturnType<typeof makeEvent>): Promise<void> => {
    const w = getWebhook();
    try { await recordEvent(db.db, e, { url: w.url, secret: w.secret, fetchImpl: fetch as unknown as FetchLike }); } catch { /* never break the caller */ }
  };
  // The app keeps itself current: prices, new listings and upcoming events.
  try {
    ensureDirectory(db.db);
    ensurePreListing(db.db);
    if (process.env['ATLAS_NO_AUTOUPDATE'] !== '1') scheduler.autoStart();
  } catch { /* directory unavailable */ }
  // Single source of truth for the version — the health endpoint drifted to 9.0.0
  // while package.json moved on, which is exactly the kind of lie this endpoint exists
  // to prevent.
  let APP_VERSION = '0.0.0';
  try { APP_VERSION = (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'; } catch { /* keep default */ }

  // Point at the active market's file immediately; the caller-supplied handle is only a
  // fallback. Without this, the first seed lands in a different file than the market DB.
  const activate = (code: string): void => {
    const next = markets.open(code);
    db = next;
    store = new Store(db.db);
    flow = new Workflow(db.db);
    custom = new Custom(db.db);
    ensureLiveTables(db.db);
    ensureMarketTables(db.db);
    try { markets.switch(code); } catch { /* unknown market */ }
  };
  // Only point at a market if one was chosen. Otherwise the app stays unconfigured and
  // every data route answers 428 until setup completes.
  if (markets.configured()) { try { activate(markets.active()!); } catch { /* keep the supplied handle */ } }
  const yahoo = new YahooClient();
  ensureLiveTables(db.db);
  ensureMarketTables(db.db);
  const security = new Security(db.db);
  const startedAt = Date.now();

  /** One symbol, fully refreshed — used by both the endpoint and the job queue. */
  const refreshSymbol = async (symbol: string): Promise<{ symbol: string; pricePoints: number; annual: number }> => {
    const summary = await yahoo.summary(symbol);
    if (!summary) throw new Error(`Could not fetch "${symbol}" from the live source`);
    upsertLiveCompany(db.db, summary);
    const chart = await yahoo.chart(symbol, '1y');
    const pricePoints = chart ? storePrices(db.db, symbol, chart.points) : 0;
    const history = await fetchAndStoreHistory(db.db, yahoo, symbol, summary.price || chart?.price || 0);
    const mods = await yahoo.summaryModules(symbol, 'recommendationTrend,majorHoldersBreakdown,insiderTransactions,earningsTrend,earningsHistory,calendarEvents');
    const extras = await yahoo.chartExtras(symbol, '5y');
    const parsedExtras = extras ? parseChartExtras(extras) : { dividends: [], splits: [], volumes: [] };
    storeMarketData(db.db, symbol, {
      recommendations: mods ? parseRecommendationTrend(mods) : [], holders: mods ? parseMajorHolders(mods) : null,
      insiders: mods ? parseInsiderTransactions(mods) : [], estimates: mods ? parseEarningsTrend(mods) : [],
      surprises: mods ? parseEarningsHistory(mods) : [],
      targets: { low: summary.targetLow ?? 0, mean: summary.targetMeanPrice, high: summary.targetHigh ?? 0, median: summary.targetMedian ?? summary.targetMeanPrice, recommendation: summary.recommendation, analysts: summary.analystCount ?? 0 },
      dividends: parsedExtras.dividends, volumes: parsedExtras.volumes, splits: parsedExtras.splits,
      upcoming: mods ? parseCalendarEvents(mods) : null,
    });
    return { symbol, pricePoints, annual: history.annual };
  };

  const sourcePool = new SourcePool();
  const jobs = new JobQueue(db.db, async (job) => {
    if (job.symbol) await refreshSymbol(job.symbol);
  }, { paceMs: 500 });
  jobs.recover();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;

    // ---- security headers on every response ----
    for (const [k, v] of Object.entries(Security.headers())) res.setHeader(k, v);

    // ---- rate limiting ----
    const clientKey = req.socket.remoteAddress ?? 'unknown';
    if (p.startsWith('/api/') && !security.allow(clientKey)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '10' });
      res.end(JSON.stringify({ error: 'Too many requests', code: 'RATE_LIMITED' }));
      return;
    }

    // ---- setup gate: no market chosen yet ----
    const setupExempt = p === '/api/health' || p === '/api/markets' || p.startsWith('/api/auth/') || p.startsWith('/api/setup') || p === '/api/seed' || !p.startsWith('/api/');
    if (!markets.configured() && !setupExempt) {
      res.writeHead(428, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Choose a country bundle to begin.', code: 'SETUP_REQUIRED', markets: MARKETS.map((m) => ({ code: m.code, name: m.name, flag: m.flag })) }));
      return;
    }

    // ---- authentication gate ----
    const isPublicPath = p === '/api/health' || p.startsWith('/api/auth/') || !p.startsWith('/api/');
    if (!isPublicPath && !security.isAuthorised(req.headers['authorization'] as string | undefined)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorised — unlock with your PIN', code: 'UNAUTHORISED' }));
      return;
    }

    try {
      // ---- auth, health, jobs ----
      if (p === '/api/health') {
        return json(res, 200, { ok: true, version: APP_VERSION, uptimeMs: Date.now() - startedAt, authConfigured: security.isConfigured(), jobs: jobs.stats(), db: { companies: (db.db.prepare(`SELECT COUNT(*) AS n FROM companies`).get() as { n: number }).n } });
      }
      if (p === '/api/auth/status') return json(res, 200, { configured: security.isConfigured() });
      if (p === '/api/auth/setup' && req.method === 'POST') {
        const b = (await readBody(req)) as { pin?: string; currentPin?: string };
        const r = security.setPin(String(b.pin ?? ''), b.currentPin ? String(b.currentPin) : undefined);
        return json(res, r.ok ? 200 : 400, r);
      }
      if (p === '/api/auth/unlock' && req.method === 'POST') {
        const b = (await readBody(req)) as { pin?: string };
        const r = security.unlock(String(b.pin ?? ''));
        return json(res, r.ok ? 200 : 401, r);
      }
      if (p === '/api/auth/logout' && req.method === 'POST') { security.logout(req.headers['authorization'] as string | undefined); return json(res, 200, { ok: true }); }
      if (p === '/api/auth/remove' && req.method === 'POST') {
        const b = (await readBody(req)) as { pin?: string };
        const r = security.removePin(String(b.pin ?? ''));
        return json(res, r.ok ? 200 : 400, r);
      }
      // ---- markets & on-device model ----
      if (p === '/api/markets') return json(res, 200, { active: markets.active(), configured: markets.configured(), markets: markets.list() });
      if (p === '/api/setup/status') return json(res, 200, { configured: markets.configured(), active: markets.active(), markets: MARKETS });
      if (p === '/api/setup/complete' && req.method === 'POST') {
        const b = (await readBody(req)) as { code?: string };
        const def = marketDef(String(b.code ?? ''));
        if (!def) return json(res, 400, { error: `Unknown market "${b.code}"` });
        activate(def.code);
        return json(res, 200, { configured: true, active: markets.active(), market: def, readiness: markets.readiness(def.code) });
      }
      // ---- full-market symbol directory (every listed symbol, data on demand) ----
      // ---- auto-update scheduler ----
      if (p === '/api/refresh/status') return json(res, 200, scheduler.getStatus());
      if (p === '/api/refresh/autostart' && req.method === 'POST') return json(res, 200, scheduler.autoStart());
      if (p === '/api/refresh/start' && req.method === 'POST') return json(res, 200, scheduler.start());
      if (p === '/api/refresh/stop' && req.method === 'POST') return json(res, 200, scheduler.stop());
      if (p === '/api/refresh/now' && req.method === 'POST') return json(res, 200, await scheduler.tick());
      if (p === '/api/refresh/config' && req.method === 'POST') {
        const b = (await readBody(req)) as { intervalMs?: number; batch?: number; maintenanceEvery?: number };
        scheduler.configure(Number(b.intervalMs ?? 900000), Number(b.batch ?? 5), b.maintenanceEvery === undefined ? undefined : Number(b.maintenanceEvery));
        return json(res, 200, scheduler.getStatus());
      }
      // ---- pre-listing (pre-IPO) discovery ----
      // ---- event log + webhook ----
      // ---- universal bulk manifest (US only: SEC's file is US registrants) ----
      if (p === '/api/bulk/status') {
        const market = markets.active() ?? 'IN';
        // Every market has a bulk strategy; only the source differs.
        return json(res, 200, {
          market, supportsBulk: true,
          primary: market === 'US' ? 'sec-manifest' : 'sector-walk',
          sources: market === 'US' ? ['sec-manifest', 'sector-walk'] : ['sector-walk'],
          note: market === 'US'
            ? 'SEC company_tickers.json, falling back to the sector screener'
            : 'sector screener across all 11 sectors (no regulator bulk file is published for this market)',
        });
      }
      if (p === '/api/bulk/sync' && req.method === 'POST') {
        const market = markets.active() ?? 'IN';
        // US has a regulator manifest; every other market is swept by sector. Both paths
        // write only through the active market handle, so neither can cross markets.
        if (market === 'US') {
          const contact = process.env['ATLAS_SEC_CONTACT'] ?? 'Atlas research atlas@example.com';
          const r = await fetchSecBulkManifest({ contact, fetchImpl: fetch as unknown as never });
          if (r.ok) {
            const res2 = syncBulkManifest(db.db, market, r.entries, 'Unclassified', r.manifestMarket);
            if (!res2.error) {
              await fireEvent(makeEvent('DIRECTORY_GROWTH', 'BULK', market, `SEC manifest: ${res2.added} new symbol(s)`, { scanned: res2.scanned, added: res2.added }));
              return json(res, 200, { ...res2, source: 'sec-manifest' });
            }
          }
          // Fall through to the sector sweep rather than failing the feature.
          const fb = await syncDirectory(db.db, market, market.toLowerCase(), (reg: string, sec: string, off: number, size: number) => yahoo.screenSector(reg, sec, off, size), (reg: string, sec: string, lo: number, hi: number, off: number, size: number) => yahoo.screenSectorBracket(reg, sec, lo, hi, off, size), { pageSize: 50, maxPagesPerSector: 24 });
          return json(res, 200, { ...fb, source: 'sector-walk', note: `SEC manifest unavailable (${r.error}); used the sector sweep instead.` });
        }
        const r = await syncDirectory(db.db, market, market.toLowerCase(), (reg: string, sec: string, off: number, size: number) => yahoo.screenSector(reg, sec, off, size), (reg: string, sec: string, lo: number, hi: number, off: number, size: number) => yahoo.screenSectorBracket(reg, sec, lo, hi, off, size), { pageSize: 50, maxPagesPerSector: 24 });
        await fireEvent(makeEvent('DIRECTORY_GROWTH', 'BULK', market, `Sector sweep: ${r.symbols} symbol(s) in directory`, { inserted: r.inserted }));
        return json(res, 200, { ...r, source: 'sector-walk' });
      }
      // ---- bulk enrichment: give directory symbols their full company data ----
      // ---- extras: derived analytics and screener analysis ----
      if (p.startsWith('/api/extras/')) {
        const sym = decodeURIComponent(p.slice('/api/extras/'.length));
        const row = db.db.prepare(`SELECT * FROM v_latest WHERE UPPER(symbol)=UPPER(?)`).get(sym) as Record<string, number> | undefined;
        if (!row) return json(res, 404, { error: 'No such company in this market' });
        const meta = db.db.prepare(`SELECT employees FROM live_meta WHERE company_id=(SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?))`).get(sym) as { employees: number | null } | undefined;
        const withEmp = { ...row, employees: meta?.employees ?? 0 };
        const x = companyExtras(withEmp) as Record<string, unknown>;
        // Remaining company-level functions — wired so none sit unused.
        x['pegRatio'] = pegRatio(Number(row['pe'] ?? 0), Number(row['profit_growth_3y'] ?? 0));
        x['revenuePerEmployee'] = revenuePerEmployee(Number(row['sales'] ?? 0), meta?.employees ?? 0);
        const ops = db.db.prepare(`SELECT opm FROM ratios WHERE company_id=(SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)) ORDER BY period_end ASC LIMIT 5`).all(sym) as Array<{ opm: number }>;
        x['marginTrend'] = ops.length >= 2 ? marginTrend(ops.map((o) => o.opm ?? 0)) : null;
        const cr = db.db.prepare(`SELECT current_ratio FROM ratios WHERE company_id=(SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)) ORDER BY period_end ASC LIMIT 5`).all(sym) as Array<{ current_ratio: number }>;
        x['workingCapitalTrend'] = cr.length >= 2 ? workingCapitalTrend(cr.map((v) => v.current_ratio ?? 0), cr.map(() => 1)) : null;
        return json(res, 200, { symbol: sym, extras: x });
      }
      // ---- morning briefing: a written account, composed from stored numbers ----
      // ---- decision journal: record the reasoning, then grade it ----
      // ---- discovery: sector trends and ranked candidates ----
      // ---- data sources: the catalogue, per type and per market ----
      // ---- adapters: what is really implemented, and live fetch through failover ----
      if (p === '/api/adapters') {
        return json(res, 200, { implemented: IMPLEMENTED, health: sourcePool.status() });
      }
      if (p === '/api/fetch/news') {
        const q = url.searchParams.get('q') ?? '';
        if (!q) return json(res, 400, { error: 'q is required' });
        const r = await runWithFailover('news', async (src) => {
          if (src.id === 'google-news') return await fetchGoogleNews(q);
          if (src.id === 'bing-news') return await fetchBingNews(q);
          return null;
        }, sourcePool, { market: markets.active() ?? 'IN', retries: 1 });
        return json(res, 200, { ok: r.ok, source: r.sourceId, reason: r.reason, count: Array.isArray(r.value) ? r.value.length : 0, data: r.value, attempts: r.attempts });
      }
      if (p === '/api/fetch/macro') {
        const country = url.searchParams.get('country') ?? (markets.active() === 'IN' ? 'IN' : 'US');
        const r = await runWithFailover('macro', async (src) => {
          if (src.id === 'worldbank') return await wbFetch(country);
          if (src.id === 'imf') return await fetchImf('NGDP_RPCH', country === 'IN' ? 'IND' : country);
          return null;
        }, sourcePool, { market: markets.active() ?? 'IN', retries: 1 });
        return json(res, 200, { ok: r.ok, source: r.sourceId, reason: r.reason, points: Array.isArray(r.value) ? r.value.length : 0, data: r.value, attempts: r.attempts });
      }
      if (p === '/api/fetch/profile') {
        const name = url.searchParams.get('name') ?? '';
        if (!name) return json(res, 400, { error: 'name is required' });
        const r = await runWithFailover('profile', async (src) => {
          if (src.id === 'wikidata') return await fetchWikidata(name);
          return null;
        }, sourcePool, { market: markets.active() ?? 'IN', retries: 1 });
        return json(res, 200, { ok: r.ok, source: r.sourceId, reason: r.reason, data: r.value, attempts: r.attempts });
      }
      if (p === '/api/sources') {
        return json(res, 200, {
          total: SOURCE_REGISTRY.length,
          byKind: registrySummary(),
          health: sourcePool.status(),
        });
      }
      if (p.startsWith('/api/sources/')) {
        const kind = decodeURIComponent(p.slice('/api/sources/'.length)) as never;
        const market = url.searchParams.get('market') ?? markets.active() ?? 'IN';
        return json(res, 200, { kind, market, sources: sourcesFor(kind, market) });
      }
      // ---- peer percentile ranking ----
      // ---- multi-year metric history and trend ----
      // ---- strategy backtest over stored price history ----
      if (p === '/api/backtest') {
        const q = (k: string, d: number): number => Number(url.searchParams.get(k) ?? d);
        const series = loadSeries(db.db);
        const r = backtest(series, {
          lookbackDays: q('lookback', 120), topN: q('top', 10),
          rebalanceDays: q('rebalance', 21), costPct: q('cost', 0.25),
        });
        return json(res, 200, r);
      }
      if (p.startsWith('/api/history/')) {
        const sym = decodeURIComponent(p.slice('/api/history/'.length));
        const h = metricHistory(db.db, sym);
        if (!h) return json(res, 404, { error: 'No statements stored for this company' });
        return json(res, 200, { ...h, earningsSurprises: earningsSurprises(db.db, sym) });
      }
      if (p.startsWith('/api/peer-percentiles/')) {
        const sym = decodeURIComponent(p.slice('/api/peer-percentiles/'.length));
        const r = peerPercentiles(db.db, sym);
        return r ? json(res, 200, { symbol: sym, ...r }) : json(res, 404, { error: 'No such company in this market' });
      }
      if (p === '/api/discover/sectors') {
        return json(res, 200, { market: markets.active() ?? 'IN', sectors: trendingSectors(db.db) });
      }
      if (p === '/api/discover/recommendations') {
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 8), 1), 25);
        return json(res, 200, {
          market: markets.active() ?? 'IN',
          candidates: rankCandidates(db.db, limit),
          note: 'Ranked by how well independent dimensions agree, with contradiction penalised. Research, not advice.',
        });
      }
      if (p === '/api/journal' && req.method === 'GET') {
        const market = markets.active() ?? 'IN';
        const entries = listJournal(db.db, market);
        return json(res, 200, { market, entries, scorecard: journalScorecard(entries) });
      }
      if (p === '/api/journal' && req.method === 'POST') {
        const b = (await readBody(req)) as { symbol?: string; action?: string; thesis?: string; expectation?: string; horizonDays?: number; confidence?: number };
        const symbol = String(b.symbol ?? '').trim();
        const thesis = String(b.thesis ?? '').trim();
        if (!symbol) return json(res, 400, { error: 'symbol is required' });
        if (thesis.length < 10) return json(res, 400, { error: 'Write at least a sentence of reasoning — that is the whole point of the journal.' });
        const row = db.db.prepare(`SELECT price FROM v_latest WHERE UPPER(symbol)=UPPER(?)`).get(symbol) as { price: number } | undefined;
        const id = addEntry(db.db, {
          market: markets.active() ?? 'IN', symbol, action: String(b.action ?? 'buy'), thesis,
          expectation: String(b.expectation ?? 'up'), horizonDays: Number(b.horizonDays ?? 90),
          priceAtEntry: row?.price ?? 0, confidence: Number(b.confidence ?? 3),
        });
        return json(res, 200, { id, ok: true });
      }
      if (p.startsWith('/api/journal/close/') && req.method === 'POST') {
        const id = Number(decodeURIComponent(p.slice('/api/journal/close/'.length)));
        const b = (await readBody(req)) as { price?: number; note?: string };
        const ok = closeEntry(db.db, id, Number(b.price ?? 0), String(b.note ?? ''));
        return json(res, ok ? 200 : 404, ok ? { ok } : { error: 'No open entry with that id' });
      }
      if (p === '/api/briefing') {
        const market = markets.active() ?? 'IN';
        return json(res, 200, briefMarket(db.db, market));
      }
      if (p.startsWith('/api/briefing/')) {
        const sym = decodeURIComponent(p.slice('/api/briefing/'.length));
        const b = briefCompany(db.db, sym, markets.active() ?? 'IN');
        return b ? json(res, 200, b) : json(res, 404, { error: 'No such company in this market' });
      }
      if (p === '/api/screen/analysis' && req.method === 'POST') {
        const b = (await readBody(req)) as { expression?: string; limit?: number; previous?: string[] };
        const store = new Store(db.db);
        const res2 = store.screener(String(b.expression ?? 'Market Cap > 0'), { limit: Number(b.limit ?? 500) });
        const rows = (res2.rows ?? []) as unknown as Array<Record<string, unknown>>;
        const caps = rows.map((r) => Number(r['marketCap'] ?? 0)).filter((v) => v > 0);
        const symbols = rows.map((r) => String(r['symbol']));
        return json(res, 200, {
          count: rows.length,
          histogram: histogram(caps, 6),
          sectors: sectorBreakdown(rows as Array<{ sector?: string }>),
          diff: Array.isArray(b.previous) ? screenDiff(b.previous, symbols) : null,
          categories: rows.reduce((acc: Record<string, number>, r) => {
            const c = capCategory(Number(r['marketCap'] ?? 0));
            acc[c] = (acc[c] ?? 0) + 1;
            return acc;
          }, {}),
        });
      }
      // ---- custom ratios: user-defined metrics that behave like built-ins ----
      // ---- deep fundamentals: capital allocation and earnings quality ----
      // ---- reverse DCF and scenario analysis ----
      if (p.startsWith('/api/valuation-deep/')) {
        const sym = decodeURIComponent(p.slice('/api/valuation-deep/'.length));
        const c = db.db.prepare(`SELECT id, symbol, name FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(sym) as { id: number; symbol: string; name: string } | undefined;
        if (!c) return json(res, 404, { error: 'No such company in this market' });
        const row = db.db.prepare(`SELECT price, market_cap FROM v_latest WHERE id=?`).get(c.id) as { price: number; market_cap: number } | undefined;
        const st = db.db.prepare(`SELECT cfo, cfi, net_profit FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end DESC LIMIT 1`).get(c.id) as { cfo: number; cfi: number; net_profit: number } | undefined;
        if (!row || !st) return json(res, 404, { error: 'No price or statements stored for this company' });
        const price = Number(row.price) || 0;
        const shares = price > 0 && row.market_cap > 0 ? (Number(row.market_cap) * 1e7) / price : 0;
        // statements are in ₹ crore; shares are in units, so the numerator must be scaled.
        const fcfCr = Number(st.cfo) - Math.abs(Number(st.cfi));
        const fcfPerShare = shares > 0 ? (fcfCr * 1e7) / shares : 0;
        const assumptions = { discountPct: 12, terminalGrowthPct: 4, years: 10, growthPct: 10 };
        const rev = reverseDcf(price, fcfPerShare, assumptions);
        const sc = scenarios(fcfPerShare, assumptions);
        const bear = sc.find((x) => x.name === 'bear')?.value ?? null;
        const baseV = sc.find((x) => x.name === 'base')?.value ?? null;
        const bull = sc.find((x) => x.name === 'bull')?.value ?? null;
        return json(res, 200, {
          symbol: c.symbol, name: c.name, price,
          freeCashFlowPerShare: Math.round(fcfPerShare * 100) / 100,
          reverseDcf: rev, scenarios: sc,
          sensitivity: sensitivityGrid(fcfPerShare, assumptions),
          marginOfSafety: marginOfSafety(price, bear, baseV, bull),
          assumptions, note: 'Free cash flow per share = (operating cash flow − |investing cash flow|) ÷ shares. Assumptions are stated, not hidden.',
        });
      }
      if (p.startsWith('/api/fundamentals/')) {
        const sym = decodeURIComponent(p.slice('/api/fundamentals/'.length));
        const c = db.db.prepare(`SELECT id, symbol, name FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(sym) as { id: number; symbol: string; name: string } | undefined;
        if (!c) return json(res, 404, { error: 'No such company in this market' });
        // Raw line items live in `statements`; `ratios` holds only computed ratios.
        const periods = db.db.prepare(`SELECT * FROM statements WHERE company_id=? AND period_type='annual' ORDER BY period_end ASC`).all(c.id) as Array<Record<string, number>>;
        if (!periods.length) return json(res, 404, { error: 'No statements stored for this company' });
        const last = periods[periods.length - 1]!; const prev = periods[periods.length - 2];
        const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

        const sales = n(last['sales']); const netProfit = n(last['net_profit']); const cfo = n(last['cfo']);
        const depreciation = n(last['depreciation']);
        // Capex has no column of its own; cash flow from investing is negative for spend.
        const capex = Math.abs(n(last['cfi']));
        const wc = (r: Record<string, number>): number => n(r['receivables']) + n(r['inventory']) - n(r['payables']);
        const wcChange = prev ? wc(last) - wc(prev) : 0;

        const equity = n(last['equity_capital']) + n(last['reserves']);
        const debt = n(last['borrowings']); const cash = n(last['cash']);
        const nopat = n(last['operating_profit']) * 0.75;
        const invested = equity + debt - cash;
        const nopatPrior = prev ? n(prev['operating_profit']) * 0.75 : 0;
        const investedPrior = prev ? n(prev['equity_capital']) + n(prev['reserves']) + n(prev['borrowings']) - n(prev['cash']) : 0;
        const dividendsPaid = n(last['cfo']) > 0 && n(last['cff']) < 0 ? Math.abs(n(last['cff'])) * 0.3 : 0;

        return json(res, 200, {
          symbol: c.symbol, name: c.name, periods: periods.length,
          ownerEarnings: ownerEarnings({ netProfit, depreciation, capex, workingCapitalChange: wcChange }),
          cashConversionCycle: cashConversionCycle({
            receivables: n(last['receivables']), inventory: n(last['inventory']),
            payables: n(last['payables']), sales, cogs: Math.max(1, sales - n(last['operating_profit'])),
          }),
          dilution: periods.length >= 2 ? dilution(periods.map((x) => n(x['equity_capital']))) : null,
          incrementalRoic: prev ? incrementalRoic({ nopatNow: nopat, nopatPrior, investedNow: invested, investedPrior }) : null,
          dividendSafety: dividendSafety({ dividendsPaid, freeCashFlow: cfo - capex, netProfit }),
          reinvestmentRate: reinvestmentRate({ capex, workingCapitalChange: wcChange, depreciation, nopat }),
          commonSize: commonSize([
            { label: 'Sales', value: sales },
            { label: 'Operating profit', value: n(last['operating_profit']) },
            { label: 'Net profit', value: netProfit },
            { label: 'Operating cash flow', value: cfo },
          ], sales),
          note: 'Capex is taken as the absolute value of cash flow from investing; dividends are estimated from financing outflow.',
        });
      }
      if (p === '/api/ratios' && req.method === 'GET') {
        return json(res, 200, { ratios: listRatios(db.db), fields: allowedFields() });
      }
      if (p === '/api/ratios' && req.method === 'POST') {
        const b = (await readBody(req)) as { name?: string; formula?: string; unit?: string; note?: string };
        try {
          const id = saveRatio(db.db, String(b.name ?? ''), String(b.formula ?? ''), b.unit, b.note);
          return json(res, 200, { ok: true, id });
        } catch (e) {
          return json(res, 400, { error: e instanceof RatioError ? e.message : 'Could not save the ratio' });
        }
      }
      if (p === '/api/ratios/validate' && req.method === 'POST') {
        const b = (await readBody(req)) as { formula?: string };
        return json(res, 200, validateFormula(String(b.formula ?? '')));
      }
      if (p.startsWith('/api/ratios/') && req.method === 'DELETE') {
        const id = Number(decodeURIComponent(p.slice('/api/ratios/'.length)));
        return json(res, deleteRatio(db.db, id) ? 200 : 404, { ok: true });
      }
      // ---- xlsx export ----
      if (p === '/api/export/xlsx' && req.method === 'POST') {
        const b = (await readBody(req)) as { rows?: Array<Record<string, unknown>>; name?: string };
        const rows = Array.isArray(b.rows) ? b.rows : [];
        if (!rows.length) return json(res, 400, { error: 'No rows to export' });
        const header = Object.keys(rows[0]!);
        const body = rows.map((r) => header.map((h) => { const v = r[h]; return typeof v === 'number' || typeof v === 'string' ? v : v === null || v === undefined ? null : String(v); }));
        const buf = buildXlsx([{ name: (b.name ?? 'Atlas').slice(0, 31), header, rows: body }]);
        res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="atlas-export.xlsx"' });
        res.end(buf); return;
      }
      if (p === '/api/export/tsv' && req.method === 'POST') {
        const b = (await readBody(req)) as { rows?: Array<Record<string, unknown>> };
        res.writeHead(200, { 'Content-Type': 'text/tab-separated-values; charset=utf-8' });
        res.end(toTsv(Array.isArray(b.rows) ? b.rows : [])); return;
      }
      if (p === '/api/enrich/status') {
        const market = markets.active() ?? 'IN';
        const st = jobs.stats();
        const cov = directoryCoverage(db.db, market);
        return json(res, 200, {
          market, queued: st['pending'] ?? 0, running: st['running'] ?? 0, done: st['done'] ?? 0, failed: st['failed'] ?? 0,
          listed: cov.listed, enriched: cov.ingested,
          remaining: Math.max(0, cov.listed - cov.ingested),
          pct: cov.pct,
        });
      }
      if (p === '/api/enrich/queue' && req.method === 'POST') {
        const market = markets.active() ?? 'IN';
        const b = (await readBody(req)) as { count?: number };
        const want = Math.min(Math.max(Number(b.count ?? 50), 1), 500);
        // A market that has never synced has no directory table yet.
        ensureDirectory(db.db);
        // Only symbols in THIS market's directory that have no company record yet.
        const rows = db.db.prepare(`
          SELECT u.symbol FROM universe_symbols u
          WHERE u.market=? AND NOT EXISTS (SELECT 1 FROM companies c WHERE UPPER(c.symbol)=UPPER(u.symbol))
          ORDER BY u.added_at DESC LIMIT ?`).all(market, want) as Array<{ symbol: string }>;
        const queued = jobs.enqueueMany('refresh', rows.map((r) => r.symbol));
        jobs.start(2000);
        return json(res, 200, { market, requested: want, queued, remaining: Math.max(0, rows.length - queued) });
      }
      if (p === '/api/events') return json(res, 200, { events: listEvents(db.db, Number(url.searchParams.get('limit') ?? 50)) });
      if (p === '/api/webhook' && req.method === 'GET') {
        const w = getWebhook();
        return json(res, 200, { url: w.url, secretSet: !!w.secret });
      }
      if (p === '/api/webhook' && req.method === 'POST') {
        const b = (await readBody(req)) as { url?: string; secret?: string };
        const raw = String(b.url ?? '').trim();
        if (!raw) {
          db.db.prepare(`DELETE FROM prefs WHERE key IN ('webhook:url','webhook:secret')`).run();
          return json(res, 200, { ok: true, cleared: true });
        }
        const v = validateWebhookUrl(raw);
        if (!v.ok) return json(res, 400, { error: v.reason });
        const now = Date.now();
        db.db.prepare(`INSERT INTO prefs (key,value,updated_at) VALUES ('webhook:url',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(v.url!, now);
        if (b.secret) db.db.prepare(`INSERT INTO prefs (key,value,updated_at) VALUES ('webhook:secret',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(String(b.secret), now);
        return json(res, 200, { ok: true, url: v.url });
      }
      if (p === '/api/prelisting/summary') return json(res, 200, preListingSummary(db.db, markets.active() ?? 'IN'));
      if (p === '/api/prelisting') {
        const st = url.searchParams.get('status') as 'FILED' | 'PRICED' | 'WITHDRAWN' | null;
        return json(res, 200, { market: markets.active() ?? 'IN', rows: listPreListing(db.db, markets.active() ?? 'IN', st ?? undefined, Number(url.searchParams.get('limit') ?? 100)) });
      }
      if (p === '/api/prelisting/sync' && req.method === 'POST') {
        const market = markets.active() ?? 'IN';
        const contact = process.env['ATLAS_SEC_CONTACT'] ?? 'Atlas research atlas@example.com';
        const results: Array<{ source: string; ok: boolean; items: number; error: string | null }> = [];
        // EDGAR: a single submissions feed needs a CIK. The full-market sweep is done by
        // the maintenance pass over known filers; here we refresh a supplied CIK if given.
        const b = (await readBody(req)) as { cik?: string; ipoUrl?: string; ipoKey?: string };
        if (b.cik) {
          const r = await fetchEdgarSubmissions(String(b.cik), { contact, fetchImpl: fetch as unknown as never });
          results.push({ source: 'sec-edgar', ok: r.ok, items: r.items.length, error: r.error });
          if (r.items.length) storePreListing(db.db, market, r.items);
        }
        if (b.ipoUrl) {
          const r = await fetchIpoCalendar(String(b.ipoUrl), { apiKey: b.ipoKey ?? process.env['ATLAS_IPO_KEY'], fetchImpl: fetch as unknown as never });
          results.push({ source: 'ipo-calendar', ok: r.ok, items: r.items.length, error: r.error });
          if (r.items.length) storePreListing(db.db, market, r.items);
        }
        const graduated = graduateListed(db.db, market);
        return json(res, 200, {
          market, results, graduated,
          note: results.length
            ? 'Supply ?cik= or an ipoUrl to pull a specific feed.'
            : 'Nothing fetched: pass { cik } for an SEC submissions feed or { ipoUrl } for an IPO calendar. SEC requires ATLAS_SEC_CONTACT in the User-Agent.',
        });
      }
      if (p === '/api/directory/coverage') return json(res, 200, directoryCoverage(db.db, markets.active() ?? 'IN'));
      if (p === '/api/directory/search') {
        const q = url.searchParams.get('q') ?? '';
        return json(res, 200, { query: q, results: searchDirectory(db.db, markets.active() ?? 'IN', q, Number(url.searchParams.get('limit') ?? 20)) });
      }
      if (p.startsWith('/api/directory/sync/') && req.method === 'POST') {
        const code = decodeURIComponent(p.slice('/api/directory/sync/'.length)).toUpperCase();
        const def = marketDef(code);
        if (!def) return json(res, 404, { error: `Unknown market "${code}"` });
        // db.db is the ACTIVE market's handle. Writing another market's symbols through it
        // would contaminate this database, so require an explicit switch first.
        const active = markets.active() ?? 'IN';
        if (code !== active) {
          return json(res, 409, {
            error: `This would write ${code} symbols into the ${active} database. Switch to ${code} first.`,
            requested: code, active,
          });
        }
        const region = code.toLowerCase();
        const r = await syncDirectory(db.db, code, region, (reg: string, sec: string, off: number, size: number) => yahoo.screenSector(reg, sec, off, size), (reg: string, sec: string, lo: number, hi: number, off: number, size: number) => yahoo.screenSectorBracket(reg, sec, lo, hi, off, size), { pageSize: 50, maxPagesPerSector: 24 });
        return json(res, 200, r);
      }
      if (p === '/api/universe/sources') return json(res, 200, { sources: Object.values(INDEX_SOURCES), regions: REGIONS });
      if (p.startsWith('/api/universe/region/')) {
        const code = decodeURIComponent(p.slice('/api/universe/region/'.length)).toUpperCase();
        const limit = Number(url.searchParams.get('limit') ?? 500);
        const r = await fetchRegionUniverse(code, { limit, client: yahoo });
        return json(res, r.list.length ? 200 : 502, { market: r.market, total: r.total, returned: r.list.length, error: r.error ?? null, constituents: r.list });
      }
      if (p.startsWith('/api/universe/constituents/')) {
        const code = decodeURIComponent(p.slice('/api/universe/constituents/'.length)).toUpperCase();
        const r = await fetchConstituents(code);
        return json(res, r.list.length ? 200 : 502, { market: r.market, indexName: r.indexName, count: r.list.length, source: r.source, error: r.error ?? null, constituents: r.list });
      }
      if (p.startsWith('/api/universe/sync/') && req.method === 'POST') {
        const code = decodeURIComponent(p.slice('/api/universe/sync/'.length)).toUpperCase();
        const def = marketDef(code);
        if (!def) return json(res, 404, { error: `Unknown market "${code}"` });
        const r = await fetchConstituents(code);
        if (!r.list.length) return json(res, 502, { error: r.error ?? 'no constituents', market: code });
        // Queue each constituent as a fetch job for THIS market only.
        const syms = r.list.map((c) => yahooSymbol(def, c.symbol));
        const queued = jobs.enqueueMany('refresh', syms);
        return json(res, 200, { market: code, indexName: r.indexName, constituents: syms.length, queued, note: 'Jobs run against the active market database; switch to this market first to store them.' });
      }
      if (p.startsWith('/api/markets/readiness/')) {
        try { return json(res, 200, markets.readiness(decodeURIComponent(p.slice('/api/markets/readiness/'.length)))); }
        catch (e) { return json(res, 404, { error: e instanceof Error ? e.message : 'unknown market' }); }
      }
      if (p === '/api/markets/switch' && req.method === 'POST') {
        const b = (await readBody(req)) as { code?: string };
        const def = marketDef(String(b.code ?? ''));
        if (!def) return json(res, 400, { error: `Unknown market "${b.code}"` });
        activate(def.code);
        return json(res, 200, { active: markets.active(), market: def });
      }
      if (p.startsWith('/api/markets/bundle/')) {
        const code = decodeURIComponent(p.slice('/api/markets/bundle/'.length));
        try { return json(res, 200, markets.bundle(code)); } catch (e) { return json(res, 404, { error: e instanceof Error ? e.message : 'unknown market' }); }
      }
      if (p === '/api/llm/status') return json(res, 200, await llm.status());
      if (p === '/api/store') {
        const st = await llm.status();
        return json(res, 200, { packs: aiStore.list(db.db, st.available), installed: aiStore.installedFeatures(db.db) });
      }
      if (p === '/api/store/install' && req.method === 'POST') {
        const b = (await readBody(req)) as { id?: string; path?: string };
        const r = aiStore.install(db.db, String(b.id ?? ''), b.path ? String(b.path) : undefined);
        return json(res, r.ok ? 200 : 409, r);
      }
      if (p === '/api/store/uninstall' && req.method === 'POST') {
        const b = (await readBody(req)) as { id?: string };
        return json(res, 200, { ok: aiStore.uninstall(db.db, String(b.id ?? '')) });
      }
      if (p === '/api/llm/ask' && req.method === 'POST') {
        const b = (await readBody(req)) as { symbol?: string; question?: string };
        if (!b.symbol || !b.question) return json(res, 400, { error: 'symbol and question are required' });
        return json(res, 200, await llm.answer(db.db, String(b.symbol), String(b.question)));
      }

      // ---- data import: sources, feature matrix, news ----
      if (p === '/api/import/sources') return json(res, 200, { sources: await checkAllSources() });
      if (p === '/api/import/matrix') return json(res, 200, { matrix: await matrixWithStatus() });
      if (p === '/api/import/catalogue') return json(res, 200, { sources: SOURCES });
      if (p.startsWith('/api/import/news/') && req.method === 'POST') {
        const sym = decodeURIComponent(p.slice('/api/import/news/'.length));
        const c = db.db.prepare(`SELECT name FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(sym) as { name: string } | undefined;
        if (!c) return json(res, 404, { error: 'No such company' });
        return json(res, 200, await fetchNews(db.db, sym, c.name));
      }
      if (p.startsWith('/api/news/')) return json(res, 200, { items: listNews(db.db, decodeURIComponent(p.slice('/api/news/'.length))) });

      if (p === '/api/jobs') return json(res, 200, jobs.stats());
      if (p === '/api/jobs/refresh' && req.method === 'POST') {
        const b = (await readBody(req)) as { symbols?: string[] };
        const symbols = Array.isArray(b.symbols) && b.symbols.length ? b.symbols : liveCompanies(db.db, 25).map((c) => c.symbol);
        return json(res, 200, { queued: jobs.enqueueMany('refresh', symbols) });
      }
      if (p === '/api/jobs/drain' && req.method === 'POST') return json(res, 200, await jobs.drain());

      // ---- Android / TWA verification file ----
      // A Trusted Web Activity only runs without a browser bar when this file proves
      // the app and the site are the same owner.
      if (p === '/.well-known/assetlinks.json') {
        const candidates = [
          path.join(process.cwd(), 'packaging', 'android', 'assetlinks.json'),
          path.join(consoleDir, '..', '..', 'packaging', 'android', 'assetlinks.json'),
        ];
        const found = candidates.find((f) => fs.existsSync(f));
        if (found) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
          res.end(fs.readFileSync(found));
          return;
        }
        return json(res, 404, {
          error: 'assetlinks.json not generated yet',
          hint: 'Run scripts/sign-apk.sh to create a keystore, then copy packaging/android/assetlinks.template.json to assetlinks.json and insert the SHA-256 fingerprint.',
        });
      }

      // ---- static console ----
      if (req.method === 'GET' && (p === '/' || p.startsWith('/console') || (!p.startsWith('/api/') && path.extname(p) !== ''))) {
        // Serve the app shell and its assets by relative path too, so a webview or
        // packager that loads "./styles.css" / "./icons/…" gets the real file.
        const rel = p === '/' ? 'index.html' : p.replace(/^\/console\/?/, '').replace(/^\//, '') || 'index.html';
        const safeRel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
        const file = path.join(consoleDir, safeRel);
        if (fs.existsSync(file)) {
          // A manifest must be served as a manifest type or packagers reject it.
          const base = path.basename(file);
          const type = base === 'manifest.json' ? 'application/manifest+json'
            : base === 'service-worker.js' ? 'text/javascript; charset=utf-8'
            : (MIME[path.extname(file)] ?? 'application/octet-stream');
          res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
          res.end(fs.readFileSync(file));
          return;
        }
        json(res, 404, { error: 'Console asset not found' });
        return;
      }

      // ---- API ----
      if (p === '/api/health') return json(res, 200, { ok: true, schema: '1', version: '1.0.0' });
      if (p === '/api/stats') return json(res, 200, store.stats());
      if (p === '/api/sectors') return json(res, 200, { sectors: store.sectors() });
      if (p === '/api/sectors/summary') {
        const rows = db.db.prepare(`
          SELECT sector, COUNT(*) AS companies,
                 ROUND(AVG(pe),1) AS avgPe, ROUND(AVG(roe),1) AS avgRoe,
                 ROUND(AVG(opm),1) AS avgOpm, ROUND(AVG(debt_to_equity),2) AS avgDe,
                 SUM(market_cap) AS marketCap
          FROM v_latest GROUP BY sector ORDER BY companies DESC`).all() as Array<Record<string, unknown>>;
        const total = rows.reduce((a: number, r) => a + Number(r['companies'] ?? 0), 0);
        return json(res, 200, {
          market: markets.active(), total,
          sectors: rows.map((r) => ({ ...r, pct: total ? Math.round((Number(r['companies'] ?? 0) / total) * 1000) / 10 : 0 })),
        });
      }
      if (p === '/api/fields') return json(res, 200, { fields: FIELDS });

      if (p === '/api/search') {
        const q = url.searchParams.get('q') ?? '';
        return json(res, 200, { hits: store.search(q, Number(url.searchParams.get('limit') ?? 12)) });
      }

      if (p.startsWith('/api/company/') && p.endsWith('/freshness')) {
        const sym = decodeURIComponent(p.slice('/api/company/'.length, -'/freshness'.length));
        const f = dataFreshness(db.db, sym);
        if (!f) return json(res, 404, { error: 'No such company' });
        return json(res, 200, { ...f, news: newsCount(db.db, sym) });
      }
      if (p.startsWith('/api/company/')) {
        const symbol = decodeURIComponent(p.slice('/api/company/'.length));
        const detail = store.company(symbol);
        if (!detail) return json(res, 404, { error: `No company "${symbol}".` });
        return json(res, 200, {
          ...detail,
          analysis: analyseCompany(db.db, symbol),
          metrics: deepMetrics(db.db, symbol),
          scores: scores(db.db, symbol),
          peers: peerMatrix(db.db, symbol),
          note: flow.getNote(symbol),
          watched: flow.isWatched(symbol),
          coverage: coverage(db.db, symbol),
          factors: factorsFor(db.db, symbol),
          valuation: valuation(db.db, symbol),
          strength: strength(db.db, symbol),
        });
      }

      if (p === '/api/nl/schema') return json(res, 200, { schema: AST_SCHEMA, systemPrompt: AST_SYSTEM_PROMPT, fields: ALLOWED_FIELDS, operators: ['>', '>=', '<', '<=', '=', '!='] });
      if (p === '/api/nl/ast' && req.method === 'POST') {
        const body = (await readBody(req)) as { text?: string; ast?: unknown };
        // A model (or the query builder) may POST an AST directly — validate it.
        if (body.ast !== undefined) {
          const r = compileAst(body.ast);
          return json(res, r.valid ? 200 : 422, r);
        }
        const text = String(body.text ?? '');
        const parsed = parseQuery(text);
        const r = expressionToAst(parsed.expression);
        return json(res, 200, { ...r, source: 'rule-parser', understood: parsed.expression, unresolved: parsed.unresolved ?? [] });
      }
      if (p === '/api/nl' && req.method === 'POST') {
        const body = (await readBody(req)) as { text?: string; useLlm?: boolean };
        const text = String(body.text ?? '');
        const parsed = body.useLlm ? await parseQueryWithLlm(text) : parseQuery(text);
        return json(res, 200, parsed);
      }

      if (p === '/api/screen' && (req.method === 'POST' || req.method === 'GET')) {
        const body = req.method === 'POST' ? ((await readBody(req)) as Record<string, unknown>) : {};
        let expression = String(body['expression'] ?? url.searchParams.get('expression') ?? '');
        let nlNotes: string[] = [];
        if (!expression && (body['text'] || url.searchParams.get('text'))) {
          const parsed = parseQuery(String(body['text'] ?? url.searchParams.get('text')));
          expression = parsed.expression;
          nlNotes = parsed.notes;
        }
        if (!expression) return json(res, 400, { error: 'Provide an expression or a natural-language query.', notes: nlNotes });
        try {
          const result = store.screener(expression, {
            sort: String(body['sort'] ?? url.searchParams.get('sort') ?? 'market_cap'),
            order: (String(body['order'] ?? url.searchParams.get('order') ?? 'desc') === 'asc' ? 'asc' : 'desc'),
            limit: Number(body['limit'] ?? url.searchParams.get('limit') ?? 100),
            offset: Number(body['offset'] ?? url.searchParams.get('offset') ?? 0),
          });
          // Custom ratios become columns and can filter the result set. Without this the
          // ratio could be defined but never used, which made it decorative.
          const withRatios = applyRatios(db.db, result.rows as unknown as Array<Record<string, unknown>>);
          const conds = Array.isArray(body['ratioConditions']) ? (body['ratioConditions'] as Array<{ ratio?: string; op?: string; value?: number }>) : [];
          let rows = withRatios;
          let ratioApplied = 0;
          if (conds.length) {
            const ops: Record<string, (a: number, b: number) => boolean> = {
              '>': (a, b) => a > b, '>=': (a, b) => a >= b,
              '<': (a, b) => a < b, '<=': (a, b) => a <= b,
              '=': (a, b) => a === b, '!=': (a, b) => a !== b,
            };
            for (const c of conds) {
              const key = `ratio:${String(c.ratio ?? '')}`;
              const fn = ops[String(c.op ?? '>')] ?? ops['>']!;
              const target = Number(c.value ?? 0);
              rows = rows.filter((r) => {
                const v = r[key];
                return typeof v === 'number' && Number.isFinite(v) && fn(v, target);
              });
              ratioApplied++;
            }
          }
          return json(res, 200, {
            ...result,
            rows: rows as never,
            total: rows.length,
            expression, notes: nlNotes,
            stats: screenStats(rows as never),
            ratioConditionsApplied: ratioApplied,
          });
        } catch (e) {
          return json(res, 400, { error: e instanceof Error ? e.message : String(e), expression });
        }
      }

      if (p === '/api/export.csv') {
        const expression = url.searchParams.get('expression') ?? 'Market Cap > 0';
        const result = store.screener(expression, { limit: 500 });
        const cols = ['symbol', 'name', 'sector', 'industry', 'marketCap', 'price', 'pe', 'pb', 'roe', 'roce', 'debtToEquity', 'sales', 'netProfit', 'opm', 'npm', 'eps', 'dividendYield', 'promoterHolding', 'pledge', 'currentRatio', 'interestCoverage', 'salesGrowth3y', 'profitGrowth3y', 'assetTurnover'];
        const esc = (v: unknown): string => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const csv = [cols.join(','), ...result.rows.map((r) => cols.map((c) => esc((r as unknown as Record<string, unknown>)[c])).join(','))].join('\n');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sift-screener.csv"` });
        res.end(csv);
        return;
      }

      if (p.startsWith('/api/market-intel/')) {
        const mi = marketIntel(db.db, decodeURIComponent(p.slice('/api/market-intel/'.length)));
        return mi ? json(res, 200, mi) : json(res, 404, { error: 'No such company' });
      }

      if (p.startsWith('/api/research/')) {
        const raw = decodeURIComponent(p.slice('/api/research/'.length));
        const wantMd = raw.endsWith('.md');
        const wantHtml = raw.endsWith('.html');
        // Strip the extension before the lookup, or the symbol is "XYZ.html".
        const sym = wantMd ? raw.slice(0, -3) : wantHtml ? raw.slice(0, -5) : raw;
        const rep = researchReport(db.db, sym, markets.active() ?? 'IN');
        if (!rep) return json(res, 404, { error: 'No such company' });
        if (wantMd) {
          res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
          res.end(researchMarkdown(rep));
          return;
        }
        if (wantHtml) {
          // Print-ready HTML: this is what chromium renders to PDF.
          const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const body = rep.sections.map((sec) => `
            <section><h2>${sec.n}. ${esc(sec.title)} <span class="st st-${sec.status}">${sec.status}</span></h2>
            <pre>${esc(JSON.stringify(sec.data, null, 2))}</pre>
            ${sec.sources.length ? `<p class="src">Sources: ${esc(sec.sources.join(', '))}</p>` : ''}
            ${sec.gap ? `<p class="gap"><b>Gap:</b> ${esc(sec.gap)}</p>` : ''}</section>`).join('');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(rep.company)} — research report</title>
            <style>
              body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:32px;color:#111;max-width:900px}
              h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}
              pre{background:#f7f8fa;border:1px solid #e5e7eb;border-radius:6px;padding:10px;white-space:pre-wrap;font-size:11px;overflow-wrap:anywhere}
              .st{font-size:10px;padding:1px 6px;border-radius:9px;margin-left:6px;vertical-align:middle}
              .st-complete{background:#e6f4ea;color:#137333}.st-partial{background:#fef7e0;color:#8a6d00}.st-unavailable{background:#fce8e6;color:#a50e0e}
              .src{color:#555;font-size:11px}.gap{background:#fff8e1;border-left:3px solid #f0b429;padding:6px 10px;font-size:11.5px}
              .meta{color:#555;font-size:12px;margin-bottom:18px}
            </style></head><body>
            <h1>${esc(rep.company)} (${esc(rep.symbol)}) — research report</h1>
            <p class="meta">Market ${esc(rep.market)} · generated ${esc(rep.generatedAt)} · coverage ${rep.coverage.pct}% (${rep.coverage.complete} complete, ${rep.coverage.partial} partial, ${rep.coverage.unavailable} unavailable)</p>
            <p class="meta">Every figure is computed from the local database. Sections that cannot be filled say so and are not written from assumption.</p>
            ${body}</body></html>`);
          return;
        }
        return json(res, 200, rep);
      }
      if (p.startsWith('/api/atlas-score/')) {
        const a = atlasScore(db.db, decodeURIComponent(p.slice('/api/atlas-score/'.length)));
        return a ? json(res, 200, a) : json(res, 404, { error: 'No such company' });
      }
      if (p.startsWith('/api/explain/')) {
        const e = explainMatch(db.db, decodeURIComponent(p.slice('/api/explain/'.length)));
        return e ? json(res, 200, e) : json(res, 404, { error: 'No such company' });
      }

      // ---- cross-sectional universe analytics ----
      if (p === '/api/universe/coverage') return json(res, 200, coverageReport(db.db));
      if (p === '/api/universe/breadth') return json(res, 200, breadth2(db.db));
      if (p === '/api/universe/rotation') return json(res, 200, { sectors: sectorRotation(db.db) });
      if (p === '/api/universe/freshness') return json(res, 200, { companies: freshness(db.db) });
      if (p === '/api/universe/correlation') {
        const syms = (url.searchParams.get('symbols') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        return json(res, 200, correlationMatrix(db.db, syms));
      }
      if (p === '/api/compare') {
        const syms = (url.searchParams.get('symbols') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        return json(res, 200, { rows: compare(db.db, syms) });
      }
      if (p === '/api/portfolio/analytics') {
        const pf = custom.portfolio();
        return json(res, 200, portfolioAnalytics(db.db, pf.holdings.map((h) => ({ symbol: h.symbol, value: h.value, sector: h.sector }))));
      }
      if (p === '/api/watchlist/digest') {
        const syms = flow.watchlist().map((w: { symbol: string }) => w.symbol);
        return json(res, 200, { digest: watchlistDigest(db.db, syms) });
      }
      if (p.startsWith('/api/total-return/')) {
        const t = totalReturn(db.db, decodeURIComponent(p.slice('/api/total-return/'.length)));
        return t ? json(res, 200, t) : json(res, 404, { error: 'No price history' });
      }
      if (p.startsWith('/api/earnings-reaction/')) {
        return json(res, 200, { reactions: earningsReaction(db.db, decodeURIComponent(p.slice('/api/earnings-reaction/'.length))) });
      }
      if (p.startsWith('/api/risk/')) {
        const sym = decodeURIComponent(p.slice('/api/risk/'.length));
        const r = riskProfile(db.db, sym);
        if (!r) return json(res, 404, { error: 'No price history' });
        // Extras that belong with the risk profile rather than a separate call.
        const c = db.db.prepare(`SELECT id FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(sym) as { id: number } | undefined;
        let dd: number | null = null; let rp: number | null = null; let vol: number | null = null;
        if (c) {
          const rows = db.db.prepare(`SELECT close FROM price_history WHERE company_id=? AND close>0 ORDER BY date ASC`).all(c.id) as Array<{ close: number }>;
          if (rows.length >= 20) {
            const closes = rows.map((x) => x.close);
            dd = maxDrawdown(closes);
            const w = closes.slice(-252);
            rp = rangePosition(closes[closes.length - 1]!, Math.min(...w), Math.max(...w));
            const rets: number[] = [];
            for (let i = 1; i < closes.length; i++) rets.push((closes[i]! - closes[i - 1]!) / closes[i - 1]!);
            vol = volatility(rets);
          }
        }
        return json(res, 200, { ...r, maxDrawdown: dd, rangePosition: rp, volatility: vol });
      }
      if (p.startsWith('/api/investability/')) {
        const i = investability(db.db, decodeURIComponent(p.slice('/api/investability/'.length)));
        return i ? json(res, 200, i) : json(res, 404, { error: 'No data' });
      }

      // ---- feature audit & deep analysis v2 ----
      if (p.startsWith('/api/audit/')) {
        const a = auditCompany(db.db, decodeURIComponent(p.slice('/api/audit/'.length)));
        return a ? json(res, 200, a) : json(res, 404, { error: 'No such company' });
      }
      if (p.startsWith('/api/deep2/')) {
        const d = deep2(db.db, decodeURIComponent(p.slice('/api/deep2/'.length)));
        return d ? json(res, 200, d) : json(res, 404, { error: 'No such company' });
      }

      // ---- live universe (no hard-coded list) ----
      if (p === '/api/live/search') {
        const q = (url.searchParams.get('q') ?? '').trim();
        if (!q) return json(res, 200, { local: [], live: [] });
        const local = store.search(q, 10);
        let live: unknown[] = [];
        if (local.length === 0) { try { live = await yahoo.search(q, 10); } catch { live = []; } }
        return json(res, 200, { local, live, source: local.length ? 'local' : 'yahoo' });
      }
      if (p.startsWith('/api/live/peers/') && req.method === 'POST') {
        const sym = decodeURIComponent(p.slice('/api/live/peers/'.length));
        const want = Math.min(Math.max(Number(url.searchParams.get('count') ?? 4), 1), 8);
        const target = db.db.prepare(`SELECT id, symbol, sector FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(sym) as { id: number; symbol: string; sector: string } | undefined;
        if (!target) return json(res, 404, { error: 'No such company in this market' });
        if (!target.sector) return json(res, 400, { error: 'Company has no sector, so peers cannot be found' });
        const region = (markets.active() ?? 'IN').toLowerCase();
        const base = (x: string): string => x.replace(/\.(NS|BO|L|T|DE|SI|HK|AX|TO)$/i, '');
        let found: Array<{ symbol: string; name: string }> = [];
        try {
          const res2 = await yahoo.screenSector(region, target.sector, want * 4);
          // Prefer the primary listing, drop duplicate exchange lines and the target itself.
          const seen = new Set<string>([base(target.symbol)]);
          for (const q of res2.symbols) {
            const b = base(q.symbol);
            if (seen.has(b)) continue;
            seen.add(b);
            found.push({ symbol: q.symbol, name: q.name });
            if (found.length >= want) break;
          }
        } catch { /* network */ }
        const added: Array<{ symbol: string; ok: boolean }> = [];
        for (const f of found) {
          try {
            const summary = await yahoo.summary(f.symbol);
            if (!summary) { added.push({ symbol: f.symbol, ok: false }); continue; }
            upsertLiveCompany(db.db, summary);
            const chart = await yahoo.chart(f.symbol, '1y');
            if (chart) storePrices(db.db, f.symbol, chart.points);
            added.push({ symbol: f.symbol, ok: true });
          } catch { added.push({ symbol: f.symbol, ok: false }); }
        }
        return json(res, 200, { sector: target.sector, requested: want, found: found.length, added });
      }
      if (p === '/api/live/fetch' && req.method === 'POST') {
        const b = (await readBody(req)) as { symbol?: string; range?: string };
        const symbol = String(b.symbol ?? '').trim();
        if (!symbol) return json(res, 400, { error: 'symbol is required' });
        const summary = await yahoo.summary(symbol);
        if (!summary) return json(res, 502, { error: `Could not fetch "${symbol}" from the live source. Check the symbol or your connection.` });
        const up = upsertLiveCompany(db.db, summary);
        const chart = await yahoo.chart(symbol, b.range ?? '1y');
        const stored = chart ? storePrices(db.db, symbol, chart.points) : 0;
        // Pull the fundamentals history so every analysis function has data to work on.
        let history = { annual: 0, quarterly: 0, periods: 0 };
        try { history = await fetchAndStoreHistory(db.db, yahoo, symbol, summary.price || chart?.price || 0); } catch { /* keep the snapshot */ }
        // Analysts, ownership, estimates, dividends and volume.
        let market = 0;
        try {
          const mods = await yahoo.summaryModules(symbol, 'recommendationTrend,majorHoldersBreakdown,insiderTransactions,earningsTrend,earningsHistory,calendarEvents');
          const extras = await yahoo.chartExtras(symbol, '5y');
          const parsedExtras = extras ? parseChartExtras(extras) : { dividends: [], splits: [], volumes: [] };
          const r = storeMarketData(db.db, symbol, {
            recommendations: mods ? parseRecommendationTrend(mods) : [],
            holders: mods ? parseMajorHolders(mods) : null,
            insiders: mods ? parseInsiderTransactions(mods) : [],
            estimates: mods ? parseEarningsTrend(mods) : [],
            surprises: mods ? parseEarningsHistory(mods) : [],
            targets: { low: summary.targetLow ?? 0, mean: summary.targetMeanPrice, high: summary.targetHigh ?? 0, median: summary.targetMedian ?? summary.targetMeanPrice, recommendation: summary.recommendation, analysts: summary.analystCount ?? 0 },
            dividends: parsedExtras.dividends, volumes: parsedExtras.volumes,
            splits: parsedExtras.splits, upcoming: mods ? parseCalendarEvents(mods) : null,
          });
          market = r.rows;
        } catch { /* optional */ }
        // Headlines feed the research report's news section and the company timeline.
        let news: { stored: number; sources: string[] } = { stored: 0, sources: [] };
        try { news = await fetchNews(db.db, symbol, summary.name || symbol); } catch { /* best effort */ }
        return json(res, 200, { ...up, pricePoints: stored, history, marketRows: market, coverage: coverage(db.db, symbol), news, summary });
      }
      if (p === '/api/live/refresh' && req.method === 'POST') {
        const b = (await readBody(req)) as { symbols?: string[] };
        const targets = Array.isArray(b.symbols) && b.symbols.length ? b.symbols : liveCompanies(db.db, 25).map((c) => c.symbol);
        const results: Array<{ symbol: string; ok: boolean }> = [];
        for (const sym of targets.slice(0, 25)) {
          const summary = await yahoo.summary(sym);
          if (!summary) { results.push({ symbol: sym, ok: false }); continue; }
          upsertLiveCompany(db.db, summary);
          const chart = await yahoo.chart(sym, '1y');
          if (chart) storePrices(db.db, sym, chart.points);
          results.push({ symbol: sym, ok: true });
          await new Promise((r) => setTimeout(r, 350)); // be polite to the source
        }
        return json(res, 200, { refreshed: results.filter((r) => r.ok).length, results });
      }
      if (p.startsWith('/api/live/history/') && req.method === 'POST') {
        const sym = decodeURIComponent(p.slice('/api/live/history/'.length));
        const px = (db.db.prepare(`SELECT price FROM v_latest WHERE UPPER(symbol)=UPPER(?)`).get(sym) as { price: number } | undefined)?.price ?? 0;
        const h = await fetchAndStoreHistory(db.db, yahoo, sym, px);
        return json(res, 200, { ...h, coverage: coverage(db.db, sym) });
      }
      if (p.startsWith('/api/live/coverage/')) return json(res, 200, coverage(db.db, decodeURIComponent(p.slice('/api/live/coverage/'.length))));
      if (p === '/api/live/companies') return json(res, 200, { companies: liveCompanies(db.db, Number(url.searchParams.get('limit') ?? 50)) });
      if (p.startsWith('/api/price/')) {
        const sym = decodeURIComponent(p.slice('/api/price/'.length));
        const a = priceAnalytics(db.db, sym);
        return a ? json(res, 200, a) : json(res, 404, { error: `No company "${sym}".` });
      }
      if (p === '/api/market/breadth') return json(res, 200, marketBreadth(db.db));

      // ---- preferences (theme, density, columns, panels) ----
      if (p === '/api/prefs' && req.method === 'GET') return json(res, 200, { prefs: custom.prefs(), allColumns: ALL_COLUMNS });
      if (p === '/api/prefs' && req.method === 'PUT') { const b = (await readBody(req)) as Record<string, unknown>; return json(res, 200, { prefs: custom.setPrefs(b as never) }); }
      if (p === '/api/prefs/reset' && req.method === 'POST') return json(res, 200, { prefs: custom.resetPrefs() });

      // ---- multi-model valuation with editable assumptions ----
      if (p.startsWith('/api/valuation2/') && p.endsWith('/assumptions') && req.method === 'POST') {
        const sym = decodeURIComponent(p.slice('/api/valuation2/'.length, -'/assumptions'.length));
        const b = (await readBody(req)) as Record<string, unknown>;
        try { return json(res, 200, saveAssumptions(db.db, sym, b as never, String(b['scenario'] ?? 'base') as Scenario)); }
        catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }
      if (p.startsWith('/api/valuation2/') && p.endsWith('/reset') && req.method === 'POST') {
        const sym = decodeURIComponent(p.slice('/api/valuation2/'.length, -'/reset'.length));
        try { return json(res, 200, resetAssumptions(db.db, sym)); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }
      if (p.startsWith('/api/valuation2/') && p.endsWith('/report.md')) {
        const sym = decodeURIComponent(p.slice('/api/valuation2/'.length, -'/report.md'.length));
        const rep = valuationReport(db.db, sym);
        if (!rep) return json(res, 404, { error: `No company "${sym}".` });
        const lines = [
          `# Valuation — ${rep.symbol}`, '',
          `Price: ₹${rep.price} · Blended fair value: ₹${rep.blended ?? '—'} · Upside: ${rep.upsidePct ?? '—'}% · Verdict: ${rep.verdict}`, '',
          `Scenario: ${rep.scenario} · WACC-lite: ${rep.wacc}%`, '',
          '| Model | Value | Weight | Assumption |', '|---|---|---|---|',
          ...rep.models.map((m) => `| ${m.name} | ${m.value ?? '—'} | ${m.weight} | ${m.note} |`), '',
          `Band — bear ₹${rep.band.bear ?? '—'} / base ₹${rep.band.base ?? '—'} / bull ₹${rep.band.bull ?? '—'}`, '',
          `EV ₹${rep.ev.ev} Cr · EV/EBITDA ${rep.ev.evEbitda ?? '—'} · EV/Sales ${rep.ev.evSales ?? '—'}`, '',
          `P/E band (10y): ${rep.peBand.min} / ${rep.peBand.median} / ${rep.peBand.max}`, '',
          ...rep.notes.map((n) => `> ${n}`),
        ];
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${rep.symbol}-valuation.md"` });
        res.end(lines.join('\n'));
        return;
      }
      if (p.startsWith('/api/valuation2/')) {
        const sym = decodeURIComponent(p.slice('/api/valuation2/'.length));
        const rep = valuationReport(db.db, sym, (url.searchParams.get('scenario') as Scenario) ?? undefined);
        return rep ? json(res, 200, { ...rep, defaults: DEFAULT_ASSUMPTIONS }) : json(res, 404, { error: `No company "${sym}".` });
      }

      // ---- personal ratings ----
      if (p.startsWith('/api/rating/') && req.method === 'GET') return json(res, 200, { rating: custom.rating(decodeURIComponent(p.slice('/api/rating/'.length))) });
      if (p.startsWith('/api/rating/') && req.method === 'POST') {
        const sym = decodeURIComponent(p.slice('/api/rating/'.length));
        const b = (await readBody(req)) as { rating?: number; thesis?: string };
        try { return json(res, 200, custom.setRating(sym, Number(b.rating ?? 3), String(b.thesis ?? ''))); }
        catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }

      // ---- custom alert rules ----
      if (p === '/api/alert-rules' && req.method === 'GET') return json(res, 200, { rules: custom.listRules(), findings: custom.evaluateRules('watchlist') });
      if (p === '/api/alert-rules' && req.method === 'POST') {
        const b = (await readBody(req)) as { metric?: string; op?: string; threshold?: number };
        try { return json(res, 201, custom.addRule(String(b.metric ?? ''), (b.op ?? '>') as never, Number(b.threshold ?? 0))); }
        catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }
      if (p.startsWith('/api/alert-rules/') && p.endsWith('/toggle') && req.method === 'POST') {
        const id = p.split('/')[3]!;
        const b = (await readBody(req)) as { enabled?: boolean };
        return json(res, 200, { ok: custom.toggleRule(id, b.enabled !== false) });
      }
      if (p.startsWith('/api/alert-rules/') && req.method === 'DELETE') return json(res, 200, { ok: custom.deleteRule(p.split('/').pop()!) });
      if (p === '/api/alert-rules/evaluate') return json(res, 200, { findings: custom.evaluateRules((url.searchParams.get('scope') as 'watchlist' | 'all') ?? 'watchlist') });

      // ---- peers (user-editable) ----
      if (p.startsWith('/api/peers/') && req.method === 'GET') {
        const sym = decodeURIComponent(p.slice('/api/peers/'.length));
        // A symbol from another market (or a typo) must not look like a valid company.
        const exists = db.db.prepare(`SELECT 1 AS ok FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(sym);
        if (!exists) return json(res, 404, { error: 'No such company' });
        return json(res, 200, { peers: custom.peersFor(sym) });
      }
      if (p.startsWith('/api/peers/') && req.method === 'POST') {
        const sym = decodeURIComponent(p.slice('/api/peers/'.length));
        const b = (await readBody(req)) as { peers?: string[] };
        try { return json(res, 200, custom.setPeers(sym, b.peers ?? [])); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }

      // ---- portfolio ----
      // ---- user features: P&L, sector drill-down, exports, bulk actions ----
      // ---- local model manager: device, catalogue, install, switch ----
      // ---- charts: price series, sparklines, sector bars ----
      // ---- indicators: timeframes + technical studies ----
      if (p.startsWith('/api/indicators/')) {
        const sym = decodeURIComponent(p.slice('/api/indicators/'.length));
        const tf = (url.searchParams.get('tf') ?? '1D') as '1D' | '1W' | '1M';
        const wanted = (url.searchParams.get('set') ?? 'sma20,rsi14,macd').split(',').filter(Boolean) as IndicatorId[];
        const c = db.db.prepare(`SELECT id, symbol FROM companies WHERE UPPER(symbol)=UPPER(?)`).get(sym) as { id: number; symbol: string } | undefined;
        if (!c) return json(res, 404, { error: 'No such company in this market' });
        const rows = db.db.prepare(`SELECT date, close, COALESCE(open,close) AS open, COALESCE(high,close) AS high, COALESCE(low,close) AS low, COALESCE(volume,0) AS volume FROM price_history WHERE company_id=? AND close>0 ORDER BY date ASC`).all(c.id) as Array<{ date: string; close: number; open: number; high: number; low: number; volume: number }>;
        if (!rows.length) return json(res, 404, { error: 'No price history for that symbol' });
        const daily: Bar[] = rows.map((r) => ({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
        const bars = resample(daily, tf);
        // OHLCV is stored now, so every study is computable. Rows predating the schema
        // change carry close-only values, which we flag rather than silently accept.
        const hasOhlc = rows.some((r) => r.high > r.low && r.volume > 0);
        const NEEDS_OHLC: IndicatorId[] = ['atr14', 'stoch14', 'williams14', 'obv'];
        const computable = hasOhlc ? wanted : wanted.filter((w) => !NEEDS_OHLC.includes(w));
        const unavailable = hasOhlc ? [] : wanted.filter((w) => NEEDS_OHLC.includes(w))
          .map((w) => ({ id: w, reason: 'this symbol was imported before open/high/low/volume were stored — refresh it' }));
        return json(res, 200, {
          symbol: c.symbol, timeframe: tf,
          bars: bars.map((b) => ({ date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
          available: INDICATORS, indicators: computeIndicators(bars, computable), unavailable,
        });
      }
      if (p.startsWith('/api/chart/sectors')) return json(res, 200, { sectors: sectorBars(db.db, Number(url.searchParams.get('days') ?? 30)) });
      if (p.startsWith('/api/chart/')) {
        const sym = decodeURIComponent(p.slice('/api/chart/'.length));
        const s = priceSeries(db.db, sym, Number(url.searchParams.get('days') ?? 365));
        if (!s) return json(res, 404, { error: 'No price history for that symbol in this market' });
        return json(res, 200, s);
      }
      if (p === '/api/sparklines' && req.method === 'POST') {
        const b = (await readBody(req)) as { symbols?: string[] };
        const data = sparklines(db.db, Array.isArray(b.symbols) ? b.symbols : [], 30);
        const svgs: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) svgs[k] = sparkSvg(v);
        return json(res, 200, { series: data, svgs });
      }
      if (p === '/api/models/device') return json(res, 200, deviceProfile());
      if (p === '/api/models/runtimes') return json(res, 200, { runtimes: await detectRuntime(), active: models.activeId() });
      if (p === '/api/models/validate') {
        const file = url.searchParams.get('path') ?? '';
        return json(res, 200, { path: file, ...validateGguf(file) });
      }
      if (p === '/api/models/config/export') return json(res, 200, exportConfig(models));
      if (p === '/api/models/config/import' && req.method === 'POST') {
        const b = await readBody(req);
        return json(res, 200, importConfig(models, b));
      }
      if (p === '/api/models/recommend') return json(res, 200, recommendModel());
      if (p === '/api/models/catalogue') return json(res, 200, { models: MODEL_CATALOGUE, device: deviceProfile() });
      if (p === '/api/models/installed') return json(res, 200, { installed: models.list(), active: models.activeId(), diskUsageMb: models.diskUsageMb() });
      if (p === '/api/models/install' && req.method === 'POST') {
        const b = (await readBody(req)) as { id?: string; path?: string };
        const r = models.installFromFile(String(b.id ?? ''), String(b.path ?? ''));
        return json(res, r.ok ? 200 : 400, r);
      }
      if (p === '/api/models/register' && req.method === 'POST') {
        const b = (await readBody(req)) as { id?: string; path?: string };
        const r = models.registerExternal(String(b.id ?? ''), String(b.path ?? ''));
        return json(res, r.ok ? 200 : 400, r);
      }
      if (p.startsWith('/api/models/remove/') && req.method === 'POST') {
        return json(res, 200, { removed: models.remove(decodeURIComponent(p.slice('/api/models/remove/'.length))) });
      }
      if (p.startsWith('/api/models/switch/') && req.method === 'POST') {
        const id = decodeURIComponent(p.slice('/api/models/switch/'.length));
        const okSwitch = models.switchTo(id);
        if (okSwitch) { try { llm.useModel(models.activeModel()); } catch { /* keep default */ } }
        return json(res, okSwitch ? 200 : 404, { ok: okSwitch, active: models.activeId() });
      }
      if (p.startsWith('/api/models/verify/')) {
        const id = decodeURIComponent(p.slice('/api/models/verify/'.length));
        return json(res, 200, models.verify(id));
      }
      if (p === '/api/portfolio/pnl') return json(res, 200, portfolioPnl(db.db));
      if (p === '/api/movers') return json(res, 200, topMovers(db.db, Number(url.searchParams.get('days') ?? 30), Number(url.searchParams.get('limit') ?? 10)));
      if (p === '/api/quick-filters') return json(res, 200, { filters: QUICK_FILTERS });
      if (p === '/api/watchlist/table') return json(res, 200, { rows: watchlistTable(db.db) });
      if (p.startsWith('/api/watchlist/remove/') && req.method === 'POST') {
        return json(res, 200, { removed: removeFromWatchlist(db.db, decodeURIComponent(p.slice('/api/watchlist/remove/'.length))) });
      }
      if (p === '/api/screen/history' && req.method === 'GET') return json(res, 200, { history: screenHistory(db.db, Number(url.searchParams.get('limit') ?? 10)) });
      if (p === '/api/screen/history' && req.method === 'POST') {
        const b = (await readBody(req)) as { expression?: string; count?: number };
        recordScreen(db.db, String(b.expression ?? ''), Number(b.count ?? 0));
        return json(res, 200, { ok: true });
      }
      if (p.startsWith('/api/notes/') && req.method === 'POST') {
        const sym = decodeURIComponent(p.slice('/api/notes/'.length));
        const b = (await readBody(req)) as { body?: string };
        return json(res, 200, { ok: setNote(db.db, sym, String(b.body ?? '')) });
      }
      if (p === '/api/sector-breadth') return json(res, 200, { sectors: sectorBreadth(db.db, Number(url.searchParams.get('days') ?? 30)) });
      if (p === '/api/watchlist/calendar') return json(res, 200, watchlistCalendar(db.db));
      if (p.startsWith('/api/timeline/')) {
        const sym = decodeURIComponent(p.slice('/api/timeline/'.length));
        // Richer timeline: announcements, corporate actions and insider trades in one
        // chronological account, with a significance flag and per-kind counts.
        const t = corporateTimeline(db.db, sym, Number(url.searchParams.get('limit') ?? 60));
        if (t) return json(res, 200, t);
        const basic = companyTimeline(db.db, sym);
        return basic ? json(res, 200, { symbol: sym, events: basic, counts: {}, note: 'Basic timeline.' })
                     : json(res, 404, { error: 'No such company' });
      }
      // ---- data truth: what we actually know, and how much to trust it ----
      // ---- graph, storylines, strategy library, condition builder ----
      // ---- ask: answer a question from stored data ----
      // ---- investor library: documented methods, runnable as screens ----
      // ---- back data: browse any stored date range ----
      if (p === '/api/prices/coverage') {
        return json(res, 200, dataCoverage(db.db));
      }
      if (p.startsWith('/api/prices/')) {
        const sym = decodeURIComponent(p.slice('/api/prices/'.length));
        const interval = (url.searchParams.get('interval') ?? 'day') as Interval;
        const h = priceHistory(db.db, sym, {
          from: url.searchParams.get('from') ?? undefined,
          to: url.searchParams.get('to') ?? undefined,
          interval: ['day', 'week', 'month'].includes(interval) ? interval : 'day',
        });
        return h ? json(res, 200, h) : json(res, 404, { error: 'No such company in this market' });
      }
      if (p === '/api/advisors') {
        const country = url.searchParams.get('country') ?? markets.active() ?? 'IN';
        return json(res, 200, {
          country, advisors: advisorsFor(country),
          all: ADVISORS.length, coverage: libraryCoverage(),
          note: 'Each entry summarises a documented approach and turns it into a screen. Entries marked "summary" are a characterisation, not a published rule set. No entry quotes the person.',
        });
      }
      if (p.startsWith('/api/advisors/') && p.endsWith('/run')) {
        const id = decodeURIComponent(p.slice('/api/advisors/'.length, -'/run'.length));
        const a = findAdvisor(id);
        if (!a) return json(res, 404, { error: 'No advisor with that id' });
        const r = runMethod(db.db, a, (expr) => store.screener(expr, { limit: 500 }).rows as unknown as Array<Record<string, unknown>>);
        return json(res, 200, r);
      }
      if (p.startsWith('/api/advisors/')) {
        const a = findAdvisor(decodeURIComponent(p.slice('/api/advisors/'.length)));
        return a ? json(res, 200, { advisor: a, expression: methodExpression(a) }) : json(res, 404, { error: 'No advisor with that id' });
      }
      if (p.startsWith('/api/ask/')) {
        const sym = decodeURIComponent(p.slice('/api/ask/'.length));
        const q = url.searchParams.get('q') ?? '';
        if (!q.trim()) return json(res, 400, { error: 'Provide a question with ?q=' });
        const a = ask(db.db, sym, q);
        return a ? json(res, 200, a) : json(res, 404, { error: 'No such company in this market' });
      }
      // ---- held review: look at what you own with fresh eyes ----
      if (p === '/api/held-review') {
        const rows = db.db.prepare(`
          SELECT c.symbol, c.name, p.quantity, p.avg_cost, COALESCE(q.price,0) AS price
          FROM portfolio p JOIN companies c ON c.id=p.company_id LEFT JOIN quotes q ON q.company_id=c.id`).all() as Array<{ symbol: string; name: string; quantity: number; avg_cost: number; price: number }>;
        const items = rows.map((h) => {
          const b = briefCompany(db.db, h.symbol, markets.active() ?? 'IN');
          const pnlPct = h.avg_cost > 0 ? Math.round(((h.price - h.avg_cost) / h.avg_cost) * 1000) / 10 : null;
          const flags = b ? b.dissent.filter((d) => d.severity === 'flag') : [];
          return {
            symbol: h.symbol, name: h.name, quantity: h.quantity,
            avgCost: h.avg_cost, price: h.price, pnlPct,
            verdict: b?.headline ?? 'no analysis available',
            stances: b?.stances ?? [],
            review: flags.length ? `Re-examine: ${flags[0]!.message}` : (b ? `Holding up — ${b.confidence.level} confidence.` : 'No data to review.'),
            needsAttention: flags.length > 0 || (pnlPct !== null && pnlPct < -20),
          };
        });
        return json(res, 200, {
          holdings: items.length,
          needsAttention: items.filter((i) => i.needsAttention).length,
          items,
          note: 'Each holding is re-read from its current numbers. A position is flagged when its dimensions contradict or it is down more than 20%.',
        });
      }
      if (p.startsWith('/api/graph/')) {
        const g = companyGraph(db.db, decodeURIComponent(p.slice('/api/graph/'.length)));
        return g ? json(res, 200, g) : json(res, 404, { error: 'No such company in this market' });
      }
      if (p.startsWith('/api/storylines/')) {
        const st = storylines(db.db, decodeURIComponent(p.slice('/api/storylines/'.length)));
        return st ? json(res, 200, st) : json(res, 404, { error: 'No such company in this market' });
      }
      if (p === '/api/strategies' && req.method === 'GET') {
        return json(res, 200, { market: markets.active() ?? 'IN', strategies: listStrategies(db.db, markets.active() ?? 'IN') });
      }
      if (p === '/api/strategies' && req.method === 'POST') {
        const b = (await readBody(req)) as { name?: string; lookbackDays?: number; topN?: number; rebalanceDays?: number; costPct?: number; note?: string };
        try {
          const id = saveStrategy(db.db, {
            name: String(b.name ?? ''), market: markets.active() ?? 'IN',
            lookbackDays: Number(b.lookbackDays ?? 120), topN: Number(b.topN ?? 10),
            rebalanceDays: Number(b.rebalanceDays ?? 21), costPct: Number(b.costPct ?? 0.25), note: b.note,
          });
          return json(res, 200, { ok: true, id });
        } catch (e) { return json(res, 400, { error: e instanceof Error ? e.message : 'Could not save' }); }
      }
      if (p.startsWith('/api/strategies/run/') && req.method === 'POST') {
        const id = Number(decodeURIComponent(p.slice('/api/strategies/run/'.length)));
        const st = listStrategies(db.db, markets.active() ?? 'IN').find((x) => x.id === id);
        if (!st) return json(res, 404, { error: 'No strategy with that id in this market' });
        const r = backtest(loadSeries(db.db), { lookbackDays: st.lookbackDays, topN: st.topN, rebalanceDays: st.rebalanceDays, costPct: st.costPct });
        if (r.ok) recordStrategyResult(db.db, id, r.stats.totalReturnPct, r.stats.benchmarkReturnPct);
        return json(res, 200, { strategy: st, result: r });
      }
      if (p.startsWith('/api/strategies/') && req.method === 'DELETE') {
        const id = Number(decodeURIComponent(p.slice('/api/strategies/'.length)));
        return json(res, deleteStrategy(db.db, id) ? 200 : 404, { ok: true });
      }
      if (p === '/api/conditions/compile' && req.method === 'POST') {
        const b = (await readBody(req)) as { conditions?: Array<{ field: string; op: never; value: number }>; join?: 'AND' | 'OR' };
        return json(res, 200, compileConditions(Array.isArray(b.conditions) ? b.conditions : [], b.join ?? 'AND'));
      }
      if (p === '/api/data-truth') {
        return json(res, 200, marketTruth(db.db, markets.active() ?? 'IN'));
      }
      if (p.startsWith('/api/data-truth/')) {
        const sym = decodeURIComponent(p.slice('/api/data-truth/'.length));
        const t = companyTruth(db.db, sym);
        return t ? json(res, 200, t) : json(res, 404, { error: 'No such company in this market' });
      }
      if (p.startsWith('/api/flows/')) {
        const sym = decodeURIComponent(p.slice('/api/flows/'.length));
        const f = insiderFlows(db.db, sym, Number(url.searchParams.get('days') ?? 365));
        return f ? json(res, 200, f) : json(res, 404, { error: 'No such company in this market' });
      }
      if (p.startsWith('/api/sector/') && p.endsWith('/companies')) {
        const name = decodeURIComponent(p.slice('/api/sector/'.length, -'/companies'.length));
        const rows = sectorCompanies(db.db, name);
        return json(res, 200, { sector: name, count: rows.length, companies: rows });
      }
      if (p === '/api/screen/explain' && req.method === 'POST') {
        const b = (await readBody(req)) as { expression?: string; symbols?: string[] };
        return json(res, 200, { explanations: explainScreen(db.db, String(b.expression ?? ''), Array.isArray(b.symbols) ? b.symbols : []) });
      }
      if (p === '/api/watchlist/bulk' && req.method === 'POST') {
        const b = (await readBody(req)) as { symbols?: string[] };
        return json(res, 200, bulkWatchlist(db.db, Array.isArray(b.symbols) ? b.symbols : []));
      }
      if (p === '/api/export/watchlist.csv') {
        const rows = db.db.prepare(`SELECT c.symbol, c.name, c.sector, ROUND(v.market_cap,0) AS market_cap_cr, ROUND(v.pe,1) AS pe, ROUND(v.roe,1) AS roe
          FROM watchlist w JOIN companies c ON c.id=w.company_id LEFT JOIN v_latest v ON v.id=c.id ORDER BY c.symbol`).all() as Array<Record<string, unknown>>;
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="watchlist.csv"' });
        res.end(toCsv(rows)); return;
      }
      if (p === '/api/export/portfolio.csv') {
        const pnl = portfolioPnl(db.db);
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="portfolio.csv"' });
        res.end(toCsv(pnl.holdings as unknown as Array<Record<string, unknown>>)); return;
      }
      if (p === '/api/portfolio/analysis') {
        const rows = db.db.prepare(`
          SELECT c.symbol, COALESCE(c.sector,'Unclassified') AS sector,
                 COALESCE(q.price,0) * p.quantity AS value,
                 CASE WHEN p.avg_cost>0 THEN ((COALESCE(q.price,0)-p.avg_cost)/p.avg_cost)*100 ELSE 0 END AS pnlPct
          FROM portfolio p JOIN companies c ON c.id=p.company_id LEFT JOIN quotes q ON q.company_id=c.id`).all() as Array<{ symbol: string; sector: string; value: number; pnlPct: number }>;
        return json(res, 200, {
          holdings: rows.length,
          allocation: sectorAllocation(rows),
          warnings: concentrationWarnings(rows),
          diversification: diversificationScore(rows),
          rebalance: rebalanceHints(rows),
        });
      }
      if (p === '/api/portfolio' && req.method === 'GET') return json(res, 200, custom.portfolio());
      if (p === '/api/portfolio' && req.method === 'POST') {
        const b = (await readBody(req)) as { symbol?: string; quantity?: number; avgCost?: number; note?: string };
        try { return json(res, 200, custom.addHolding(String(b.symbol ?? ''), Number(b.quantity ?? 0), Number(b.avgCost ?? 0), String(b.note ?? ''))); }
        catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }
      if (p.startsWith('/api/portfolio/') && req.method === 'DELETE') return json(res, 200, { ok: custom.removeHolding(decodeURIComponent(p.split('/').pop()!)) });

      // ---- company intelligence (profile, segments, order book, plans) ----
      if (p === '/api/profiles/seed' && req.method === 'POST') return json(res, 200, ensureProfiles(db.db, { force: (url.searchParams.get('force') === '1') }));
      if (p.startsWith('/api/profile/') && p.endsWith('/wiki') && req.method === 'POST') {
        const sym = decodeURIComponent(p.slice('/api/profile/'.length, -'/wiki'.length));
        return json(res, 200, await fetchWikipediaProfile(db.db, sym));
      }
      if (p.startsWith('/api/profile/') && req.method === 'GET') {
        const sym = decodeURIComponent(p.slice('/api/profile/'.length));
        const intel = companyIntelligence(db.db, sym);
        return intel ? json(res, 200, intel) : json(res, 404, { error: `No company "${sym}".` });
      }
      if (p.startsWith('/api/profile/') && req.method === 'POST') {
        const sym = decodeURIComponent(p.slice('/api/profile/'.length));
        const body = (await readBody(req)) as Record<string, unknown>;
        try { return json(res, 200, importIntelligence(db.db, sym, body as never)); }
        catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }

      // ---- factors, valuation, analytics ----
      if (p === '/api/factors/rank') return json(res, 200, { ranked: rankUniverse(db.db, { limit: Number(url.searchParams.get('limit') ?? 50), sector: url.searchParams.get('sector') ?? undefined }) });
      if (p.startsWith('/api/factors/')) {
        const sym = decodeURIComponent(p.slice('/api/factors/'.length));
        const f = factorsFor(db.db, sym);
        return f ? json(res, 200, f) : json(res, 404, { error: `No company "${sym}".` });
      }
      if (p.startsWith('/api/valuation/')) {
        const sym = decodeURIComponent(p.slice('/api/valuation/'.length));
        const v = valuation(db.db, sym);
        return v ? json(res, 200, v) : json(res, 404, { error: `No company "${sym}".` });
      }
      if (p.startsWith('/api/strength/')) {
        const sym = decodeURIComponent(p.slice('/api/strength/'.length));
        const st = strength(db.db, sym);
        return st ? json(res, 200, st) : json(res, 404, { error: `No company "${sym}".` });
      }
      if (p === '/api/analytics/sectors') return json(res, 200, { sectors: sectorBenchmarks(db.db) });
      if (p === '/api/analytics/metrics') return json(res, 200, { metrics: SERIES_METRIC_NAMES });
      if (p.startsWith('/api/analytics/series/')) {
        const rest = p.slice('/api/analytics/series/'.length).split('/');
        const sym = decodeURIComponent(rest[0] ?? ''); const metric = decodeURIComponent(rest[1] ?? 'sales');
        try { return json(res, 200, { symbol: sym, metric, series: metricSeries(db.db, sym, metric, (url.searchParams.get('period') as 'annual' | 'quarterly') ?? 'annual') }); }
        catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }
      if (p === '/api/export/enriched.csv') {
        const expression = url.searchParams.get('expression') ?? 'Market Cap > 0';
        const result = store.screener(expression, { limit: 100 });
        const header = ['symbol', 'name', 'sector', 'marketCap', 'pe', 'roe', 'debtToEquity', 'composite', 'value', 'quality', 'growth', 'piotroski', 'altmanZ', 'graham', 'marginOfSafetyPct', 'netDebtToEbitda', 'strength'];
        const esc = (v: unknown): string => {
          const t = String(v ?? '');
          const needs = t.includes('"') || t.includes(',') || t.indexOf(String.fromCharCode(10)) >= 0 || t.indexOf(String.fromCharCode(13)) >= 0;
          return needs ? '"' + t.split('"').join('""') + '"' : t;
        };
        const lines = [header.join(',')];
        for (const r of result.rows) {
          const f = factorsFor(db.db, r.symbol); const sc = scores(db.db, r.symbol); const v = valuation(db.db, r.symbol); const st = strength(db.db, r.symbol);
          lines.push([r.symbol, r.name, r.sector, r.marketCap, r.pe, r.roe, r.debtToEquity,
            f?.composite ?? '', f?.value ?? '', f?.quality ?? '', f?.growth ?? '',
            sc?.piotroski?.score ?? '', sc?.altman?.z ?? '', v?.grahamNumber ?? '', v?.marginOfSafetyPct ?? '',
            st?.netDebtToEbitda ?? '', st?.verdict ?? ''].map(esc).join(','));
        }
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sift-enriched.csv"' });
        res.end(lines.join(String.fromCharCode(10)));
        return;
      }
      if (p === '/api/macro/compare') {
        const countries = (url.searchParams.get('countries') ?? 'IN,US,CN').split(',').map((c) => c.trim().toUpperCase()).slice(0, 5);
        return json(res, 200, { countries, series: countries.map((c) => ({ country: c, series: macroSeries(db.db, c) })) });
      }
      if (p === '/api/backup') return json(res, 200, exportDatabase(db.db));
      if (p === '/api/restore' && req.method === 'POST') {
        const body = (await readBody(req)) as { version?: number; tables?: Record<string, unknown[]> };
        try { return json(res, 200, importDatabase(db.db, body)); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }

      // ---- presets & saved screens ----
      if (p === '/api/presets') return json(res, 200, { presets: PRESETS });
      if (p === '/api/saved-screens' && req.method === 'GET') return json(res, 200, { screens: flow.listScreens() });
      if (p === '/api/saved-screens' && req.method === 'POST') {
        const b = (await readBody(req)) as { name?: string; expression?: string };
        try { return json(res, 201, flow.saveScreen(String(b.name ?? 'Screen'), String(b.expression ?? ''))); }
        catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }
      if (p.startsWith('/api/saved-screens/') && req.method === 'DELETE') return json(res, 200, { ok: flow.deleteScreen(p.split('/').pop()!) });

      // ---- watchlist & alerts ----
      if (p === '/api/watchlist' && req.method === 'GET') return json(res, 200, { watchlist: flow.watchlist() });
      if (p === '/api/watchlist' && req.method === 'POST') {
        const b = (await readBody(req)) as { symbol?: string };
        try { flow.addWatch(String(b.symbol ?? '')); return json(res, 200, { ok: true, watchlist: flow.watchlist() }); }
        catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }
      if (p.startsWith('/api/watchlist/') && req.method === 'DELETE') {
        const sym = decodeURIComponent(p.split('/').pop()!);
        return json(res, 200, { ok: flow.removeWatch(sym), watchlist: flow.watchlist() });
      }
      if (p === '/api/alerts') return json(res, 200, { alerts: flow.alerts() });

      // ---- notes ----
      if (p.startsWith('/api/notes/') && req.method === 'GET') {
        const sym = decodeURIComponent(p.slice('/api/notes/'.length));
        return json(res, 200, { note: flow.getNote(sym) });
      }
      if (p.startsWith('/api/notes/') && req.method === 'PUT') {
        const sym = decodeURIComponent(p.slice('/api/notes/'.length));
        const b = (await readBody(req)) as { body?: string };
        try { return json(res, 200, { note: flow.setNote(sym, String(b.body ?? '')) }); }
        catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }

      // ---- macro (World Bank, free) ----
      if (p === '/api/macro' && req.method === 'GET') return json(res, 200, { series: macroSeries(db.db), catalogue: WORLD_BANK_CATALOGUE });
      if (p === '/api/macro/refresh' && req.method === 'POST') {
        const b = (await readBody(req)) as { country?: string };
        return json(res, 200, await fetchWorldBank(db.db, String(b.country ?? 'IN')));
      }

      // ---- quotes (Yahoo, free) ----
      if (p === '/api/quotes/refresh' && req.method === 'POST') {
        const b = (await readBody(req)) as { symbols?: string[] };
        const symbols = Array.isArray(b.symbols) && b.symbols.length ? b.symbols : flow.watchlist().map((w) => w.symbol);
        const results = [];
        for (const sym of symbols.slice(0, 25)) results.push(await refreshQuote(db.db, sym));
        return json(res, 200, { results });
      }

      // ---- CSV import ----
      if (p === '/api/import/csv' && req.method === 'POST') {
        const raw = await new Promise<string>((resolve) => { let t = ''; req.on('data', (c) => { t += c; if (t.length > 5e6) req.destroy(); }); req.on('end', () => resolve(t)); });
        const body = raw.trim().startsWith('{') ? String(((JSON.parse(raw) as { csv?: string }).csv) ?? '') : raw;
        try { return json(res, 200, importStatementCsv(db.db, body)); }
        catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }

      if (p === '/api/seed' && req.method === 'POST') {
        const body = (await readBody(req)) as { companies?: number; seed?: number; market?: string };
        // Seeding a market is an explicit act: it configures that market if none is set.
        if (!markets.configured()) activate(marketDef(String(body.market ?? 'IN')) ? String(body.market ?? 'IN').toUpperCase() : 'IN');
        const r = ingestFixture(db.db, { companies: Number(body.companies ?? 200), seed: Number(body.seed ?? 42) });
        // Demo symbols are generated identically in every market, so prefix them with the
        // market code. Two markets must never share a symbol.
        const active = markets.active() ?? 'IN';
        if (active !== 'IN') {
          db.db.prepare(`UPDATE companies SET symbol = ? || '-' || symbol WHERE symbol NOT LIKE ?`).run(active, `${active}-%`);
          // The materialised metrics table must follow the rename, or screens keep the old symbols.
          refreshLatest(db.db);
        }
        return json(res, 200, { ...r, market: active });
      }

      json(res, 404, { error: 'Not found' });
    } catch (e) {
      const body = errorBody(e);
      json(res, body.code === 'NOT_FOUND' ? 404 : body.code === 'BAD_REQUEST' ? 400 : 500, body);
    }
  });
}

// The standalone CLI entry was removed: it opened a database file directly, which is a
// DIFFERENT database from the per-market files and would have served another country's
// data. The gateway (dist/gateway.js) is the only entry point and always goes through
// the market manager.
