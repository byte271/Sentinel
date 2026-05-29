// ---------------------------------------------------------------------------
// SENTINEL NIST Compliance Profile
// ---------------------------------------------------------------------------
// Maps SENTINEL's runtime safety mechanisms onto the four functions of the NIST
// AI Risk Management Framework (AI RMF 1.0): GOVERN, MAP, MEASURE, MANAGE.
//
// The profile is evidence-driven: it inspects a snapshot of what a deployment
// actually has configured (policies, identity, audit chain, shadow execution,
// drift detection, …) and grades each control as satisfied / partial /
// unsatisfied. It then produces a structured, exportable compliance report
// with a coverage score and a prioritized gap list.
//
// This module is pure and dependency-free: it operates on a plain
// `ComplianceEvidence` value so it can be unit-tested without standing up a
// full kernel, and `gatherEvidence()` is provided to assemble that value from
// a live SENTINEL instance.
// ---------------------------------------------------------------------------

<<<<<<< HEAD
import { SENTINEL_VERSION } from '../spec/version.js';

=======
>>>>>>> e550e260dcc2f57c57596854a8be22259fd660ce
/** The four core functions of the NIST AI Risk Management Framework. */
export type NistFunction = 'GOVERN' | 'MAP' | 'MEASURE' | 'MANAGE';

/** Whether an individual control is met by the current configuration. */
export type ControlStatus = 'satisfied' | 'partial' | 'unsatisfied' | 'not_applicable';

/**
 * A snapshot of the safety mechanisms a deployment has in place. Every field
 * is optional; absent fields are treated as "not configured" (the most
 * conservative interpretation) rather than assumed present.
 */
export interface ComplianceEvidence {
  /** Number of programmatic policy rules registered. */
  policyRuleCount?: number;
  /** Number of declarative (DSL) policy rules registered. */
  dslRuleCount?: number;
  /** Whether a human-in-the-loop approval gateway is wired up. */
  approvalConfigured?: boolean;
  /** Whether actor identities are validated before execution. */
  identityValidationEnabled?: boolean;
  /** Number of registered actors (with trust levels). */
  registeredActorCount?: number;
  /** Whether quantitative risk assessment runs for each action. */
  riskAssessmentEnabled?: boolean;
  /** Whether blast-radius impact analysis is available. */
  blastRadiusEnabled?: boolean;
  /** Whether shadow-first execution is enforced before commit. */
  shadowFirstRequired?: boolean;
  /** Number of audit trace records recorded so far. */
  traceCount?: number;
  /** Whether tracing is enabled even if no traces exist yet. */
  traceEnabled?: boolean;
  /** Length of the tamper-evident Merkle audit chain. */
  auditChainLength?: number;
  /** Whether the Merkle audit chain currently verifies as intact. */
  auditChainVerified?: boolean;
  /** Whether audit state is persisted to durable storage. */
  persistenceEnabled?: boolean;
  /** Whether temporal branching / prevented-future analysis is available. */
  temporalEnabled?: boolean;
  /** Number of futures that were explored and prevented from committing. */
  preventedFutureCount?: number;
  /** Whether out-of-band drift detection is active. */
  driftDetectionEnabled?: boolean;
  /** Whether committed actions can be rolled back. */
  rollbackEnabled?: boolean;
  /** Whether automated recovery strategies are configured. */
  recoveryEnabled?: boolean;
}

/** The assessed result of a single control. */
export interface ControlAssessment {
  id: string;
  function: NistFunction;
  title: string;
  /** The SENTINEL mechanism that implements this control. */
  sentinelMechanism: string;
  status: ControlStatus;
  /** Human-readable justification for the status. */
  detail: string;
  /** Recommendation to close the gap (present when not fully satisfied). */
  recommendation?: string;
}

/** Per-function rollup of control coverage. */
export interface FunctionCoverage {
  function: NistFunction;
  satisfied: number;
  partial: number;
  unsatisfied: number;
  applicable: number;
  /** Coverage score 0–100 (partial counts as half). */
  coverageScore: number;
}

