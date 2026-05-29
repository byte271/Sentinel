import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuid } from 'uuid';
import {
  InMemoryPersistenceStore,
  JsonFilePersistenceStore,
  createSentinel,
  createFilesystemSurface,
  FilesystemAdapter,
} from '../src/index.js';
import type { PersistenceStore } from '../src/index.js';
import { TraceStore } from '../src/trace/store.js';
import { MerkleChain } from '../src/trace/merkle.js';
import type { ActionIntent, ActorIdentity } from '../src/kernel/types.js';

const actor: ActorIdentity = { id: 'persist-user', type: 'human', name: 'Tester', trust: 'elevated', scopes: ['*'] };
function makeIntent(surface: string, action: string, params: Record<string, unknown>): ActionIntent {
  return { id: uuid(), surface, action, params, initiator: actor, timestamp: Date.now(), metadata: {} };
}

// Shared contract exercised against every PersistenceStore implementation.
function runStoreContract(name: string, factory: () => PersistenceStore) {
  describe(`PersistenceStore contract: ${name}`, () => {
    it('saves and loads a value as a detached copy', async () => {
      const store = factory();
      const original = { a: 1, nested: { b: [1, 2, 3] } };
      await store.save('k1', original);

      const loaded = await store.load<typeof original>('k1');
      expect(loaded).toEqual(original);

      // Mutating the original must not affect persisted state.
      original.nested.b.push(99);
      const reloaded = await store.load<typeof original>('k1');
      expect(reloaded!.nested.b).toEqual([1, 2, 3]);
    });

    it('returns undefined for missing keys', async () => {
      const store = factory();
      expect(await store.load('nope')).toBeUndefined();
      expect(await store.has('nope')).toBe(false);
    });

    it('reports presence and lists keys', async () => {
      const store = factory();
      await store.save('alpha', 1);
      await store.save('beta', 2);
      expect(await store.has('alpha')).toBe(true);
      const keys = (await store.keys()).sort();
      expect(keys).toEqual(['alpha', 'beta']);
    });

    it('handles keys with unusual characters', async () => {
      const store = factory();
      const weird = 'sentinel:trace/store ünïcode #1';
      await store.save(weird, { ok: true });
      expect(await store.has(weird)).toBe(true);
      expect(await store.load(weird)).toEqual({ ok: true });
      expect(await store.keys()).toContain(weird);
    });

    it('overwrites and deletes', async () => {
      const store = factory();
      await store.save('k', 'v1');
      await store.save('k', 'v2');
      expect(await store.load('k')).toBe('v2');
      await store.delete('k');
      expect(await store.has('k')).toBe(false);
      // Deleting a missing key is a no-op.
      await expect(store.delete('k')).resolves.toBeUndefined();
    });

    it('clears all keys', async () => {
      const store = factory();
      await store.save('a', 1);
      await store.save('b', 2);
      await store.clear();
      expect(await store.keys()).toEqual([]);
    });
  });
}

describe('Persistence stores', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `sentinel-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  runStoreContract('InMemory', () => new InMemoryPersistenceStore());
  runStoreContract('JsonFile', () => new JsonFilePersistenceStore(join(tmpdir(), `sentinel-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`)));

  it('JsonFile writes durable files and serializes concurrent saves', async () => {
    const store = new JsonFilePersistenceStore(dir);
    await Promise.all([
      store.save('x', { n: 1 }),
      store.save('x', { n: 2 }),
      store.save('y', { n: 3 }),
    ]);
    expect(existsSync(dir)).toBe(true);
    // y is independent; x has one of the written values (no corruption).
    expect(await store.load('y')).toEqual({ n: 3 });
    const x = await store.load<{ n: number }>('x');
    expect([1, 2]).toContain(x!.n);
    // No leftover temp files.
    const keys = await store.keys();
    expect(keys.sort()).toEqual(['x', 'y']);
  });
});

describe('MerkleChain restore', () => {
  it('restores an exported chain that still verifies', () => {
    const chain = new MerkleChain();
    chain.append('a', 'data-a');
    chain.append('b', 'data-b');
    chain.append('c', 'data-c');
    const exported = chain.export();
    const rootBefore = chain.getRoot();

    const restored = new MerkleChain();
    restored.restore(exported);
    expect(restored.length).toBe(3);
    expect(restored.getRoot()).toBe(rootBefore);
    expect(restored.verify().valid).toBe(true);
  });
});

describe('TraceStore snapshot / restore / persistence', () => {
  let dir: string;
  const sid = 'persist-fs';
  beforeEach(() => {
    dir = join(tmpdir(), `sentinel-persist-fs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  async function populatedStore(): Promise<TraceStore> {
    const sentinel = createSentinel();
    const surface = createFilesystemSurface(sid, 'Persist FS', dir);
    sentinel.kernel.registerSurface(surface);
    sentinel.executor.registerAdapter(new FilesystemAdapter(sid, dir));
    sentinel.identity.register(actor);
    await sentinel.kernel.execute(makeIntent(sid, 'write_file', { path: 'p1.txt', content: 'one' }));
    await sentinel.kernel.execute(makeIntent(sid, 'write_file', { path: 'p2.txt', content: 'two' }));
    return sentinel.trace;
  }

  it('round-trips state through snapshot/restore preserving the verifiable chain', async () => {
    const store = await populatedStore();
    const before = store.list();
    expect(before.length).toBe(2);
    const rootBefore = store.getChainRoot();

    const snapshot = store.snapshot();
    const restored = new TraceStore();
    restored.restore(snapshot);

    expect(restored.list().length).toBe(2);
    expect(restored.getChainRoot()).toBe(rootBefore);
    expect(restored.verifyChain().valid).toBe(true);
    // Secondary indexes rebuilt: filtering by surface works.
    expect(restored.list({ surfaceId: sid }).length).toBe(2);
  });

  it('persists to and hydrates from a PersistenceStore backend', async () => {
    const store = await populatedStore();
    const backend = new JsonFilePersistenceStore(join(dir, 'audit'));
    const key = await store.persist(backend);

    const fresh = new TraceStore();
    expect(await fresh.hydrate(backend, key)).toBe(true);
    expect(fresh.list().length).toBe(2);
    expect(fresh.verifyChain().valid).toBe(true);

    // Hydrating from a missing key reports false.
    const empty = new TraceStore();
    expect(await empty.hydrate(backend, 'does-not-exist')).toBe(false);
  });

  it('rejects snapshots with an unsupported version', () => {
    const store = new TraceStore();
    expect(() =>
      store.restore({ version: 999, traces: [], eventLog: [], chain: [] }),
    ).toThrow(/Unsupported TraceStore snapshot version/);
  });
});
