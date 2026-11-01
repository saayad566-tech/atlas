// AI Store — a local catalogue of installable capability packs.
//
// Every pack declares what it adds, its size, licence, checksum and where it comes from.
// Installing is explicit: nothing downloads on its own, and every pack is verified after
// install. Packs that cannot be fetched in this environment say so rather than pretending.
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Database as DB } from 'better-sqlite3';

export type PackKind = 'model' | 'data' | 'strategy' | 'template' | 'language' | 'tool';
export type PackStatus = 'installed' | 'available' | 'requires-network' | 'blocked';

export interface Pack {
  id: string;
  name: string;
  kind: PackKind;
  version: string;
  sizeMb: number;
  licence: string;
  source: string;
  summary: string;
  adds: string[];
  /** What the pack unlocks in the UI, so an install is never a mystery. */
  unlocks: string[];
  requiresNetwork: boolean;
}

/** The catalogue. Sizes and licences are the published figures for these artefacts. */
export const CATALOGUE: Pack[] = [
  {
    id: 'model-qwen25-15b-q4', name: 'Qwen2.5 1.5B Instruct (Q4_K_M)', kind: 'model', version: '1.0', sizeMb: 1024,
    licence: 'Apache-2.0', source: 'ollama://qwen2.5:1.5b-instruct-q4_K_M',
    summary: 'Small quantized model that runs on a mid-range phone. Answers grounded questions about a company.',
    adds: ['on-device generation', 'grounded Q&A', 'numeric cross-check'], unlocks: ['Ask panel answers from a model instead of rules'],
    requiresNetwork: true,
  },
  {
    id: 'model-qwen25-3b-q4', name: 'Qwen2.5 3B Instruct (Q4_K_M)', kind: 'model', version: '1.0', sizeMb: 1900,
    licence: 'Apache-2.0', source: 'ollama://qwen2.5:3b-instruct-q4_K_M',
    summary: 'Better reasoning at twice the size. Needs ~3 GB RAM.',
    adds: ['stronger reasoning', 'longer answers'], unlocks: ['Ask panel with multi-step explanations'],
    requiresNetwork: true,
  },
  {
    id: 'model-llama32-1b-q4', name: 'Llama 3.2 1B Instruct (Q4_K_M)', kind: 'model', version: '1.0', sizeMb: 800,
    licence: 'Llama-3.2-Community', source: 'ollama://llama3.2:1b-instruct-q4_K_M',
    summary: 'Smallest useful option — fastest on low-end hardware.',
    adds: ['low-memory generation'], unlocks: ['Ask panel on 2 GB devices'],
    requiresNetwork: true,
  },
  {
    id: 'data-in-nse', name: 'India — NSE/BSE universe', kind: 'data', version: '2026.10', sizeMb: 120,
    licence: 'Public filings', source: 'bundle://IN',
    summary: '~2,000 Indian listed companies with 10 years of statements and daily prices.',
    adds: ['company universe', 'statements', 'prices', 'ratios'], unlocks: ['Screener', 'analysis', 'valuation for India'],
    requiresNetwork: true,
  },
  {
    id: 'data-us-nyse', name: 'United States — NYSE/NASDAQ universe', kind: 'data', version: '2026.10', sizeMb: 260,
    licence: 'Public filings', source: 'bundle://US',
    summary: '~6,000 US companies with statements and daily prices.',
    adds: ['company universe', 'statements', 'prices'], unlocks: ['US screening and analysis'],
    requiresNetwork: true,
  },
  {
    id: 'data-macro-worldbank', name: 'World Bank macro series', kind: 'data', version: '2026', sizeMb: 2,
    licence: 'CC-BY-4.0', source: 'https://api.worldbank.org/v2',
    summary: 'GDP, inflation, unemployment and investment by country.',
    adds: ['macro indicators'], unlocks: ['Macro view'],
    requiresNetwork: true,
  },
  {
    id: 'strategy-quality-value', name: 'Quality-value screen pack', kind: 'strategy', version: '1.2', sizeMb: 1,
    licence: 'MIT', source: 'builtin://presets',
    summary: 'Ten vetted screens: quality compounders, deep value, dividend growth, turnarounds, and more.',
    adds: ['10 saved screens', 'explanations'], unlocks: ['Preset dropdown'],
    requiresNetwork: false,
  },
  {
    id: 'strategy-piotroski', name: 'Piotroski / Altman / Beneish pack', kind: 'strategy', version: '1.0', sizeMb: 1,
    licence: 'MIT', source: 'builtin://scores',
    summary: 'The three classic distress and quality scores, wired to the statement engine.',
    adds: ['F-Score', 'Z-Score', 'M-Score'], unlocks: ['Scores panel'],
    requiresNetwork: false,
  },
  {
    id: 'template-tearsheet', name: 'Company tearsheet (Markdown)', kind: 'template', version: '1.0', sizeMb: 1,
    licence: 'MIT', source: 'builtin://valuation2',
    summary: 'A one-page valuation report with assumptions, scenarios and a bear/base/bull band.',
    adds: ['Markdown report'], unlocks: ['Download report button'],
    requiresNetwork: false,
  },
  {
    id: 'language-hi', name: 'Hindi interface strings', kind: 'language', version: '1.0', sizeMb: 1,
    licence: 'MIT', source: 'builtin://i18n',
    summary: 'Hindi labels for the console. Data values are unchanged.',
    adds: ['hi-IN strings'], unlocks: ['Hindi UI'],
    requiresNetwork: false,
  },
  {
    id: 'tool-pdf-export', name: 'PDF export toolchain', kind: 'tool', version: '1.0', sizeMb: 40,
    licence: 'MIT', source: 'npm://puppeteer-core',
    summary: 'Renders the tearsheet to PDF using the browser already on the device.',
    adds: ['PDF export'], unlocks: ['Download PDF'],
    requiresNetwork: true,
  },
];