/** The full, exportable NIST compliance report. */
export interface NistComplianceReport {
  framework: 'NIST AI RMF 1.0';
  profileVersion: string;
  generatedAt: number;
  summary: {
    totalControls: number;
    applicable: number;
    satisfied: number;
    partial: number;
    unsatisfied: number;
    /** Overall coverage score 0–100. */
    coverageScore: number;
    /** Coarse readiness label derived from the coverage score. */
    readiness: 'non-compliant' | 'developing' | 'substantial' | 'compliant';
  };
  byFunction: Record<NistFunction, FunctionCoverage>;
  controls: ControlAssessment[];
  /** Prioritized list of unmet/partial controls with recommendations. */
  gaps: Array<{ id: string; status: ControlStatus; recommendation: string }>;
}

interface ControlDefinition {
  id: string;
  function: NistFunction;
  title: string;
  sentinelMechanism: string;
  evaluate: (e: ComplianceEvidence) => Pick<ControlAssessment, 'status' | 'detail' | 'recommendation'>;
}

<<<<<<< HEAD
// B1: the compliance profile version is no longer an independent string that can
// drift from the package version. It delegates to the single canonical source.
const PROFILE_VERSION = SENTINEL_VERSION;
=======
const PROFILE_VERSION = '0.4.0';
>>>>>>> e550e260dcc2f57c57596854a8be22259fd660ce

const STATUS_WEIGHT: Record<ControlStatus, number> = {
  satisfied: 1,
  partial: 0.5,
  unsatisfied: 0,
  not_applicable: 0,
};

/**
 * The curated control catalogue. Each control maps a NIST AI RMF subcategory
 * to a concrete SENTINEL mechanism and grades it from evidence.
 */
