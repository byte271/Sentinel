// ---------------------------------------------------------------------------
// SENTINEL Deterministic Replay Engine (Feature 2)
// ---------------------------------------------------------------------------
// "I don't know what my agent actually did." This module records every agent
// action — tool calls, model inferences, state mutations, blocked actions — as
// an ordered, hash-chained execution log, and replays it with exact
// reproducibility. Think `rr` (Mozilla's record-and-replay debugger), but for
// AI agents.
//
//   - Every event is captured with its input, output, and content hashes.
//   - The log is a hash chain, so tampering is detectable.
//   - Deterministic replay: feeding the same inputs back through a ReplayCursor
//     returns the exact recorded outputs; a different input is flagged as a
//     non-determinism violation rather than silently diverging.
//   - Time-travel: seek to any point and reconstruct the state the agent saw.
//   - Exports to JSON for compliance audits (and maps cleanly onto a SQLite or
//     WASM-backed store — the recorder is storage-agnostic).
//
// Dependency-free (Node `crypto` only).
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';

export type ReplayEventType = 'tool_call' | 'inference' | 'state_mutation' | 'blocked';

export interface RecordedEvent {
  seq: number;
  type: ReplayEventType;
  /** Tool name, model name, or state key depending on type. */
  name: string;
  input: unknown;
  output: unknown;
  timestamp: number;
  inputHash: string;
  outputHash: string;
  /** Hash of the previous event's chainHash (genesis = zero). */
  previousHash: string;
  /** Hash over this event's fields + previousHash. */
  chainHash: string;
}

export interface RecordingExport {
  version: string;
  recordedAt: number;
  head: string;
  eventCount: number;
  events: RecordedEvent[];
}

const ZERO = '0'.repeat(64);

function hash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex');
}

/** Deterministic JSON stringify with sorted object keys. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce((acc, k) => { acc[k] = (v as Record<string, unknown>)[k]; return acc; }, {} as Record<string, unknown>);
    }
    return v;
  });
}

/** Records an agent session as a deterministic, hash-chained execution log. */
export class ExecutionRecorder {
  private events: RecordedEvent[] = [];

  /** Record one event. Returns the chained, hashed record. */
  record(type: ReplayEventType, name: string, input: unknown, output: unknown, at: number = Date.now()): RecordedEvent {
    const seq = this.events.length;
    const previousHash = seq === 0 ? ZERO : this.events[seq - 1].chainHash;
    const inputHash = hash(input ?? null);
    const outputHash = hash(output ?? null);
    const chainHash = createHash('sha256')
      .update(`${seq}|${type}|${name}|${inputHash}|${outputHash}|${previousHash}`)
      .digest('hex');
    const event: RecordedEvent = { seq, type, name, input, output, timestamp: at, inputHash, outputHash, previousHash, chainHash };
    this.events.push(event);
    return event;
  }

  /** Convenience helpers for the standard event kinds. */
  recordToolCall(name: string, input: unknown, output: unknown, at?: number): RecordedEvent {
    return this.record('tool_call', name, input, output, at);
  }
  recordInference(model: string, prompt: unknown, completion: unknown, at?: number): RecordedEvent {
    return this.record('inference', model, prompt, completion, at);
  }
  recordStateMutation(key: string, patch: Record<string, unknown>, at?: number): RecordedEvent {
    return this.record('state_mutation', key, undefined, patch, at);
  }
  recordBlocked(name: string, input: unknown, reason: unknown, at?: number): RecordedEvent {
    return this.record('blocked', name, input, reason, at);
  }

  log(): RecordedEvent[] {
    return [...this.events];
  }

  get length(): number {
    return this.events.length;
  }

  /** Stable digest of the entire recording (the head chain hash). */
  digest(): string {
    return this.events.length === 0 ? ZERO : this.events[this.events.length - 1].chainHash;
  }

  /** Verify the hash chain is intact. */
  verify(): { valid: boolean; brokenAt?: number } {
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      const prev = i === 0 ? ZERO : this.events[i - 1].chainHash;
      if (e.previousHash !== prev) return { valid: false, brokenAt: i };
      const recomputed = createHash('sha256')
        .update(`${e.seq}|${e.type}|${e.name}|${hash(e.input ?? null)}|${hash(e.output ?? null)}|${e.previousHash}`)
        .digest('hex');
      if (recomputed !== e.chainHash) return { valid: false, brokenAt: i };
    }
    return { valid: true };
  }

  export(): RecordingExport {
    return {
      version: '1',
      recordedAt: Date.now(),
      head: this.digest(),
      eventCount: this.events.length,
      events: this.log(),
    };
  }

  static import(data: RecordingExport): ExecutionRecorder {
    const r = new ExecutionRecorder();
    r.events = [...data.events];
    return r;
  }
}

/** Raised when replay inputs diverge from what was recorded. */
export class NonDeterminismError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonDeterminismError';
  }
}

/**
 * A time-travelling cursor over a recording. Drives deterministic replay and
 * reconstructs the state the agent saw at any point.
 */
export class ReplayCursor {
  private readonly events: RecordedEvent[];
  private pos = 0;

  constructor(source: ExecutionRecorder | RecordedEvent[]) {
    this.events = source instanceof ExecutionRecorder ? source.log() : [...source];
  }

  get position(): number {
    return this.pos;
  }

  get size(): number {
    return this.events.length;
  }

  reset(): void {
    this.pos = 0;
  }

  /** Move to an absolute sequence position. */
  seek(seq: number): RecordedEvent | undefined {
    this.pos = Math.max(0, Math.min(seq, this.events.length));
    return this.events[this.pos];
  }

  current(): RecordedEvent | undefined {
    return this.events[this.pos];
  }

  step(): RecordedEvent | undefined {
    return this.events[this.pos++];
  }

  rewind(to = 0): void {
    this.pos = Math.max(0, to);
  }

  /**
   * Deterministically replay the next event. The caller asserts the type, name,
   * and input it is about to execute; the cursor verifies they match the
   * recording (same input → same output) and returns the recorded output. A
   * mismatch throws NonDeterminismError.
   */
  next(type: ReplayEventType, name: string, input: unknown): unknown {
    const event = this.events[this.pos];
    if (!event) throw new NonDeterminismError(`Replay overran the log at position ${this.pos}`);
    if (event.type !== type || event.name !== name) {
      throw new NonDeterminismError(`Expected ${event.type}:${event.name} at seq ${event.seq}, got ${type}:${name}`);
    }
    if (hash(input ?? null) !== event.inputHash) {
      throw new NonDeterminismError(`Input divergence at seq ${event.seq} for ${type}:${name}`);
    }
    this.pos++;
    return event.output;
  }

  /** Reconstruct merged state from all state_mutation events up to (and incl.) seq. */
  stateAt(seq: number): Record<string, unknown> {
    const state: Record<string, unknown> = {};
    for (const e of this.events) {
      if (e.seq > seq) break;
      if (e.type === 'state_mutation' && e.output && typeof e.output === 'object') {
        Object.assign(state, e.output as Record<string, unknown>);
      }
    }
    return state;
  }

  /** All events of a given type (e.g. all blocked actions for a report). */
  filter(type: ReplayEventType): RecordedEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}
