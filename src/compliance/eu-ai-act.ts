// ---------------------------------------------------------------------------
// SENTINEL EU AI Act Compliance Report Generator (v0.3.0, S3)
// ---------------------------------------------------------------------------
// With the EU AI Act (Regulation 2024/1689) reaching full enforcement on
// August 2, 2026, enterprises need auditor-ready documentation NOW. This
// module generates a compliance report from the actual Sentinel configuration
// and runtime capabilities — not a generic template, but evidence-driven
// documentation tied to the live safety posture.
//
// Outputs: Markdown (suitable for PDF rendering via weasyprint) and JSON
// (for regulatory submission APIs). Follows Annex IV structure.
//
// Dependency-free; references Sentinel capabilities only.
// ---------------------------------------------------------------------------

import type { Capability } from './owasp.js';
import { DEFAULT_CAPABILITIES } from './owasp.js';
import { SENTINEL_VERSION } from '../spec/version.js';

/** EU AI Act risk tier (Article 6). */
export type AiActRiskTier = 'prohibited' | 'high-risk' | 'limited' | 'minimal';

/** Conformity assessment status per Annex IV requirement. */
export type ConformityStatus = 'satisfied' | 'partial' | 'not-applicable' | 'gap';

export interface AnnexIVRequirement {
  id: string;
  title: string;
  description: string;
  status: ConformityStatus;
  evidence: string;
  /** Which Sentinel capabilities address this requirement. */
  coveredBy: Capability[];
}

export interface HumanOversightMeasure {
  id: string;
  measure: string;
  implemented: boolean;
  mechanism: string;
}

export interface EuAiActReport {
  framework: 'eu-ai-act';
  version: string;
  generatedAt: string;
  sentinelVersion: string;
  enforcementDate: string;
  daysUntilEnforcement: number;

  /** Risk tier classification. */
  riskTier: AiActRiskTier;
  riskTierJustification: string;

  /** Annex IV conformity assessment. */
  annexIV: AnnexIVRequirement[];
  annexIVScore: number;

  /** Article 14: Human oversight provisions. */
  humanOversight: HumanOversightMeasure[];

  /** Article 13: Transparency. */
  transparency: { requirement: string; satisfied: boolean; mechanism: string }[];

  /** Article 9: Risk management. */
  riskManagement: { requirement: string; satisfied: boolean; mechanism: string }[];

  /** Post-market monitoring (Article 72). */
  monitoring: { requirement: string; satisfied: boolean; mechanism: string }[];

  /** Overall readiness. */
  readiness: 'ready' | 'partial' | 'not-ready';
  gaps: string[];
}

export interface EuAiActOptions {
  /** Override the risk tier (default: auto-detect based on capabilities). */
  riskTier?: AiActRiskTier;
  /** Fixed timestamp for deterministic reports. */
  now?: string;
}

