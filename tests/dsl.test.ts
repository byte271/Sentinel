import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyDSL } from '../src/safe/dsl.js';
import type { DSLContext } from '../src/safe/dsl.js';

describe('PolicyDSL', () => {
  let dsl: PolicyDSL;

  beforeEach(() => {
    dsl = new PolicyDSL();
  });

  it('parses DENY WHEN action MATCHES pattern', () => {
    const rule = dsl.parse('DENY WHEN action MATCHES "delete_*"');
    expect(rule.verdict).toBe('deny');
    expect(rule.conditions.length).toBeGreaterThan(0);
    expect(rule.conditions[0].field).toBe('action');
    expect(rule.conditions[0].operator).toBe('MATCHES');
  });

  it('parses WARN WHEN with CONTAINS', () => {
    const rule = dsl.parse('WARN WHEN surface.name CONTAINS "prod"');
    expect(rule.verdict).toBe('warn');
    expect(rule.conditions[0].field).toBe('surface.name');
  });

  it('evaluates DENY correctly', () => {
    const rule = dsl.parse('DENY WHEN action MATCHES "delete_*"');
    const ctx: DSLContext = {
      action: 'delete_file',
      surface: { id: 's1', name: 'test', type: 'fs' },
      actor: { id: 'a1', name: 'A', trust: 'standard', type: 'ai' },
      params: {},
      risk: { level: 'medium', score: 0.5 },
    };
    expect(dsl.evaluate(rule, ctx)).toBe(true);
  });

  it('does not match when condition fails', () => {
    const rule = dsl.parse('DENY WHEN action MATCHES "delete_*"');
    const ctx: DSLContext = {
      action: 'write_file',
      surface: { id: 's1', name: 'test', type: 'fs' },
      actor: { id: 'a1', name: 'A', trust: 'standard', type: 'ai' },
      params: {},
      risk: { level: 'low', score: 0.1 },
    };
    expect(dsl.evaluate(rule, ctx)).toBe(false);
  });

  it('supports ALLOW verdict', () => {
    const rule = dsl.parse('ALLOW WHEN action MATCHES "read_*"');
    expect(rule.verdict).toBe('allow');
  });

  it('supports REQUIRE_APPROVAL verdict', () => {
    const rule = dsl.parse('REQUIRE_APPROVAL WHEN risk.level == "critical"');
    expect(rule.verdict).toBe('require_approval');
  });

  it('throws on invalid expressions', () => {
    expect(() => dsl.parse('INVALID')).toThrow();
  });
});
