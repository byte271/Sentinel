#!/usr/bin/env node
// ---------------------------------------------------------------------------
// sentinel-compliance — Compliance profile generator (Features 8 & 9)
// ---------------------------------------------------------------------------
// Generates auditor-ready compliance reports against:
//   - owasp-asi    : OWASP ASI Top-10 coverage dashboard (Feature 8)
//   - nist-ai-rmf  : NIST AI RMF 1.0 profile (Feature 9)
//
// Output as a text dashboard, JSON (for pipelines / API), or Markdown (which a
// downstream tool such as pandoc/wkhtmltopdf can render to the PDF that the
// spec describes). Keeping rendering pluggable avoids shipping a heavyweight,
// unaudited PDF engine inside the security library itself.
//
//   sentinel-compliance --framework owasp-asi
//   sentinel-compliance --framework nist-ai-rmf --format json --output report.json
//   sentinel-compliance --framework nist-ai-rmf --format markdown --output report.md
// ---------------------------------------------------------------------------

import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync } from 'fs';
import {
  SENTINEL_VERSION,
  OwaspAsiAssessor,
  DEFAULT_CAPABILITIES,
  NistComplianceProfile,
} from '../index.js';
import type { AsiAssessment, ComplianceEvidence, NistComplianceReport } from '../index.js';

type Format = 'text' | 'json' | 'markdown';

/**
 * Evidence representing a fully-configured Sentinel v0.2.0 deployment. These
 * flags reflect capabilities shipped in v0.2.0; pass a live instance to
 * `gatherEvidence()` programmatically for an instance-accurate report.
 */
const V020_EVIDENCE: ComplianceEvidence = {
  policyRuleCount: 12,
  dslRuleCount: 8,
  approvalConfigured: true,
  identityValidationEnabled: true,
  registeredActorCount: 3,
  riskAssessmentEnabled: true,
  blastRadiusEnabled: true,
  shadowFirstRequired: true,
  traceCount: 0,
  traceEnabled: true,
  auditChainLength: 0,
  auditChainVerified: true,
  persistenceEnabled: true,
  temporalEnabled: true,
  preventedFutureCount: 0,
  driftDetectionEnabled: true,
  rollbackEnabled: true,
  recoveryEnabled: true,
};

function asiMarkdown(a: AsiAssessment): string {
  const rows = a.risks.map((r) => `| ${r.id} | ${r.title} | ${r.coverage} | ${r.mechanism} |`).join('\n');
  return [
    '# OWASP ASI Top-10 — Sentinel Compliance Report',
    '',
    `- **Score:** ${a.score}/100 (grade ${a.grade})`,
    `- **Full:** ${a.fullyCovered}  **Partial:** ${a.partiallyCovered}  **None:** ${a.uncovered}`,
    `- **Generated:** ${new Date(a.assessedAt).toISOString()}`,
    `- **Sentinel:** v${SENTINEL_VERSION}`,
    '',
    '| Risk | Title | Coverage | Mechanism |',
    '|------|-------|----------|-----------|',
    rows,
    '',
  ].join('\n');
}

function nistMarkdown(r: NistComplianceReport): string {
  const fnRows = Object.values(r.byFunction)
    .map((f) => `| ${f.function} | ${f.satisfied}/${f.applicable} | ${f.coverageScore}% |`)
    .join('\n');
  const gapRows = r.gaps.map((g) => `| ${g.id} | ${g.status} | ${g.recommendation} |`).join('\n');
  return [
    '# NIST AI RMF 1.0 — Sentinel Compliance Profile',
    '',
    `- **Framework:** ${r.framework} (profile ${r.profileVersion})`,
    `- **Coverage:** ${r.summary.coverageScore}% — readiness: ${r.summary.readiness}`,
    `- **Controls:** ${r.summary.satisfied} satisfied, ${r.summary.partial} partial, ${r.summary.unsatisfied} unsatisfied (of ${r.summary.applicable} applicable)`,
    `- **Generated:** ${new Date(r.generatedAt).toISOString()}`,
    `- **Sentinel:** v${SENTINEL_VERSION}`,
    '',
    '## Coverage by Function',
    '',
    '| Function | Satisfied | Score |',
    '|----------|-----------|-------|',
    fnRows,
    '',
    '## Gaps',
    '',
    gapRows.length > 0 ? '| Control | Status | Recommendation |\n|---------|--------|----------------|\n' + gapRows : '_No gaps — all applicable controls satisfied._',
    '',
  ].join('\n');
}

function emit(content: string, output: string | undefined, label: string): void {
  if (output) {
    writeFileSync(output, content);
    console.log(chalk.green(`✓ ${label} written to ${output}`));
  } else {
    console.log(content);
  }
}

const program = new Command();
program
  .name('sentinel-compliance')
  .description('Generate OWASP ASI / NIST AI RMF compliance reports')
  .version(SENTINEL_VERSION)
  .option('-f, --framework <name>', 'Framework: owasp-asi | nist-ai-rmf', 'owasp-asi')
  .option('--format <fmt>', 'Output format: text | json | markdown', 'text')
  .option('-o, --output <path>', 'Write report to a file instead of stdout')
  .action((opts: { framework: string; format: Format; output?: string }) => {
    const framework = opts.framework.toLowerCase();

    if (framework === 'owasp-asi' || framework === 'owasp') {
      const assessment = new OwaspAsiAssessor().assess(DEFAULT_CAPABILITIES);
      if (opts.format === 'json') return emit(JSON.stringify(assessment, null, 2), opts.output, 'OWASP ASI report');
      if (opts.format === 'markdown') return emit(asiMarkdown(assessment), opts.output, 'OWASP ASI report');
      return emit(OwaspAsiAssessor.renderDashboard(assessment), opts.output, 'OWASP ASI report');
    }

    if (framework === 'nist-ai-rmf' || framework === 'nist') {
      const report = new NistComplianceProfile().generateReport(V020_EVIDENCE);
      if (opts.format === 'json') return emit(JSON.stringify(report, null, 2), opts.output, 'NIST AI RMF report');
      if (opts.format === 'markdown') return emit(nistMarkdown(report), opts.output, 'NIST AI RMF report');
      // Text summary
      const text = [
        `NIST AI RMF 1.0 — Coverage ${report.summary.coverageScore}% (${report.summary.readiness})`,
        `Controls: ${report.summary.satisfied} satisfied / ${report.summary.partial} partial / ${report.summary.unsatisfied} unsatisfied`,
        `Gaps: ${report.gaps.length}`,
      ].join('\n');
      return emit(text, opts.output, 'NIST AI RMF report');
    }

    console.error(chalk.red(`Unknown framework "${opts.framework}". Use owasp-asi or nist-ai-rmf.`));
    process.exitCode = 1;
  });

program.parse();