const CONTROLS: ControlDefinition[] = [
  // -- GOVERN ---------------------------------------------------------------
  {
    id: 'GOVERN-1.1',
    function: 'GOVERN',
    title: 'Policies, processes, and procedures are in place',
    sentinelMechanism: 'PolicyEngine + PolicyDSL',
    evaluate: (e) => {
      const total = (e.policyRuleCount ?? 0) + (e.dslRuleCount ?? 0);
      if (total > 0) {
        return { status: 'satisfied', detail: `${total} policy rule(s) enforce action governance.` };
      }
      return {
        status: 'unsatisfied',
        detail: 'No policy rules are registered.',
        recommendation: 'Register programmatic or DSL policy rules to govern agent actions.',
      };
    },
  },
  {
    id: 'GOVERN-2.1',
    function: 'GOVERN',
    title: 'Roles, responsibilities, and authority are accountable',
    sentinelMechanism: 'IdentityManager (trust levels + scopes)',
    evaluate: (e) => {
      const actors = e.registeredActorCount ?? 0;
      if (e.identityValidationEnabled && actors > 0) {
        return { status: 'satisfied', detail: `${actors} actor(s) registered with validated identities and scopes.` };
      }
      if (e.identityValidationEnabled || actors > 0) {
        return {
          status: 'partial',
          detail: 'Identity layer present but incompletely configured.',
          recommendation: 'Register actors with explicit trust levels and enable identity validation.',
        };
      }
      return {
        status: 'unsatisfied',
        detail: 'No identity validation or registered actors.',
        recommendation: 'Register actors and enable identity validation to establish accountability.',
      };
    },
  },
  {
    id: 'GOVERN-4.1',
    function: 'GOVERN',
    title: 'Human oversight of high-consequence decisions',
    sentinelMechanism: 'ApprovalGateway (human-in-the-loop)',
    evaluate: (e) =>
      e.approvalConfigured
        ? { status: 'satisfied', detail: 'Human approval gateway is configured for high-risk actions.' }
        : {
            status: 'unsatisfied',
            detail: 'No approval gateway configured.',
            recommendation: 'Configure an ApprovalGateway so high-risk actions route to human review.',
          },
  },
  // -- MAP ------------------------------------------------------------------
  {
    id: 'MAP-1.1',
    function: 'MAP',
    title: 'Risk is categorized for each action',
    sentinelMechanism: 'RiskAssessment',
    evaluate: (e) =>
      e.riskAssessmentEnabled
        ? { status: 'satisfied', detail: 'Quantitative risk assessment runs for each intent.' }
        : {
            status: 'unsatisfied',
            detail: 'Risk assessment is not enabled.',
            recommendation: 'Enable risk assessment to categorize each action before execution.',
          },
  },
  {
    id: 'MAP-3.1',
    function: 'MAP',
    title: 'Potential impacts are characterized',
    sentinelMechanism: 'BlastRadiusAnalyzer',
    evaluate: (e) =>
      e.blastRadiusEnabled
        ? { status: 'satisfied', detail: 'Blast-radius analysis characterizes direct and transitive impact.' }
        : {
            status: 'unsatisfied',
            detail: 'No blast-radius impact analysis available.',
            recommendation: 'Enable BlastRadiusAnalyzer to characterize the impact surface of actions.',
          },
  },
  {
    id: 'MAP-5.1',
    function: 'MAP',
    title: 'Impacts are assessed pre-deployment',
    sentinelMechanism: 'ShadowExecutor (shadow-first)',
    evaluate: (e) =>
      e.shadowFirstRequired
        ? { status: 'satisfied', detail: 'Shadow-first execution previews effects before any real commit.' }
        : {
            status: 'partial',
            detail: 'Shadow execution available but not enforced before commit.',
            recommendation: 'Set requireShadowFirst to enforce previewing effects before committing.',
          },
  },
  // -- MEASURE --------------------------------------------------------------
  {
    id: 'MEASURE-1.1',
    function: 'MEASURE',
    title: 'Actions are measured and logged',
    sentinelMechanism: 'TraceStore',
    evaluate: (e) => {
      // The control is only satisfied when tracing is actively enabled AND
      // records exist. Legacy traces left over while tracing is disabled do not
      // satisfy ongoing measurement — new actions would go unlogged.
      if (e.traceEnabled && (e.traceCount ?? 0) > 0) {
        return { status: 'satisfied', detail: `${e.traceCount} action(s) recorded with tracing enabled.` };
      }
      if (e.traceEnabled) {
        return {
          status: 'partial',
          detail: 'Tracing is enabled but no actions have been recorded yet.',
          recommendation: 'Once actions execute, traces will be recorded; verify trace capture in production.',
        };
      }
      if ((e.traceCount ?? 0) > 0) {
        return {
          status: 'partial',
          detail: `${e.traceCount} legacy trace(s) exist but tracing is currently disabled — new actions are not logged.`,
          recommendation: 'Re-enable tracing so every action continues to be measured and logged.',
        };
      }
      return {
        status: 'unsatisfied',
        detail: 'Tracing is disabled.',
        recommendation: 'Enable tracing so every action is measured and logged.',
      };
    },
  },
  {
    id: 'MEASURE-2.1',
    function: 'MEASURE',
    title: 'Measurements are tamper-evident',
    sentinelMechanism: 'MerkleChain',
    evaluate: (e) => {
      if ((e.auditChainLength ?? 0) > 0 && e.auditChainVerified) {
        return { status: 'satisfied', detail: `Merkle audit chain of length ${e.auditChainLength} verifies as intact.` };
      }
      if ((e.auditChainLength ?? 0) > 0 && e.auditChainVerified === false) {
        return {
          status: 'unsatisfied',
          detail: 'Merkle audit chain failed verification — possible tampering.',
          recommendation: 'Investigate the broken audit chain immediately; integrity cannot be attested.',
        };
      }
      return {
        status: 'partial',
        detail: 'Merkle chain present but empty.',
        recommendation: 'Audit chain will populate as actions execute; verify integrity in production.',
      };
    },
  },
  {
    id: 'MEASURE-4.1',
    function: 'MEASURE',
    title: 'Measurement records are durable',
    sentinelMechanism: 'PersistenceStore',
    evaluate: (e) =>
      e.persistenceEnabled
        ? { status: 'satisfied', detail: 'Audit state is persisted to durable storage and survives restarts.' }
        : {
            status: 'partial',
            detail: 'Audit state is in-memory only.',
            recommendation: 'Attach a PersistenceStore so audit records survive process restarts.',
          },
  },
  // -- MANAGE ---------------------------------------------------------------
  {
    id: 'MANAGE-1.1',
    function: 'MANAGE',
    title: 'High-risk futures are prevented',
    sentinelMechanism: 'TemporalBranchEngine (prevented futures)',
    evaluate: (e) => {
      // The control is satisfied when the prevention *capability* is in place,
      // consistent with how other controls (e.g. GOVERN-1.1) are satisfied by
      // capability rather than by whether the mechanism has fired yet. Having
      // already prevented futures is reported as additional evidence, not a
      // prerequisite — a brand-new deployment that has never hit a dangerous
      // intent should not be marked non-compliant.
      if (e.temporalEnabled) {
        const prevented = e.preventedFutureCount ?? 0;
        return {
          status: 'satisfied',
          detail: prevented > 0
            ? `Temporal branching enabled; ${prevented} dangerous future(s) already prevented.`
            : 'Temporal branching enabled — dangerous futures are simulated and can be prevented before commit.',
        };
      }
      return {
        status: 'unsatisfied',
        detail: 'No temporal branching / prevented-future capability in use.',
        recommendation: 'Adopt temporal branching to simulate and prevent dangerous outcomes.',
      };
    },
  },
  {
    id: 'MANAGE-2.1',
    function: 'MANAGE',
    title: 'Deployed system is monitored for drift',
    sentinelMechanism: 'DriftDetector',
    evaluate: (e) =>
      e.driftDetectionEnabled
        ? { status: 'satisfied', detail: 'Drift detection monitors for unauthorized out-of-band changes.' }
        : {
            status: 'unsatisfied',
            detail: 'No drift detection configured.',
            recommendation: 'Enable DriftDetector to catch out-of-band changes to managed surfaces.',
          },
  },
  {
    id: 'MANAGE-4.1',
    function: 'MANAGE',
    title: 'Adverse outcomes can be recovered',
    sentinelMechanism: 'Rollback + MagicRecovery',
    evaluate: (e) => {
      if (e.rollbackEnabled && e.recoveryEnabled) {
        return { status: 'satisfied', detail: 'Rollback and automated recovery are both available.' };
      }
      if (e.rollbackEnabled || e.recoveryEnabled) {
        return {
          status: 'partial',
          detail: 'Partial recovery capability configured.',
          recommendation: 'Enable both rollback and automated recovery for full incident response.',
        };
      }
      return {
        status: 'unsatisfied',
        detail: 'No rollback or recovery capability.',
        recommendation: 'Enable rollback and recovery so adverse outcomes can be reversed.',
      };
    },
  },
];