const ENFORCEMENT_DATE = '2026-08-02';

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((b.getTime() - a.getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Annex IV — Technical documentation requirements
// ---------------------------------------------------------------------------

function buildAnnexIV(caps: Set<Capability>): AnnexIVRequirement[] {
  const s = (reqs: Capability[]): ConformityStatus => {
    const met = reqs.filter((r) => caps.has(r)).length;
    if (met === reqs.length) return 'satisfied';
    if (met > 0) return 'partial';
    return 'gap';
  };
  return [
    { id: 'AIV-1', title: 'General description of the AI system', description: 'Intended purpose, interaction with hardware/software, versions',
      status: 'satisfied', evidence: `Sentinel v${SENTINEL_VERSION} is an agent safety sidecar providing out-of-band control.`, coveredBy: [] },
    { id: 'AIV-2', title: 'Detailed description of elements and development process', description: 'Methods, design specs, system architecture',
      status: 'satisfied', evidence: 'Source code + architecture docs (README, docs/) are MIT-licensed and auditable.', coveredBy: [] },
    { id: 'AIV-3', title: 'Monitoring, functioning, and control', description: 'Human oversight capabilities',
      status: s(['kill-switch', 'action-approval']), evidence: 'Kill Switch (graceful/hard), approval gateway, and Shield sidecar control plane.',
      coveredBy: ['kill-switch', 'action-approval'] },
    { id: 'AIV-4', title: 'Risk management system', description: 'Identification and analysis of known and foreseeable risks',
      status: s(['firewall', 'risk-scoring', 'tool-scanning']), evidence: 'AgentFirewall (32 patterns), risk scoring, OWASP ASI assessment.',
      coveredBy: ['firewall', 'risk-scoring', 'tool-scanning'] },
    { id: 'AIV-5', title: 'Data governance and management', description: 'Training, validation, and testing datasets',
      status: 'not-applicable', evidence: 'Sentinel is a runtime safety layer, not a model trainer; no training data governance required.',
      coveredBy: [] },
    { id: 'AIV-6', title: 'Logging capabilities', description: 'Automatic recording of events (logs)',
      status: s(['memory-integrity']), evidence: 'Merkle-chained TraceStore, MemoryLedger, ExecutionRecorder — tamper-evident.',
      coveredBy: ['memory-integrity'] },
    { id: 'AIV-7', title: 'Accuracy, robustness, cybersecurity', description: 'Levels of accuracy, robustness, and cybersecurity measures',
      status: s(['firewall', 'a2a-hmac', 'replay-protection']),
      evidence: 'Deterministic firewall, HMAC-SHA256 signing, constant-time token verification, nonce replay protection.',
      coveredBy: ['firewall', 'a2a-hmac', 'replay-protection'] },
    { id: 'AIV-8', title: 'Discriminatory impact assessment', description: 'Assessment of potential discriminatory impact',
      status: 'not-applicable', evidence: 'Sentinel is a safety sidecar, not a decision-making model; bias assessment is at the model level.',
      coveredBy: [] },
    { id: 'AIV-9', title: 'Changes and modifications', description: 'Record of changes made during lifecycle',
      status: 'satisfied', evidence: 'CHANGELOG.md, git history, append-only MerkleChain.',
      coveredBy: [] },
    { id: 'AIV-10', title: 'Conformity assessment', description: 'Procedures and results of conformity assessment',
      status: s(['tool-scanning', 'risk-scoring']),
      evidence: 'This report constitutes the conformity self-assessment. OWASP ASI + NIST AI RMF profiles.',
      coveredBy: ['tool-scanning', 'risk-scoring'] },
  ];
}

// ---------------------------------------------------------------------------
// Human oversight (Article 14)
// ---------------------------------------------------------------------------

function buildHumanOversight(caps: Set<Capability>): HumanOversightMeasure[] {
  return [
    { id: 'HO-1', measure: 'Ability to understand AI system capabilities and limitations',
      implemented: true, mechanism: 'Prevented Futures TUI, audit trail viewer, OWASP ASI dashboard' },
    { id: 'HO-2', measure: 'Ability to correctly interpret AI system output',
      implemented: caps.has('tool-scanning'), mechanism: 'Deterministic firewall verdicts with matched-pattern evidence' },
    { id: 'HO-3', measure: 'Ability to decide not to use or to override AI decisions',
      implemented: caps.has('action-approval'), mechanism: 'Approval gateway (action-level), policy engine with DSL overrides' },
    { id: 'HO-4', measure: 'Ability to interrupt / stop the AI system',
      implemented: caps.has('kill-switch'), mechanism: 'Transactional Kill Switch with forensic snapshot + OOB Shield process' },
    { id: 'HO-5', measure: 'Post-market monitoring capabilities',
      implemented: caps.has('memory-integrity'), mechanism: 'OTEL span export, Merkle audit trail, ExecutionRecorder' },
  ];
}

// ---------------------------------------------------------------------------
// Assessor
// ---------------------------------------------------------------------------

export class EuAiActAssessor {

  assess(capabilities: Iterable<Capability> = DEFAULT_CAPABILITIES, options: EuAiActOptions = {}): EuAiActReport {
    const caps = new Set(capabilities);
    const now = options.now ? new Date(options.now) : new Date();
    const enforcement = new Date(ENFORCEMENT_DATE);
    const daysLeft = daysBetween(now, enforcement);

    const riskTier: AiActRiskTier = options.riskTier ?? 'high-risk';
    const riskTierJustification = riskTier === 'high-risk'
      ? 'Agent systems performing autonomous actions on user data are classified as high-risk under Annex III, Section 1(c) — AI systems intended to be used as safety components.'
      : `Manually classified as ${riskTier} per operator assessment.`;

    const annexIV = buildAnnexIV(caps);
    const satisfied = annexIV.filter((r) => r.status === 'satisfied').length;
    const partial = annexIV.filter((r) => r.status === 'partial').length;
    const na = annexIV.filter((r) => r.status === 'not-applicable').length;
    const applicable = annexIV.length - na;
    const annexIVScore = applicable === 0 ? 100 : Math.round(((satisfied + partial * 0.5) / applicable) * 100);

    const humanOversight = buildHumanOversight(caps);

    const transparency = [
      { requirement: 'Users informed the system is AI-operated', satisfied: true, mechanism: 'Sentinel protocol headers identify the safety sidecar' },
      { requirement: 'Explainable safety decisions', satisfied: caps.has('firewall'), mechanism: 'Firewall verdicts include pattern id, category, severity, and matched evidence' },
      { requirement: 'Audit trail accessible to authorities', satisfied: caps.has('memory-integrity'), mechanism: 'Merkle-chained TraceStore with per-entry proofs, exportable as JSON' },
    ];

    const riskManagement = [
      { requirement: 'Risk identification and analysis', satisfied: caps.has('risk-scoring'), mechanism: 'OWASP ASI 10/10 assessment, 32-pattern firewall, Red Team engine' },
      { requirement: 'Risk estimation and evaluation', satisfied: caps.has('tool-scanning'), mechanism: '0-100 risk scoring per tool call, severity ranking (none/low/medium/high/critical)' },
      { requirement: 'Residual risk documentation', satisfied: true, mechanism: 'Red Team report documents weaknesses and undefended attack vectors' },
      { requirement: 'Testing against foreseeable misuse', satisfied: true, mechanism: 'Adversarial Self-Testing engine generates deterministic attack catalogue' },
    ];

    const monitoring = [
      { requirement: 'Continuous logging of system behavior', satisfied: caps.has('memory-integrity'), mechanism: 'Append-only TraceStore + MemoryLedger + OTEL spans' },
      { requirement: 'Incident detection and response', satisfied: caps.has('kill-switch'), mechanism: 'Kill Switch with forensic snapshot and recovery plan' },
      { requirement: 'Regulatory reporting capability', satisfied: true, mechanism: 'This EU AI Act report generator + NIST AI RMF + OWASP ASI exports' },
    ];

    const gaps: string[] = [];
    for (const r of annexIV) {
      if (r.status === 'gap') gaps.push(`${r.id}: ${r.title} — ${r.description}`);
    }
    for (const h of humanOversight) {
      if (!h.implemented) gaps.push(`Human Oversight ${h.id}: ${h.measure}`);
    }

    const readiness: EuAiActReport['readiness'] =
      gaps.length === 0 && annexIVScore >= 90 ? 'ready' :
      gaps.length <= 2 && annexIVScore >= 70 ? 'partial' :
      'not-ready';

    return {
      framework: 'eu-ai-act',
      version: '2024/1689',
      generatedAt: now.toISOString(),
      sentinelVersion: SENTINEL_VERSION,
      enforcementDate: ENFORCEMENT_DATE,
      daysUntilEnforcement: Math.max(daysLeft, 0),
      riskTier,
      riskTierJustification,
      annexIV,
      annexIVScore,
      humanOversight,
      transparency,
      riskManagement,
      monitoring,
      readiness,
      gaps,
    };
  }

  /** Render a Markdown compliance report (suitable for PDF conversion via weasyprint). */
  static renderMarkdown(report: EuAiActReport): string {
    const lines: string[] = [];
    const l = (s = '') => lines.push(s);

    l(`# EU AI Act Compliance Report — Sentinel v${report.sentinelVersion}`);
    l();
    l(`- **Regulation:** EU AI Act (${report.version})`);
    l(`- **Enforcement date:** ${report.enforcementDate} (${report.daysUntilEnforcement} days remaining)`);
    l(`- **Generated:** ${report.generatedAt}`);
    l(`- **Readiness:** ${report.readiness.toUpperCase()}`);
    l();

    l(`## Risk Classification`);
    l();
    l(`- **Tier:** ${report.riskTier}`);
    l(`- **Justification:** ${report.riskTierJustification}`);
    l();

    l(`## Annex IV — Technical Documentation (Score: ${report.annexIVScore}%)`);
    l();
    l('| # | Requirement | Status | Evidence |');
    l('|---|-------------|--------|----------|');
    for (const r of report.annexIV) {
      l(`| ${r.id} | ${r.title} | ${r.status} | ${r.evidence} |`);
    }
    l();

    l(`## Article 14 — Human Oversight`);
    l();
    l('| # | Measure | Implemented | Mechanism |');
    l('|---|---------|-------------|-----------|');
    for (const h of report.humanOversight) {
      l(`| ${h.id} | ${h.measure} | ${h.implemented ? 'Yes' : 'No'} | ${h.mechanism} |`);
    }
    l();

    l(`## Article 13 — Transparency`);
    l();
    l('| Requirement | Satisfied | Mechanism |');
    l('|-------------|-----------|-----------|');
    for (const t of report.transparency) {
      l(`| ${t.requirement} | ${t.satisfied ? 'Yes' : 'No'} | ${t.mechanism} |`);
    }
    l();

    l(`## Article 9 — Risk Management`);
    l();
    l('| Requirement | Satisfied | Mechanism |');
    l('|-------------|-----------|-----------|');
    for (const r of report.riskManagement) {
      l(`| ${r.requirement} | ${r.satisfied ? 'Yes' : 'No'} | ${r.mechanism} |`);
    }
    l();

    l(`## Article 72 — Post-Market Monitoring`);
    l();
    l('| Requirement | Satisfied | Mechanism |');
    l('|-------------|-----------|-----------|');
    for (const m of report.monitoring) {
      l(`| ${m.requirement} | ${m.satisfied ? 'Yes' : 'No'} | ${m.mechanism} |`);
    }
    l();

    if (report.gaps.length > 0) {
      l(`## Gaps`);
      l();
      for (const g of report.gaps) l(`- ${g}`);
      l();
    }

    l('---');
    l(`*Report generated by Sentinel v${report.sentinelVersion}. This is a configuration-aware self-assessment, not a certified attestation.*`);
    return lines.join('\n');
  }
}
