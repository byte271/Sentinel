// ---------------------------------------------------------------------------
// Feature 5: Memory Integrity Layer tests.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { MemoryLedger } from '../src/memory/index.js';

const prov = { agentId: 'agent-1', taskId: 'task-1', source: 'agent' as const };

describe('MemoryLedger — append-only chain', () => {
  it('chains entries and verifies clean', () => {
    const m = new MemoryLedger();
    m.append('goal', 'ship v0.2.0', prov);
    m.append('constraint', 'do not post without review', prov);
    m.append('goal', 'ship v0.2.0 safely', prov);

    expect(m.length).toBe(3);
    expect(m.verify().valid).toBe(true);
    expect(m.get('goal')?.value).toBe('ship v0.2.0 safely');
    expect(m.history('goal')).toHaveLength(2);
  });

  it('detects in-place tampering of a historical value', () => {
    const m = new MemoryLedger();
    m.append('constraint', 'do not post without review', prov);
    m.append('note', 'second entry', prov);

    // Simulate a rogue agent silently rewriting memory.
    (m.all()[0] as { value: string }).value = 'post freely';

    const v = m.verify();
    expect(v.valid).toBe(false);
    expect(v.brokenAt).toBe(0);
    expect(v.reason).toMatch(/content hash mismatch/i);
  });

  it('detects deletion/reordering via broken linkage', () => {
    const m = new MemoryLedger();
    m.append('a', '1', prov);
    m.append('b', '2', prov);
    m.append('c', '3', prov);
    const entries = m.all();
    // Remove the middle entry and rebuild a ledger from the tampered set.
    const tampered = MemoryLedger.fromEntries([entries[0], entries[2]]);
    expect(tampered.verify().valid).toBe(false);
  });
});

describe('MemoryLedger — HMAC signing', () => {
  it('signs entries and rejects forged content', () => {
    const m = new MemoryLedger({ signingSecret: 'top-secret' });
    m.append('k', 'v', prov);
    expect(m.all()[0].signature).toBeTruthy();
    expect(m.verify().valid).toBe(true);

    // Tamper with value AND recompute nothing — signature won't match.
    (m.all()[0] as { value: string }).value = 'forged';
    expect(m.verify().valid).toBe(false);
  });
});

describe('MemoryLedger — temporal decay', () => {
  it('decays unreinforced memory over time and recovers on reinforcement', () => {
    const m = new MemoryLedger({ decayHalfLifeMs: 1000 });
    const t0 = 1_000_000;
    m.append('fact', 'x', { agentId: 'a', source: 'agent' }, t0);

    const fresh = m.trustScore('fact', t0);
    const oneHalfLife = m.trustScore('fact', t0 + 1000);
    expect(oneHalfLife).toBeLessThan(fresh);
    expect(oneHalfLife).toBeCloseTo(fresh * 0.5, 5);

    // Reinforce resets the decay clock.
    m.reinforce('fact', t0 + 1000);
    expect(m.trustScore('fact', t0 + 1000)).toBeGreaterThan(oneHalfLife);
    expect(m.verify().valid).toBe(true);
  });

  it('weights untrusted sources lower than user/system', () => {
    const m = new MemoryLedger();
    const now = 2_000_000;
    m.append('fromUser', 'a', { agentId: 'a', source: 'user' }, now);
    m.append('fromWeb', 'b', { agentId: 'a', source: 'web' }, now);
    expect(m.trustScore('fromUser', now)).toBeGreaterThan(m.trustScore('fromWeb', now));
  });
});

describe('MemoryLedger — export', () => {
  it('produces a verifiable audit log', () => {
    const m = new MemoryLedger({ signingSecret: 's' });
    m.append('k', 'v', prov);
    const exported = m.export();
    expect(exported.signed).toBe(true);
    expect(exported.algorithm).toBe('sha256+hmac-sha256');
    expect(exported.verification.valid).toBe(true);
    expect(exported.head).toBe(m.all()[0].contentHash);
  });
});
