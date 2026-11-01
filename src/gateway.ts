// Atlas gateway — one public port, two internal applications.
//
//   /api/fin/*  → the financial screener (Sift)
//   everything else → the console (Sift's UI) and its own API
//
// Each app keeps its own SQLite file and its own code. They are dispatched by
// emitting the request into an existing http.Server, so no extra port is bound and
// neither app needs to know it is behind a prefix.
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { openDatabase as openFinance } from './finance/core/db';
import { createServer as createFinanceServer } from './finance/api/server';
import { MarketManager } from './finance/core/markets';
import { ingestFixture } from './finance/core/ingest';
import { Store } from './finance/core/store';
import { ensureProfiles } from './finance/core/profile';

export interface AtlasOptions { dataDir?: string; consoleDir?: string; port?: number }

export interface Atlas {
  server: http.Server;
  finance: http.Server;
  close: () => Promise<void>;
}

function dispatch(target: http.Server, req: http.IncomingMessage, res: http.ServerResponse, url: string): void {
  req.url = url;
  target.emit('request', req, res);
}

export function createAtlas(opts: AtlasOptions = {}): Atlas {
  const dataDir = opts.dataDir ?? path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // The finance database is the ACTIVE MARKET's file. There is no separate
  // "atlas-finance.db" any more — that file was a leftover nothing read.
  // Handle only: if no market is configured yet, open the IN file WITHOUT marking it
  // active. The server refuses data routes until setup completes anyway.
  const bootMarkets = new MarketManager(dataDir, 'IN');
  const finDb = bootMarkets.configured() ? bootMarkets.activeDb() : bootMarkets.open('IN');

  const consoleDir = opts.consoleDir ?? (fs.existsSync(path.join(process.cwd(), 'dist', 'console'))
    ? path.join(process.cwd(), 'dist', 'console')
    : path.join(process.cwd(), 'src', 'console'));

  const finance = createFinanceServer(finDb, consoleDir, dataDir);

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/api/fin/')) return dispatch(finance, req, res, url.replace('/api/fin', '') || '/');
    return dispatch(finance, req, res, url);
  });

  // No WebSocket surface remains: the workspace application was removed.
  server.on('upgrade', (_req, socket) => { socket.destroy(); });

  const close = async (): Promise<void> => {
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => finance.close(() => r()));
  };

  /** Drain connections and close both databases — call on SIGINT/SIGTERM. */
  const shutdown = async (): Promise<void> => {
    await new Promise<void>((resolve) => { server.close(() => resolve()); setTimeout(resolve, 5000); });
    try { finDb.db.close(); } catch { /* already closed */ }
  };
  const onSignal = (): void => { void shutdown().then(() => process.exit(0)); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  return { server, finance, close };
}

function main(): void {
  const dataDir = process.env['ATLAS_DATA'] ?? process.env['DATA_DIR'] ?? path.join(process.cwd(), 'data');
  const atlas = createAtlas({ dataDir });

  // There is NO default market: the app starts empty and a country bundle is downloaded
  // on demand. Demo data is opt-in, and it seeds the ACTIVE MARKET's file — not a
  // separate database that nothing reads.
  if (process.env['ATLAS_SEED_DEMO'] === '1') {
    const markets = new MarketManager(dataDir, 'IN');
    const db = markets.activeDb();
    const stats = new Store(db.db).stats();
    if (stats.companies === 0) {
      const r = ingestFixture(db.db, { companies: Number(process.env['ATLAS_SEED_COUNT'] ?? 200), seed: 42 });
      const p = ensureProfiles(db.db);
      process.stdout.write(`Seeded ${r.companies} companies into market ${markets.active()} in ${r.ms} ms\n`);
      void p;
    }
  }

  const port = Number(process.env['PORT'] ?? 8800);
  atlas.server.listen(port, () => {
    const markets = new MarketManager(dataDir, 'IN');
    const active = markets.activeDef();
    process.stdout.write(`Atlas listening on http://127.0.0.1:${port}\n`);
    process.stdout.write(`  data:   ${dataDir}\n`);
    process.stdout.write(`  market: ${active.code} (${active.name}, ${active.currency}) — switch or download bundles in the app\n`);
  });
}

if (require.main === module) main();
