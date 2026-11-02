// Minimal HTTPS GET that honours an egress proxy.
//
// Node's built-in fetch does NOT read https_proxy, so in an environment that only
// allows outbound traffic through a proxy (common on corporate networks and in this
// sandbox) every request fails with a connect timeout. curl honours the variable,
// Node does not. This helper closes that gap with a CONNECT tunnel.
import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';

export interface SimpleResponse { status: number; body: string; headers?: Record<string, string> }

function directGet(url: URL, headers: Record<string, string>, method = 'GET', body = ''): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: url.hostname, path: url.pathname + url.search, headers, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        const hdrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') hdrs[k.toLowerCase()] = v;
        resolve({ status: res.statusCode ?? 0, body, headers: hdrs });
      });
    });
    if (body) req.write(body);
    req.end();
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

function connectTunnel(proxy: URL, host: string, port: number): Promise<import('net').Socket> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: proxy.hostname, port: Number(proxy.port || 3128), method: 'CONNECT',
      path: `${host}:${port}`,
      headers: proxy.username ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64') } : {},
    });
    req.on('connect', (res, socket) => {
      if ((res.statusCode ?? 0) !== 200) { reject(new Error(`proxy CONNECT failed: ${res.statusCode}`)); return; }
      resolve(socket);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('proxy timeout')));
    req.end();
  });
}

/** Decode HTTP/1.1 chunked transfer-encoding. */
export function dechunk(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const lineEnd = raw.indexOf('\r\n', i);
    if (lineEnd < 0) break;
    const sizeHex = raw.slice(i, lineEnd).split(';')[0]!.trim();
    const size = parseInt(sizeHex, 16);
    if (!Number.isFinite(size) || size <= 0) break;
    const start = lineEnd + 2;
    out += raw.slice(start, start + size);
    i = start + size + 2;
  }
  return out;
}

function viaProxy(url: URL, headers: Record<string, string>, proxy: URL, method = 'GET', body = ''): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    connectTunnel(proxy, url.hostname, Number(url.port || 443))
      .then((socket) => {
        const tlsSocket = tls.connect({ socket, servername: url.hostname }, () => {
          const hdrs = { Host: url.hostname, Connection: 'close', ...headers };
          const head = `${method} ${url.pathname}${url.search} HTTP/1.1\r\n` + Object.entries(hdrs).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n' + body;
          tlsSocket.write(head);
        });
        let raw = '';
        tlsSocket.setEncoding('utf8');
        tlsSocket.on('data', (c) => { raw += c; });
        tlsSocket.on('end', () => {
          const split = raw.indexOf('\r\n\r\n');
          if (split < 0) { reject(new Error('malformed response')); return; }
          const head = raw.slice(0, split);
          let body = raw.slice(split + 4);
          const status = Number(/^HTTP\/\d\.\d (\d+)/.exec(head)?.[1] ?? 0);
          const hdrs: Record<string, string> = {};
          for (const line of head.split('\r\n').slice(1)) {
            const i = line.indexOf(':');
            if (i > 0) hdrs[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
          }
          // Yahoo and friends use chunked encoding; the raw socket gives us the frames.
          if ((hdrs['transfer-encoding'] ?? '').toLowerCase().includes('chunked')) body = dechunk(body);
          resolve({ status, body, headers: hdrs });
        });
        tlsSocket.on('error', reject);
        tlsSocket.setTimeout(20000, () => tlsSocket.destroy(new Error('timeout')));
      })
      .catch(reject);
  });
}

/** GET a URL as text, through https_proxy when one is configured. */
/** Probe timeout: short, so a dead host cannot stall a status page. */
const PROBE_TIMEOUT_MS = 6000;

export async function httpsGetText(urlStr: string, headers: Record<string, string> = {}, redirects = 0): Promise<SimpleResponse> {
  const url = new URL(urlStr);
  const proxy = process.env['https_proxy'] ?? process.env['HTTPS_PROXY'] ?? process.env['http_proxy'] ?? process.env['HTTP_PROXY'];
  const hdrs = { 'Accept-Encoding': 'identity', ...headers };
  let res: SimpleResponse;
  if (proxy) {
    try { res = await viaProxy(url, hdrs, new URL(proxy)); }
    catch { res = await directGet(url, hdrs); }
  } else {
    res = await directGet(url, hdrs);
  }
  const location = res.headers?.['location'];
  if (res.status >= 300 && res.status < 400 && location && redirects < 3) {
    const next = new URL(location, url).toString();
    return httpsGetText(next, headers, redirects + 1);
  }
  return res;
}

/** POST a JSON body and return the raw response. */
export async function httpsPostText(urlStr: string, body: string, headers: Record<string, string> = {}): Promise<SimpleResponse> {
  const url = new URL(urlStr);
  const proxy = process.env['https_proxy'] ?? process.env['HTTPS_PROXY'] ?? process.env['http_proxy'] ?? process.env['HTTP_PROXY'];
  const hdrs = { 'Accept-Encoding': 'identity', ...headers };
  if (proxy) {
    try { return await viaProxy(url, hdrs, new URL(proxy), 'POST', body); }
    catch { return await directGet(url, hdrs, 'POST', body); }
  }
  return directGet(url, hdrs, 'POST', body);
}

