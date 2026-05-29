// ---------------------------------------------------------------------------
// SENTINEL Safe Module — PolicyEngine
// ---------------------------------------------------------------------------
// Evaluates risk and enforces policy for action intents against surfaces.
// ---------------------------------------------------------------------------

import type {
  ActionIntent,
  Surface,
  PolicyDecision,
  RiskAssessment,
  RiskFactor,
  RiskLevel,
  SentinelConfig,
  SurfaceCapability,
} from '../kernel/types.js';
import { PolicyDSL, DSLContext, DSLRule } from './dsl.js';

// ---------------------------------------------------------------------------
// Module-level constants (avoid recreating per-call)
// ---------------------------------------------------------------------------

/**
 * Regex pattern for secrets-exposure detection.
 * Defined once at module level so the engine doesn't recompile it every call.
 */
const SECRETS_PATTERN = /\b(password|secret|token|key|credential)\b/i;

/**
 * Per-risk-factor score weights for composite risk calculation.
 * Defined once at module level — `assessRisk()` is called on every action,
 * so the object must not be recreated on each invocation.
 */
const FACTOR_WEIGHTS: Record<string, number> = {
  destructive: 0.3,
  external_side_effect: 0.2,
  financial: 0.35,
  secrets_exposure: 0.3,
  data_loss: 0.35,
  identity_risk: 0.25,
  production_environment: 0.2,
};

// ---------------------------------------------------------------------------
// PolicyRule
// ---------------------------------------------------------------------------

export interface PolicyRule {
  name: string;
  description: string;
  condition: (intent: ActionIntent, surface: Surface) => boolean;
  riskFactor: RiskFactor;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function riskLevelToScore(level: RiskLevel): number {
  switch (level) {
    case 'none':     return 0;
    case 'low':      return 0.1;
    case 'medium':   return 0.4;
    case 'high':     return 0.7;
    case 'critical': return 1.0;
  }
}

export function scoreToRiskLevel(score: number): RiskLevel {
  if (score <= 0) return 'none';
  if (score >= 0.85) return 'critical';
  if (score >= 0.55) return 'high';
  if (score >= 0.25) return 'medium';
  return 'low';
}

export function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  const scoreA = riskLevelToScore(a);
  const scoreB = riskLevelToScore(b);
  return scoreA >= scoreB ? a : b;
}

// ---------------------------------------------------------------------------
// Built-in rules
// ---------------------------------------------------------------------------

const deleteRule: PolicyRule = {
  name: 'destructive-action',
  description: 'Flags actions that delete, remove, drop, or destroy resources.',
  condition: (intent) =>
    /(?:\b|_)(delete|remove|drop|destroy)(?:\b|_)/i.test(intent.action),
  riskFactor: { type: 'destructive', severity: 'high', description: 'Destructive action detected', mitigatable: true },
};

const paymentRule: PolicyRule = {
  name: 'financial-action',
  description: 'Flags actions involving payments, refunds, charges, or transfers.',
  condition: (intent) =>
    /\b(pay|refund|charge|transfer)\b/i.test(intent.action),
  riskFactor: { type: 'financial', severity: 'critical', description: 'Financial action detected', mitigatable: true },
};

const secretsRule: PolicyRule = {
  name: 'secrets-exposure',
  description: 'Flags actions whose params reference passwords, secrets, tokens, keys, or credentials.',
  condition: (intent) => {
    // Early-exit iteration avoids building a full concatenated string.
    for (const k of Object.keys(intent.params)) {
      if (SECRETS_PATTERN.test(k)) return true;
    }
    for (const v of Object.values(intent.params)) {
      if (typeof v === 'string' && SECRETS_PATTERN.test(v)) return true;
    }
    return false;
  },
  riskFactor: { type: 'secrets_exposure', severity: 'high', description: 'Secrets exposure risk', mitigatable: true },
};

const productionRule: PolicyRule = {
  name: 'production-environment',
  description: 'Flags actions targeting surfaces whose name contains "prod".',
  condition: (_intent, surface) =>
    /prod/i.test(surface.name),
  riskFactor: { type: 'production_environment', severity: 'high', description: 'Production environment targeted', mitigatable: false },
};

