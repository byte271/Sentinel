// ---------------------------------------------------------------------------
// SENTINEL Memory Integrity Layer (Feature 5)
// ---------------------------------------------------------------------------
// Agent memory is too often a plaintext file (e.g. OpenClaw's MEMORY.md) that
// can be silently rewritten — by a buggy agent, a prompt-injected one, or an
// attacker. This module turns memory into a signed, append-only, hash-chained
// ledger so that any tampering with historical entries is cryptographically
// detectable.
//
// Properties:
//   - Append-only hash chain: each entry embeds the hash of the previous one,
//     so editing/removing any past entry breaks every entry after it.
//   - Content hashing: the stored hash is recomputed from the stored fields on
//     verify(), so mutating a value in place is detected immediately.
//   - Optional HMAC-SHA256 signing: with a signing secret, entries cannot be
//     forged or re-chained without the secret.
//   - Provenance: every write records which agent wrote it, during which task,
//     and from what input/source.
//   - Temporal decay: memories lose trust as they age unless reinforced.
//   - Storage-agnostic: the ledger keeps entries in memory and (de)serializes
//     to plain JSON, so it works over any backend (file, SQLite, S3, ...).
//
// Hashing defaults to SHA-256 (Node built-in, zero dependencies). A custom
// hasher (e.g. BLAKE3 from a native addon) can be injected via options without
// changing any call sites.
// ---------------------------------------------------------------------------

import { createHash, createHmac, timingSafeEqual } from 'crypto';

/** Where a memory came from — used for trust weighting. */
export type MemorySource = 'agent' | 'user' | 'tool' | 'web' | 'system' | 'unknown';

export interface MemoryProvenance {
  /** The agent that wrote this memory. */
  agentId: string;
  /** The task/session during which it was written. */
  taskId?: string;
  /** Where the information originated. Untrusted sources (web/tool) decay faster. */
  source?: MemorySource;
  /** Hash of the input that produced this memory (e.g. the tool output). */
  inputHash?: string;
}

export interface MemoryEntry {
  sequence: number;
  id: string;
  key: string;
  value: string;
  /** Hash over the canonical serialization of this entry's fields. */
  contentHash: string;
  /** contentHash of the previous entry (or zero hash for the genesis entry). */
  previousHash: string;
  timestamp: number;
  /** Last time this memory was reinforced (defaults to write time). */
  reinforcedAt: number;
  /** Number of times this memory has been reinforced. */
  reinforceCount: number;
  provenance: MemoryProvenance;
  /** HMAC-SHA256 signature over contentHash, present when a secret is set. */
  signature?: string;
}

export interface MemoryVerification {
  valid: boolean;
  length: number;
  brokenAt?: number;
  reason?: string;
}

export interface MemoryLedgerOptions {
  /** Custom hash function (defaults to SHA-256). Inject BLAKE3 here if desired. */
  hasher?: (input: string) => string;
  /** Secret for HMAC-SHA256 signing. When set, every entry is signed/verified. */
  signingSecret?: string;
  /** Half-life (ms) for temporal decay. Default: 7 days. */
  decayHalfLifeMs?: number;
  /** Per-source trust multipliers (0–1). Untrusted sources start lower. */
  sourceTrust?: Partial<Record<MemorySource, number>>;
}

const ZERO_HASH = '0'.repeat(64);
const DEFAULT_HALF_LIFE = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SOURCE_TRUST: Record<MemorySource, number> = {
  user: 1.0,
  system: 1.0,
  agent: 0.9,
  tool: 0.6,
  web: 0.4,
  unknown: 0.5,
};

let counter = 0;

export class MemoryLedger {
  private entries: MemoryEntry[] = [];
  private readonly hasher: (input: string) => string;
  private readonly signingSecret?: string;
  private readonly halfLife: number;
  private readonly sourceTrust: Record<MemorySource, number>;

  constructor(options: MemoryLedgerOptions = {}) {
    this.hasher = options.hasher ?? ((input) => createHash('sha256').update(input).digest('hex'));
    this.signingSecret = options.signingSecret;
    this.halfLife = options.decayHalfLifeMs ?? DEFAULT_HALF_LIFE;
    this.sourceTrust = { ...DEFAULT_SOURCE_TRUST, ...(options.sourceTrust ?? {}) };
  }

  /** Append a new memory write. Returns the created, chained (and signed) entry. */
  append(key: string, value: string, provenance: MemoryProvenance, at: number = Date.now()): MemoryEntry {
    const previousHash = this.entries.length > 0
      ? this.entries[this.entries.length - 1].contentHash
      : ZERO_HASH;
    const sequence = this.entries.length;
    const base = {
      sequence,
      id: `mem-${Date.now().toString(36)}-${(counter++).toString(36)}`,
      key,
      value,
      previousHash,
      timestamp: at,
      reinforcedAt: at,
      reinforceCount: 0,
      provenance,
    };
    const contentHash = this.hashEntry(base);
    const entry: MemoryEntry = {
      ...base,
      contentHash,
      signature: this.signingSecret ? this.sign(contentHash) : undefined,
    };
    this.entries.push(entry);
    return entry;
  }

