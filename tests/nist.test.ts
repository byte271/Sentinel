import { describe, it, expect } from 'vitest';
import {
  NistComplianceProfile,
  gatherEvidence,
  createSentinel,
} from '../src/index.js';
import type { ComplianceEvidence } from '../src/index.js';

const FULL_EVIDENCE: ComplianceEvidence = {
  policyRuleCount: 3,
  dslRuleCount: 2,
  approvalConfigured: true,
  identityValidationEnabled: true,
  registeredActorCount: 4,
  riskAssessmentEnabled: true,
  blastRadiusEnabled: true,
  shadowFirstRequired: true,
  traceCount: 10,
  traceEnabled: true,
  auditChainLength: 10,
  auditChainVerified: true,
  persistenceEnabled: true,
  temporalEnabled: true,
  preventedFutureCount: 2,
  driftDetectionEnabled: true,
  rollbackEnabled: true,
  recoveryEnabled: true,
};

describe('NistComplianceProfile', () => {
  it('grades an empty deployment as non-compliant with all gaps', () => {
    const report = new NistComplianceProfile().generateReport({});
    expect(report.framework).toBe('NIST AI RMF 1.0');
    expect(report.summary.satisfied).toBe(0);
    expect(report.summary.coverageScore).toBeLessThan(40);
    expect(report.summary.readiness).toBe('non-compliant');
    // Every control should appear as a gap.
    expect(report.gaps.length).toBe(report.summary.applicable);
    // Gaps are ordered with unsatisfied before partial.
    const statuses = report.gaps.map((g) => g.status);
    const firstPartial = statuses.indexOf('partial');
    const lastUnsat = statuses.lastIndexOf('unsatisfied');
    if (firstPartial !== -1 && lastUnsat !== -1) {
      expect(lastUnsat).toBeLessThan(firstPartial);
    }
  });

  it('grades a fully-configured deployment as compliant with no gaps', () => {
    const report = new NistComplianceProfile().generateReport(FULL_EVIDENCE);
    expect(report.summary.unsatisfied).toBe(0);
    expect(report.summary.partial).toBe(0);
    expect(report.summary.coverageScore).toBe(100);
    expect(report.summary.readiness).toBe('compliant');
    expect(report.gaps).toEqual([]);
  });

  it('covers all four NIST functions and rolls up consistently', () => {
    const report = new NistComplianceProfile().generateReport(FULL_EVIDENCE);
    const fns = Object.keys(report.byFunction).sort();
    expect(fns).toEqual(['GOVERN', 'MANAGE', 'MAP', 'MEASURE']);

    let satisfied = 0;
    let applicable = 0;
    for (const fn of fns as Array<keyof typeof report.byFunction>) {
      satisfied += report.byFunction[fn].satisfied;
      applicable += report.byFunction[fn].applicable;
      expect(report.byFunction[fn].coverageScore).toBe(100);
    }
    expect(satisfied).toBe(report.summary.satisfied);
    expect(applicable).toBe(report.summary.applicable);
  });

  it('flags a broken audit chain as unsatisfied (tamper signal)', () => {
    const report = new NistComplianceProfile().generateReport({
      ...FULL_EVIDENCE,
      auditChainLength: 5,
      auditChainVerified: false,
    });
    const measure = report.controls.find((c) => c.id === 'MEASURE-2.1');
    expect(measure?.status).toBe('unsatisfied');
    expect(measure?.detail).toMatch(/tampering/i);
  });

  it('marks shadow and persistence as partial when not enforced', () => {
    const report = new NistComplianceProfile().generateReport({
      ...FULL_EVIDENCE,
      shadowFirstRequired: false,
      persistenceEnabled: false,
    });
    expect(report.controls.find((c) => c.id === 'MAP-5.1')?.status).toBe('partial');
    expect(report.controls.find((c) => c.id === 'MEASURE-4.1')?.status).toBe('partial');
  });

  it('exports JSON', () => {
    const json = new NistComplianceProfile().exportJson(FULL_EVIDENCE);
    const parsed = JSON.parse(json);
    expect(parsed.framework).toBe('NIST AI RMF 1.0');
    expect(Array.isArray(parsed.controls)).toBe(true);
  });
});

describe('gatherEvidence', () => {
  it('derives evidence from a live SENTINEL instance', () => {
    const sentinel = createSentinel();
    sentinel.policy.addDSLRule('DENY WHEN action MATCHES "delete_*"');

    const evidence = gatherEvidence(sentinel, { registeredActorCount: 1, preventedFutureCount: 0 });
    expect(evidence.dslRuleCount).toBe(1);
    expect(evidence.approvalConfigured).toBe(true);
    expect(evidence.blastRadiusEnabled).toBe(true);
    expect(evidence.shadowFirstRequired).toBe(true); // default config
    expect(evidence.temporalEnabled).toBe(true);
    expect(evidence.driftDetectionEnabled).toBe(true);
    expect(evidence.rollbackEnabled).toBe(true);
    expect(evidence.recoveryEnabled).toBe(true);

    const report = sentinel.nist.generateReport(evidence);
    // A freshly-wired instance should already have substantial coverage.
    expect(report.summary.coverageScore).toBeGreaterThan(50);
  });

  it('respects persistence override and absence', () => {
    const sentinel = createSentinel();
    expect(gatherEvidence(sentinel).persistenceEnabled).toBe(false);
    expect(gatherEvidence(sentinel, { persistenceEnabled: true }).persistenceEnabled).toBe(true);
  });
});
