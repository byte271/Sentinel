// ---------------------------------------------------------------------------
// B4: HTTP server X-Sentinel-Token authentication + token lifecycle tests.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TokenManager } from '../src/api/token.js';
import { HttpServer, type SentinelServices } from '../src/api/server.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sentinel-token-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function manager(): TokenManager {
  return new TokenManager(join(dir, 'token.json'));
}

describe('TokenManager', () => {
  it('auto-generates and persists a token on first use', () => {
    const m = manager();
    const t = m.getToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(m.location())).toBe(true);
    // Idempotent: a fresh manager on the same file returns the same token.
    expect(manager().getToken()).toBe(t);
  });

  it('verifies the current token in constant time and rejects others', () => {
    const m = manager();
    const t = m.getToken();
    expect(m.verify(t)).toBe(true);
    expect(m.verify('wrong')).toBe(false);
    expect(m.verify('')).toBe(false);
    expect(m.verify(undefined)).toBe(false);
  });

  it('rotate() invalidates the previous token', () => {
    const m = manager();
    const before = m.getToken();
    const after = m.rotate();
    expect(after).not.toBe(before);
    expect(m.verify(before)).toBe(false);
    expect(m.verify(after)).toBe(true);
  });
});

describe('HttpServer token auth (B4)', () => {
  const services: SentinelServices = {
    execute: async () => ({ ok: true }),
    shadow: async () => ({ ok: true }),
    listTraces: () => [],
    getTrace: () => undefined,
    rollback: async () => ({ ok: true }),
    listSurfaces: () => [],
    verifyChain: () => ({ valid: true }),
    approve: () => ({ ok: true }),
    deny: () => ({ ok: true }),
    getPendingApprovals: () => [],
    getStatus: () => ({ status: 'ok' }),
    checkDrift: async () => ({ drift: false }),
  };

  let server: HttpServer;
  let port: number;
  let token: string;

  beforeEach(async () => {
    const tm = manager();
    token = tm.getToken();
    port = 30000 + Math.floor(Math.random() * 5000);
    server = new HttpServer(services, {
      port,
      auth: { method: 'token', sentinelToken: tm },
    });
    await server.start();
  });
  afterEach(async () => {
    await server.stop();
  });

  it('rejects requests with no token (401) but allows /api/status', async () => {
    const protectedRes = await fetch(`http://127.0.0.1:${port}/api/surfaces`);
    expect(protectedRes.status).toBe(401);

    const status = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(status.status).toBe(200);
  });

  it('accepts requests carrying the valid X-Sentinel-Token', async () => {
    const ok = await fetch(`http://127.0.0.1:${port}/api/surfaces`, {
      headers: { 'X-Sentinel-Token': token },
    });
    expect(ok.status).toBe(200);

    const bad = await fetch(`http://127.0.0.1:${port}/api/surfaces`, {
      headers: { 'X-Sentinel-Token': 'nope' },
    });
    expect(bad.status).toBe(401);
  });
});