const externalRule: PolicyRule = {
  name: 'external-side-effect',
  description: 'Flags actions that send emails, notifications, or publish externally.',
  condition: (intent) =>
    /\b(send|email|notify|publish)\b/i.test(intent.action),
  riskFactor: { type: 'external_side_effect', severity: 'medium', description: 'External side effect detected', mitigatable: true },
};

const BUILT_IN_RULES: PolicyRule[] = [
  deleteRule,
  paymentRule,
  secretsRule,
  productionRule,
  externalRule,
];

// ---------------------------------------------------------------------------
// PolicyEngine
// ---------------------------------------------------------------------------

export class PolicyEngine {
  private readonly config: SentinelConfig;
  private readonly rules: PolicyRule[] = [...BUILT_IN_RULES];
  private dsl: PolicyDSL = new PolicyDSL();
  /** DSL rules stored in their final parsed form — no remapping needed at evaluation time. */
  private dslRules: DSLRule[] = [];
  private lastRiskAssessment: { level: string; score: number } = { level: 'none', score: 0 };

  constructor(config: SentinelConfig) {
    this.config = config;
  }

  // ---- Public API ----------------------------------------------------------

  async assess(intent: ActionIntent, surface: Surface, riskAssessment?: import('../kernel/types.js').RiskAssessment): Promise<PolicyDecision> {
    // Resolve risk first so DSL rules receive current data, not stale lastRiskAssessment.
    const effectiveRiskAssessment = riskAssessment ?? await this.assessRisk(intent, surface);

    // Check DSL rules with up-to-date risk context
    const dslResult = this.evaluateDSLRules(intent, surface, effectiveRiskAssessment);

    if (dslResult) {
      if (dslResult.verdict === 'deny') {
        return {
          allowed: false,
          reason: `DSL rule denied: ${dslResult.matchedRules.map((r) => r.raw).join('; ')}`,
          conditions: [],
          requiredApprovals: [],
          maxRiskLevel: 'critical',
          forceShadow: true,
          forceHumanReview: true,
        };
      }

      if (dslResult.verdict === 'require_approval') {
        return {
          allowed: false,
          reason: `DSL rule requires approval: ${dslResult.matchedRules.map((r) => r.raw).join('; ')}`,
          conditions: ['Admin approval required.'],
          requiredApprovals: ['admin'],
          maxRiskLevel: 'high',
          forceShadow: true,
          forceHumanReview: true,
        };
      }

      // For 'warn', we note it but continue with existing logic below
      // For 'allow', we also continue with existing logic
    }

    const capability = surface.capabilities.find(
      (c: SurfaceCapability) => c.action === intent.action,
    );

    // Risk is already resolved above.
    const capRiskLevel = capability?.riskLevel ?? 'low';
    const effectiveLevel = maxRiskLevel(effectiveRiskAssessment.level, capRiskLevel);

    const conditions: string[] = [];

    // If DSL returned 'warn', add a note
    if (dslResult && dslResult.verdict === 'warn') {
      conditions.push(`DSL warning: ${dslResult.matchedRules.map((r) => r.raw).join('; ')}`);
    }

    // Determine verdict based on config thresholds
    const effectiveScore = Math.max(
      effectiveRiskAssessment.score,
      riskLevelToScore(capRiskLevel),
    );

    const maxAutoScore = riskLevelToScore(this.config.requireApprovalAbove);

    if (effectiveLevel === 'critical') {
      return {
        allowed: false,
        reason: `Risk level "${effectiveLevel}" exceeds safe threshold.`,
        conditions,
        requiredApprovals: [],
        maxRiskLevel: effectiveLevel,
        forceShadow: true,
        forceHumanReview: true,
      };
    }

    if (effectiveScore > maxAutoScore) {
      return {
        allowed: false,
        reason: `Effective risk score ${effectiveScore.toFixed(2)} exceeds auto-commit threshold (${maxAutoScore.toFixed(2)}).`,
        conditions: ['Human approval required before commit.', ...conditions],
        requiredApprovals: ['human'],
        maxRiskLevel: effectiveLevel,
        forceShadow: true,
        forceHumanReview: true,
      };
    }

    if (!capability) {
      return {
        allowed: false,
        reason: `Capability "${intent.action}" not found on surface "${surface.id}".`,
        conditions,
        requiredApprovals: [],
        maxRiskLevel: effectiveLevel,
        forceShadow: false,
        forceHumanReview: false,
      };
    }

    return {
      allowed: true,
      reason: effectiveRiskAssessment.factors.length > 0
        ? effectiveRiskAssessment.factors.map((f) => `Risk factor detected: ${f.type}`).join('; ')
        : 'Action within acceptable risk thresholds.',
      conditions,
      requiredApprovals: [],
      maxRiskLevel: effectiveLevel,
      forceShadow: false,
      forceHumanReview: false,
    };
  }

