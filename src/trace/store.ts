/**
 * SENTINEL-Trace: Trace Store
 *
 * The TraceStore is the audit / memory layer of SENTINEL. Every intent that flows
 * through the system produces a TraceRecord. Each record accumulates
 * TraceEvents as the intent moves through shadow, commit, and rollback
 * phases. The store supports filtering, timeline reconstruction, statistics,
 * and full JSON export for external analysis.
 */

import { v4 as uuid } from 'uuid';
import type { TraceRecord, TraceEvent } from '../kernel/types.js';
import { MerkleChain } from './merkle.js';
import type { MerkleTraceEntry } from './merkle.js';
import type { PersistenceStore } from '../persist/store.js';

/** Serializable snapshot of a TraceStore's full state. */
export interface TraceStoreSnapshot {
  /** Snapshot schema version for forward-compatibility. */
  version: number;
  /** Every stored trace record. */
  traces: TraceRecord[];
  /** The global cross-trace event log. */
  eventLog: TraceEvent[];
  /** The Merkle audit chain entries. */
  chain: MerkleTraceEntry[];
}

/** Default persistence key under which a TraceStore snapshot is stored. */
export const TRACE_SNAPSHOT_KEY = 'sentinel:trace-store';

const SNAPSHOT_VERSION = 1;

// ---------------------------------------------------------------------------
// TraceFilter — criteria for querying stored traces.
// ---------------------------------------------------------------------------

export interface TraceFilter {
  /** Only return traces for this surface. */
  surfaceId?: string;

  /** Only return traces initiated by this actor. */
  actorId?: string;

  /** Only return traces with this status. */
  status?: TraceRecord['status'];

  /** Only return traces started at or after this timestamp (ms). */
  fromTimestamp?: number;

  /** Only return traces started at or before this timestamp (ms). */
  toTimestamp?: number;

  /** Maximum number of traces to return. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// TraceStore
// ---------------------------------------------------------------------------

export class TraceStore {
  /** All traces keyed by trace ID. */
  private traces: Map<string, TraceRecord> = new Map();

  /** Global event log across all traces. */
  private eventLog: TraceEvent[] = [];

  /** Secondary indexes for fast lookups. */
  private indexByIntent: Map<string, string> = new Map();  // intentId -> traceId
  private indexBySurface: Map<string, Set<string>> = new Map();  // surface -> set of traceIds
  private indexByActor: Map<string, Set<string>> = new Map();  // actorId -> set of traceIds
  private indexByStatus: Map<string, Set<string>> = new Map();  // status -> set of traceIds

  /** Merkle chain for tamper-evident audit. */
  private chain: MerkleChain = new MerkleChain();

  // -----------------------------------------------------------------------
  // Basic CRUD
  // -----------------------------------------------------------------------

  /** Store (or overwrite) a trace record. */
  record(trace: TraceRecord): void {
    const oldTrace = this.traces.get(trace.id);

    // Remove stale index entries when overwriting an existing trace.
    if (oldTrace) {
      this.removeFromIndex(this.indexBySurface, oldTrace.surface, oldTrace.id);
      this.removeFromIndex(this.indexByActor, oldTrace.actor.id, oldTrace.id);
      this.removeFromIndex(this.indexByStatus, oldTrace.status, oldTrace.id);
    }

    this.traces.set(trace.id, trace);

    // Maintain secondary indexes via the shared addToIndex helper.
    this.indexByIntent.set(trace.intentId, trace.id);
    this.addToIndex(this.indexBySurface, trace.surface, trace.id);
    this.addToIndex(this.indexByActor, trace.actor.id, trace.id);
    this.addToIndex(this.indexByStatus, trace.status, trace.id);

    // Only append to the Merkle chain for new traces, not updates.
    if (!oldTrace) {
      this.chain.append(trace.id, JSON.stringify(trace));
    }
  }

  /** Retrieve a trace by its own ID. */
  get(id: string): TraceRecord | undefined {
    return this.traces.get(id);
  }

  /** Retrieve the first trace that matches a given intentId. */
  getByIntentId(intentId: string): TraceRecord | undefined {
    const traceId = this.indexByIntent.get(intentId);
    if (traceId !== undefined) {
      return this.traces.get(traceId);
    }
    return undefined;
  }

  // -----------------------------------------------------------------------
  // Listing & filtering
  // -----------------------------------------------------------------------

