// Downloading a local model.
//
// HuggingFace is reachable, so the app can fetch a GGUF itself rather than telling the user
// to go and find one. Downloads stream to disk, report progress, and are verified before
// they are used — a truncated or wrong file must never be loaded as a model.

import fs from 'node:fs';
import path from 'node:path';
import { MODEL_CATALOGUE } from './modelmanager';
import { httpsDownloadToFile } from './net';

export interface DownloadProgress {
  id: string;
  state: 'starting' | 'downloading' | 'verifying' | 'done' | 'failed';
  bytes: number;
  totalBytes: number | null;
  pct: number | null;
  file: string | null;
  error: string | null;
}

const active = new Map<string, DownloadProgress>();

/**
 * HuggingFace serves a file at /<repo>/resolve/main/<file>. The catalogue stores the repo
 * page, so the filename is derived from the variant's quantisation.
 */
export function directUrl(id: string): string | null {
  const m = MODEL_CATALOGUE.find((x) => x.id === id);
  if (!m) return null;
  // The exact filename comes from the catalogue: deriving it from the model name produced
  // "qwen2.5-q4_k_m.gguf" when the real file is "qwen2.5-0.5b-instruct-q4_k_m.gguf".
  const repo = m.source.replace(/\/$/, '');
  if (!m.file) return null;
  return `${repo}/resolve/main/${m.file}`;
}

export function progressOf(id: string): DownloadProgress | null {
  return active.get(id) ?? null;
}

/** A GGUF file starts with the ASCII magic GGUF. */
export function looksLikeGguf(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    return head.toString('ascii') === 'GGUF';
  } catch { return false; }
}

/**
 * Fetch a model to `dir`. Streams so a 500 MB file does not sit in memory, and verifies the
 * result before reporting success.
 */
/**
 * Download with curl when it is present. Returns null when curl is unavailable, so the
 * caller can fall back. curl is used because it honours the proxy environment natively and
 * is installed by default on Linux, macOS and Windows 10+.
 */
async function curlDownload(
  url: string, dest: string, onProgress: (bytes: number, total: number | null) => void,
): Promise<{ ok: boolean; bytes: number; total: number | null; error: string | null } | null> {
  try {
    const { spawn } = await import('node:child_process');
    return await new Promise((resolve) => {
      const child = spawn('curl', ['-sL', '--fail', '--retry', '2', '-o', dest, url], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (c: Buffer) => { stderr += c.toString().slice(0, 400); });
      child.on('error', () => resolve(null));           // curl not installed
      child.on('close', (code) => {
        if (code !== 0) return resolve({ ok: false, bytes: 0, total: null, error: stderr.trim().slice(0, 200) || `curl exited ${code}` });
        try {
          const bytes = fs.statSync(dest).size;
          onProgress(bytes, bytes);
          resolve({ ok: true, bytes, total: bytes, error: null });
        } catch { resolve({ ok: false, bytes: 0, total: null, error: 'downloaded file missing' }); }
      });
    });
  } catch { return null; }
}

export async function downloadModel(id: string, dir: string, url?: string): Promise<DownloadProgress> {
  const m = MODEL_CATALOGUE.find((x) => x.id === id);
  if (!m) return { id, state: 'failed', bytes: 0, totalBytes: null, pct: null, file: null, error: `Unknown model "${id}"` };

  const target = path.join(dir, `${id}.gguf`);
  const state: DownloadProgress = { id, state: 'starting', bytes: 0, totalBytes: null, pct: null, file: target, error: null };
  active.set(id, state);

  if (fs.existsSync(target) && looksLikeGguf(target)) {
    const size = fs.statSync(target).size;
    Object.assign(state, { state: 'done', bytes: size, totalBytes: size, pct: 100 });
    return state;
  }

  const src = url ?? directUrl(id);
  if (!src) { Object.assign(state, { state: 'failed', error: 'no download URL for this model' }); return state; }

  try {
    fs.mkdirSync(dir, { recursive: true });
    const part = `${target}.part`;
    Object.assign(state, { state: 'downloading' });

    // curl first when it exists: it handles proxies, redirects and resume correctly on every
    // platform, and it is what actually works in a proxy-only environment. The internal
    // client is the fallback for machines without it.
    const r = (await curlDownload(src, part, (bytes, total) => {
      Object.assign(state, { bytes, totalBytes: total, pct: total ? Math.round((bytes / total) * 100) : null });
    })) ?? await httpsDownloadToFile(src, part, (bytes, total) => {
      Object.assign(state, { bytes, totalBytes: total, pct: total ? Math.round((bytes / total) * 100) : null });
    }, { 'User-Agent': 'Atlas/3.4 (+https://github.com/saayad566-tech/atlas)' });

    if (!r.ok) {
      fs.rmSync(part, { force: true });
      Object.assign(state, { state: 'failed', error: r.error ?? 'download failed' });
      return state;
    }

    Object.assign(state, { state: 'verifying' });
    if (!looksLikeGguf(part)) {
      fs.rmSync(part, { force: true });
      Object.assign(state, { state: 'failed', error: 'downloaded file is not a GGUF model' });
      return state;
    }
    fs.renameSync(part, target);
    Object.assign(state, { state: 'done', pct: 100, bytes: r.bytes });
    return state;
  } catch (e) {
    Object.assign(state, { state: 'failed', error: e instanceof Error ? e.message.slice(0, 200) : 'download failed' });
    return state;
  }
}
