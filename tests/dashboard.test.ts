import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { ShieldCore } from '../src/shield/core.js';
import { buildDashboardState, createDashboardServer } from '../src/shield/dashboard.js';

function listening(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    const addr = server.address();
    if (addr && typeof addr === 'object') return resolve(addr.port);
    server.once('listening', () => resolve((server.address() as { port: number }).port));
  });
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ port, host: '127.0.0.1', path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

function post(port: number, path: string, payload: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      { port, host: '127.0.0.1', path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

describe('Dashboard state builder', () => {
  it('aggregates Shield, OWASP, and EU AI Act state', () => {
    const core = new ShieldCore();
    core.connect('agent-x');
    core.evaluate({ tool: 'shell', args: { cmd: 'rm -rf /' } }, '1');
    const state = buildDashboardState(core);
    expect(state.killSwitch).toBe('armed');
    expect(state.policy).toBe('strict');
    expect(state.stats.blocked).toBe(1);
    expect(state.agents.length).toBe(1);
    expect(state.owasp.total).toBeGreaterThanOrEqual(10);
    expect(state.owasp.score).toBeGreaterThan(0);
    expect(state.euAiAct.daysUntilEnforcement).toBeGreaterThanOrEqual(0);
    expect(['ready', 'partial', 'not-ready']).toContain(state.euAiAct.readiness);
  });
});

describe('Dashboard HTTP server', () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  });

  it('serves the static dashboard HTML at /', async () => {
    const core = new ShieldCore();
    server = createDashboardServer(core, { port: 0 });
    const port = await listening(server);
    const res = await get(port, '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('SENTINEL');
  });

  it('serves JSON at /api/status', async () => {
    const core = new ShieldCore();
    core.connect('agent-y');
    server = createDashboardServer(core, { port: 0 });
    const port = await listening(server);
    const res = await get(port, '/api/status');
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.agents.length).toBe(1);
    expect(parsed.killSwitch).toBe('armed');
  });

  it('fires a kill via POST /api/kill', async () => {
    const core = new ShieldCore();
    core.connect('doomed');
    server = createDashboardServer(core, { port: 0 });
    const port = await listening(server);
    const res = await post(port, '/api/kill', { agent: 'doomed', reason: 'test' });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.killed).toBe('doomed');
    expect(parsed.snapshot.agentId).toBe('doomed');
  });

  it('returns 400 when kill has no agent', async () => {
    const core = new ShieldCore();
    server = createDashboardServer(core, { port: 0 });
    const port = await listening(server);
    const res = await post(port, '/api/kill', {});
    expect(res.status).toBe(400);
  });

  it('respects allowKill=false', async () => {
    const core = new ShieldCore();
    core.connect('safe');
    server = createDashboardServer(core, { port: 0, allowKill: false });
    const port = await listening(server);
    const res = await post(port, '/api/kill', { agent: 'safe' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown routes', async () => {
    const core = new ShieldCore();
    server = createDashboardServer(core, { port: 0 });
    const port = await listening(server);
    const res = await get(port, '/nope');
    expect(res.status).toBe(404);
  });
});
