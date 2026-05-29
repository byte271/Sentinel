/**
 * SENTINEL-Exec: Shadow Executor
 *
 * The ShadowExecutor is the core execution component of SENTINEL. It implements
 * the "shadow-first" pattern: every action is first executed in a sandboxed
 * shadow pass to predict state changes, then optionally committed for real,
 * and can be rolled back if needed.
 *
 * ActionAdapters bridge SENTINEL to real-world systems (filesystems, APIs, DBs).
 */

import { v4 as uuid } from 'uuid';
import type {
  ActionPlan,
  Surface,
  ShadowResult,
  CommitResult,
  RollbackToken,
  RollbackAction,
  StateDelta,
  DiffEntry,
  Evidence,
  SentinelConfig,
  RiskLevel,
} from '../kernel/types.js';

// ---------------------------------------------------------------------------
// ActionAdapter — the integration point between SENTINEL and external systems.
// Each adapter represents a single surface (e.g. a filesystem, a database,
// an API endpoint) and knows how to execute actions in both shadow and real
// modes, capture state, compute diffs, and roll back.
// ---------------------------------------------------------------------------

export interface ActionAdapter {
  /** Unique identifier for this adapter instance. */
  id: string;

  /** The surface this adapter operates on. */
  surfaceId: string;

  /** Capture the current state of the surface. */
  getState(): Promise<Record<string, unknown>>;

  /**
   * Execute an action in shadow (dry-run) mode.
   * Must not cause real side-effects.
   */
  executeShadow(
    action: string,
    params: Record<string, unknown>,
  ): Promise<{ result: Record<string, unknown>; sideEffects: string[] }>;

  /** Execute an action for real and collect evidence. */
  executeReal(
    action: string,
    params: Record<string, unknown>,
  ): Promise<{ result: Record<string, unknown>; evidence: Evidence[] }>;

  /** Roll back a set of previously-committed actions. */
  rollback(
    actions: RollbackAction[],
  ): Promise<{ success: boolean; evidence: Evidence[] }>;

  /** Compute a structured diff between two state snapshots. */
  computeDiff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): DiffEntry[];
}

// ---------------------------------------------------------------------------
// ShadowExecutor — shadow → commit → rollback lifecycle manager.
// ---------------------------------------------------------------------------

export class ShadowExecutor {
  /** Registered adapters keyed by surfaceId. */
  private adapters: Map<string, ActionAdapter> = new Map();

  /** Plans stored during shadow execution, keyed by intentId. */
  private plans: Map<string, ActionPlan> = new Map();

  /** Rollback tokens stored during commit, keyed by token ID. */
  private rollbackTokens: Map<string, { token: RollbackToken; surfaceId: string }> = new Map();

  /** Global SENTINEL configuration. */
  private config: SentinelConfig;

  constructor(config: SentinelConfig) {
    this.config = config;
  }

  // -----------------------------------------------------------------------
  // Adapter management
  // -----------------------------------------------------------------------

  /** Register an ActionAdapter for a given surface. */
  registerAdapter(adapter: ActionAdapter): void {
    this.adapters.set(adapter.surfaceId, adapter);
  }

  /** Retrieve an adapter by surface ID. */
  getAdapter(surfaceId: string): ActionAdapter | undefined {
    return this.adapters.get(surfaceId);
  }

  // -----------------------------------------------------------------------
  // Shadow pass — predict state changes without real side-effects.
  // -----------------------------------------------------------------------

  /** Alias for shadow() — convenience for users expecting `shadowExecute`. */
  async shadowExecute(plan: ActionPlan, surface: Surface): Promise<ShadowResult> {
    return this.shadow(plan, surface);
  }

