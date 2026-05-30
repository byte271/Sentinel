import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEngine } from '../src/safe/policy.js';
import type { ActionIntent, Surface, SentinelConfig, SurfaceCapability } from '../src/kernel/types.js';

function makeIntent(action: string): ActionIntent {
  return {
    id: 'i1', surface: 's1', action,
    params: {}, initiator: { id: 'a1', type: 'ai', name: 'A', trust: 'standard', scopes: ['*'] },
    timestamp: Date.now(), metadata: {},
  };
}

const testCaps: SurfaceCapability[] = [
  { action: 'read_file', riskLevel: 'none', reversible: true, description: 'Read', params: [], requiresApproval: false },
  { action: 'write_file', riskLevel: 'medium', reversible: true, description: 'Write', params: [], requiresApproval: false },
  { action: 'delete_file', riskLevel: 'high', reversible: false, description: 'Delete', params: [], requiresApproval: false },
];
const surface: Surface = {
  id: 's1', name: 'Test Surface', type: 'filesystem',
  version: '1.0.0',
  capabilities: testCaps,
  manifest: { surfaceId: 's1', version: '1.0.0', capabilities: testCaps, metadata: {} },
};

describe('PolicyEngine', () => {
  let engine: PolicyEngine;
  const config: SentinelConfig = {
    defaultRiskThreshold: 'high', requireShadowFirst: true,
    requireApprovalAbove: 'high', traceEnabled: true,
    maxShadowDurationMs: 30000, adapters: {},
  };

  beforeEach(() => {
    engine = new PolicyEngine(config);
  });

  it('assesses risk based on capability', async () => {
    const risk = await engine.assessRisk(makeIntent('delete_file'), surface);
    expect(risk.level).toBeDefined();
    expect(risk.score).toBeGreaterThanOrEqual(0);
  });

  it('assesses low risk for read actions', async () => {
    const risk = await engine.assessRisk(makeIntent('read_file'), surface);
    expect(risk.level).toBe('none');
  });

  it('evaluates policy decisions', async () => {
    const decision = await engine.assess(makeIntent('write_file'), surface);
    expect(decision.allowed).toBeDefined();
  });

  it('enforces DSL deny rules', async () => {
    engine.addDSLRule('DENY WHEN action MATCHES "delete_*"');
    const decision = await engine.assess(makeIntent('delete_file'), surface);
    expect(decision.allowed).toBe(false);
  });

  it('lists DSL rules', () => {
    engine.addDSLRule('DENY WHEN action MATCHES "delete_*"');
    engine.addDSLRule('WARN WHEN surface.name CONTAINS "Test"');
    expect(engine.listDSLRules().length).toBe(2);
  });
});