const ALL_FUNCTIONS: NistFunction[] = ['GOVERN', 'MAP', 'MEASURE', 'MANAGE'];

function readinessFor(score: number): NistComplianceReport['summary']['readiness'] {
  if (score >= 90) return 'compliant';
  if (score >= 70) return 'substantial';
  if (score >= 40) return 'developing';
  return 'non-compliant';
}

/**
 * Evaluates SENTINEL configurations against the NIST AI RMF and produces a
 * structured, exportable compliance report.
 */
export class NistComplianceProfile {
  /** Assess every control against the supplied evidence. */
  assess(evidence: ComplianceEvidence): ControlAssessment[] {
    return CONTROLS.map((def) => {
      const result = def.evaluate(evidence);
      return {
        id: def.id,
        function: def.function,
        title: def.title,
        sentinelMechanism: def.sentinelMechanism,
        ...result,
      };
    });
  }

  /** Build the full compliance report. */
  generateReport(evidence: ComplianceEvidence): NistComplianceReport {
    const controls = this.assess(evidence);

    const byFunction = {} as Record<NistFunction, FunctionCoverage>;
    for (const fn of ALL_FUNCTIONS) {
      byFunction[fn] = {
        function: fn,
        satisfied: 0,
        partial: 0,
        unsatisfied: 0,
        applicable: 0,
        coverageScore: 0,
      };
    }

    let weightSum = 0;
    let applicable = 0;
    let satisfied = 0;
    let partial = 0;
    let unsatisfied = 0;

    for (const c of controls) {
      const fc = byFunction[c.function];
      if (c.status === 'not_applicable') continue;

      applicable++;
      fc.applicable++;
      weightSum += STATUS_WEIGHT[c.status];

      if (c.status === 'satisfied') {
        satisfied++;
        fc.satisfied++;
      } else if (c.status === 'partial') {
        partial++;
        fc.partial++;
      } else {
        unsatisfied++;
        fc.unsatisfied++;
      }
    }

    for (const fn of ALL_FUNCTIONS) {
      const fc = byFunction[fn];
      const fnWeight = fc.satisfied + fc.partial * 0.5;
      fc.coverageScore = fc.applicable > 0 ? Math.round((fnWeight / fc.applicable) * 100) : 0;
    }

    const coverageScore = applicable > 0 ? Math.round((weightSum / applicable) * 100) : 0;

    const gaps = controls
      .filter((c) => c.status === 'partial' || c.status === 'unsatisfied')
      .map((c) => ({
        id: c.id,
        status: c.status,
        recommendation: c.recommendation ?? 'Address this control to improve compliance coverage.',
      }))
      // Unsatisfied gaps before partial ones.
      .sort((a, b) => STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status]);

