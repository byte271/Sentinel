import { describe, it, expect } from 'vitest';
import { AgentFirewall } from '../src/firewall/index.js';
import { RedTeamEngine, generateAttacks } from '../src/redteam/index.js';

describe('Red Team Engine', () => {
  it('generates a catalogue with all 7 attack categories', () => {
    const attacks = generateAttacks();
    const cats = new Set(attacks.map((a) => a.category));
    expect(cats.has('prompt-injection')).toBe(true);
    expect(cats.has('jailbreak')).toBe(true);
    expect(cats.has('tool-abuse')).toBe(true);
    expect(cats.has('data-exfiltration')).toBe(true);
    expect(cats.has('credential-access')).toBe(true);
    expect(cats.has('context-pollution')).toBe(true);
    expect(cats.has('memory-tampering')).toBe(true);
    expect(attacks.length).toBeGreaterThanOrEqual(30);
  });

  it('filters attacks by category', () => {
    const attacks = generateAttacks(['jailbreak']);
    expect(attacks.every((a) => a.category === 'jailbreak')).toBe(true);
    expect(attacks.length).toBeGreaterThanOrEqual(5);
  });

  it('produces a defense report with score and grade (strict)', () => {
    const fw = new AgentFirewall({ policy: 'strict' });
    const engine = new RedTeamEngine(fw);
    const report = engine.run({ agent: 'test-agent', now: '2026-01-01T00:00:00Z' });
    expect(report.agent).toBe('test-agent');
    expect(report.policy).toBe('strict');
    expect(report.total).toBeGreaterThanOrEqual(30);
    expect(report.blocked + report.warned + report.allowed).toBe(report.total);
    expect(report.defenseScore).toBeGreaterThanOrEqual(0);
    expect(report.defenseScore).toBeLessThanOrEqual(100);
    expect(['A+', 'A', 'B', 'C', 'D', 'F']).toContain(report.grade);
    expect(report.categories.length).toBeGreaterThanOrEqual(5);
  });

  it('strict policy achieves a higher defense score than permissive', () => {
    const strict = new RedTeamEngine(new AgentFirewall({ policy: 'strict' }));
    const permissive = new RedTeamEngine(new AgentFirewall({ policy: 'permissive' }));
    expect(strict.run().defenseScore).toBeGreaterThanOrEqual(permissive.run().defenseScore);
  });

  it('reports weaknesses for attacks that are not defended', () => {
    const fw = new AgentFirewall({ policy: 'permissive' });
    const engine = new RedTeamEngine(fw);
    const report = engine.run();
    // Permissive lets medium/high through as warns, so some expected-block attacks may pass
    // Just verify structure — weaknesses are AttackResult[]
    for (const w of report.weaknesses) {
      expect(w.defended).toBe(false);
      expect(w.attack).toBeDefined();
    }
  });

  it('produces deterministic results (same config → same report)', () => {
    const fw = new AgentFirewall({ policy: 'balanced' });
    const a = new RedTeamEngine(fw).run({ now: '2026-01-01T00:00:00Z' });
    const b = new RedTeamEngine(fw).run({ now: '2026-01-01T00:00:00Z' });
    expect(a.defenseScore).toBe(b.defenseScore);
    expect(a.total).toBe(b.total);
    expect(a.blocked).toBe(b.blocked);
    expect(a.results.map((r) => r.verdict)).toEqual(b.results.map((r) => r.verdict));
  });

  it('renders a text report with ASCII frame', () => {
    const fw = new AgentFirewall({ policy: 'strict' });
    const report = new RedTeamEngine(fw).run({ agent: 'demo' });
    const text = RedTeamEngine.renderReport(report);
    expect(text).toContain('SENTINEL RED TEAM REPORT');
    expect(text).toContain('DEFENSE SCORE:');
    expect(text).toContain('demo');
    expect(text).toContain('┌');
    expect(text).toContain('└');
  });

  it('per-category coverage sums match the total', () => {
    const fw = new AgentFirewall({ policy: 'balanced' });
    const report = new RedTeamEngine(fw).run();
    const catTotal = report.categories.reduce((s, c) => s + c.total, 0);
    expect(catTotal).toBe(report.total);
  });
});
