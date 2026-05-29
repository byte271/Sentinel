// ---------------------------------------------------------------------------
// Feature 4: Context Guardian tests.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { ContextGuardian } from '../src/info/context.js';

describe('ContextGuardian — health & budget', () => {
  it('tracks token utilization against the budget', () => {
    const g = new ContextGuardian({ tokenBudget: 1000, tokenizer: (c) => c.length });
    g.add('a'.repeat(400), { source: 'user' });
    g.add('b'.repeat(300), { source: 'agent' });
    const h = g.health();
    expect(h.totalTokens).toBe(700);
    expect(h.utilization).toBeCloseTo(0.7, 5);
    expect(h.shouldCompact).toBe(false);
  });

  it('recommends compaction when over budget', () => {
    const g = new ContextGuardian({ tokenBudget: 100, tokenizer: (c) => c.length });
    g.add('x'.repeat(150), { source: 'agent' });
    const h = g.health();
    expect(h.utilization).toBeGreaterThan(1);
    expect(h.shouldCompact).toBe(true);
    expect(h.alerts.some((a) => /compaction/i.test(a))).toBe(true);
  });
});

describe('ContextGuardian — untrusted content', () => {
  it('marks web/tool content as untrusted and lowers trust', () => {
    const g = new ContextGuardian({ tokenizer: (c) => c.length });
    const webChunk = g.addUntrusted('fetched from the internet', 'web');
    expect(webChunk.untrusted).toBe(true);
    expect(webChunk.trust).toBeLessThanOrEqual(0.4);
    expect(webChunk.content).toContain('<<UNTRUSTED:web>>');
  });

  it('reports untrusted ratio and raises an injection alert', () => {
    const g = new ContextGuardian({ tokenBudget: 100000, tokenizer: (c) => c.length });
    g.add('trusted instructions', { source: 'user' });
    g.addUntrusted('z'.repeat(200), 'web');
    const h = g.health();
    expect(h.untrustedRatio).toBeGreaterThan(0.4);
    expect(h.alerts.some((a) => /injection/i.test(a))).toBe(true);
  });
});

describe('ContextGuardian — compaction preserves pinned constraints', () => {
  it('evicts low-trust chunks first and keeps pinned ones', () => {
    const g = new ContextGuardian({ tokenBudget: 100, compactTarget: 0.5, tokenizer: (c) => c.length });
    const critical = g.add('DO NOT post without review', { source: 'system', pinned: true });
    g.addUntrusted('w'.repeat(60), 'web'); // low trust
    g.add('a'.repeat(60), { source: 'agent' }); // mid trust

    const before = g.totalTokens();
    const { removed, freedTokens } = g.compact();
    expect(freedTokens).toBeGreaterThan(0);
    expect(g.totalTokens()).toBeLessThan(before);
    // The pinned critical constraint survives.
    expect(g.list().some((c) => c.id === critical.id)).toBe(true);
    // The untrusted web chunk is evicted first.
    expect(removed[0].untrusted).toBe(true);
    expect(g.criticalConstraints()).toContain('DO NOT post without review');
  });
});

describe('ContextGuardian — lost in the middle', () => {
  it('flags a pinned instruction stuck in the middle of a full window', () => {
    const g = new ContextGuardian({ tokenBudget: 100, tokenizer: () => 20 });
    g.add('first', { source: 'user' });           // pos 0
    g.add('pinned constraint', { source: 'system', pinned: true }); // pos 1 (middle)
    g.add('third', { source: 'agent' });          // pos 2
    g.add('fourth', { source: 'agent' });         // pos 3
    g.add('fifth', { source: 'agent' });          // pos 4
    const h = g.health();
    expect(h.lostInMiddleRisk).toBe(true);
    expect(h.alerts.some((a) => /lost in the middle/i.test(a))).toBe(true);
  });
});

describe('ContextGuardian — entropy', () => {
  it('detects repetitive (polluted) context with low entropy', () => {
    const g = new ContextGuardian({ tokenBudget: 100000, tokenizer: (c) => c.length });
    g.add(('spam ').repeat(200), { source: 'agent' });
    const h = g.health();
    expect(h.entropy).toBeLessThan(0.2);
    expect(h.pollutionScore).toBeGreaterThan(0);
  });
});
