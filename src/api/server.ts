import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { createHmac } from 'crypto';

export interface ServerConfig {
  port: number;
  host?: string;
  corsOrigin?: string;
  /** Auth configuration. If unset, all endpoints are public. */
  auth?: AuthConfig;
  /** Per-endpoint rate limits (requests per minute, 0 = unlimited). */
  rateLimit?: {
    execute?: number;
    rollback?: number;
    approve?: number;
    traces?: number;
    default?: number;
  };
}

export interface AuthConfig {
  /** Auth method. */
  method: 'bearer' | 'api-key' | 'custom' | 'session' | 'token';
  /** Auth middleware function. Return true to allow, false to deny. */
  middleware?: (req: IncomingMessage) => boolean | Promise<boolean>;
  /** Bearer token(s) — only used when method is 'bearer'. */
  bearerTokens?: Set<string>;
  /** API keys — only used when method is 'api-key'. */
  apiKeys?: Set<string>;
  /** Signing secret for HMAC-signed tokens (optional). */
  hmacSecret?: string;
  /**
   * Verifier for the `X-Sentinel-Token` header — only used when method is
   * 'token' (B4). Supply a `TokenManager` (or any object exposing a
   * constant-time `verify`) so the auto-generated, rotatable Sentinel token
   * gates every endpoint.
   */
  sentinelToken?: { verify(presented: string | undefined | null): boolean };
  /**
   * IdentityManager instance used when method is 'session'.
   * Session tokens issued by IdentityManager.createSession() are verified via
   * identityManager.validateSession(token), which performs full HMAC
   * verification and expiry checks for stateless, tamper-evident auth.
   */
  identityManager?: {
    validateSession(token: string): { valid: boolean; actorId?: string; scopes?: string[] };
  };
}

export interface SentinelServices {
  execute: (intent: Record<string, unknown>) => Promise<Record<string, unknown>>;
  shadow: (intent: Record<string, unknown>) => Promise<Record<string, unknown>>;
  listTraces: (filter?: Record<string, unknown>) => Record<string, unknown>[];
  getTrace: (id: string) => Record<string, unknown> | undefined;
  rollback: (traceId: string) => Promise<Record<string, unknown>>;
  listSurfaces: () => Record<string, unknown>[];
  verifyChain: () => Record<string, unknown>;
  approve: (requestId: string, actorId: string) => Record<string, unknown>;
  deny: (requestId: string, actorId: string, reason?: string) => Record<string, unknown>;
  getPendingApprovals: () => Record<string, unknown>[];
  getStatus: () => Record<string, unknown>;
  checkDrift: (surfaceId: string) => Promise<Record<string, unknown>>;
}

/** Maximum request body size in bytes (1 MB). */
const MAX_BODY_SIZE = 1_048_576;

