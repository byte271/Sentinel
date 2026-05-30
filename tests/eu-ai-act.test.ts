import { describe, it, expect } from 'vitest';
import { EuAiActAssessor, DEFAULT_CAPABILITIES } from '../src/compliance/index.js';

describe('EU AI Act Compliance', () => {
  const assessor = new EuAiActAssessor();

  it('produces a report with all default capabilities', () => {
    const report = assessor.assess(DEFAULT_CAPABILITIES, { now: '2026-06-01T00:00:00Z' });
    expect(report.framework).toBe('eu-ai-act');
    expect(report.version).toBe('2024/1689');
    expect(report.sentinelVersion).toBeTruthy();
    expect(report.enforcementDate).toBe('2026-08-02');
    expect(report.daysUntilEnforcement).toBeGreaterThan(0);
    expect(report.riskTier).toBe('high-risk');
    expect(report.annexIV.length).toBeGreaterThanOrEqual(8);
    expect(report.humanOversight.length).toBeGreaterThanOrEqual(4);
  });

  it('computes a high Annex IV score with all capabilities', () => {
    const report = assessor.assess(DEFAULT_CAPABILITIES, { now: '2026-06-01T00:00:00Z' });
    expect(report.annexIVScore).toBeGreaterThanOrEqual(90);
    expect(report.readiness).toBe('ready');
    expect(report.gaps.length).toBe(0);
  });

  it('reports gaps when capabilities are missing', () => {
    const report = assessor.assess([], { now: '2026-06-01T00:00:00Z' });
    expect(report.annexIVScore).toBeLessThan(90);
    expect(report.gaps.length).toBeGreaterThan(0);
    expect(report.readiness).not.toBe('ready');
  });

  it('accepts a manual risk-tier override', () => {
    const report = assessor.assess(DEFAULT_CAPABILITIES, { riskTier: 'limited', now: '2026-06-01T00:00:00Z' });
    expect(report.riskTier).toBe('limited');
    expect(report.riskTierJustification).toContain('limited');
  });

  it('days until enforcement decreases when closer to date', () => {
    const early = assessor.assess(DEFAULT_CAPABILITIES, { now: '2026-01-01T00:00:00Z' });
    const late = assessor.assess(DEFAULT_CAPABILITIES, { now: '2026-07-01T00:00:00Z' });
    expect(early.daysUntilEnforcement).toBeGreaterThan(late.daysUntilEnforcement);
  });

  it('clamps days to 0 after enforcement', () => {
    const after = assessor.assess(DEFAULT_CAPABILITIES, { now: '2027-01-01T00:00:00Z' });
    expect(after.daysUntilEnforcement).toBe(0);
  });

  it('renders a Markdown report', () => {
    const report = assessor.assess(DEFAULT_CAPABILITIES, { now: '2026-06-01T00:00:00Z' });
    const md = EuAiActAssessor.renderMarkdown(report);
    expect(md).toContain('EU AI Act Compliance Report');
    expect(md).toContain('Annex IV');
    expect(md).toContain('Human Oversight');
    expect(md).toContain('Transparency');
    expect(md).toContain('Risk Management');
    expect(md).toContain('Post-Market Monitoring');
  });

  it('human oversight measures reflect capabilities', () => {
    const full = assessor.assess(DEFAULT_CAPABILITIES, { now: '2026-06-01T00:00:00Z' });
    expect(full.humanOversight.every((h) => h.implemented)).toBe(true);

    const empty = assessor.assess([], { now: '2026-06-01T00:00:00Z' });
    expect(empty.humanOversight.some((h) => !h.implemented)).toBe(true);
  });

  it('is deterministic (same input → same output)', () => {
    const a = assessor.assess(DEFAULT_CAPABILITIES, { now: '2026-06-01T00:00:00Z' });
    const b = assessor.assess(DEFAULT_CAPABILITIES, { now: '2026-06-01T00:00:00Z' });
    expect(a.annexIVScore).toBe(b.annexIVScore);
    expect(a.readiness).toBe(b.readiness);
    expect(a.gaps).toEqual(b.gaps);
  });
});