  /**
   * List traces, optionally filtered and limited.
   * Results are sorted by startedAt descending (most recent first).
   */
  list(filter?: TraceFilter): TraceRecord[] {
    let candidateIds: Set<string> | undefined;

    if (filter) {
      // Use indexes for indexed fields; intersect candidate sets.
      if (filter.surfaceId !== undefined) {
        const ids = this.indexBySurface.get(filter.surfaceId);
        candidateIds = ids ? new Set(ids) : new Set();
      }
      if (filter.actorId !== undefined) {
        const ids = this.indexByActor.get(filter.actorId);
        candidateIds = this.intersect(candidateIds, ids ?? new Set());
      }
      if (filter.status !== undefined) {
        const ids = this.indexByStatus.get(filter.status);
        candidateIds = this.intersect(candidateIds, ids ?? new Set());
      }
    }

    let results: TraceRecord[];
    if (candidateIds !== undefined) {
      results = [];
      for (const id of candidateIds) {
        const trace = this.traces.get(id);
        if (trace) results.push(trace);
      }
    } else {
      results = Array.from(this.traces.values());
    }

    // Apply timestamp filters (not indexed).
    if (filter) {
      if (filter.fromTimestamp !== undefined) {
        results = results.filter((t) => t.startedAt >= filter.fromTimestamp!);
      }
      if (filter.toTimestamp !== undefined) {
        results = results.filter((t) => t.startedAt <= filter.toTimestamp!);
      }
    }

    // Sort by startedAt descending.
    results.sort((a, b) => b.startedAt - a.startedAt);

    // Apply limit.
    if (filter?.limit !== undefined && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /** Alias for list() — convenience for users expecting `query`. */
  query(filter?: TraceFilter): TraceRecord[] {
    return this.list(filter);
  }

  // -----------------------------------------------------------------------
  // Event management
  // -----------------------------------------------------------------------

  /**
   * Append an event to a specific trace and to the global event log.
   * If the trace does not exist this is a no-op for the trace-level append
   * but the event is still recorded globally.
   */
  addEvent(traceId: string, event: TraceEvent): void {
    // Add to the global log regardless.
    this.eventLog.push(event);

    // Add to the trace's own events array.
    const trace = this.traces.get(traceId);
    if (trace) {
      if (!trace.events) {
        trace.events = [];
      }
      trace.events.push(event);
    }
  }

  /** Get all events associated with a specific trace. */
  getEvents(traceId: string): TraceEvent[] {
    const trace = this.traces.get(traceId);
    return trace?.events ?? [];
  }

  // -----------------------------------------------------------------------
  // Timeline
  // -----------------------------------------------------------------------

  /**
   * Build a human-readable timeline for a trace, ordered chronologically.
   * Each line has the format: `[ISO timestamp] phase — message`
   */
  getTimeline(traceId: string): string {
    const events = this.getEvents(traceId);
    if (events.length === 0) {
      return `No events recorded for trace ${traceId}`;
    }

    // Sort events chronologically.
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

    const lines = sorted.map((e) => {
      const time = new Date(e.timestamp).toISOString();
      const message = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
      return `[${time}] ${e.type} — ${message}`;
    });

    return lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // Statistics
  // -----------------------------------------------------------------------

  /** Compute aggregate statistics across all stored traces. */
  getStats(): {
    total: number;
    byStatus: Record<string, number>;
    bySurface: Record<string, number>;
    avgDurationMs: number;
  } {
    const all = Array.from(this.traces.values());
    const total = all.length;

    const byStatus: Record<string, number> = {};
    const bySurface: Record<string, number> = {};
    let totalDuration = 0;
    let durCount = 0;

    for (const t of all) {
      // Status counts.
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;

      // Surface counts.
      bySurface[t.surface] = (bySurface[t.surface] ?? 0) + 1;

      // Duration (only if completedAt is present).
      if (t.completedAt !== undefined) {
        totalDuration += t.completedAt - t.startedAt;
        durCount++;
      }
    }

    const avgDurationMs = durCount > 0 ? totalDuration / durCount : 0;

    return { total, byStatus, bySurface, avgDurationMs };
  }

  // -----------------------------------------------------------------------
  // Export
  // -----------------------------------------------------------------------

  /** Export a single trace (with events) as a formatted JSON string. */
  export(traceId: string): string {
    const trace = this.traces.get(traceId);
    if (!trace) {
      return JSON.stringify({ error: `Trace ${traceId} not found` }, null, 2);
    }
    return JSON.stringify(trace, null, 2);
  }

  /** Export every trace as a formatted JSON array. */
  exportAll(): string {
    const all = Array.from(this.traces.values());
    return JSON.stringify(all, null, 2);
  }

  // -----------------------------------------------------------------------
  // Merkle chain integration
  // -----------------------------------------------------------------------

  /** Verify the integrity of the entire Merkle chain. */
  verifyChain(): { valid: boolean; length: number; brokenAt?: number; brokenReason?: string } {
    return this.chain.verify();
  }

  /** Retrieve a single chain entry by sequence number. */
  getChainEntry(sequenceNumber: number) {
    return this.chain.getEntry(sequenceNumber);
  }

  /** Return the number of entries in the Merkle chain. */
  getChainLength(): number {
    return this.chain.length;
  }

  /** Return the current Merkle root hash. */
  getChainRoot(): string {
    return this.chain.getRoot();
  }

  /** Return the Merkle proof for a given sequence number. */
  getChainProof(sequenceNumber: number): string[] {
    return this.chain.getProof(sequenceNumber);
  }

  /** Export the full Merkle chain. */
  exportChain() {
    return this.chain.export();
  }

  // -----------------------------------------------------------------------
  // Persistence (snapshot / restore)
  // -----------------------------------------------------------------------

  /**
   * Capture the complete state of this store — traces, global event log, and
   * the Merkle chain — as a serializable, deeply-detached snapshot.
   */
  snapshot(): TraceStoreSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      traces: Array.from(this.traces.values()),
      eventLog: [...this.eventLog],
      chain: this.chain.export(),
    };
  }

  /**
   * Replace this store's state with the contents of a snapshot. Secondary
   * indexes are rebuilt and the Merkle chain is restored verbatim (it is NOT
   * recomputed), so a snapshot taken from a valid chain remains verifiable
   * after restore.
   */
  restore(snapshot: TraceStoreSnapshot): void {
    if (snapshot.version !== SNAPSHOT_VERSION) {
      throw new Error(
        `Unsupported TraceStore snapshot version ${snapshot.version} (expected ${SNAPSHOT_VERSION}).`,
      );
    }

    this.traces.clear();
    this.indexByIntent.clear();
    this.indexBySurface.clear();
    this.indexByActor.clear();
    this.indexByStatus.clear();

    for (const trace of snapshot.traces) {
      this.traces.set(trace.id, trace);
      this.indexByIntent.set(trace.intentId, trace.id);
      this.addToIndex(this.indexBySurface, trace.surface, trace.id);
      this.addToIndex(this.indexByActor, trace.actor.id, trace.id);
      this.addToIndex(this.indexByStatus, trace.status, trace.id);
    }

    this.eventLog = [...snapshot.eventLog];
    this.chain.restore(snapshot.chain);
  }

  /**
   * Write a snapshot of this store to a {@link PersistenceStore} backend.
   * Returns the key the snapshot was written under.
   */
  async persist(store: PersistenceStore, key: string = TRACE_SNAPSHOT_KEY): Promise<string> {
    await store.save(key, this.snapshot());
    return key;
  }

  /**
   * Load a snapshot from a {@link PersistenceStore} backend into this store.
   * Returns `true` if a snapshot was found and restored, `false` otherwise.
   */
  async hydrate(store: PersistenceStore, key: string = TRACE_SNAPSHOT_KEY): Promise<boolean> {
    const snapshot = await store.load<TraceStoreSnapshot>(key);
    if (snapshot === undefined) return false;
    this.restore(snapshot);
    return true;
  }

  // -----------------------------------------------------------------------
  // Private index helpers
  // -----------------------------------------------------------------------

  private addToIndex(index: Map<string, Set<string>>, key: string, traceId: string): void {
    let set = index.get(key);
    if (!set) {
      set = new Set();
      index.set(key, set);
    }
    set.add(traceId);
  }

  private removeFromIndex(index: Map<string, Set<string>>, key: string, traceId: string): void {
    const set = index.get(key);
    if (set) {
      set.delete(traceId);
      if (set.size === 0) {
        index.delete(key);
      }
    }
  }

  private intersect(existing: Set<string> | undefined, incoming: Set<string>): Set<string> {
    if (existing === undefined) {
      return new Set(incoming);
    }
    const result = new Set<string>();
    for (const id of existing) {
      if (incoming.has(id)) {
        result.add(id);
      }
    }
    return result;
  }
}
