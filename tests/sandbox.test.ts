import { describe, it, expect } from 'vitest';
import { DeterministicSandbox } from '../src/sandbox/index.js';

describe('Deterministic Shadow Sandbox', () => {
  it('virtual filesystem reads back what it writes', () => {
    const sb = new DeterministicSandbox();
    sb.writeFile('/tmp/a.txt', 'hello');
    expect(sb.readFile('/tmp/a.txt')).toBe('hello');
    expect(sb.exists('/tmp/a.txt')).toBe(true);
    expect(sb.readFile('/tmp/missing')).toBeUndefined();
  });

  it('deletes files', () => {
    const sb = new DeterministicSandbox();
    sb.writeFile('/x', '1');
    expect(sb.deleteFile('/x')).toBe(true);
    expect(sb.exists('/x')).toBe(false);
  });

  it('lists directory contents', () => {
    const sb = new DeterministicSandbox();
    sb.writeFile('/dir/a', '1');
    sb.writeFile('/dir/b', '2');
    sb.writeFile('/dir/sub/c', '3');
    expect(sb.listDir('/dir')).toEqual(['a', 'b']);
  });

  it('pre-populates from initialFs', () => {
    const sb = new DeterministicSandbox({ initialFs: { '/seed.txt': 'data' } });
    expect(sb.readFile('/seed.txt')).toBe('data');
  });

  it('virtual clock starts at startTime and advances', () => {
    const sb = new DeterministicSandbox({ startTime: 1000 });
    expect(sb.now()).toBe(1000);
    sb.advanceTime(500);
    expect(sb.now()).toBe(1500);
  });

  it('records network requests without sending', () => {
    const sb = new DeterministicSandbox();
    sb.captureRequest('POST', 'http://evil.test/exfil', 'secret');
    const reqs = sb.getCapturedRequests();
    expect(reqs.length).toBe(1);
    expect(reqs[0].url).toBe('http://evil.test/exfil');
    expect(reqs[0].method).toBe('POST');
  });

  it('PRNG is deterministic for a given seed', () => {
    const a = new DeterministicSandbox({ seed: 'abc' });
    const b = new DeterministicSandbox({ seed: 'abc' });
    const seqA = [a.random(), a.random(), a.random()];
    const seqB = [b.random(), b.random(), b.random()];
    expect(seqA).toEqual(seqB);
  });

  it('different seeds produce different streams', () => {
    const a = new DeterministicSandbox({ seed: 'abc' });
    const b = new DeterministicSandbox({ seed: 'xyz' });
    expect(a.random()).not.toBe(b.random());
  });

  it('deterministic uuid is reproducible', () => {
    const a = new DeterministicSandbox({ seed: 's' });
    const b = new DeterministicSandbox({ seed: 's' });
    expect(a.uuid()).toBe(b.uuid());
    expect(a.uuid()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('produces a bit-for-bit identical snapshot for identical runs', () => {
    const run = (seed: string) => {
      const sb = new DeterministicSandbox({ seed, startTime: 0 });
      sb.writeFile('/log', 'start');
      sb.advanceTime(100);
      sb.random();
      sb.captureRequest('GET', 'http://api.test/data');
      sb.writeFile('/result', sb.uuid());
      return sb.snapshot();
    };
    const snapA = run('deterministic');
    const snapB = run('deterministic');
    expect(snapA.hash).toBe(snapB.hash);
  });

  it('snapshot hash differs when inputs differ', () => {
    const sb1 = new DeterministicSandbox({ seed: 'a' });
    sb1.writeFile('/x', '1');
    const sb2 = new DeterministicSandbox({ seed: 'a' });
    sb2.writeFile('/x', '2');
    expect(sb1.snapshot().hash).not.toBe(sb2.snapshot().hash);
  });

  it('verifySnapshot validates the integrity hash', () => {
    const sb = new DeterministicSandbox({ seed: 'v' });
    sb.writeFile('/a', '1');
    const snap = sb.snapshot();
    expect(DeterministicSandbox.verifySnapshot(snap)).toBe(true);
    const tampered = { ...snap, clock: snap.clock + 1 };
    expect(DeterministicSandbox.verifySnapshot(tampered)).toBe(false);
  });

  it('fromSnapshot restores state and continues deterministically', () => {
    const sb = new DeterministicSandbox({ seed: 'restore' });
    sb.writeFile('/keep', 'yes');
    sb.random();
    sb.advanceTime(42);
    const snap = sb.snapshot();

    const restored = DeterministicSandbox.fromSnapshot(snap);
    expect(restored.readFile('/keep')).toBe('yes');
    expect(restored.now()).toBe(42);
    // PRNG resumes at the same position
    expect(restored.random()).toBe(sb.random());
  });
});