    return {
      framework: 'NIST AI RMF 1.0',
      profileVersion: PROFILE_VERSION,
      generatedAt: Date.now(),
      summary: {
        totalControls: controls.length,
        applicable,
        satisfied,
        partial,
        unsatisfied,
        coverageScore,
        readiness: readinessFor(coverageScore),
      },
      byFunction,
      controls,
      gaps,
    };
  }

  /** Serialize a report to pretty-printed JSON. */
  exportJson(evidence: ComplianceEvidence): string {
    return JSON.stringify(this.generateReport(evidence), null, 2);
  }
}

// ---------------------------------------------------------------------------
// Evidence collection
// ---------------------------------------------------------------------------

/**
 * Structural view of a live SENTINEL instance, used to auto-derive evidence.
 * Optional module fields are typed as `unknown` because only their *presence*
 * matters here; `trace`, `policy`, and `config` expose the specific accessors
 * needed to read counts. An instance returned by `createSentinel()` satisfies this
 * shape directly.
 */
export interface EvidenceSources {
  config?: { requireShadowFirst?: boolean; traceEnabled?: boolean };
  policy?: { listDSLRules(): unknown[] };
  approval?: unknown;
  identity?: unknown;
  blastRadius?: unknown;
  executor?: unknown;
  temporal?: unknown;
  drift?: unknown;
  magic?: unknown;
  trace?: {
    getStats(): { total: number };
    getChainLength(): number;
    verifyChain(): { valid: boolean };
  };
  /** A persistence backend, if one has been attached. */
  persistence?: unknown;
}

/**
 * Facts that cannot be derived from module presence alone and must be supplied
 * explicitly by the caller (or measured externally).
 */
export interface EvidenceOverrides {
  policyRuleCount?: number;
  registeredActorCount?: number;
  preventedFutureCount?: number;
  persistenceEnabled?: boolean;
}

/**
 * Derive {@link ComplianceEvidence} from a live SENTINEL instance. Module presence
 * implies the corresponding capability is available; counts that SENTINEL does not
 * track globally (registered actors, prevented futures, …) can be supplied via
 * `overrides`.
 */
export function gatherEvidence(
  sources: EvidenceSources,
  overrides: EvidenceOverrides = {},
): ComplianceEvidence {
  const present = (v: unknown): boolean => v !== undefined && v !== null;

  const dslRuleCount = sources.policy ? sources.policy.listDSLRules().length : 0;
  const traceStats = sources.trace ? sources.trace.getStats() : undefined;

  return {
    policyRuleCount: overrides.policyRuleCount ?? 0,
    dslRuleCount,
    approvalConfigured: present(sources.approval),
    identityValidationEnabled: present(sources.identity),
    registeredActorCount: overrides.registeredActorCount ?? 0,
    riskAssessmentEnabled: present(sources.policy),
    blastRadiusEnabled: present(sources.blastRadius),
    shadowFirstRequired: sources.config?.requireShadowFirst ?? false,
    traceCount: traceStats?.total ?? 0,
    traceEnabled: sources.config?.traceEnabled ?? present(sources.trace),
    auditChainLength: sources.trace ? sources.trace.getChainLength() : 0,
    auditChainVerified: sources.trace ? sources.trace.verifyChain().valid : false,
    persistenceEnabled: overrides.persistenceEnabled ?? present(sources.persistence),
    temporalEnabled: present(sources.temporal),
    preventedFutureCount: overrides.preventedFutureCount ?? 0,
    driftDetectionEnabled: present(sources.drift),
    rollbackEnabled: present(sources.executor),
    recoveryEnabled: present(sources.magic),
  };
}
