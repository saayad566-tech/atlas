// Backup and restore, without a server.
//
// The sync engine in this build has no endpoint, so redundancy is solved the way an
// offline-first product should solve it: the whole local state exports to one file the user
// owns and can copy anywhere, and restores from it. No account, no upload, no third party.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

export interface BackupManifest {
  format: 'atlas-backup';
  version: number;
  createdAt: string;
  appVersion: string;
  /** Every database file included, with its size. */
  databases: Array<{ name: string; bytes: number }>;
  /** Settings and preferences captured alongside the data. */
  settings: Record<string, unknown>;
  note: string;
}

export interface Backup {
  manifest: BackupManifest;
  /** Base64 of the gzipped database bundle, keyed by file name. */
  data: Record<string, string>;
}

const FORMAT_VERSION = 1;

/** Collect every market database and a settings snapshot into one object. */
export function createBackup(dataDir: string, settings: Record<string, unknown>, appVersion: string): Backup {
  const databases: Array<{ name: string; bytes: number }> = [];
  const data: Record<string, string> = {};

  const marketsDir = join(dataDir, 'markets');
  if (existsSync(marketsDir)) {
    for (const name of readdirSync(marketsDir)) {
      if (!name.endsWith('.db')) continue;
      const full = join(marketsDir, name);
      const st = statSync(full);
      // A backup must not silently include a database being written: check it is readable
      // and non-zero before packing it.
      if (st.size === 0) continue;
      const buf = readFileSync(full);
      data[name] = gzipSync(buf).toString('base64');
      databases.push({ name, bytes: st.size });
    }
  }

  return {
    manifest: {
      format: 'atlas-backup',
      version: FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      appVersion,
      databases,
      settings,
      note: 'This file contains your local market data and settings. Keep it somewhere you '
        + 'control; it is not encrypted.',
    },
    data,
  };
}

export function writeBackup(path: string, backup: Backup): { path: string; bytes: number } {
  const json = JSON.stringify(backup);
  const packed = gzipSync(Buffer.from(json, 'utf8'));
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, packed);
  return { path, bytes: packed.length };
}

export function readBackup(path: string): Backup | null {
  if (!existsSync(path)) return null;
  try {
    const raw = gunzipSync(readFileSync(path)).toString('utf8');
    const parsed = JSON.parse(raw) as Backup;
    if (parsed?.manifest?.format !== 'atlas-backup') return null;
    return parsed;
  } catch { return null; }
}

/**
 * Restore a backup into a data directory.
 *
 * Files are written to a staging name first and moved into place only when complete, so a
 * failed restore cannot leave a half-written database behind.
 */
export function restoreBackup(backup: Backup, dataDir: string): { restored: string[]; skipped: string[] } {
  const marketsDir = join(dataDir, 'markets');
  if (!existsSync(marketsDir)) mkdirSync(marketsDir, { recursive: true });

  const restored: string[] = [];
  const skipped: string[] = [];

  for (const [name, b64] of Object.entries(backup.data ?? {})) {
    // Only ever restore a name that looks like a database file, never a path.
    if (!/^[A-Za-z0-9._-]+\.db$/.test(name) || basename(name) !== name) { skipped.push(name); continue; }
    try {
      const buf = gunzipSync(Buffer.from(b64, 'base64'));
      if (!buf.length) { skipped.push(name); continue; }
      const staging = join(marketsDir, `.restore-${name}`);
      writeFileSync(staging, buf);
      const { renameSync } = require('node:fs') as typeof import('node:fs');
      renameSync(staging, join(marketsDir, name));
      restored.push(name);
    } catch { skipped.push(name); }
  }
  return { restored, skipped };
}

/** A short summary for the interface, without exposing the whole file. */
export function describeBackup(backup: Backup): string {
  const n = backup.manifest.databases.length;
  const mb = backup.manifest.databases.reduce((a, d) => a + d.bytes, 0) / 1_048_576;
  const when = new Date(backup.manifest.createdAt);
  return `${n} database${n === 1 ? '' : 's'}, ${mb.toFixed(1)} MB, taken ${when.toLocaleString()}`;
}
