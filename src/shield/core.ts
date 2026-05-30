// ---------------------------------------------------------------------------
// SENTINEL Shield Core (v0.3.0, S1)
// ---------------------------------------------------------------------------
// The out-of-band control plane, expressed as pure logic with no networking.
// The core owns:
//   - an AgentFirewall (deterministic verdicts on every tool call),
//   - a KillSwitch (transactional kill + forensic snapshot per agent),
//   - a per-session token registry (revoked on kill or watchdog fire).
//
// The transport layer (ShieldServer) is a thin shell around this. Keeping the
// logic transport-free makes it exhaustively unit-testable and lets the same
// core back the in-process API, the TCP/Unix-socket server, and tests.
// ---------------------------------------------------------------------------

import { randomBytes, timingSafeEqual } from 'crypto';
import { AgentFirewall } from '../firewall/firewall.js';
import type { FirewallPolicy } from '../firewall/firewall.js';
import { KillSwitch } from '../exec/killswitch.js';
import type { KillMode, ForensicsSnapshot } from '../exec/killswitch.js';
import { SENTINEL_VERSION } from '../spec/version.js';
import { SHIELD_PROTOCOL_VERSION } from './protocol.js';
import type {
  ShieldToolCall,
  WelcomeResponse,
  VerdictResponse,
  StatusResponse,
} from './protocol.js';

export interface ShieldCoreOptions {
  /** Firewall policy preset. Default: 'strict' (the Shield defaults to safety). */
  policy?: FirewallPolicy;
  /** Per-agent graceful kill window in ms. Default: 5000. */
  gracefulWindowMs?: number;
  /** Firewall to use (default: a new one with the configured policy). */
  firewall?: AgentFirewall;
}

interface Session {
  agent: string;
  sessionId: string;
  token: Buffer;
  connectedAt: number;
  revoked: boolean;
}

export interface ShieldStats {
  allowed: number;
  warned: number;
  blocked: number;
}

let sessionCounter = 0;

export class ShieldCore {
  readonly firewall: AgentFirewall;
  readonly killSwitch: KillSwitch;
  private readonly gracefulWindowMs: number;
  private readonly sessions = new Map<string, Session>();
  private readonly stats: ShieldStats = { allowed: 0, warned: 0, blocked: 0 };
  private killSwitchFired = false;
  private readonly startedAt = Date.now();

  constructor(options: ShieldCoreOptions = {}) {
    this.firewall = options.firewall ?? new AgentFirewall({ policy: options.policy ?? 'strict' });
    this.killSwitch = new KillSwitch();
    this.gracefulWindowMs = options.gracefulWindowMs ?? 5000;
  }

  // ---- Connection lifecycle ------------------------------------------------

  /** Register a connecting agent; returns the welcome payload (with a token). */
  connect(agent: string): WelcomeResponse {
    const sessionId = `sess-${(sessionCounter++).toString(36)}-${randomBytes(4).toString('hex')}`;
    const token = randomBytes(32);
    this.sessions.set(sessionId, { agent, sessionId, token, connectedAt: Date.now(), revoked: false });
    this.killSwitch.register(agent, this.gracefulWindowMs);
    return {
      type: 'welcome',
      shieldVersion: SENTINEL_VERSION,
      protocol: SHIELD_PROTOCOL_VERSION,
      policy: this.firewall.getPolicy(),
      sessionId,
      token: token.toString('hex'),
    };
  }

  /** Constant-time validation of a session token. */
  verifyToken(sessionId: string, tokenHex: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.revoked) return false;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(tokenHex, 'hex');
    } catch {
      return false;
    }
    if (candidate.length !== session.token.length) return false;
    return timingSafeEqual(candidate, session.token);
  }

  agentForSession(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.agent;
  }

  // ---- Tool-call evaluation ------------------------------------------------

  /** Scan a tool call and update stats. Deterministic. */
  evaluate(call: ShieldToolCall, id: string): VerdictResponse {
    const r = this.firewall.scan(call);
    if (r.verdict === 'block') this.stats.blocked++;
    else if (r.verdict === 'warn') this.stats.warned++;
    else this.stats.allowed++;
    return {
      type: 'verdict',
      id,
      verdict: r.verdict,
      risk: r.risk,
      score: r.score,
      matches: r.matches,
      allowed: r.verdict !== 'block',
    };
  }

  // ---- Operation tracking (for transactional kill) -------------------------

  beginOperation(agent: string, description: string): string {
    const session = this.killSwitch.get(agent);
    if (!session) throw new Error(`Shield: unknown agent "${agent}"`);
    return session.beginOperation(description);
  }

  completeOperation(agent: string, opId: string): void {
    const session = this.killSwitch.get(agent);
    if (!session) throw new Error(`Shield: unknown agent "${agent}"`);
    session.completeOperation(opId);
  }

  // ---- Kill ----------------------------------------------------------------

  async kill(agent: string, mode: KillMode = 'graceful', reason?: string): Promise<ForensicsSnapshot> {
    const snapshot = await this.killSwitch.kill(agent, { mode, reason });
    // Revoke every session belonging to the killed agent.
    for (const session of this.sessions.values()) {
      if (session.agent === agent) session.revoked = true;
    }
    return snapshot;
  }

  /** Revoke all tokens (called by the watchdog when the Shield is failing). */
  revokeAll(reason: string): string[] {
    const revoked: string[] = [];
    for (const session of this.sessions.values()) {
      if (!session.revoked) {
        session.revoked = true;
        revoked.push(session.sessionId);
      }
    }
    this.killSwitchFired = true;
    void reason;
    return revoked;
  }

  markKillSwitchFired(): void {
    this.killSwitchFired = true;
  }

  // ---- Status --------------------------------------------------------------

  status(id: string): StatusResponse {
    return {
      type: 'status',
      id,
      shieldVersion: SENTINEL_VERSION,
      policy: this.firewall.getPolicy(),
      uptimeMs: Date.now() - this.startedAt,
      killSwitch: this.killSwitchFired ? 'fired' : 'armed',
      agents: this.killSwitch.list().map((s) => ({
        agent: s.agentId,
        status: s.status,
        operations: s.allOperations().length,
      })),
      stats: { ...this.stats },
    };
  }

  getStats(): ShieldStats {
    return { ...this.stats };
  }

  activeSessionCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (!s.revoked) n++;
    return n;
  }
}