  async shadow(plan: ActionPlan, surface: Surface): Promise<ShadowResult> {
    const adapter = this.adapters.get(surface.id);
    if (!adapter) {
      return this.failedShadowResult(plan.intentId, `No adapter registered for surface "${surface.id}"`);
    }

    try {
      const startMs = Date.now();

      // Store the plan so commit() can retrieve it later.
      this.plans.set(plan.intentId, plan);

      // 1. Capture the "before" snapshot.
      const beforeState = await adapter.getState();

      // 2. Execute every plan step in shadow mode.
      const stepResults: Array<{ result: Record<string, unknown>; sideEffects: string[] }> = [];
      for (const step of plan.steps) {
        const stepResult = await adapter.executeShadow(step.action, step.params);
        stepResults.push(stepResult);
      }

      // 3. Capture the "after" snapshot (shadow didn't mutate anything, so
      //    before === after for the real FS; we use step results to predict).
      const afterState = await adapter.getState();

      // 4. Compute diff between before and after.
      const diff = adapter.computeDiff(beforeState, afterState);

      // 5. Collect all predicted side-effects.
      const allSideEffects = stepResults.flatMap((r) => r.sideEffects);

      // 6. Build evidence array.
      const evidence: Evidence[] = [
        this.createEvidence('snapshot', { diff, sideEffects: allSideEffects, stepResults: stepResults.map(r => r.result) }, surface.id),
      ];

      // 7. Build predicted changes from side effects (since shadow doesn't mutate real state)
      const predictedChanges: DiffEntry[] = allSideEffects.map(se => {
        const [op, path] = se.includes(':') ? se.split(':') : ['unknown', se];
        return {
          path: path || se,
          op: op === 'create' || op === 'create_directory' ? 'add' as const :
              op === 'delete' ? 'remove' as const :
              op === 'overwrite' ? 'replace' as const : 'add' as const,
        };
      });

      const predictedDelta: StateDelta = {
        before: beforeState,
        after: afterState,
        changes: predictedChanges.length > 0 ? predictedChanges : diff,
      };

      // 8. Derive risk and confidence from the simulation results rather than
      //    defaulting to level=none / confidence=1.0 regardless of what was
      //    predicted. Upstream modules (e.g. TemporalBranchEngine) rely on
      //    these values to make correct branch-selection decisions.
      const totalImpact = allSideEffects.length + predictedChanges.length;

      let riskLevel: RiskLevel;
      let riskScore: number;
      if (totalImpact === 0) {
        riskLevel = 'none';
        riskScore = 0;
      } else if (totalImpact <= 2) {
        riskLevel = 'low';
        riskScore = 0.25;
      } else if (totalImpact <= 5) {
        riskLevel = 'medium';
        riskScore = 0.5;
      } else if (totalImpact <= 10) {
        riskLevel = 'high';
        riskScore = 0.75;
      } else {
        riskLevel = 'critical';
        riskScore = 1.0;
      }

      // Confidence decreases proportionally with predicted impact: more changes
      // mean a larger surface area where the real execution can diverge from the
      // shadow simulation. Floor at 0.5 — even a large shadow still carries
      // meaningful signal about the operation's structure.
      const shadowConfidence = totalImpact === 0
        ? 1.0
        : Math.max(0.5, 1.0 - totalImpact * 0.04);

      const riskFactors: import('../kernel/types.js').RiskFactor[] = [];
      if (allSideEffects.length > 0) {
        riskFactors.push({
          type: 'side_effects',
          severity: riskLevel,
          description: `${allSideEffects.length} predicted side effect(s)`,
          mitigatable: true,
        });
      }
      if (predictedChanges.length > 0) {
        riskFactors.push({
          type: 'state_changes',
          severity: riskLevel,
          description: `${predictedChanges.length} predicted state change(s)`,
          mitigatable: true,
        });
      }

      return {
        intentId: plan.intentId,
        planId: uuid(),
        predictedDelta,
        evidence,
        confidence: shadowConfidence,
        timestamp: Date.now(),
        status: 'success',
        risk: {
          level: riskLevel,
          factors: riskFactors,
          score: riskScore,
          requiresApproval: riskLevel === 'high' || riskLevel === 'critical',
          mitigations: [],
        },
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      return this.failedShadowResult(
        plan.intentId,
        err instanceof Error ? err.message : String(err),
        surface.id,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Commit — apply predicted changes for real.
  // -----------------------------------------------------------------------

  async commit(shadowResult: ShadowResult, surface: Surface): Promise<CommitResult> {
    const adapter = this.adapters.get(surface.id);
    if (!adapter) {
      return {
        intentId: shadowResult.intentId,
        shadowResultId: shadowResult.planId,
        status: 'failed',
        realDelta: shadowResult.predictedDelta,
        evidence: [
          this.createEvidence('log', { error: `No adapter registered for surface "${surface.id}"` }, surface.id),
        ],
        timestamp: Date.now(),
      };
    }

    try {
      // 1. Capture real "before" state.
      const beforeState = await adapter.getState();

      // 2. Retrieve the plan stored during shadow execution.
      const plan = this.plans.get(shadowResult.intentId);

      if (!plan || !plan.steps.length) {
        return {
          intentId: shadowResult.intentId,
          shadowResultId: shadowResult.planId,
          status: 'failed',
          realDelta: shadowResult.predictedDelta,
          evidence: [
            this.createEvidence('log', { error: `No execution plan found for intent "${shadowResult.intentId}"` }, surface.id),
          ],
          timestamp: Date.now(),
        };
      }

      // Execute real actions for each step.
      const allEvidence: Evidence[] = [];

      for (const step of plan.steps) {
        const real = await adapter.executeReal(step.action, step.params);
        allEvidence.push(...real.evidence);
      }

      // 3. Capture real "after" state.
      const afterState = await adapter.getState();

      // 4. Compute the real diff.
      const diff = adapter.computeDiff(beforeState, afterState);

      const realDelta: StateDelta = {
        before: beforeState,
        after: afterState,
        changes: diff,
      };

      // 5. Compare real delta with shadow predicted delta.
      const confidence = this.computeConfidence(shadowResult.predictedDelta, realDelta);

      // 6. Build rollback token from plan steps that have rollbackAction.
      const rollbackToken: RollbackToken | undefined =
        plan ? this.buildRollbackToken(shadowResult.intentId, plan) : undefined;

      // Store the rollback token for later retrieval.
      if (rollbackToken) {
        this.rollbackTokens.set(rollbackToken.id, { token: rollbackToken, surfaceId: surface.id });
      }

      return {
        intentId: shadowResult.intentId,
        shadowResultId: shadowResult.planId,
        status: 'committed',
        realDelta,
        rollbackToken,
        evidence: [
          ...allEvidence,
          this.createEvidence('state_change', { realDelta, confidence }, surface.id),
        ],
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        intentId: shadowResult.intentId,
        shadowResultId: shadowResult.planId,
        status: 'failed',
        realDelta: shadowResult.predictedDelta,
        evidence: [
          this.createEvidence('log', { error: err instanceof Error ? err.message : String(err) }, surface.id),
        ],
        timestamp: Date.now(),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Rollback — undo a committed change using its rollback token.
  // -----------------------------------------------------------------------

  async rollback(tokenId: string): Promise<CommitResult> {
    const stored = this.rollbackTokens.get(tokenId);
    if (!stored) {
      return {
        intentId: '',
        shadowResultId: tokenId,
        status: 'failed',
        realDelta: { before: {}, after: {}, changes: [] },
        evidence: [
          this.createEvidence('log', { error: `No rollback token found for "${tokenId}"` }, 'unknown'),
        ],
        timestamp: Date.now(),
      };
    }

    const { token, surfaceId } = stored;

    // Validate the token is still usable.
    if (token.expiresAt && Date.now() > token.expiresAt) {
      return {
        intentId: token.intentId,
        shadowResultId: token.id,
        status: 'failed',
        realDelta: { before: {}, after: {}, changes: [] },
        evidence: [
          this.createEvidence('log', { error: 'Rollback token has expired' }, surfaceId),
        ],
        timestamp: Date.now(),
      };
    }

    const adapter = this.adapters.get(surfaceId);
    if (!adapter) {
      return {
        intentId: token.intentId,
        shadowResultId: token.id,
        status: 'failed',
        realDelta: { before: {}, after: {}, changes: [] },
        evidence: [
          this.createEvidence('log', { error: `No adapter for surface "${surfaceId}"` }, surfaceId),
        ],
        timestamp: Date.now(),
      };
    }

    try {
      // Execute rollback actions in reverse order.
      const reversedActions = [...token.actions].reverse();
      const { success, evidence } = await adapter.rollback(reversedActions);

      // Mark token as consumed.
      token.valid = false;

      return {
        intentId: token.intentId,
        shadowResultId: token.id,
        status: success ? 'rolled_back' : 'failed',
        realDelta: { before: {}, after: {}, changes: [] },
        evidence: [
          ...evidence,
          this.createEvidence('state_change', { success, tokenId: token.id }, surfaceId),
        ],
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        intentId: token.intentId,
        shadowResultId: token.id,
        status: 'failed',
        realDelta: { before: {}, after: {}, changes: [] },
        evidence: [
          this.createEvidence('log', { error: err instanceof Error ? err.message : String(err) }, surfaceId),
        ],
        timestamp: Date.now(),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Compute a confidence score (0–1) by comparing how closely the real
   * state delta matches the shadow-predicted delta.
   */
  private computeConfidence(predicted: StateDelta, actual: StateDelta): number {
    if (!predicted.changes.length && !actual.changes.length) {
      return 1.0;
    }
    if (!predicted.changes.length || !actual.changes.length) {
      return 0.0;
    }

    // Simple heuristic: ratio of matching diff entries to total entries.
    const predictedPaths = new Set(predicted.changes.map((d) => d.path));
    const actualPaths = new Set(actual.changes.map((d) => d.path));

    let matches = 0;
    for (const path of predictedPaths) {
      if (actualPaths.has(path)) {
        matches++;
      }
    }

    const totalUnique = new Set([...predictedPaths, ...actualPaths]).size;
    return totalUnique > 0 ? matches / totalUnique : 1.0;
  }

  /**
   * Build a RollbackToken from plan steps that include a rollbackAction.
   */
  private buildRollbackToken(intentId: string, plan: ActionPlan): RollbackToken {
    const actions: RollbackAction[] = plan.steps
      .filter((step) => step.rollbackAction)
      .map((step) => ({ action: step.rollbackAction!, params: step.params, order: 0 }) as RollbackAction);

    const defaultTtlMs = 30 * 60 * 1000; // 30 minutes

    return {
      id: uuid(),
      intentId,
      actions,
      expiresAt: Date.now() + defaultTtlMs,
      valid: true,
    };
  }

  /**
   * Create a typed Evidence entry.
   */
  private createEvidence(type: Evidence['type'], data: unknown, source: string): Evidence {
    return {
      type,
      data,
      source,
      timestamp: Date.now(),
      confidence: 1.0,
    };
  }

  /**
   * Build a failed ShadowResult for error cases.
   */
  private failedShadowResult(intentId: string, error: string, surfaceId?: string): ShadowResult {
    return {
      intentId,
      planId: '',
      predictedDelta: {
        before: {},
        after: {},
        changes: [],
      },
      evidence: [this.createEvidence('log', { error }, surfaceId ?? 'unknown')],
      confidence: 0,
      timestamp: Date.now(),
      status: 'failure',
      risk: { level: 'none', factors: [], score: 0, requiresApproval: false, mitigations: [] },
      durationMs: 0,
    };
  }
}
