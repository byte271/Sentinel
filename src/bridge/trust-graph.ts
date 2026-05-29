// ---------------------------------------------------------------------------
// SENTINEL Multi-Agent Trust Graph (Feature 6)
// ---------------------------------------------------------------------------
// Multi-agent systems form a *graph* of delegations, not a line. Trust leaks
// when a sub-agent inherits permissions it never earned, or when adversarial
// content fetched by one agent propagates through a delegation chain into a
// privileged action by another.
//
// This module models that graph explicitly and enforces the invariants that
// keep it safe:
//
//   - Delegation depth limits (default max depth 2).
//   - Permission narrowing — a child can only ever receive a SUBSET of its
//     parent's effective permissions; escalation attempts are rejected.
//   - Trust scoring per agent that decays with delegation depth, suspicious
//     behavior, and exposure to untrusted input.
//   - Inter-agent message signing (HMAC-SHA256) with timestamp-bound nonces
//     for replay protection.
//   - Anomaly detection: depth-limit breaches, permission escalation, and
//     trust collapse.
//   - Export to graph data plus Mermaid/Graphviz DOT for visualization (which a
//     downstream renderer can turn into SVG/PNG).
//
// Dependency-free (Node `crypto` only).
// ---------------------------------------------------------------------------

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export interface TrustNode {
  id: string;
  label: string;
  /** Operator-granted base trust, 0–1. */
  baseTrust: number;
  /** Effective trust after depth decay and penalties, 0–1. */
  effectiveTrust: number;
  /** Granted permission scopes (supports '*' and 'prefix.*' wildcards). */
  permissions: string[];
  /** Delegation depth from a root (0 = root). */
  depth: number;
  /** Parent agent id, if delegated. */
  parent?: string;
  /** Accumulated anomaly flags. */
  flags: string[];
}

export interface TrustEdge {
  from: string;
  to: string;
  permissions: string[];
  createdAt: number;
}

export type AnomalyType = 'depth-exceeded' | 'permission-escalation' | 'trust-collapse';

export interface TrustAnomaly {
  type: AnomalyType;
  agentId: string;
  detail: string;
  at: number;
}

export interface DelegationResult {
  ok: boolean;
  node?: TrustNode;
  reason?: string;
  anomalies: TrustAnomaly[];
}

export interface SignedMessage {
  from: string;
  to: string;
  payload: string;
  timestamp: number;
  nonce: string;
  signature: string;
}

export interface MessageVerification {
  valid: boolean;
  reason?: string;
}

export interface TrustGraphOptions {
  /** Maximum delegation chain depth. Default: 2. */
  maxDelegationDepth?: number;
  /** Per-level multiplicative trust decay. Default: 0.15 (15% per hop). */
  depthDecay?: number;
  /** Effective trust below this is flagged as a collapse. Default: 0.2. */
  collapseThreshold?: number;
  /** Secret for inter-agent HMAC message signing. */
  signingSecret?: string;
  /** Replay window for signed messages, in ms. Default: 60s. */
  nonceWindowMs?: number;
}

export class TrustGraph {
  private nodes = new Map<string, TrustNode>();
  private edges: TrustEdge[] = [];
  private anomalyLog: TrustAnomaly[] = [];
  private seenNonces = new Map<string, number>();

  private readonly maxDepth: number;
  private readonly depthDecay: number;
  private readonly collapseThreshold: number;
  private readonly signingSecret?: string;
  private readonly nonceWindowMs: number;

  constructor(options: TrustGraphOptions = {}) {
    this.maxDepth = options.maxDelegationDepth ?? 2;
    this.depthDecay = options.depthDecay ?? 0.15;
    this.collapseThreshold = options.collapseThreshold ?? 0.2;
    this.signingSecret = options.signingSecret;
    this.nonceWindowMs = options.nonceWindowMs ?? 60_000;
  }

  /** Register a root agent (depth 0) with operator-granted trust + permissions. */
  addRoot(id: string, opts: { trust: number; permissions: string[]; label?: string }): TrustNode {
    const node: TrustNode = {
      id,
      label: opts.label ?? id,
      baseTrust: clamp01(opts.trust),
      effectiveTrust: clamp01(opts.trust),
      permissions: [...opts.permissions],
      depth: 0,
      flags: [],
    };
    this.nodes.set(id, node);
    return node;
  }