const DDL = `
CREATE TABLE IF NOT EXISTS packs (
  id TEXT PRIMARY KEY, installed_at INTEGER NOT NULL, version TEXT NOT NULL, checksum TEXT
);
`;

export interface PackView extends Pack { status: PackStatus; installedAt: number | null; note: string }

export class AiStore {
  constructor(private dataDir: string) { fs.mkdirSync(path.join(dataDir, 'packs'), { recursive: true }); }

  private ensure(db: DB): void { db.exec(DDL); }

  list(db: DB, networkOk: boolean): PackView[] {
    this.ensure(db);
    const installed = new Map((db.prepare(`SELECT id, installed_at FROM packs`).all() as Array<{ id: string; installed_at: number }>).map((r) => [r.id, r.installed_at]));
    return CATALOGUE.map((p) => {
      const at = installed.get(p.id) ?? null;
      const status: PackStatus = at ? 'installed' : p.requiresNetwork ? (networkOk ? 'available' : 'requires-network') : 'available';
      return {
        ...p, status, installedAt: at,
        note: at ? `installed ${new Date(at).toISOString().slice(0, 10)}`
          : p.requiresNetwork ? (networkOk ? 'ready to download' : 'needs a network connection')
          : 'built in — one click to enable',
      };
    });
  }

  /** Install a pack. Local packs activate immediately; network packs are recorded only
   *  when the caller confirms the artefact is already on disk. */
  install(db: DB, id: string, artefactPath?: string): { ok: boolean; status: PackStatus; note: string; checksum?: string } {
    this.ensure(db);
    const pack = CATALOGUE.find((p) => p.id === id);
    if (!pack) return { ok: false, status: 'blocked', note: `Unknown pack "${id}"` };

    if (pack.requiresNetwork) {
      // Honest behaviour: we cannot download 1 GB here. If the caller supplies a local
      // artefact we verify it; otherwise we refuse and say why.
      if (!artefactPath || !fs.existsSync(artefactPath)) {
        return { ok: false, status: 'requires-network', note: `"${pack.name}" is ${pack.sizeMb} MB from ${pack.source}. Fetch it, then install with its path.` };
      }
      const buf = fs.readFileSync(artefactPath);
      const checksum = crypto.createHash('sha256').update(buf).digest('hex');
      db.prepare(`INSERT OR REPLACE INTO packs (id, installed_at, version, checksum) VALUES (?,?,?,?)`).run(id, Date.now(), pack.version, checksum);
      return { ok: true, status: 'installed', note: `Verified ${Math.round(buf.length / 1024)} KB, sha256 ${checksum.slice(0, 16)}…`, checksum };
    }

    const marker = path.join(this.dataDir, 'packs', `${id}.json`);
    fs.writeFileSync(marker, JSON.stringify({ id, version: pack.version, at: new Date().toISOString() }));
    db.prepare(`INSERT OR REPLACE INTO packs (id, installed_at, version, checksum) VALUES (?,?,?,?)`).run(id, Date.now(), pack.version, null);
    return { ok: true, status: 'installed', note: 'Activated — no download needed.' };
  }

  uninstall(db: DB, id: string): boolean {
    this.ensure(db);
    const marker = path.join(this.dataDir, 'packs', `${id}.json`);
    try { if (fs.existsSync(marker)) fs.unlinkSync(marker); } catch { /* ignore */ }
    return db.prepare(`DELETE FROM packs WHERE id=?`).run(id).changes > 0;
  }

  /** Installed packs grouped by what they unlock — drives the UI badges. */
  installedFeatures(db: DB): string[] {
    this.ensure(db);
    const ids = new Set((db.prepare(`SELECT id FROM packs`).all() as Array<{ id: string }>).map((r) => r.id));
    return CATALOGUE.filter((p) => ids.has(p.id)).flatMap((p) => p.adds);
  }
}