  async assessRisk(intent: ActionIntent, surface: Surface): Promise<RiskAssessment> {
    const factors = this.evaluateRules(intent, surface);

    // Derive additional heuristic factors not covered by explicit rules
    if (/\b(data_loss|truncate|wipe|purge)\b/i.test(intent.action) && !factors.some((f) => f.type === 'data_loss')) {
      factors.push({ type: 'data_loss', severity: 'high', description: 'Potential data loss', mitigatable: true });
    }
    if (/\b(impersonate|spoof|identity)\b/i.test(intent.action) && !factors.some((f) => f.type === 'identity_risk')) {
      factors.push({ type: 'identity_risk', severity: 'high', description: 'Identity risk detected', mitigatable: false });
    }

    // Calculate composite score using module-level weight table.
    let score = 0;
    for (const factor of factors) {
      score += FACTOR_WEIGHTS[factor.type] ?? 0.1;
    }
    score = Math.min(score, 1);

    const level = scoreToRiskLevel(score);

    this.lastRiskAssessment = { level, score };

    return {
      level,
      score,
      factors,
      requiresApproval: level === 'high' || level === 'critical',
      mitigations: factors.filter((f) => f.mitigatable).map((f) => `Mitigate: ${f.type}`),
    };
  }

  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
  }

  /** Alias for addRule — convenience for programmatic rule registration. */
  addProgrammaticRule(rule: PolicyRule): void {
    this.addRule(rule);
  }

  // ---- DSL integration -----------------------------------------------------

  addDSLRule(expression: string): void {
    const parsed = this.dsl.parse(expression);
    this.dslRules.push(parsed);
  }

  removeDSLRule(id: string): void {
    this.dslRules = this.dslRules.filter((r) => r.id !== id);
  }

  listDSLRules(): Array<{ id: string; verdict: string; raw: string }> {
    return this.dslRules.map((r) => ({ id: r.id, verdict: r.verdict, raw: r.raw }));
  }

  evaluateDSLRules(
    intent: ActionIntent,
    surface: Surface,
    currentRisk?: { level: string; score: number },
  ): { verdict: string; matchedRules: Array<{ id: string; raw: string }> } | null {
    if (this.dslRules.length === 0) return null;

    const riskCtx = currentRisk ?? this.lastRiskAssessment;
    const context: DSLContext = {
      action: intent.action,
      surface: { id: surface.id, name: surface.name, type: surface.type },
      actor: {
        id: intent.initiator.id,
        name: intent.initiator.name,
        trust: intent.initiator.trust,
        type: intent.initiator.type,
      },
      params: intent.params,
      risk: { level: riskCtx.level, score: riskCtx.score },
    };

    // dslRules is already DSLRule[] — no remapping needed.
    const result = this.dsl.evaluateAll(this.dslRules, context);
    if (result.matchedRules.length === 0) return null;

    return {
      verdict: result.verdict,
      matchedRules: result.matchedRules.map((r) => ({ id: r.id, raw: r.raw })),
    };
  }

  // ---- Private -------------------------------------------------------------

  private evaluateRules(intent: ActionIntent, surface: Surface): RiskFactor[] {
    const factors: RiskFactor[] = [];

    for (const rule of this.rules) {
      if (rule.condition(intent, surface)) {
        if (!factors.some((f) => f.type === rule.riskFactor.type)) {
          factors.push(rule.riskFactor);
        }
      }
    }

    return factors;
  }
}