  /**
   * Delegate from a parent to a (new or existing) child. Enforces depth limit
   * and permission narrowing. Rejected delegations record an anomaly and do not
   * mutate the graph.
   */
  delegate(
    fromId: string,
    toId: string,
    opts: { permissions: string[]; trust?: number; label?: string },
  ): DelegationResult {
    const anomalies: TrustAnomaly[] = [];
    const parent = this.nodes.get(fromId);
    if (!parent) {
      return { ok: false, reason: `Unknown parent agent "${fromId}"`, anomalies };
    }

    const depth = parent.depth + 1;
    if (depth > this.maxDepth) {
      const a = this.recordAnomaly('depth-exceeded', toId,
        `Delegation to depth ${depth} exceeds max ${this.maxDepth}`);
      anomalies.push(a);
      return { ok: false, reason: a.detail, anomalies };
    }

    // Permission narrowing: requested ⊆ parent.permissions.
    const escalated = opts.permissions.filter((p) => !permitted(p, parent.permissions));
    if (escalated.length > 0) {
      const a = this.recordAnomaly('permission-escalation', toId,
        `Requested permissions not held by parent: ${escalated.join(', ')}`);
      anomalies.push(a);
      return { ok: false, reason: a.detail, anomalies };
    }

    // Trust decays per hop and can never exceed the parent's effective trust.
    const decayed = parent.effectiveTrust * (1 - this.depthDecay);
    const baseTrust = clamp01(Math.min(decayed, opts.trust ?? decayed));

    const node: TrustNode = {
      id: toId,
      label: opts.label ?? toId,
      baseTrust,
      effectiveTrust: baseTrust,
      permissions: [...opts.permissions],
      depth,
      parent: fromId,
      flags: [],
    };
    this.nodes.set(toId, node);
    this.edges.push({ from: fromId, to: toId, permissions: [...opts.permissions], createdAt: Date.now() });

    if (node.effectiveTrust < this.collapseThreshold) {
      anomalies.push(this.recordAnomaly('trust-collapse', toId,
        `Effective trust ${node.effectiveTrust.toFixed(2)} below threshold ${this.collapseThreshold}`));
    }

    return { ok: true, node, anomalies };
  }

  /** Penalize an agent for suspicious behavior (0–1 severity). */
  recordSuspiciousBehavior(id: string, severity = 0.3, detail = 'suspicious behavior'): void {
    this.applyPenalty(id, clamp01(severity), detail);
  }

  /** Penalize an agent for ingesting untrusted input (smaller default penalty). */
  recordUntrustedInput(id: string, severity = 0.15, detail = 'ingested untrusted input'): void {
    this.applyPenalty(id, clamp01(severity), detail);
  }

  /** Effective trust score for an agent (0 when unknown). */
  trustScore(id: string): number {
    return this.nodes.get(id)?.effectiveTrust ?? 0;
  }

  /** Whether an agent currently holds a permission (after narrowing). */
  hasPermission(id: string, permission: string): boolean {
    const node = this.nodes.get(id);
    return node ? permitted(permission, node.permissions) : false;
  }

  getNode(id: string): TrustNode | undefined {
    const n = this.nodes.get(id);
    return n ? { ...n, permissions: [...n.permissions], flags: [...n.flags] } : undefined;
  }

  anomalies(): TrustAnomaly[] {
    return [...this.anomalyLog];
  }

  // ---- inter-agent message signing ---------------------------------------

  /** Sign an inter-agent message with HMAC-SHA256 and a fresh nonce. */
  signMessage(from: string, to: string, payload: string, at: number = Date.now()): SignedMessage {
    if (!this.signingSecret) throw new Error('TrustGraph: signingSecret required to sign messages');
    const nonce = randomBytes(12).toString('hex');
    const timestamp = at;
    const signature = this.computeSignature(from, to, payload, timestamp, nonce);
    return { from, to, payload, timestamp, nonce, signature };
  }

  /**
   * Verify a signed message: signature integrity, freshness (within the replay
   * window), and nonce uniqueness (replay protection).
   */
  verifyMessage(msg: SignedMessage, now: number = Date.now()): MessageVerification {
    if (!this.signingSecret) return { valid: false, reason: 'no signing secret configured' };

    const expected = this.computeSignature(msg.from, msg.to, msg.payload, msg.timestamp, msg.nonce);
    const a = Buffer.from(msg.signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, reason: 'bad signature' };
    }

