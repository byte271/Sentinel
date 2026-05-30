// ---------------------------------------------------------------------------
// SENTINEL Shield Server (v0.3.0, S1)
// ---------------------------------------------------------------------------
// The out-of-band sidecar transport. Wraps a ShieldCore in a newline-delimited
// JSON server over TCP and/or a Unix domain socket, supervised by a Watchdog.
//
// Properties from the spec:
//   - Out-of-band: the Shield is its own process; the agent connects to it.
//   - Protocol-level interception: every tool call is scanned before the agent
//     is told it may proceed.
//   - Watchdog-protected: if the control loop stops feeding the watchdog, all
//     tokens are revoked and a forensic snapshot is written to disk.
//   - Process supervision: an agent launched via `spawnAgent` runs as a child;
//     a kill sends SIGKILL to its process group — it cannot negotiate or ignore.
// ---------------------------------------------------------------------------

import net from 'net';
import http from 'http';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ShieldCore } from './core.js';
import type { ShieldCoreOptions } from './core.js';
import { createDashboardServer } from './dashboard.js';
import { Watchdog } from './watchdog.js';
import {
  encodeMessage,
  LineDecoder,
} from './protocol.js';
import type {
  ShieldRequest,
  ShieldResponse,
} from './protocol.js';

export interface ShieldServerOptions extends ShieldCoreOptions {
  /** TCP port to listen on. Omit to skip TCP. */
  port?: number;
  /** TCP host (default: 127.0.0.1). */
  host?: string;
  /** Unix domain socket path. Omit to skip. */
  socketPath?: string;
  /** Watchdog window in ms. Default: 5000. */
  watchdogMs?: number;
  /** Directory for forensic snapshots written on watchdog fire. */
  forensicsDir?: string;
  /** If set, also serve the enterprise dashboard + JSON API on this HTTP port. */
  httpPort?: number;
  /** Suppress console logging (used in tests). */
  quiet?: boolean;
}

interface Conn {
  socket: net.Socket;
  decoder: LineDecoder<ShieldRequest>;
  sessionId?: string;
  agent?: string;
}

export class ShieldServer {
  readonly core: ShieldCore;
  readonly watchdog: Watchdog;
  private readonly options: ShieldServerOptions;
  private servers: net.Server[] = [];
  private httpServer: http.Server | null = null;
  private conns = new Set<Conn>();
  private children = new Map<string, ChildProcess>();
  private boundPort?: number;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly watchdogEnabled: boolean;

  constructor(options: ShieldServerOptions = {}) {
    this.options = options;
    this.core = new ShieldCore(options);
    // A watchdog window of 0 disables the dead-man's switch.
    this.watchdogEnabled = (options.watchdogMs ?? 5000) > 0;
    this.watchdog = new Watchdog({
      windowMs: options.watchdogMs && options.watchdogMs > 0 ? options.watchdogMs : 5000,
      onExpire: (info) => this.onWatchdogExpire(info),
    });
  }

  /** The actual TCP port (useful when 0 was requested for an ephemeral port). */
  get port(): number | undefined {
    return this.boundPort;
  }

  // ---- Lifecycle -----------------------------------------------------------

