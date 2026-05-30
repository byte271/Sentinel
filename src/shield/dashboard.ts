// ---------------------------------------------------------------------------
// SENTINEL Enterprise Dashboard data + HTTP API (v0.3.0, S5)
// ---------------------------------------------------------------------------
// A single static dashboard.html (no build step, no database) polls a JSON API
// exposed by the Shield. This module builds the dashboard state from the live
// ShieldCore and serves both the JSON and the static HTML over plain HTTP.
//
// Extension points (documented, not shipped): a D3 force-directed trust graph
// rendered from the trust-graph export, and PDF export of the compliance view
// via the same Markdown→PDF pipeline used by sentinel-compliance.
// ---------------------------------------------------------------------------

import http from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { OwaspAsiAssessor, DEFAULT_CAPABILITIES } from '../compliance/owasp.js';
import { EuAiActAssessor } from '../compliance/eu-ai-act.js';
import type { ShieldCore } from './core.js';

export interface DashboardState {
  shieldVersion: string;
  policy: string;
  uptimeMs: number;
  killSwitch: 'armed' | 'fired';
  agents: Array<{ agent: string; status: string; operations: number }>;
  stats: { allowed: number; warned: number; blocked: number };
  owasp: { score: number; grade: string; fullyCovered: number; total: number };
  euAiAct: { annexIVScore: number; readiness: string; daysUntilEnforcement: number; riskTier: string };
  generatedAt: string;
}

/** Build the full dashboard state from the live Shield core. Deterministic given core state. */
export function buildDashboardState(core: ShieldCore): DashboardState {
  const status = core.status('dashboard');
  const owasp = new OwaspAsiAssessor().assess(DEFAULT_CAPABILITIES);
  const eu = new EuAiActAssessor().assess(DEFAULT_CAPABILITIES);
  return {
    shieldVersion: status.shieldVersion,
    policy: status.policy,
    uptimeMs: status.uptimeMs,
    killSwitch: status.killSwitch,
    agents: status.agents,
    stats: status.stats,
    owasp: {
      score: owasp.score,
      grade: owasp.grade,
      fullyCovered: owasp.fullyCovered,
      total: owasp.risks.length,
    },
    euAiAct: {
      annexIVScore: eu.annexIVScore,
      readiness: eu.readiness,
      daysUntilEnforcement: eu.daysUntilEnforcement,
      riskTier: eu.riskTier,
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Resolve the bundled dashboard.html, falling back to an inline minimal page. */
function loadDashboardHtml(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/shield -> repo public/. Try a couple of likely locations.
    for (const candidate of [
      join(here, '..', '..', 'public', 'dashboard.html'),
      join(here, '..', '..', '..', 'public', 'dashboard.html'),
    ]) {
      try {
        return readFileSync(candidate, 'utf-8');
      } catch { /* try next */ }
    }
  } catch { /* ignore */ }
  return '<!doctype html><title>Sentinel</title><body>Dashboard asset missing — poll /api/status for JSON.</body>';
}

export interface DashboardServerOptions {
  port: number;
  host?: string;
  /** Allow the kill-switch button to fire kills via POST /api/kill. Default: true. */
  allowKill?: boolean;
}

/**
 * A minimal HTTP server serving the static dashboard and a JSON API backed by
 * a ShieldCore. Returns the underlying http.Server so callers manage lifecycle.
 */
export function createDashboardServer(core: ShieldCore, options: DashboardServerOptions): http.Server {
  const allowKill = options.allowKill ?? true;
  const html = loadDashboardHtml();

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/' || url === '/index.html' || url === '/dashboard.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (url === '/api/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(buildDashboardState(core)));
      return;
    }
    if (url === '/api/kill' && req.method === 'POST') {
      if (!allowKill) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'kill disabled' }));
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        void (async () => {
          try {
            const parsed = body ? (JSON.parse(body) as { agent?: string; reason?: string }) : {};
            const agent = parsed.agent;
            if (!agent) {
              res.writeHead(400, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ error: 'agent required' }));
              return;
            }
            const snapshot = await core.kill(agent, 'hard', parsed.reason ?? 'dashboard-kill');
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ killed: agent, snapshot }));
          } catch (err) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
        })();
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(options.port, options.host ?? '127.0.0.1');
  return server;
}
