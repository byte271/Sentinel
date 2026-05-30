// ---------------------------------------------------------------------------
// SENTINEL Shield Protocol (v0.3.0, S1)
// ---------------------------------------------------------------------------
// A tiny, language-agnostic, newline-delimited JSON ("JSONL") protocol spoken
// between an agent and the out-of-band Shield process over a Unix domain
// socket or TCP. Any agent in any language can connect; the heavy safety logic
// lives in the Shield, not in the agent's process.
//
// Every request carries a correlation `id` that the matching response echoes,
// so a client can multiplex concurrent requests over a single connection.
// ---------------------------------------------------------------------------

import type { RiskLevel } from '../kernel/types.js';
import type { FirewallVerdict, PatternMatch } from '../firewall/firewall.js';
import type { KillMode, ForensicsSnapshot } from '../exec/killswitch.js';

export const SHIELD_PROTOCOL_VERSION = 1;

/** A tool call as presented to the Shield (mirrors firewall.ToolCall). */
export interface ShieldToolCall {
  tool: string;
  args?: Record<string, unknown>;
  text?: string;
}

// ---- Client → Shield requests ---------------------------------------------

export interface HelloRequest {
  type: 'hello';
  protocol: number;
  agent: string;
}

export interface ScanRequest {
  type: 'scan';
  id: string;
  call: ShieldToolCall;
}

export interface BeginRequest {
  type: 'begin';
  id: string;
  description: string;
}

export interface CompleteRequest {
  type: 'complete';
  id: string;
  opId: string;
}

export interface KillRequest {
  type: 'kill';
  id: string;
  /** Target agent; defaults to the calling session's agent. */
  agent?: string;
  mode?: KillMode;
  reason?: string;
}

export interface StatusRequest {
  type: 'status';
  id: string;
}

export interface PingRequest {
  type: 'ping';
  id: string;
}

export type ShieldRequest =
  | HelloRequest
  | ScanRequest
  | BeginRequest
  | CompleteRequest
  | KillRequest
  | StatusRequest
  | PingRequest;

// ---- Shield → Client responses --------------------------------------------

export interface WelcomeResponse {
  type: 'welcome';
  shieldVersion: string;
  protocol: number;
  policy: string;
  sessionId: string;
  /** Opaque per-session token; revoked on kill or watchdog fire. */
  token: string;
}

export interface VerdictResponse {
  type: 'verdict';
  id: string;
  verdict: FirewallVerdict;
  risk: RiskLevel;
  score: number;
  matches: PatternMatch[];
  /** Convenience: true when the call may proceed (verdict !== 'block'). */
  allowed: boolean;
}

export interface OkResponse {
  type: 'ok';
  id: string;
  opId?: string;
}

export interface KilledResponse {
  type: 'killed';
  id: string;
  snapshot: ForensicsSnapshot;
}

export interface StatusResponse {
  type: 'status';
  id: string;
  shieldVersion: string;
  policy: string;
  uptimeMs: number;
  killSwitch: 'armed' | 'fired';
  agents: Array<{ agent: string; status: string; operations: number }>;
  stats: { allowed: number; warned: number; blocked: number };
}

export interface PongResponse {
  type: 'pong';
  id: string;
}

export interface ErrorResponse {
  type: 'error';
  id?: string;
  message: string;
}

/** Pushed (unsolicited) when a session's token is revoked. */
export interface RevokedNotice {
  type: 'revoked';
  reason: string;
}

export type ShieldResponse =
  | WelcomeResponse
  | VerdictResponse
  | OkResponse
  | KilledResponse
  | StatusResponse
  | PongResponse
  | ErrorResponse
  | RevokedNotice;

// ---- Line framing ----------------------------------------------------------

/** Encode a message as a single newline-terminated JSON line. */
export function encodeMessage(msg: ShieldRequest | ShieldResponse): string {
  return JSON.stringify(msg) + '\n';
}

/**
 * Stateful newline-delimited JSON decoder. Feed it raw chunks; it yields fully
 * parsed messages and buffers any partial trailing line.
 */
export class LineDecoder<T> {
  private buffer = '';

  push(chunk: string): T[] {
    this.buffer += chunk;
    const out: T[] = [];
    let nl = this.buffer.indexOf('\n');
    while (nl >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line.length > 0) {
        out.push(JSON.parse(line) as T);
      }
      nl = this.buffer.indexOf('\n');
    }
    return out;
  }
}