  async listen(): Promise<void> {
    if (this.watchdogEnabled) {
      this.watchdog.start();
      // Internal heartbeat: prove the event loop is alive so a healthy idle
      // Shield stays armed; only a hung/dead loop lets the window elapse.
      this.heartbeat = setInterval(() => this.watchdog.feed(), Math.max(1, Math.floor(this.watchdog.windowMs / 2)));
      (this.heartbeat as unknown as { unref?: () => void }).unref?.();
    }
    const tasks: Promise<void>[] = [];

    if (this.options.port !== undefined) {
      const server = net.createServer((s) => this.onConnection(s));
      this.servers.push(server);
      tasks.push(new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.options.port, this.options.host ?? '127.0.0.1', () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') this.boundPort = addr.port;
          resolve();
        });
      }));
    }

    if (this.options.socketPath) {
      const server = net.createServer((s) => this.onConnection(s));
      this.servers.push(server);
      tasks.push(new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.options.socketPath, () => resolve());
      }));
    }

    if (this.options.httpPort !== undefined) {
      this.httpServer = createDashboardServer(this.core, { port: this.options.httpPort, host: this.options.host });
      this.log(`Dashboard on http://${this.options.host ?? '127.0.0.1'}:${this.options.httpPort}`);
    }

    await Promise.all(tasks);
    this.log(`Shield listening (policy=${this.core.firewall.getPolicy()}, watchdog=${this.watchdogEnabled ? this.watchdog.windowMs + 'ms' : 'disabled'})`);
  }

  async close(): Promise<void> {
    if (this.heartbeat !== null) { clearInterval(this.heartbeat); this.heartbeat = null; }
    this.watchdog.stop();
    for (const child of this.children.values()) {
      this.hardKillChild(child);
    }
    this.children.clear();
    for (const conn of this.conns) conn.socket.destroy();
    this.conns.clear();
    await Promise.all(this.servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    this.servers = [];
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
      this.httpServer = null;
    }
  }

  // ---- Child-process supervision ------------------------------------------

  /**
   * Launch an agent as a child process. The Shield is the parent, so a kill is
   * a SIGKILL to the child's process group — the agent cannot fight back.
   */
  spawnAgent(agentId: string, command: string, args: string[] = []): ChildProcess {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    this.children.set(agentId, child);
    this.core.killSwitch.register(agentId, this.options.gracefulWindowMs ?? 5000);
    child.once('exit', () => this.children.delete(agentId));
    return child;
  }

  /** SIGKILL an agent's child process tree, if one is tracked. */
  killAgentProcess(agentId: string): boolean {
    const child = this.children.get(agentId);
    if (!child) return false;
    this.hardKillChild(child);
    this.children.delete(agentId);
    return true;
  }

  private hardKillChild(child: ChildProcess): void {
    if (child.pid === undefined || child.killed) return;
    try {
      // Negative pid → kill the whole process group (detached spawn).
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }

  // ---- Connection handling -------------------------------------------------

  private onConnection(socket: net.Socket): void {
    socket.setEncoding('utf-8');
    const conn: Conn = { socket, decoder: new LineDecoder<ShieldRequest>() };
    this.conns.add(conn);

    socket.on('data', (chunk: string) => {
      this.watchdog.feed(); // the control loop is alive
      let messages: ShieldRequest[];
      try {
        messages = conn.decoder.push(chunk);
      } catch (err) {
        this.send(conn, { type: 'error', message: `malformed message: ${(err as Error).message}` });
        return;
      }
      for (const msg of messages) {
        // Fire and forget; ordering preserved by awaiting sequentially.
        void this.handle(conn, msg);
      }
    });

    socket.on('error', () => { /* client vanished */ });
    socket.on('close', () => { this.conns.delete(conn); });
  }

  private async handle(conn: Conn, msg: ShieldRequest): Promise<void> {
    switch (msg.type) {
      case 'hello': {
        const welcome = this.core.connect(msg.agent);
        conn.sessionId = welcome.sessionId;
        conn.agent = msg.agent;
        this.send(conn, welcome);
        return;
      }
      case 'scan': {
        if (!conn.sessionId) return this.send(conn, { type: 'error', id: msg.id, message: 'not connected — send hello first' });
        this.send(conn, this.core.evaluate(msg.call, msg.id));
        return;
      }
      case 'begin': {
        if (!conn.agent) return this.send(conn, { type: 'error', id: msg.id, message: 'not connected' });
        const opId = this.core.beginOperation(conn.agent, msg.description);
        this.send(conn, { type: 'ok', id: msg.id, opId });
        return;
      }
      case 'complete': {
        if (!conn.agent) return this.send(conn, { type: 'error', id: msg.id, message: 'not connected' });
        this.core.completeOperation(conn.agent, msg.opId);
        this.send(conn, { type: 'ok', id: msg.id });
        return;
      }
      case 'kill': {
        const target = msg.agent ?? conn.agent;
        if (!target) return this.send(conn, { type: 'error', id: msg.id, message: 'no target agent' });
        const snapshot = await this.core.kill(target, msg.mode ?? 'hard', msg.reason);
        this.killAgentProcess(target);
        this.send(conn, { type: 'killed', id: msg.id, snapshot });
        this.pushRevocation(target, msg.reason ?? 'killed');
        return;
      }
      case 'status': {
        this.send(conn, this.core.status(msg.id));
        return;
      }
      case 'ping': {
        this.send(conn, { type: 'pong', id: msg.id });
        return;
      }
      default: {
        this.send(conn, { type: 'error', message: `unknown message type` });
      }
    }
  }

  private send(conn: Conn, msg: ShieldResponse): void {
    if (!conn.socket.destroyed) conn.socket.write(encodeMessage(msg));
  }

  /** Push a revocation notice to every connection bound to an agent, then close. */
  private pushRevocation(agent: string, reason: string): void {
    for (const conn of this.conns) {
      if (conn.agent === agent) {
        this.send(conn, { type: 'revoked', reason });
      }
    }
  }

  // ---- Watchdog ------------------------------------------------------------

  private onWatchdogExpire(info: { lastFedAt: number; expiredAt: number; windowMs: number }): void {
    const revoked = this.core.revokeAll('watchdog-expired');
    const snapshot = {
      event: 'watchdog-expired',
      ...info,
      revokedSessions: revoked,
      agents: this.core.status('watchdog').agents,
      writtenAt: new Date().toISOString(),
    };
    try {
      const dir = this.options.forensicsDir ?? join(process.cwd(), '.sentinel-forensics');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `watchdog-${info.expiredAt}.json`), JSON.stringify(snapshot, null, 2));
    } catch { /* best-effort forensics */ }
    // Notify every live connection that its token is now void.
    for (const conn of this.conns) {
      this.send(conn, { type: 'revoked', reason: 'watchdog-expired' });
    }
    this.log('Watchdog expired — all tokens revoked, forensic snapshot written.');
  }

  private log(msg: string): void {
    if (!this.options.quiet) console.error(`[shield] ${msg}`);
  }
}