    if (Math.abs(now - msg.timestamp) > this.nonceWindowMs) {
      return { valid: false, reason: 'message expired (outside replay window)' };
    }

    this.pruneNonces(now);
    if (this.seenNonces.has(msg.nonce)) {
      return { valid: false, reason: 'replay detected (nonce reused)' };
    }
    this.seenNonces.set(msg.nonce, msg.timestamp);

    return { valid: true };
  }

  // ---- export / visualization --------------------------------------------

  export(): { nodes: TrustNode[]; edges: TrustEdge[]; anomalies: TrustAnomaly[] } {
    return {
      nodes: [...this.nodes.values()].map((n) => ({ ...n, permissions: [...n.permissions], flags: [...n.flags] })),
      edges: this.edges.map((e) => ({ ...e, permissions: [...e.permissions] })),
      anomalies: this.anomalies(),
    };
  }

  /** Mermaid flowchart of the trust graph (renderable to SVG/PNG downstream). */
  toMermaid(): string {
    const lines = ['graph TD'];
    for (const n of this.nodes.values()) {
      const t = n.effectiveTrust.toFixed(2);
      const danger = n.effectiveTrust < this.collapseThreshold ? ':::danger' : '';
      lines.push(`  ${safeId(n.id)}["${n.label}\\ntrust=${t} depth=${n.depth}"]${danger}`);
    }
    for (const e of this.edges) {
      lines.push(`  ${safeId(e.from)} -->|${e.permissions.join(',') || 'delegate'}| ${safeId(e.to)}`);
    }
    lines.push('  classDef danger fill:#fdd,stroke:#c00;');
    return lines.join('\n');
  }

  /** Graphviz DOT representation. */
  toDOT(): string {
    const lines = ['digraph TrustGraph {', '  rankdir=TB;', '  node [shape=box];'];
    for (const n of this.nodes.values()) {
      const color = n.effectiveTrust < this.collapseThreshold ? 'red' : 'black';
      lines.push(`  "${n.id}" [label="${n.label}\\ntrust=${n.effectiveTrust.toFixed(2)} depth=${n.depth}", color=${color}];`);
    }
    for (const e of this.edges) {
      lines.push(`  "${e.from}" -> "${e.to}" [label="${e.permissions.join(',')}"];`);
    }
    lines.push('}');
    return lines.join('\n');
  }

  // ---- internals ----------------------------------------------------------

  private applyPenalty(id: string, penalty: number, detail: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.effectiveTrust = clamp01(node.effectiveTrust - penalty);
    node.flags.push(detail);
    if (node.effectiveTrust < this.collapseThreshold) {
      this.recordAnomaly('trust-collapse', id,
        `Effective trust collapsed to ${node.effectiveTrust.toFixed(2)} after: ${detail}`);
    }
  }

  private recordAnomaly(type: AnomalyType, agentId: string, detail: string): TrustAnomaly {
    const anomaly: TrustAnomaly = { type, agentId, detail, at: Date.now() };
    this.anomalyLog.push(anomaly);
    const node = this.nodes.get(agentId);
    if (node) node.flags.push(`${type}: ${detail}`);
    return anomaly;
  }

  private computeSignature(from: string, to: string, payload: string, timestamp: number, nonce: string): string {
    return createHmac('sha256', this.signingSecret as string)
      .update(`${from}|${to}|${payload}|${timestamp}|${nonce}`)
      .digest('hex');
  }

  private pruneNonces(now: number): void {
    for (const [nonce, ts] of this.seenNonces) {
      if (now - ts > this.nonceWindowMs) this.seenNonces.delete(nonce);
    }
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Whether `permission` is covered by a set of granted scopes (with wildcards). */
function permitted(permission: string, granted: string[]): boolean {
  for (const g of granted) {
    if (g === '*' || g === permission) return true;
    if (g.endsWith('.*') && permission.startsWith(g.slice(0, -1))) return true;
    if (g.endsWith('*') && permission.startsWith(g.slice(0, -1))) return true;
  }
  return false;
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}
