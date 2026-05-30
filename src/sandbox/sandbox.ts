// ---------------------------------------------------------------------------
// SENTINEL Deterministic Shadow Sandbox (v0.3.0, S4)
// ---------------------------------------------------------------------------
// v0.2.0's ShadowExecutor uses pluggable adapters that simulate side effects
// in-memory — correct but not truly isolated. v0.3.0 introduces a full
// deterministic sandbox: every tool call runs against a memory-backed virtual
// file system, recorded (not-sent) network layer, deterministic seeded PRNG,
// and a virtual clock. The result is bit-for-bit reproducible shadow runs.
//
// Honest-engineering note: this is an in-process sandbox, not a true WASM
// isolation boundary. The architecture (virtual FS/net/time/random exposed via
// a uniform API, deterministic by construction, replayable from a snapshot) is
// identical to what a WASM runtime would provide, but does not enforce memory
// isolation from a hostile guest. Compiling the sandbox harness into a real
// WASM module (via wasm-rr or wasmtime) is the production extension point and
// documented as such.
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';

/** A single entry in the virtual filesystem. */
export interface VfsEntry {
  type: 'file' | 'dir';
  content?: string;
  createdAt: number;
  modifiedAt: number;
}

/** A captured (never-sent) network request. */
export interface CapturedRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  capturedAt: number;
}

/** The complete deterministic state of a sandbox run (snapshotable). */
export interface SandboxSnapshot {
  seed: string;
  clock: number;
  prngCalls: number;
  fs: Record<string, VfsEntry>;
  network: CapturedRequest[];
  /** SHA-256 over the canonical JSON of this snapshot (minus the hash). */
  hash: string;
}

export interface SandboxOptions {
  /** Seed for the deterministic PRNG. Same seed → same run. */
  seed?: string;
  /** Starting virtual clock (epoch ms). Default: 0. */
  startTime?: number;
  /** Pre-populate the virtual filesystem. */
  initialFs?: Record<string, string>;
}

/**
 * A seeded, repeatable pseudo-random number generator (xorshift128+).
 * Same seed always produces the same stream — a hard requirement for
 * bit-for-bit replay.
 */
class DeterministicPrng {
  private s0: number;
  private s1: number;
  calls = 0;

  constructor(seed: string) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    }
    this.s0 = h ^ 0xdeadbeef;
    this.s1 = h ^ 0xcafebabe;
  }

  /** Returns a deterministic float in [0, 1). */
  next(): number {
    this.calls++;
    let x = this.s0;
    const y = this.s1;
    this.s0 = y;
    x ^= x << 23;
    x ^= x >> 17;
    x ^= y;
    x ^= y >> 26;
    this.s1 = x;
    return ((this.s0 + this.s1) >>> 0) / 0x100000000;
  }

  /** Deterministic UUID v4 (uses the PRNG, not crypto). */
  uuid(): string {
    const hex = () => Math.floor(this.next() * 16).toString(16);
    return [
      Array.from({ length: 8 }, hex).join(''),
      Array.from({ length: 4 }, hex).join(''),
      '4' + Array.from({ length: 3 }, hex).join(''),
      ((8 + Math.floor(this.next() * 4)).toString(16)) + Array.from({ length: 3 }, hex).join(''),
      Array.from({ length: 12 }, hex).join(''),
    ].join('-');
  }
}

export class DeterministicSandbox {
  readonly seed: string;
  private clock: number;
  private prng: DeterministicPrng;

  private readonly fs = new Map<string, VfsEntry>();
  private readonly network: CapturedRequest[] = [];

  constructor(options: SandboxOptions = {}) {
    this.seed = options.seed ?? 'sentinel';
    this.clock = options.startTime ?? 0;
    this.prng = new DeterministicPrng(this.seed);

    // Pre-populate FS
    if (options.initialFs) {
      for (const [path, content] of Object.entries(options.initialFs)) {
        this.writeFile(path, content);
      }
    }
  }

  // ---- Virtual clock -------------------------------------------------------

  now(): number {
    return this.clock;
  }

  advanceTime(ms: number): void {
    this.clock += ms;
  }

  // ---- Deterministic PRNG --------------------------------------------------

  random(): number {
    return this.prng.next();
  }

  randomInt(min: number, max: number): number {
    return min + Math.floor(this.prng.next() * (max - min));
  }

  uuid(): string {
    return this.prng.uuid();
  }

  // ---- Virtual filesystem --------------------------------------------------

  writeFile(path: string, content: string): void {
    const existing = this.fs.get(path);
    this.fs.set(path, {
      type: 'file',
      content,
      createdAt: existing?.createdAt ?? this.clock,
      modifiedAt: this.clock,
    });
  }

  readFile(path: string): string | undefined {
    const entry = this.fs.get(path);
    return entry?.type === 'file' ? entry.content : undefined;
  }

  deleteFile(path: string): boolean {
    return this.fs.delete(path);
  }

  mkdir(path: string): void {
    if (!this.fs.has(path)) {
      this.fs.set(path, { type: 'dir', createdAt: this.clock, modifiedAt: this.clock });
    }
  }

  listDir(path: string): string[] {
    const prefix = path.endsWith('/') ? path : path + '/';
    const names: string[] = [];
    for (const key of this.fs.keys()) {
      if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
        names.push(key.slice(prefix.length));
      }
    }
    return names.sort();
  }

  exists(path: string): boolean {
    return this.fs.has(path);
  }

  stat(path: string): VfsEntry | undefined {
    return this.fs.get(path);
  }

  // ---- Virtual network (captured, never sent) ------------------------------

  captureRequest(method: string, url: string, body?: string, headers?: Record<string, string>): CapturedRequest {
    const req: CapturedRequest = { method, url, headers, body, capturedAt: this.clock };
    this.network.push(req);
    return req;
  }

  getCapturedRequests(): CapturedRequest[] {
    return [...this.network];
  }

  // ---- Snapshot & replay ---------------------------------------------------

  snapshot(): SandboxSnapshot {
    const fsObj: Record<string, VfsEntry> = {};
    for (const [k, v] of this.fs) fsObj[k] = { ...v };
    const snap: Omit<SandboxSnapshot, 'hash'> = {
      seed: this.seed,
      clock: this.clock,
      prngCalls: this.prng.calls,
      fs: fsObj,
      network: this.network.map((r) => ({ ...r })),
    };
    const hash = createHash('sha256').update(JSON.stringify(snap)).digest('hex');
    return { ...snap, hash };
  }

  /** Two snapshots from identical inputs must have the same hash. */
  static verifySnapshot(snapshot: SandboxSnapshot): boolean {
    const { hash, ...rest } = snapshot;
    const recomputed = createHash('sha256').update(JSON.stringify(rest)).digest('hex');
    return recomputed === hash;
  }

  /** Restore a sandbox to a previous snapshot state. */
  static fromSnapshot(snapshot: SandboxSnapshot): DeterministicSandbox {
    const sb = new DeterministicSandbox({ seed: snapshot.seed, startTime: snapshot.clock });
    // Replay PRNG to the correct position.
    for (let i = 0; i < snapshot.prngCalls; i++) sb.prng.next();
    for (const [path, entry] of Object.entries(snapshot.fs)) sb.fs.set(path, { ...entry });
    for (const req of snapshot.network) sb.network.push({ ...req });
    return sb;
  }
}