export class HttpServer {
  private server: Server | null = null;
  private services: SentinelServices;
  private config: ServerConfig;
  private sseClients: Set<ServerResponse> = new Set();
  private authConfig: AuthConfig | undefined;
  private rateLimits: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(services: SentinelServices, config: ServerConfig) {
    this.services = services;
    this.config = config;
    this.authConfig = config.auth;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', reject);

      const host = this.config.host ?? '0.0.0.0';
      this.server.listen(this.config.port, host, () => {
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      // Close all SSE connections
      for (const client of this.sseClients) {
        client.end();
      }
      this.sseClients.clear();

      this.server.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  pushEvent(event: { type: string; data: unknown }): void {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    const deadClients: ServerResponse[] = [];
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        deadClients.push(client);
      }
    }
    for (const dead of deadClients) {
      this.sseClients.delete(dead);
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers
    if (this.config.corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', this.config.corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Sentinel-Token, X-Api-Key');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Rate limit check
    const route = this.getRouteKey(req);
    if (!this.checkRateLimit(route)) {
      this.sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Please slow down.');
      return;
    }

    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    try {
      // Auth check — all endpoints require authentication when auth is configured.
      // Only /api/status is explicitly public (health probe / liveness check).
      // Every other endpoint — including read-only GET routes — may expose
      // sensitive operational data and must therefore be gated.
      const publicEndpoint = url.split('?')[0] === '/api/status';
      if (!publicEndpoint && this.authConfig) {
        const authed = await this.checkAuth(req);
        if (!authed) {
          this.sendError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
          return;
        }
      }
      // POST /api/execute
      if (method === 'POST' && url === '/api/execute') {
        const body = JSON.parse(await this.readBody(req));
        const result = await this.services.execute(body);
        this.sendJson(res, 200, result);
        return;
      }

      // POST /api/shadow
      if (method === 'POST' && url === '/api/shadow') {
        const body = JSON.parse(await this.readBody(req));
        const result = await this.services.shadow(body);
        this.sendJson(res, 200, result);
        return;
      }

      // GET /api/traces/:id
      const traceId = this.extractParam(url, '/api/traces/');
      if (method === 'GET' && traceId) {
        const trace = this.services.getTrace(traceId);
        if (!trace) {
          this.sendError(res, 404, 'NOT_FOUND', `Trace "${traceId}" not found`);
          return;
        }
        this.sendJson(res, 200, trace);
        return;
      }

      // GET /api/traces
      if (method === 'GET' && (url === '/api/traces' || url.startsWith('/api/traces?'))) {
        const filter = this.parseQueryParams(url);
        const traces = this.services.listTraces(
          Object.keys(filter).length > 0 ? filter : undefined,
        );
        this.sendJson(res, 200, traces);
        return;
      }

      // POST /api/rollback/:id
      const rollbackId = this.extractParam(url, '/api/rollback/');
      if (method === 'POST' && rollbackId) {
        const result = await this.services.rollback(rollbackId);
        this.sendJson(res, 200, result);
        return;
      }

      // GET /api/surfaces
      if (method === 'GET' && url === '/api/surfaces') {
        this.sendJson(res, 200, this.services.listSurfaces());
        return;
      }

      // GET /api/chain/verify
      if (method === 'GET' && url === '/api/chain/verify') {
        this.sendJson(res, 200, this.services.verifyChain());
        return;
      }

      // POST /api/approve/:id
      const approveId = this.extractParam(url, '/api/approve/');
      if (method === 'POST' && approveId) {
        const body = JSON.parse(await this.readBody(req));
        const result = this.services.approve(approveId, body.actorId);
        this.sendJson(res, 200, result);
        return;
      }

      // POST /api/deny/:id
      const denyId = this.extractParam(url, '/api/deny/');
      if (method === 'POST' && denyId) {
        const body = JSON.parse(await this.readBody(req));
        const result = this.services.deny(denyId, body.actorId, body.reason);
        this.sendJson(res, 200, result);
        return;
      }

      // GET /api/approvals
      if (method === 'GET' && url === '/api/approvals') {
        this.sendJson(res, 200, this.services.getPendingApprovals());
        return;
      }

      // GET /api/drift/:surfaceId
      const driftSurfaceId = this.extractParam(url, '/api/drift/');
      if (method === 'GET' && driftSurfaceId) {
        const result = await this.services.checkDrift(driftSurfaceId);
        this.sendJson(res, 200, result);
        return;
      }

      // GET /api/status
      if (method === 'GET' && url === '/api/status') {
        this.sendJson(res, 200, this.services.getStatus());
        return;
      }

      // GET /api/events (SSE)
      if (method === 'GET' && url === '/api/events') {
        this.handleSSE(req, res);
        return;
      }

      // 404
      this.sendError(res, 404, 'NOT_FOUND', `No route for ${method} ${url}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      this.sendError(res, 500, 'INTERNAL_ERROR', message);
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;

      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error('Request body too large'));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private sendError(res: ServerResponse, status: number, code: string, message: string): void {
    this.sendJson(res, status, { error: { code, message } });
  }

  private handleSSE(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    res.write(':ok\n\n');

    this.sseClients.add(res);

    req.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  private extractParam(url: string, pattern: string): string | null {
    const cleanUrl = url.split('?')[0];
    if (!cleanUrl.startsWith(pattern)) return null;
    const param = cleanUrl.slice(pattern.length);
    if (param === '' || param.includes('/')) return null;
    return decodeURIComponent(param);
  }

  private parseQueryParams(url: string): Record<string, string> {
    const qIndex = url.indexOf('?');
    if (qIndex === -1) return {};
    const query = url.slice(qIndex + 1);
    const params: Record<string, string> = {};
    for (const pair of query.split('&')) {
      const [key, value] = pair.split('=');
      if (key) {
        params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
      }
    }
    return params;
  }

  /** Check authentication for a request. */
  private async checkAuth(req: IncomingMessage): Promise<boolean> {
    if (!this.authConfig) return true;

    // Custom middleware takes precedence
    if (this.authConfig.middleware) {
      return this.authConfig.middleware(req);
    }

    if (this.authConfig.method === 'bearer') {
      const authHeader = req.headers['authorization'] ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!token) return false;

      // Check against known tokens
      if (this.authConfig.bearerTokens?.has(token)) return true;

      // HMAC-signed token validation
      if (this.authConfig.hmacSecret) {
        return this.verifyHmacToken(token, this.authConfig.hmacSecret);
      }

      return false;
    }

    if (this.authConfig.method === 'session') {
      // Validate tokens issued by IdentityManager.createSession(), which
      // uses HMAC-SHA256 signing with expiry so they are stateless and
      // tamper-evident without a server-side session store lookup.
      const authHeader = req.headers['authorization'] ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!token || !this.authConfig.identityManager) return false;
      const result = this.authConfig.identityManager.validateSession(token);
      return result.valid;
    }

    if (this.authConfig.method === 'api-key') {
      const apiKey = (req.headers['x-api-key'] as string) ?? '';
      return apiKey !== '' && (this.authConfig.apiKeys?.has(apiKey) ?? false);
    }

    if (this.authConfig.method === 'token') {
      // B4: every endpoint requires the X-Sentinel-Token header, verified in
      // constant time against the auto-generated, rotatable Sentinel token.
      if (!this.authConfig.sentinelToken) return false;
      const presented = (req.headers['x-sentinel-token'] as string) ?? '';
      return this.authConfig.sentinelToken.verify(presented);
    }

    return false;
  }

  /** Verify an HMAC-signed token. */
  private verifyHmacToken(token: string, secret: string): boolean {
    const dotIndex = token.indexOf('.');
    if (dotIndex === -1) return false;

    const signature = token.slice(0, dotIndex);
    const payloadB64 = token.slice(dotIndex + 1);

    const expectedSignature = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(payloadB64)
      .digest('base64url');

    // Constant-time comparison
    if (signature.length !== expectedSignature.length) return false;
    let mismatch = 0;
    for (let i = 0; i < signature.length; i++) {
      mismatch |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }
    if (mismatch !== 0) return false;

    // Validate expiry
    try {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
      return Date.now() <= payload.expiresAt;
    } catch {
      return false;
    }
  }

  /** Get route key for rate limiting. */
  private getRouteKey(req: IncomingMessage): string {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    if (method === 'POST' && url === '/api/execute') return 'execute';
    if (method === 'POST' && url.startsWith('/api/rollback/')) return 'rollback';
    if (method === 'POST' && url.startsWith('/api/approve/')) return 'approve';
    if (url.startsWith('/api/traces')) return 'traces';
    return 'default';
  }

  /** Check and enforce rate limits. */
  private checkRateLimit(route: string): boolean {
    if (!this.config.rateLimit) return true;

    const limitPerMinute = (this.config.rateLimit as Record<string, number | undefined>)[route]
      ?? this.config.rateLimit.default
      ?? 0;

    if (limitPerMinute <= 0) return true;

    const now = Date.now();
    const entry = this.rateLimits.get(route);

    if (!entry || now > entry.resetAt) {
      this.rateLimits.set(route, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    if (entry.count >= limitPerMinute) return false;

    entry.count++;
    return true;
  }
}
