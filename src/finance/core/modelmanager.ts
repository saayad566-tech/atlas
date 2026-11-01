// Local model manager: device-aware recommendation, install, store, switch.
//
// The point is that a user on a 2 GB phone and a user on a 32 GB workstation should be
// told different things, and neither should have to guess which file to download.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export interface DeviceProfile {
  cores: number; ramMb: number; freeDiskMb: number; platform: string; arch: string; tier: 'low' | 'mid' | 'high';
}

export interface ModelVariant {
  id: string; name: string; family: string; params: string; quant: 'Q4_K_M' | 'Q5_K_M' | 'Q8_0' | 'fp16';
  sizeMb: number; ramNeededMb: number; licence: string; source: string; sha256?: string;
  quality: 1 | 2 | 3 | 4 | 5; speed: 1 | 2 | 3 | 4 | 5;
}

/** A small, honest catalogue — every entry is a real published model. */
export const MODEL_CATALOGUE: ModelVariant[] = [
  { id: 'qwen2.5-0.5b-q4', name: 'Qwen2.5 0.5B Instruct Q4_K_M', family: 'Qwen2.5', params: '0.5B', quant: 'Q4_K_M', sizeMb: 398, ramNeededMb: 700, licence: 'Apache-2.0', source: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF', quality: 2, speed: 5 },
  { id: 'qwen2.5-1.5b-q4', name: 'Qwen2.5 1.5B Instruct Q4_K_M', family: 'Qwen2.5', params: '1.5B', quant: 'Q4_K_M', sizeMb: 1024, ramNeededMb: 1600, licence: 'Apache-2.0', source: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF', quality: 3, speed: 4 },
  { id: 'qwen2.5-3b-q4', name: 'Qwen2.5 3B Instruct Q4_K_M', family: 'Qwen2.5', params: '3B', quant: 'Q4_K_M', sizeMb: 1900, ramNeededMb: 2800, licence: 'Qwen licence', source: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF', quality: 4, speed: 3 },
  { id: 'llama3.2-1b-q4', name: 'Llama 3.2 1B Instruct Q4_K_M', family: 'Llama 3.2', params: '1B', quant: 'Q4_K_M', sizeMb: 808, ramNeededMb: 1300, licence: 'Llama 3.2 Community', source: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF', quality: 3, speed: 4 },
  { id: 'llama3.2-1b-q8', name: 'Llama 3.2 1B Instruct Q8_0', family: 'Llama 3.2', params: '1B', quant: 'Q8_0', sizeMb: 1320, ramNeededMb: 1900, licence: 'Llama 3.2 Community', source: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF', quality: 3, speed: 3 },
  { id: 'qwen2.5-7b-q4', name: 'Qwen2.5 7B Instruct Q4_K_M', family: 'Qwen2.5', params: '7B', quant: 'Q4_K_M', sizeMb: 4680, ramNeededMb: 6400, licence: 'Qwen licence', source: 'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF', quality: 5, speed: 2 },
];

export function deviceProfile(): DeviceProfile {
  const ramMb = Math.round(os.totalmem() / (1024 * 1024));
  const cores = os.cpus().length;
  let freeDiskMb = 0;
  try { const st = fs.statfsSync(process.cwd()); freeDiskMb = Math.round((st.bavail * st.bsize) / (1024 * 1024)); } catch { /* unknown */ }
  const tier: DeviceProfile['tier'] = ramMb >= 8000 ? 'high' : ramMb >= 3000 ? 'mid' : 'low';
  return { cores, ramMb, freeDiskMb, platform: process.platform, arch: process.arch, tier };
}

export interface Recommendation {
  device: DeviceProfile;
  best: ModelVariant | null;
  reason: string;
  options: Array<{ model: ModelVariant; verdict: 'recommended' | 'fits' | 'tight' | 'too-big'; note: string }>;
}

/** Which model actually suits this device — by RAM headroom and disk, not by hype. */
export function recommendModel(profile: DeviceProfile = deviceProfile()): Recommendation {
  const usableRam = profile.ramMb * 0.7;           // leave room for the OS and the app
  const options = MODEL_CATALOGUE.map((model) => {
    const ramOk = model.ramNeededMb <= usableRam;
    const diskOk = model.sizeMb < profile.freeDiskMb;
    let verdict: 'recommended' | 'fits' | 'tight' | 'too-big';
    if (!diskOk) verdict = 'too-big';
    else if (!ramOk) verdict = 'too-big';
    else if (model.ramNeededMb > usableRam * 0.8) verdict = 'tight';
    else verdict = 'fits';
    const note = !diskOk ? `needs ${model.sizeMb} MB disk, ${profile.freeDiskMb} MB free`
      : !ramOk ? `needs ~${model.ramNeededMb} MB RAM, ~${Math.round(usableRam)} MB usable`
      : verdict === 'tight' ? 'runs, but leaves little headroom' : 'comfortable';
    return { model, verdict, note };
  });
  // Best = highest quality among those that fit comfortably, else the largest that fits.
  const fitting = options.filter((o) => o.verdict === 'fits');
  const tight = options.filter((o) => o.verdict === 'tight');
  const pool = fitting.length ? fitting : tight;
  const best = pool.sort((a, b) => b.model.quality - a.model.quality || a.model.sizeMb - b.model.sizeMb)[0]?.model ?? null;
  const reason = best
    ? `${profile.tier} device (${profile.ramMb} MB RAM, ${profile.cores} cores): ${best.name} fits with headroom and gives the best quality per megabyte.`
    : `No catalogue model fits ${profile.ramMb} MB RAM / ${profile.freeDiskMb} MB disk. The deterministic engine will answer instead.`;
  return { device: profile, best, reason, options: options.sort((a, b) => b.model.quality - a.model.quality) };
}

export interface InstalledModel { id: string; name: string; sizeMb: number; file: string; installedAt: number; active: boolean; sha256: string | null }

/** Local model store: files on disk + a small JSON manifest. */
export class ModelStore {
  private readonly dir: string;
  private readonly manifest: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'models');
    this.manifest = path.join(this.dir, 'installed.json');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private read(): Record<string, { file: string; installedAt: number; sha256: string | null }> {
    try { return JSON.parse(fs.readFileSync(this.manifest, 'utf8')) as Record<string, { file: string; installedAt: number; sha256: string | null }>; }
    catch { return {}; }
  }

  private write(m: Record<string, { file: string; installedAt: number; sha256: string | null }>): void {
    fs.writeFileSync(this.manifest, JSON.stringify(m, null, 2));
  }

  list(): InstalledModel[] {
    const m = this.read();
    const activeId = this.activeId();
    return Object.entries(m).map(([id, v]) => {
      const spec = MODEL_CATALOGUE.find((x) => x.id === id);
      let sizeMb = spec?.sizeMb ?? 0;
      try { sizeMb = Math.round((fs.statSync(path.join(this.dir, v.file)).size / (1024 * 1024)) * 100) / 100; } catch { /* keep spec */ }
      return { id, name: spec?.name ?? id, sizeMb, file: v.file, installedAt: v.installedAt, active: id === activeId, sha256: v.sha256 };
    }).sort((a, b) => b.installedAt - a.installedAt);
  }

  /** Absolute path for a stored model — export/import must agree on this. */
  absolutePath(id: string): string | null {
    const entry = this.read()[id];
    if (!entry) return null;
    return path.isAbsolute(entry.file) ? entry.file : path.join(this.dir, entry.file);
  }

  diskUsageMb(): number { return Math.round(this.list().reduce((a, m) => a + m.sizeMb, 0) * 100) / 100; }

  activeId(): string | null {
    try { return (JSON.parse(fs.readFileSync(path.join(this.dir, 'active.json'), 'utf8')) as { id?: string }).id ?? null; } catch { return null; }
  }

  activeModel(): InstalledModel | null { const id = this.activeId(); return id ? this.list().find((m) => m.id === id) ?? null : null; }

  switchTo(id: string): boolean {
    if (!this.list().some((m) => m.id === id)) return false;
    fs.writeFileSync(path.join(this.dir, 'active.json'), JSON.stringify({ id, at: Date.now() }));
    return true;
  }

  clearActive(): void { try { fs.unlinkSync(path.join(this.dir, 'active.json')); } catch { /* none */ } }

  /** Install from a local file (offline) — the network path is the store's job. */
  installFromFile(id: string, sourcePath: string): { ok: boolean; error?: string; model?: InstalledModel } {
    const spec = MODEL_CATALOGUE.find((x) => x.id === id);
    if (!spec) return { ok: false, error: `Unknown model "${id}"` };
    if (!fs.existsSync(sourcePath)) return { ok: false, error: `Source file not found: ${sourcePath}` };
    const size = fs.statSync(sourcePath).size;
    if (size < 1024) return { ok: false, error: 'File is too small to be a model' };
    // Refuse anything that is not really a GGUF, and anything that will not fit.
    const head = validateGguf(sourcePath);
    if (!head.ok) return { ok: false, error: `Not a usable model: ${head.reason}` };
    let freeMb = 0;
    try { const st = fs.statfsSync(this.dir); freeMb = Math.round((st.bavail * st.bsize) / (1024 * 1024)); } catch { /* unknown */ }
    if (freeMb && size / (1024 * 1024) > freeMb * 0.9) return { ok: false, error: `Needs ${Math.round(size / 1048576)} MB, only ${freeMb} MB free` };
    const dest = path.join(this.dir, `${id}.gguf`);
    fs.copyFileSync(sourcePath, dest);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
    const m = this.read();
    m[id] = { file: path.basename(dest), installedAt: Date.now(), sha256 };
    this.write(m);
    return { ok: true, model: this.list().find((x) => x.id === id) };
  }

  /** Register a model that is already managed elsewhere (e.g. by ollama). */
  registerExternal(id: string, externalPath: string): { ok: boolean; error?: string } {
    if (!MODEL_CATALOGUE.some((x) => x.id === id)) return { ok: false, error: `Unknown model "${id}"` };
    if (!fs.existsSync(externalPath)) return { ok: false, error: `Path not found: ${externalPath}` };
    const m = this.read();
    m[id] = { file: externalPath, installedAt: Date.now(), sha256: null };
    this.write(m);
    return { ok: true };
  }

  remove(id: string): boolean {
    const m = this.read();
    const entry = m[id];
    if (!entry) return false;
    try { fs.unlinkSync(path.join(this.dir, entry.file)); } catch { /* may be external */ }
    delete m[id];
    this.write(m);
    if (this.activeId() === id) this.clearActive();
    return true;
  }

  /** Verify a stored model file still exists and matches its recorded hash. */
  verify(id: string): { ok: boolean; reason?: string } {
    const m = this.read();
    const entry = m[id];
    if (!entry) return { ok: false, reason: 'not installed' };
    const file = path.join(this.dir, entry.file);
    if (!fs.existsSync(file)) return { ok: false, reason: 'file missing on disk' };
    if (entry.sha256) {
      const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      if (actual !== entry.sha256) return { ok: false, reason: 'checksum mismatch — file changed' };
    }
    return { ok: true };
  }
}

// ---- runtime dependencies ---------------------------------------------------
// A model file is useless without a runtime. These checks say what is available
// before the user wonders why nothing answers.

export interface RuntimeInfo {
  id: 'ollama' | 'llamacpp' | 'none';
  name: string;
  available: boolean;
  endpoint: string | null;
  detail: string;
  install: string;
}

export interface GgufInfo { ok: boolean; reason?: string; version?: number; tensorCount?: number; magic?: string }

/** Read the real bytes: a GGUF file starts with the ASCII magic "GGUF". */
export function validateGguf(file: string): GgufInfo {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(24);
    const read = fs.readSync(fd, head, 0, 24, 0);
    fs.closeSync(fd);
    if (read < 24) return { ok: false, reason: 'file is shorter than a GGUF header' };
    const magic = head.subarray(0, 4).toString('ascii');
    if (magic !== 'GGUF') return { ok: false, reason: `not a GGUF file (magic "${magic}")`, magic };
    const version = head.readUInt32LE(4);
    if (version < 1 || version > 10) return { ok: false, reason: `unsupported GGUF version ${version}`, magic, version };
    const tensorCount = Number(head.readBigUInt64LE(8));
    if (tensorCount === 0) return { ok: false, reason: 'header declares zero tensors — likely truncated', magic, version, tensorCount };
    return { ok: true, magic, version, tensorCount };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Probe the two runtimes people actually use. Loopback only. */
export async function detectRuntime(fetchImpl: typeof fetch = fetch): Promise<RuntimeInfo[]> {
  const probe = async (url: string): Promise<boolean> => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1200);
      const r = await fetchImpl(url, { signal: ctl.signal });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  };
  const ollamaUp = await probe('http://127.0.0.1:11434/api/tags');
  const llamaUp = await probe('http://127.0.0.1:8080/health');
  const hasBin = (bin: string): boolean => {
    try { require('child_process').execSync(`command -v ${bin}`, { stdio: 'ignore' }); return true; } catch { return false; }
  };
  return [
    {
      id: 'ollama', name: 'Ollama', available: ollamaUp || hasBin('ollama'),
      endpoint: ollamaUp ? 'http://127.0.0.1:11434' : null,
      detail: ollamaUp ? 'running on 127.0.0.1:11434' : hasBin('ollama') ? 'binary present, server not running' : 'not installed',
      install: 'curl -fsSL https://ollama.com/install.sh | sh && ollama serve',
    },
    {
      id: 'llamacpp', name: 'llama.cpp server', available: llamaUp || hasBin('llama-server'),
      endpoint: llamaUp ? 'http://127.0.0.1:8080' : null,
      detail: llamaUp ? 'running on 127.0.0.1:8080' : hasBin('llama-server') ? 'binary present, server not running' : 'not installed',
      install: 'Build from https://github.com/ggml-org/llama.cpp then: llama-server -m model.gguf --port 8080',
    },
  ];
}

export interface ConfigBundle { version: number; exportedAt: string; active: string | null; models: Array<{ id: string; file: string }> }

/** Export/import the model configuration so a user can move it between devices. */
export function exportConfig(store: ModelStore): ConfigBundle {
  return {
    version: 1, exportedAt: new Date().toISOString(), active: store.activeId(),
    // Absolute paths: a bare filename means nothing on another device.
    models: store.list().map((m) => ({ id: m.id, file: store.absolutePath(m.id) ?? m.file })),
  };
}

export function importConfig(store: ModelStore, bundle: unknown): { ok: boolean; registered: number; error?: string } {
  const b = bundle as Partial<ConfigBundle>;
  if (!b || typeof b !== 'object' || !Array.isArray(b.models)) return { ok: false, registered: 0, error: 'invalid config bundle' };
  let registered = 0;
  for (const m of b.models) {
    if (!m || typeof m.id !== 'string') continue;
    const r = store.registerExternal(m.id, String(m.file ?? ''));
    if (r.ok) registered++;
  }
  if (b.active && store.list().some((x) => x.id === b.active)) store.switchTo(b.active);
  return { ok: true, registered };
}
