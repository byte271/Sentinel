// ---------------------------------------------------------------------------
// SENTINEL OWASP ASI 10/10 Compliance (Feature 8)
// ---------------------------------------------------------------------------
// Real-time compliance scoring against all 10 OWASP ASI (Agentic Security
// Integrity) Top-10 risks. Each risk maps to the concrete Sentinel mechanisms
// that mitigate it; coverage is computed from which capabilities are enabled,
// so the dashboard reflects the actual configuration rather than a static
// marketing claim.
//
// Produces structured results (JSON API) and a plain-text dashboard (TUI).
// Dependency-free.
// ---------------------------------------------------------------------------

/** A Sentinel capability that contributes to ASI coverage. */
export type Capability =
  | 'firewall'
  | 'intent-drift'
  | 'tool-scanning'
  | 'risk-scoring'
  | 'kill-switch'
  | 'action-approval'
  | 'permission-narrowing'
  | 'a2a-hmac'
  | 'replay-protection'
  | 'memory-integrity'
  | 'trust-graph'
  | 'delegation-limits'
  | 'rate-limiting'
  | 'context-budget'
  | 'identity-verification'
  | 'spawn-detection'
  | 'pii-redaction'
  | 'output-filtering'
  | 'credential-detection'
  | 'sandboxing'
  | 'model-audit';

export type Coverage = 'full' | 'partial' | 'none';

export interface AsiRiskDefinition {
  id: string;
  title: string;
  mechanism: string;
  /** Capabilities that, together, provide full coverage. */
  requires: Capability[];
  /** Some risks are inherently only partially addressable by a library. */
  maxCoverage?: Coverage;
}

export interface AsiRiskResult {
  id: string;
  title: string;
  coverage: Coverage;
  score: number; // 0–1
  mechanism: string;
  missing: Capability[];
}

export interface AsiAssessment {
  risks: AsiRiskResult[];
  /** Overall score 0–100. */
  score: number;
  grade: string;
  fullyCovered: number;
  partiallyCovered: number;
  uncovered: number;
  assessedAt: number;
}

/** The OWASP ASI Top-10, mapped to Sentinel mechanisms (matches the v0.2.0 spec). */
export const ASI_RISKS: AsiRiskDefinition[] = [
  { id: 'ASI01', title: 'Agent Goal Hijack', mechanism: 'Firewall pattern matching + intent drift detection', requires: ['firewall', 'intent-drift'] },
  { id: 'ASI02', title: 'Tool Misuse', mechanism: 'Pre-execution tool call scanning + risk scoring', requires: ['tool-scanning', 'risk-scoring'] },
  { id: 'ASI03', title: 'Excessive Agency', mechanism: 'Kill Switch + action-level approval + permission narrowing', requires: ['kill-switch', 'action-approval', 'permission-narrowing'] },
  { id: 'ASI04', title: 'Inter-Agent Communication Hijack', mechanism: 'HMAC-SHA256 mutual auth + replay protection', requires: ['a2a-hmac', 'replay-protection'] },
  { id: 'ASI05', title: 'Memory & State Manipulation', mechanism: 'Memory Integrity Layer + cryptographic provenance', requires: ['memory-integrity'] },
  { id: 'ASI06', title: 'Delegated Trust Abuse', mechanism: 'Multi-Agent Trust Graph + delegation depth limits', requires: ['trust-graph', 'delegation-limits'] },
  { id: 'ASI07', title: 'Resource Exhaustion', mechanism: 'Rate limiting + context budget monitoring', requires: ['rate-limiting', 'context-budget'] },
  { id: 'ASI08', title: 'Rogue Agent Generation', mechanism: 'Agent identity verification + unauthorized spawn detection', requires: ['identity-verification', 'spawn-detection'], maxCoverage: 'partial' },
  { id: 'ASI09', title: 'Sensitive Data Exposure', mechanism: 'PII redaction + output filtering + credential pattern detection', requires: ['pii-redaction', 'output-filtering', 'credential-detection'] },
  { id: 'ASI10', title: 'Model Theft', mechanism: 'Execution sandboxing + model access auditing', requires: ['sandboxing', 'model-audit'] },
];

/** Capabilities provided by a fully-configured Sentinel v0.2.0 deployment. */
export const DEFAULT_CAPABILITIES: Capability[] = [
  'firewall', 'intent-drift', 'tool-scanning', 'risk-scoring',
  'kill-switch', 'action-approval', 'permission-narrowing',
  'a2a-hmac', 'replay-protection', 'memory-integrity',
  'trust-graph', 'delegation-limits', 'rate-limiting', 'context-budget',
  'identity-verification', 'spawn-detection',
  'pii-redaction', 'output-filtering', 'credential-detection',
  'sandboxing', 'model-audit',
];

function gradeFor(score: number): string {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export class OwaspAsiAssessor {
  private readonly risks: AsiRiskDefinition[];

  constructor(risks: AsiRiskDefinition[] = ASI_RISKS) {
    this.risks = risks;
  }

  /** Assess coverage given the set of enabled capabilities. */
  assess(capabilities: Iterable<Capability> = DEFAULT_CAPABILITIES, at: number = Date.now()): AsiAssessment {
    const enabled = new Set(capabilities);
    const results: AsiRiskResult[] = this.risks.map((risk) => {
      const missing = risk.requires.filter((c) => !enabled.has(c));
      const present = risk.requires.length - missing.length;
      let coverage: Coverage;
      if (present === 0) coverage = 'none';
      else if (missing.length === 0) coverage = 'full';
      else coverage = 'partial';

      // Cap coverage for risks a library can only partially address.
      if (risk.maxCoverage === 'partial' && coverage === 'full') coverage = 'partial';

      const score = coverage === 'full' ? 1 : coverage === 'partial' ? 0.5 : 0;
      return { id: risk.id, title: risk.title, coverage, score, mechanism: risk.mechanism, missing };
    });

    const totalScore = results.reduce((s, r) => s + r.score, 0);
    const score = Math.round((totalScore / this.risks.length) * 100);

    return {
      risks: results,
      score,
      grade: gradeFor(score),
      fullyCovered: results.filter((r) => r.coverage === 'full').length,
      partiallyCovered: results.filter((r) => r.coverage === 'partial').length,
      uncovered: results.filter((r) => r.coverage === 'none').length,
      assessedAt: at,
    };
  }

  /** Render a plain-text dashboard table for the TUI / CLI. */
  static renderDashboard(assessment: AsiAssessment): string {
    const icon = (c: Coverage): string => (c === 'full' ? '[x]' : c === 'partial' ? '[~]' : '[ ]');
    const bar = makeBar(assessment.score);
    const lines: string[] = [];
    lines.push('OWASP ASI Top-10 — Sentinel Compliance Dashboard');
    lines.push('='.repeat(64));
    lines.push(`Score: ${assessment.score}/100  Grade: ${assessment.grade}   ${bar}`);
    lines.push(`Full: ${assessment.fullyCovered}  Partial: ${assessment.partiallyCovered}  None: ${assessment.uncovered}`);
    lines.push('-'.repeat(64));
    for (const r of assessment.risks) {
      lines.push(`${icon(r.coverage)} ${r.id}  ${r.title}`);
      lines.push(`      ${r.mechanism}`);
      if (r.missing.length > 0) lines.push(`      missing: ${r.missing.join(', ')}`);
    }
    lines.push('='.repeat(64));
    return lines.join('\n');
  }
}

function makeBar(score: number, width = 24): string {
  const filled = Math.round((score / 100) * width);
  return `[${'#'.repeat(filled)}${'.'.repeat(width - filled)}]`;
}
