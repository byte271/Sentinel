// ---------------------------------------------------------------------------
// Feature 6: Multi-Agent Trust Graph tests.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { TrustGraph } from '../src/bridge/trust-graph.js';

describe('TrustGraph — delegation depth limit', () => {
  it('rejects delegation beyond the configured max depth', () => {
    const g = new TrustGraph({ maxDelegationDepth: 2 });
    g.addRoot('orchestrator', { trust: 1, permissions: ['*'] });
    expect(g.delegate('orchestrator', 'research', { permissions: ['web.fetch'] }).ok).toBe(true); // depth 1
    expect(g.delegate('research', 'code', { permissions: ['web.fetch'] }).ok).toBe(true); // depth 2
    const tooDeep = g.delegate('code', 'shell-runner', { permissions: ['web.fetch'] }); // depth 3
    expect(tooDeep.ok).toBe(false);
    expect(tooDeep.anomalies[0].type).toBe('depth-exceeded');
    expect(g.anomalies().some((a) => a.type === 'depth-exceeded')).toBe(true);
  });
});

describe('TrustGraph — permission narrowing', () => {
  it('allows a subset and rejects escalation', () => {
    const g = new TrustGraph();
    g.addRoot('parent', { trust: 1, permissions: ['fs.read', 'web.fetch'] });

    const ok = g.delegate('parent', 'child', { permissions: ['fs.read'] });
    expect(ok.ok).toBe(true);

    const escalate = g.delegate('parent', 'rogue', { permissions: ['shell.exec'] });
    expect(escalate.ok).toBe(false);
    expect(escalate.anomalies[0].type).toBe('permission-escalation');
  });

  it('honors wildcard scopes from the parent', () => {
    const g = new TrustGraph();
    g.addRoot('parent', { trust: 1, permissions: ['fs.*'] });
    expect(g.delegate('parent', 'child', { permissions: ['fs.read', 'fs.write'] }).ok).toBe(true);
    expect(g.hasPermission('child', 'fs.write')).toBe(true);
    expect(g.hasPermission('child', 'net.open')).toBe(false);
  });

  it('a child cannot re-delegate a permission it never received', () => {
    const g = new TrustGraph({ maxDelegationDepth: 3 });
    g.addRoot('p', { trust: 1, permissions: ['fs.read', 'shell.exec'] });
    g.delegate('p', 'c', { permissions: ['fs.read'] }); // no shell.exec
    const grand = g.delegate('c', 'g', { permissions: ['shell.exec'] });
    expect(grand.ok).toBe(false);
    expect(grand.anomalies[0].type).toBe('permission-escalation');
  });
});

describe('TrustGraph — trust scoring', () => {
  it('decays trust with delegation depth', () => {
    const g = new TrustGraph({ depthDecay: 0.2 });
    g.addRoot('root', { trust: 1, permissions: ['*'] });
    g.delegate('root', 'a', { permissions: ['x'] });
    g.delegate('a', 'b', { permissions: ['x'] });
    expect(g.trustScore('root')).toBe(1);
    expect(g.trustScore('a')).toBeCloseTo(0.8, 5);
    expect(g.trustScore('b')).toBeCloseTo(0.64, 5);
  });

  it('penalizes suspicious behavior and flags collapse', () => {
    const g = new TrustGraph({ collapseThreshold: 0.5 });
    g.addRoot('a', { trust: 0.6, permissions: ['*'] });
    g.recordSuspiciousBehavior('a', 0.3);
    expect(g.trustScore('a')).toBeCloseTo(0.3, 5);
    expect(g.anomalies().some((x) => x.type === 'trust-collapse')).toBe(true);
  });
});

describe('TrustGraph — signed inter-agent messages', () => {
  it('signs and verifies a message', () => {
    const g = new TrustGraph({ signingSecret: 'k' });
    const msg = g.signMessage('a', 'b', 'do the thing', 1000);
    expect(g.verifyMessage(msg, 1000).valid).toBe(true);
  });

  it('rejects tampered payloads', () => {
    const g = new TrustGraph({ signingSecret: 'k' });
    const msg = g.signMessage('a', 'b', 'original', 1000);
    const tampered = { ...msg, payload: 'malicious' };
    expect(g.verifyMessage(tampered, 1000).valid).toBe(false);
  });

  it('detects replay (nonce reuse) and expiry', () => {
    const g = new TrustGraph({ signingSecret: 'k', nonceWindowMs: 5000 });
    const msg = g.signMessage('a', 'b', 'p', 1000);
    expect(g.verifyMessage(msg, 1000).valid).toBe(true);
    // Same nonce again → replay.
    const replay = g.verifyMessage(msg, 1001);
    expect(replay.valid).toBe(false);
    expect(replay.reason).toMatch(/replay/i);
    // Outside the window → expired.
    const fresh = g.signMessage('a', 'b', 'p2', 1000);
    expect(g.verifyMessage(fresh, 1000 + 10_000).reason).toMatch(/expired/i);
  });
});

describe('TrustGraph — export', () => {
  it('exports nodes/edges and renders Mermaid + DOT', () => {
    const g = new TrustGraph();
    g.addRoot('root', { trust: 1, permissions: ['*'] });
    g.delegate('root', 'child', { permissions: ['fs.read'] });
    const data = g.export();
    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(1);
    expect(g.toMermaid()).toContain('graph TD');
    expect(g.toDOT()).toContain('digraph TrustGraph');
  });
});