/** GET a URL and parse JSON. */
export async function httpsGetJson<T>(urlStr: string, headers: Record<string, string> = {}): Promise<{ status: number; json: T | null }> {
  const res = await httpsGetText(urlStr, { Accept: 'application/json', ...headers });
  try { return { status: res.status, json: JSON.parse(res.body) as T }; }
  catch { return { status: res.status, json: null }; }
}

// ---- cookie-aware session ---------------------------------------------------

/** A tiny cookie jar so multi-step flows (Yahoo's consent → crumb) work in Node. */
export class HttpSession {
  private cookies = new Map<string, string>();
  constructor(private userAgent = 'Mozilla/5.0 (compatible; Atlas/1.0)') {}

  private cookieHeader(): string { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }

  private absorb(res: SimpleResponse): void {
    const set = res.headers?.['set-cookie'];
    if (!set) return;
    for (const part of set.split(/,(?=[^;]+=)/)) {
      const kv = part.split(';')[0] ?? '';
      const i = kv.indexOf('=');
      if (i > 0) this.cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
  }

  /** POST JSON — needed by Yahoo's custom screener, which is GET-only elsewhere. */
  async post(url: string, body: string, headers: Record<string, string> = {}): Promise<SimpleResponse> {
    const h: Record<string, string> = {
      'User-Agent': this.userAgent, Accept: 'application/json',
      'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), ...headers,
    };
    const cookie = this.cookieHeader();
    if (cookie) h['Cookie'] = cookie;
    const res = await httpsPostText(url, body, h);
    this.absorb(res);
    return res;
  }

  async get(url: string, headers: Record<string, string> = {}): Promise<SimpleResponse> {
    const h: Record<string, string> = { 'User-Agent': this.userAgent, Accept: 'application/json', ...headers };
    const cookie = this.cookieHeader();
    if (cookie) h['Cookie'] = cookie;
    const res = await httpsGetText(url, h);
    this.absorb(res);
    return res;
  }

  async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<{ status: number; json: T | null }> {
    const res = await this.get(url, headers);
    try { return { status: res.status, json: JSON.parse(res.body) as T }; } catch { return { status: res.status, json: null }; }
  }
}

/**
 * Stream a URL straight to a file, through https_proxy when one is configured.
 *
 * A model is hundreds of megabytes: buffering it in memory would be wasteful, and Node's
 * built-in fetch ignores the proxy environment, so this reuses the same CONNECT tunnel as
 * the text client and pipes the response to disk.
 */
export async function httpsDownloadToFile(
  urlStr: string,
  dest: string,
  onProgress?: (bytes: number, total: number | null) => void,
  headers: Record<string, string> = {},
  redirects = 0,
): Promise<{ ok: boolean; bytes: number; total: number | null; error: string | null }> {
  const fsMod = await import('node:fs');
  const url = new URL(urlStr);
  const proxy = process.env['https_proxy'] ?? process.env['HTTPS_PROXY'] ?? process.env['http_proxy'] ?? process.env['HTTP_PROXY'];
  const hdrs = { 'Accept-Encoding': 'identity', ...headers };

  const write = (res: import('node:http').IncomingMessage): Promise<{ ok: boolean; bytes: number; total: number | null; error: string | null }> =>
    new Promise((resolve) => {
      const total = Number(res.headers['content-length'] ?? 0) || null;
      let bytes = 0;
      const out = fsMod.createWriteStream(dest);
      res.on('data', (c: Buffer) => { bytes += c.length; out.write(c); if (onProgress) onProgress(bytes, total); });
      res.on('end', () => { out.end(() => resolve({ ok: true, bytes, total, error: null })); });
      res.on('error', (e: Error) => { out.end(() => resolve({ ok: false, bytes, total, error: e.message })); });
    });

  try {
    if (proxy) {
      const socket = await connectTunnel(new URL(proxy), url.hostname, Number(url.port || 443));
      const res = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
        const req = https.request({ host: url.hostname, path: url.pathname + url.search, method: 'GET', headers: hdrs, createConnection: () => socket as unknown as import('node:net').Socket, servername: url.hostname }, resolve);
        req.on('error', reject);
        req.end();
      });
      const loc = res.headers['location'];
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && typeof loc === 'string' && redirects < 3) {
        res.resume();
        return httpsDownloadToFile(new URL(loc, url).toString(), dest, onProgress, headers, redirects + 1);
      }
      if ((res.statusCode ?? 0) !== 200) { res.resume(); return { ok: false, bytes: 0, total: null, error: `HTTP ${res.statusCode}` }; }
      return await write(res);
    }
    const res = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const req = https.request({ host: url.hostname, path: url.pathname + url.search, method: 'GET', headers: hdrs }, resolve);
      req.on('error', reject);
      req.end();
    });
    if ((res.statusCode ?? 0) !== 200) { res.resume(); return { ok: false, bytes: 0, total: null, error: `HTTP ${res.statusCode}` }; }
    return await write(res);
  } catch (e) {
    return { ok: false, bytes: 0, total: null, error: e instanceof Error ? e.message : 'download failed' };
  }
}
