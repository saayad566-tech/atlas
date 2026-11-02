// Multi-tenant access: scoped API keys so one deployment can serve several isolated users.
//
// Keys are stored as SHA-256 hashes — the plaintext is shown once at creation and never
// again, so a stolen database cannot be used to authenticate.

import crypto from 'node:crypto';
import type { Database as DB } from 'better-sqlite3';

export type Scope = 'read' | 'write' | 'admin';

export interface Tenant { id: string; name: string; createdAt: number; active: boolean; dataDir: string }
export interface KeyInfo { id: number; tenantId: string; label: string; scopes: Scope[]; createdAt: number; lastUsedAt: number | null; active: boolean }

const DDL = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, data_dir TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenant_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, label TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, created_at INTEGER NOT NULL,
  last_used_at INTEGER, active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_keys_hash ON tenant_keys(hash);
`;

const hash = (key: string): string => crypto.createHash('sha256').update(key).digest('hex');

/** Constant-time comparison, so a wrong key cannot be discovered by timing. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export class Tenants {
  constructor(private db: DB) { this.db.exec(DDL); }

  create(name: string, dataDir: string): Tenant {
    const id = `t_${crypto.randomBytes(6).toString('hex')}`;
    const now = Date.now();
    this.db.prepare(`INSERT INTO tenants (id,name,created_at,active,data_dir) VALUES (?,?,?,1,?)`).run(id, name, now, dataDir);
    return { id, name, createdAt: now, active: true, dataDir };
  }

  list(): Tenant[] {
    return (this.db.prepare(`SELECT * FROM tenants ORDER BY created_at ASC`).all() as Array<Record<string, unknown>>).map((r) => ({
      id: String(r['id']), name: String(r['name']), createdAt: Number(r['created_at']),
      active: Number(r['active']) === 1, dataDir: String(r['data_dir']),
    }));
  }

  /** Create a key. The plaintext is returned exactly once and never stored. */
  issueKey(tenantId: string, label: string, scopes: Scope[] = ['read']): { key: string; info: KeyInfo } {
    const tenant = this.db.prepare(`SELECT id FROM tenants WHERE id=?`).get(tenantId);
    if (!tenant) throw new Error(`Unknown tenant "${tenantId}"`);
    const key = `atl_${crypto.randomBytes(24).toString('base64url')}`;
    const now = Date.now();
    const r = this.db.prepare(`INSERT INTO tenant_keys (tenant_id,label,hash,scopes,created_at,active) VALUES (?,?,?,?,?,1)`)
      .run(tenantId, label, hash(key), scopes.join(','), now);
    return {
      key,
      info: { id: Number(r.lastInsertRowid), tenantId, label, scopes, createdAt: now, lastUsedAt: null, active: true },
    };
  }

  listKeys(tenantId: string): KeyInfo[] {
    return (this.db.prepare(`SELECT * FROM tenant_keys WHERE tenant_id=? ORDER BY created_at DESC`).all(tenantId) as Array<Record<string, unknown>>).map((r) => ({
      id: Number(r['id']), tenantId: String(r['tenant_id']), label: String(r['label']),
      scopes: String(r['scopes']).split(',').filter(Boolean) as Scope[],
      createdAt: Number(r['created_at']),
      lastUsedAt: r['last_used_at'] === null ? null : Number(r['last_used_at']),
      active: Number(r['active']) === 1,
    }));
  }

  /** Verify a presented key. Returns the tenant and its scopes, or null. */
  verify(key: string): { tenantId: string; scopes: Scope[] } | null {
    if (!key || !key.startsWith('atl_')) return null;
    const h = hash(key);
    const row = this.db.prepare(`SELECT * FROM tenant_keys WHERE hash=? AND active=1`).get(h) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (!safeEqual(String(row['hash']), h)) return null;
    const tenant = this.db.prepare(`SELECT active FROM tenants WHERE id=?`).get(String(row['tenant_id'])) as { active: number } | undefined;
    if (!tenant || tenant.active !== 1) return null;
    this.db.prepare(`UPDATE tenant_keys SET last_used_at=? WHERE id=?`).run(Date.now(), Number(row['id']));
    return { tenantId: String(row['tenant_id']), scopes: String(row['scopes']).split(',').filter(Boolean) as Scope[] };
  }

  revoke(keyId: number): boolean {
    const r = this.db.prepare(`UPDATE tenant_keys SET active=0 WHERE id=?`).run(keyId);
    return r.changes > 0;
  }

  hasScope(scopes: Scope[], needed: Scope): boolean {
    if (scopes.includes('admin')) return true;
    if (needed === 'read') return scopes.includes('read') || scopes.includes('write');
    return scopes.includes(needed);
  }
}
