// ---------------------------------------------------------------------------
// SENTINEL Persistence — Durable Storage for Audit State
// ---------------------------------------------------------------------------
// SENTINEL's trace store and Merkle chain are in-memory by default. For real
// deployments the tamper-evident audit trail must survive process restarts.
//
// `PersistenceStore` is a minimal, dependency-free key/value contract that any
// backend can implement (file, SQLite, Postgres, S3, …). Two reference
// implementations ship with SENTINEL:
//
//   - InMemoryPersistenceStore — volatile, useful for tests and ephemeral runs
//   - JsonFilePersistenceStore — durable, one JSON document per key, with
//     atomic writes (temp file + rename) so a crash mid-write never corrupts
//     an existing snapshot.
//
// Values are round-tripped through JSON, so stored data is always a deep,
// detached copy — callers cannot mutate persisted state by holding a reference.
// ---------------------------------------------------------------------------

import { mkdir, readFile, writeFile, rename, unlink, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A durable key/value store for SENTINEL audit snapshots.
 * All methods are async so backends may be remote or disk-backed.
 */
export interface PersistenceStore {
  /** Persist `data` under `key`, overwriting any existing value. */
  save(key: string, data: unknown): Promise<void>;

  /** Load the value stored under `key`, or `undefined` if absent. */
  load<T = unknown>(key: string): Promise<T | undefined>;

  /** Whether a value exists for `key`. */
  has(key: string): Promise<boolean>;

  /** Remove the value stored under `key`. No-op if absent. */
  delete(key: string): Promise<void>;

  /** List all keys currently held by the store. */
  keys(): Promise<string[]>;

  /** Remove every value from the store. */
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// InMemoryPersistenceStore
// ---------------------------------------------------------------------------

/**
 * Volatile {@link PersistenceStore} backed by a `Map`. Values are JSON-cloned
 * on the way in and out, matching the durable backends' detached-copy
 * semantics so tests behave identically against either implementation.
 */
export class InMemoryPersistenceStore implements PersistenceStore {
  private readonly data: Map<string, string> = new Map();

  async save(key: string, data: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(data));
  }

  async load<T = unknown>(key: string): Promise<T | undefined> {
    const raw = this.data.get(key);
    if (raw === undefined) return undefined;
    return JSON.parse(raw) as T;
  }

  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.data.keys());
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}

// ---------------------------------------------------------------------------
// JsonFilePersistenceStore
// ---------------------------------------------------------------------------

const FILE_SUFFIX = '.sentinel.json';

/**
 * Durable {@link PersistenceStore} that writes one JSON document per key into
 * a directory. Keys are percent-encoded into safe filenames, so any string
 * (including slashes and unicode) is a valid key.
 *
 * Writes are atomic: data is written to a unique temp file and then renamed
 * over the target, which is an atomic operation on POSIX filesystems. A crash
 * mid-write therefore leaves the previous snapshot intact.
 */
export class JsonFilePersistenceStore implements PersistenceStore {
  private readonly dir: string;
  /** Serializes writes to the same key to avoid interleaved temp renames. */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(directory: string) {
    this.dir = directory;
  }

  private fileFor(key: string): string {
    return join(this.dir, encodeURIComponent(key) + FILE_SUFFIX);
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.dir)) {
      await mkdir(this.dir, { recursive: true });
    }
  }

  async save(key: string, data: unknown): Promise<void> {
    const run = async (): Promise<void> => {
      await this.ensureDir();
      const target = this.fileFor(key);
      const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      const serialized = JSON.stringify(data, null, 2);
      try {
        await writeFile(tmp, serialized, 'utf8');
        await rename(tmp, target);
      } catch (err) {
        // Best-effort cleanup of the temp file on failure.
        await unlink(tmp).catch(() => undefined);
        throw err;
      }
    };
    // Chain writes so concurrent saves don't race on rename.
    const next = this.writeChain.then(run, run);
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  async load<T = unknown>(key: string): Promise<T | undefined> {
    const target = this.fileFor(key);
    try {
      const raw = await readFile(target, 'utf8');
      return JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async has(key: string): Promise<boolean> {
    return existsSync(this.fileFor(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.fileFor(key)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  async keys(): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    const entries = await readdir(this.dir);
    return entries
      .filter((name) => name.endsWith(FILE_SUFFIX))
      .map((name) => decodeURIComponent(name.slice(0, -FILE_SUFFIX.length)));
  }

  async clear(): Promise<void> {
    if (!existsSync(this.dir)) return;
    const entries = await readdir(this.dir);
    await Promise.all(
      entries
        .filter((name) => name.endsWith(FILE_SUFFIX))
        .map((name) => rm(join(this.dir, name), { force: true })),
    );
  }
}