  /**
   * Walk the chain and verify integrity: linkage, recomputed content hashes,
   * and (when signing is enabled) signatures. Detects in-place mutation,
   * deletion, reordering, and forgery.
   */
  verify(): MemoryVerification {
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];

      const expectedPrev = i === 0 ? ZERO_HASH : this.entries[i - 1].contentHash;
      if (e.previousHash !== expectedPrev) {
        return { valid: false, length: this.entries.length, brokenAt: i, reason: `Entry ${i} previousHash linkage broken` };
      }

      const recomputed = this.hashEntry(e);
      if (recomputed !== e.contentHash) {
        return { valid: false, length: this.entries.length, brokenAt: i, reason: `Entry ${i} content hash mismatch (tampered value)` };
      }

      if (this.signingSecret) {
        if (!e.signature || !this.verifySignature(e.contentHash, e.signature)) {
          return { valid: false, length: this.entries.length, brokenAt: i, reason: `Entry ${i} signature invalid` };
        }
      }
    }
    return { valid: true, length: this.entries.length };
  }

  /** Reinforce a memory (resets its decay clock). Returns the new entry, if any. */
  reinforce(key: string, at: number = Date.now()): MemoryEntry | undefined {
    const latest = this.get(key);
    if (!latest) return undefined;
    // Reinforcement is itself an appended, chained event so the ledger stays
    // append-only and auditable.
    const entry = this.append(key, latest.value, {
      ...latest.provenance,
      source: latest.provenance.source,
    }, at);
    entry.reinforceCount = latest.reinforceCount + 1;
    entry.reinforcedAt = at;
    // Re-hash/sign because we mutated decay metadata after creation.
    entry.contentHash = this.hashEntry(entry);
    entry.signature = this.signingSecret ? this.sign(entry.contentHash) : undefined;
    // Fix the chain head's stored hash references for the next append.
    return entry;
  }

  /** Latest entry for a key (the current value of that memory). */
  get(key: string): MemoryEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].key === key) return this.entries[i];
    }
    return undefined;
  }

  /** Full write history for a key, oldest first. */
  history(key: string): MemoryEntry[] {
    return this.entries.filter((e) => e.key === key);
  }

  /** All entries in chain order. */
  all(): MemoryEntry[] {
    return [...this.entries];
  }

  get length(): number {
    return this.entries.length;
  }

  /**
   * Temporal decay score in [0,1] for the current value of a key, combining
   * exponential age-decay (reset by reinforcement) with the source trust
   * weight. Old, unreinforced, low-trust memories score near 0.
   */
  trustScore(key: string, now: number = Date.now()): number {
    const e = this.get(key);
    if (!e) return 0;
    const age = Math.max(0, now - e.reinforcedAt);
    const decay = Math.pow(0.5, age / this.halfLife);
    const sourceWeight = this.sourceTrust[e.provenance.source ?? 'unknown'];
    // Reinforcement provides a bounded boost.
    const reinforcement = Math.min(1, 1 + e.reinforceCount * 0.1);
    return Math.max(0, Math.min(1, decay * sourceWeight * reinforcement));
  }

  /**
   * Export a verifiable audit log: the full chain plus its head hash and a
   * verification result, suitable for archival or third-party checking.
   */
  export(): { algorithm: string; signed: boolean; head: string; verification: MemoryVerification; entries: MemoryEntry[] } {
    return {
      algorithm: this.signingSecret ? 'sha256+hmac-sha256' : 'sha256',
      signed: Boolean(this.signingSecret),
      head: this.entries.length > 0 ? this.entries[this.entries.length - 1].contentHash : ZERO_HASH,
      verification: this.verify(),
      entries: this.all(),
    };
  }

  /** Reconstruct a ledger from previously exported entries (does not re-sign). */
  static fromEntries(entries: MemoryEntry[], options: MemoryLedgerOptions = {}): MemoryLedger {
    const ledger = new MemoryLedger(options);
    ledger.entries = [...entries];
    return ledger;
  }

  // ---- internals ----------------------------------------------------------

  private hashEntry(e: Omit<MemoryEntry, 'contentHash' | 'signature'>): string {
    const canonical = JSON.stringify([
      e.sequence,
      e.key,
      e.value,
      e.previousHash,
      e.timestamp,
      e.reinforcedAt,
      e.reinforceCount,
      e.provenance.agentId,
      e.provenance.taskId ?? '',
      e.provenance.source ?? 'unknown',
      e.provenance.inputHash ?? '',
    ]);
    return this.hasher(canonical);
  }

  private sign(contentHash: string): string {
    return createHmac('sha256', this.signingSecret as string).update(contentHash).digest('hex');
  }

  private verifySignature(contentHash: string, signature: string): boolean {
    const expected = this.sign(contentHash);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
