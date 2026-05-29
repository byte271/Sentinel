// ---------------------------------------------------------------------------
// SENTINEL Temporal Branch Engine v2 — Parallel Future Exploration (Refined)
// ---------------------------------------------------------------------------
// Git branches for reality. Fork execution into parallel timelines, run
// different strategies in each, score all outcomes, and only commit the
// winning future.
//
// v2 refinements:
//  - 6th scoring dimension: reversibility
//  - Auto-normalizing weights (custom dimensions don't break totals)
//  - Merge request quorum + auto-expiry
//  - 3 pruning strategies: confidence-decay, risk-ceiling, diminishing-returns
//  - Pairwise timeline diffs for side-by-side comparison
//  - Chained Merkle proof hash across all non-selection proofs
//  - Custom safety gate checks (dynamic registration)
//  - Statistical summary (summarizeFutures)
//  - diffTimelines() for any two timelines
//  - Budget utilization tracking per timeline
//  - Auto-strategy inference from intent analysis
//  - Content preview in action diffs
//  - Timeline depth tracking
// ---------------------------------------------------------------------------

import { v4 as uuid } from 'uuid';
import { createHash } from 'crypto';
import type {
  ActionIntent,
  ActionPlan,
  DiffEntry,
  ExplorationStats,
  RiskAssessment,
  RiskLevel,
  ShadowResult,
  Surface,

  Timeline,
  TimelineComparison,
  TimelineForkRequest,
  TimelinePhase,
  TimelinePairwiseDiff,
  TimelineScoreDimension,
  TimelineScoringCriteria,
  TemporalBranchResult,
  TraceRecord,
  BranchBudget,
  PruningStrategy,
  RealityMergeRequest,
  MergeRequestStatus,
  MergeReview,
  RealityActionDiff,
  PreventedFuture,
  PreventionReason,
  NonSelectionProof,
  CounterfactualAnalysis,
  CounterfactualOutcome,
  SafetyGateResult,
  SafetyGateCheck,
  SafetyGateStatus,
  CustomSafetyGateCheck,
  ActorIdentity,
} from '../kernel/types.js';
import type { ExecModule } from '../kernel/kernel.js';
import { inferRollbackAction } from '../helpers.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SCORING: TimelineScoringCriteria = {
  confidence: 0.25,
  safety: 0.20,
  minimality: 0.10,
  completeness: 0.20,
  speed: 0.10,
  reversibility: 0.15,
};

const DEFAULT_BUDGET: BranchBudget = {
  maxTimelines: 10,
  maxDepth: 3,
  maxTotalIntents: 50,
  maxExplorationMs: 60_000,
  earlyPruneThreshold: 20,
  minStepConfidence: 0.1,
  maxStepRisk: 'critical',
};

const RISK_SCORE: Record<RiskLevel, number> = {
  none: 100, low: 80, medium: 50, high: 20, critical: 0,
};

const RISK_WEIGHT: Record<RiskLevel, number> = {
  none: 0, low: 1, medium: 2, high: 3, critical: 4,
};

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PlanBuilder {
  buildPlan(intent: ActionIntent, surface: Surface): ActionPlan;
}

export interface TemporalStateProvider {
  getActualState(surfaceId: string): Promise<Record<string, unknown>>;
}

/**
 * Minimal kernel contract used to commit a winning timeline. When set, every
 * intent in a merged timeline is committed via `execute()` so it passes the
 * full safety lifecycle — identity, risk, policy, blast radius, approval — not
 * just the temporal safety gate. This is what closes the temporal bypass.
 */
export interface TemporalKernel {
  execute(intent: ActionIntent): Promise<TraceRecord>;
}

// ---------------------------------------------------------------------------
// TemporalBranchEngine
// ---------------------------------------------------------------------------

export class TemporalBranchEngine {
  private timelines: Map<string, Timeline> = new Map();
  /** Parent → child IDs index for O(1) getChildren(). Updated in fork(). */
  private readonly childIndex: Map<string, Set<string>> = new Map();
  private mergeRequests: Map<string, RealityMergeRequest> = new Map();
  private preventedFutures: PreventedFuture[] = [];
  private nonSelectionProofs: NonSelectionProof[] = [];

  private scoring: TimelineScoringCriteria;
  private budget: BranchBudget;
  private sandboxMode = false;
  private pruningStrategies: Set<PruningStrategy> = new Set(['score_threshold', 'confidence_decay', 'risk_ceiling']);

  private execModule: ExecModule | undefined;
  private kernel: TemporalKernel | undefined;
  private surfaces: Map<string, Surface> = new Map();
  private planBuilder: PlanBuilder | undefined;
  private stateProvider: TemporalStateProvider | undefined;
  private customGateChecks: CustomSafetyGateCheck[] = [];
  private listeners: Array<(event: string, data: Record<string, unknown>) => void> = [];

  /** Default MR expiry (ms). 0 = never. */
  private defaultMergeRequestTtlMs = 0;
  /** Default required approvals for MRs. */
  private defaultQuorum = 1;

  constructor(scoring?: Partial<TimelineScoringCriteria>, budget?: Partial<BranchBudget>) {
    this.scoring = { ...DEFAULT_SCORING, ...scoring };
    this.budget = { ...DEFAULT_BUDGET, ...budget };
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  setExecModule(mod: ExecModule): void { this.execModule = mod; }
  /** Wire the safety kernel that commits the winning timeline's intents. */
  setKernel(kernel: TemporalKernel): void { this.kernel = kernel; }
  registerSurface(surface: Surface): void { this.surfaces.set(surface.id, surface); }
  setPlanBuilder(builder: PlanBuilder): void { this.planBuilder = builder; }
  setStateProvider(provider: TemporalStateProvider): void { this.stateProvider = provider; }

  setScoringCriteria(criteria: Partial<TimelineScoringCriteria>): void {
    this.scoring = { ...this.scoring, ...criteria };
  }

  setBudget(budget: Partial<BranchBudget>): void {
    this.budget = { ...this.budget, ...budget };
  }

  /** Set which pruning strategies are active. */
  setPruningStrategies(strategies: PruningStrategy[]): void {
    this.pruningStrategies = new Set(strategies);
  }

  /** Register a custom safety gate check. */
  registerGateCheck(check: CustomSafetyGateCheck): void {
    this.customGateChecks.push(check);
  }

  /** Set default MR configuration. */
  setMergeRequestDefaults(opts: { ttlMs?: number; quorum?: number }): void {
    if (opts.ttlMs !== undefined) this.defaultMergeRequestTtlMs = opts.ttlMs;
    if (opts.quorum !== undefined) this.defaultQuorum = opts.quorum;
  }

  onEvent(listener: (event: string, data: Record<string, unknown>) => void): void {
    this.listeners.push(listener);
  }

  // -----------------------------------------------------------------------
  // [14] Sandbox Mode
  // -----------------------------------------------------------------------

  enableSandbox(): void { this.sandboxMode = true; this.emit('sandbox:enabled', {}); }
  disableSandbox(): void { this.sandboxMode = false; this.emit('sandbox:disabled', {}); }
  isSandboxMode(): boolean { return this.sandboxMode; }

  // -----------------------------------------------------------------------
  // [1] Fork
  // -----------------------------------------------------------------------

  fork(request: TimelineForkRequest, parentId?: string): Timeline {
    this.enforceBudget(request, parentId);

    // Derive depth from parent's already-stored depth — O(1) instead of O(depth) walk.
    const depth = parentId ? (this.timelines.get(parentId)?.depth ?? 0) + 1 : 0;

    const timeline: Timeline = {
      id: uuid(),
      name: request.name,
      parentId: parentId ?? null,
      depth,
      intents: [...request.intents],
      shadowResults: [],
      predictedDelta: { before: {}, after: {}, changes: [] },
      confidence: 0,
      score: 0,
      scoreBreakdown: [],
      risk: { level: 'none', factors: [], score: 0, requiresApproval: false, mitigations: [] },
      phase: 'created',
      createdAt: Date.now(),
      evaluationCostMs: 0,
      traces: [],
      metadata: { ...request.metadata },
    };

    this.timelines.set(timeline.id, timeline);

    // Maintain child index for O(1) getChildren() lookups.
    if (parentId) {
      let children = this.childIndex.get(parentId);
      if (!children) { children = new Set(); this.childIndex.set(parentId, children); }
      children.add(timeline.id);
    }

    this.emit('timeline:forked', { timelineId: timeline.id, name: timeline.name, intentCount: timeline.intents.length, depth });
    return timeline;
  }

  // -----------------------------------------------------------------------
  // [2] Evaluate
  // -----------------------------------------------------------------------

  async evaluate(timelineId: string): Promise<Timeline> {
    const timeline = this.requireTimeline(timelineId);
    if (!this.execModule) throw new Error('ExecModule not set.');

    timeline.phase = 'evaluating';
    this.emit('timeline:evaluating', { timelineId, name: timeline.name });

    const evalStart = Date.now();
    const allChanges: DiffEntry[] = [];
    let combinedBefore: Record<string, unknown> = {};
    let combinedAfter: Record<string, unknown> = {};
    let totalRiskScore = 0;
    let maxRiskLevel: RiskLevel = 'none';

    for (let i = 0; i < timeline.intents.length; i++) {
      // Time budget
      if (Date.now() - evalStart > this.budget.maxExplorationMs) {
        this.recordPrevented(timeline, 'budget_exceeded',
          `Time limit (${this.budget.maxExplorationMs}ms) exceeded at step ${i + 1}.`);
        break;
      }

      const intent = timeline.intents[i];
      const surface = this.surfaces.get(intent.surface);

      if (!surface) {
        timeline.shadowResults.push(this.failedShadowResult(intent, `Surface "${intent.surface}" not found`));
        continue;
      }

      const plan = this.buildPlanForIntent(intent, surface);
      const shadowResult = await this.execModule.shadow(plan, surface);
      timeline.shadowResults.push(shadowResult);

      if (shadowResult.predictedDelta) {
        if (i === 0) combinedBefore = { ...shadowResult.predictedDelta.before };
        combinedAfter = { ...combinedAfter, ...shadowResult.predictedDelta.after };
        allChanges.push(...shadowResult.predictedDelta.changes);
      }

      totalRiskScore += shadowResult.risk.score;
      if (RISK_WEIGHT[shadowResult.risk.level] > RISK_WEIGHT[maxRiskLevel]) {
        maxRiskLevel = shadowResult.risk.level;
      }

      this.emit('timeline:step:evaluated', {
        timelineId, step: i + 1, total: timeline.intents.length,
        status: shadowResult.status, confidence: shadowResult.confidence,
      });

      // [12] Multi-strategy pruning heuristics
      if (i > 0 && this.shouldEarlyPrune(timeline, i, shadowResult)) {
        this.recordPrevented(timeline, 'early_pruned',
          `Pruned at step ${i + 1}: failed pruning heuristics.`);
        break;
      }
    }

    // Aggregates
    timeline.predictedDelta = { before: combinedBefore, after: combinedAfter, changes: allChanges };
    const successfulResults = timeline.shadowResults.filter(r => r.status === 'success');
    // Geometric mean of per-step confidences so that a long timeline of
    // high-confidence steps doesn't underflow to near-zero (e.g. 0.9^20 ≈ 0.12).
    timeline.confidence = successfulResults.length > 0
      ? Math.pow(
          successfulResults.reduce((acc, r) => acc * r.confidence, 1),
          1 / successfulResults.length,
        )
      : 0;

    timeline.risk = {
      level: maxRiskLevel,
      factors: timeline.shadowResults.flatMap(r => r.risk.factors),
      score: timeline.intents.length > 0 ? totalRiskScore / timeline.intents.length : 0,
      requiresApproval: timeline.shadowResults.some(r => r.risk.requiresApproval),
      mitigations: timeline.shadowResults.flatMap(r => r.risk.mitigations),
    };

    // [3] Score with normalized weights + reversibility dimension
    timeline.scoreBreakdown = this.scoreTimeline(timeline);
    timeline.score = timeline.scoreBreakdown.reduce((sum, dim) => sum + dim.score * dim.weight, 0);

    timeline.phase = 'evaluated';
    timeline.evaluatedAt = Date.now();
    timeline.evaluationCostMs = Date.now() - evalStart;

    this.emit('timeline:evaluated', {
      timelineId, name: timeline.name,
      score: round2(timeline.score), confidence: round2(timeline.confidence),
      risk: timeline.risk.level, costMs: timeline.evaluationCostMs,
    });

    // Auto-prevent dangerous timelines
    if (RISK_WEIGHT[timeline.risk.level] >= RISK_WEIGHT['critical']) {
      this.recordPrevented(timeline, 'high_risk', `Risk "${timeline.risk.level}" is too dangerous.`);
    } else if (timeline.confidence < 0.1) {
      this.recordPrevented(timeline, 'low_confidence', `Confidence ${(timeline.confidence * 100).toFixed(1)}% too low.`);
    } else if (successfulResults.length === 0 && timeline.intents.length > 0) {
      this.recordPrevented(timeline, 'shadow_failed', 'All shadow executions failed.');
    }

    return timeline;
  }

  // -----------------------------------------------------------------------
  // [15] Explore — the main high-level API
  // -----------------------------------------------------------------------

  async explore(requests: TimelineForkRequest[]): Promise<TemporalBranchResult> {
    const startMs = Date.now();
    this.preventedFutures = [];
    this.nonSelectionProofs = [];

    const timelines = requests.map(req => this.fork(req));
    this.emit('temporal:exploring', { timelineCount: timelines.length, names: timelines.map(t => t.name) });

    const evaluated = await Promise.all(timelines.map(t => this.evaluate(t.id)));
    const comparison = this.compare(evaluated.map(t => t.id));

    // Record prevented futures for non-winners
    for (const tl of evaluated) {
      if (tl.id !== comparison.winner.id && !this.preventedFutures.find(p => p.timelineId === tl.id)) {
        this.recordPrevented(tl, 'outscored',
          `Outscored by "${comparison.winner.name}" (${round2(comparison.winner.score)} vs ${round2(tl.score)}).`);
      }
    }

    // Build non-selection proofs
    for (const tl of evaluated) {
      if (tl.id !== comparison.winner.id) {
        this.nonSelectionProofs.push(this.buildNonSelectionProof(tl, comparison.winner));
      }
    }

    // Chain all proof hashes for tamper evidence
    const explorationProofHash = this.chainProofHashes(this.nonSelectionProofs);

    // Counterfactual with pairwise diffs
    const counterfactual = this.buildCounterfactualAnalysis(comparison.winner, evaluated);

    // Statistical summary
    const stats = this.computeExplorationStats(evaluated, startMs);

    this.emit('temporal:explored', {
      winner: comparison.winner.name, winnerScore: comparison.winner.score,
      preventedCount: this.preventedFutures.length,
      proofHash: explorationProofHash.slice(0, 16),
      durationMs: Date.now() - startMs,
    });

    return {
      timelines: evaluated,
      comparison,
      preventedFutures: [...this.preventedFutures],
      nonSelectionProofs: [...this.nonSelectionProofs],
      counterfactual,
      explorationProofHash,
      stats,
      durationMs: Date.now() - startMs,
    };
  }

  // -----------------------------------------------------------------------
  // [15] Future Search Engine
  // -----------------------------------------------------------------------

  searchFutures(query: {
    minScore?: number;
    maxRisk?: RiskLevel;
    minConfidence?: number;
    phase?: TimelinePhase;
    nameContains?: string;
    surfaceId?: string;
  }): Timeline[] {
    let results = Array.from(this.timelines.values());
    if (query.minScore !== undefined) results = results.filter(t => t.score >= query.minScore!);
    if (query.maxRisk !== undefined) results = results.filter(t => RISK_WEIGHT[t.risk.level] <= RISK_WEIGHT[query.maxRisk!]);
    if (query.minConfidence !== undefined) results = results.filter(t => t.confidence >= query.minConfidence!);
    if (query.phase !== undefined) results = results.filter(t => t.phase === query.phase);
    if (query.nameContains !== undefined) results = results.filter(t => t.name.toLowerCase().includes(query.nameContains!.toLowerCase()));
    if (query.surfaceId !== undefined) results = results.filter(t => t.intents.some(i => i.surface === query.surfaceId));
    return results.sort((a, b) => b.score - a.score);
  }

  /** Statistical summary across all explored futures. */
  summarizeFutures(): ExplorationStats | undefined {
    const evaluated = Array.from(this.timelines.values()).filter(t => t.phase !== 'created');
    if (evaluated.length === 0) return undefined;
    return this.computeExplorationStats(evaluated, 0);
  }

  /**
   * Clear per-exploration state (prevented futures, non-selection proofs).
   * Call this before a fresh `explore()` cycle when you want a clean slate
   * instead of the automatic reset that happens inside `explore()`.
   */
  clearExploration(): void {
    this.preventedFutures = [];
    this.nonSelectionProofs = [];
  }

  // -----------------------------------------------------------------------
  // Compare + [10] Explanation + [19] Risk-Aware Selection
  // -----------------------------------------------------------------------

  compare(timelineIds: string[]): TimelineComparison {
    const timelines = timelineIds.map(id => this.requireTimeline(id));

    const matrix: Record<string, Record<string, number>> = {};
    for (const tl of timelines) {
      for (const dim of tl.scoreBreakdown) {
        if (!matrix[dim.dimension]) matrix[dim.dimension] = {};
        matrix[dim.dimension][tl.id] = dim.score;
      }
    }

    // Risk-aware sort: score first, risk tiebreaker, then reversibility tiebreaker
    const ranked = [...timelines].sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) < 1) {
        const riskDiff = RISK_WEIGHT[a.risk.level] - RISK_WEIGHT[b.risk.level];
        if (riskDiff !== 0) return riskDiff;
        // Prefer higher reversibility
        const aRev = a.scoreBreakdown.find(d => d.dimension === 'reversibility')?.score ?? 0;
        const bRev = b.scoreBreakdown.find(d => d.dimension === 'reversibility')?.score ?? 0;
        return bRev - aRev;
      }
      return scoreDiff;
    });

    const winner = ranked[0];
    const reasoning = this.generateReasoning(ranked);
    this.emit('timeline:compared', { rankedNames: ranked.map(t => t.name), winner: winner.name });

    return { ranked, winner, matrix, reasoning, timestamp: Date.now() };
  }

  // -----------------------------------------------------------------------
  // [7] Reality Merge Requests — with quorum + expiry
  // -----------------------------------------------------------------------

  createMergeRequest(timelineId: string, author: ActorIdentity, title?: string): RealityMergeRequest {
    const timeline = this.requireTimeline(timelineId);
    const actionDiffs = this.buildActionDiffs(timeline);
    const safetyGate = this.runSafetyGateSync(timeline);

    const mr: RealityMergeRequest = {
      id: uuid(),
      timelineId,
      timelineName: timeline.name,
      author,
      status: 'open',
      title: title ?? `Merge timeline "${timeline.name}" into reality`,
      description: this.generateMergeDescription(timeline, actionDiffs),
      predictedDelta: timeline.predictedDelta,
      actionDiffs,
      score: timeline.score,
      scoreBreakdown: timeline.scoreBreakdown,
      risk: timeline.risk,
      reviews: [],
      requiredApprovals: this.defaultQuorum,
      safetyGate,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: this.defaultMergeRequestTtlMs > 0 ? Date.now() + this.defaultMergeRequestTtlMs : 0,
    };

    this.mergeRequests.set(mr.id, mr);
    this.emit('mergerequest:created', { mrId: mr.id, title: mr.title, quorum: mr.requiredApprovals });
    return mr;
  }

  reviewMergeRequest(mrId: string, review: MergeReview): RealityMergeRequest {
    const mr = this.mergeRequests.get(mrId);
    if (!mr) throw new Error(`Merge request "${mrId}" not found.`);

    // Check expiry
    if (mr.expiresAt > 0 && Date.now() > mr.expiresAt) {
      mr.status = 'cancelled';
      mr.updatedAt = Date.now();
      this.emit('mergerequest:expired', { mrId });
      return mr;
    }

    mr.reviews.push(review);
    mr.updatedAt = Date.now();

    if (review.verdict === 'reject') {
      mr.status = 'rejected';
      mr.rejectionReason = review.comment;
    } else if (review.verdict === 'approve') {
      // Check quorum
      const approvalCount = mr.reviews.filter(r => r.verdict === 'approve').length;
      if (approvalCount >= mr.requiredApprovals) {
        mr.status = 'approved';
      } else {
        mr.status = 'reviewing';
      }
    }

    this.emit('mergerequest:reviewed', { mrId, verdict: review.verdict, approvals: mr.reviews.filter(r => r.verdict === 'approve').length, quorum: mr.requiredApprovals });
    return mr;
  }

  getMergeRequest(mrId: string): RealityMergeRequest | undefined { return this.mergeRequests.get(mrId); }

  listMergeRequests(status?: MergeRequestStatus): RealityMergeRequest[] {
    const all = Array.from(this.mergeRequests.values());
    return status ? all.filter(mr => mr.status === status) : all;
  }

  // -----------------------------------------------------------------------
  // [4] Merge — with [13] revalidation + [20] safety gate
  // -----------------------------------------------------------------------

  async merge(timelineId: string): Promise<Timeline> {
    const timeline = this.requireTimeline(timelineId);
    if (!this.execModule) throw new Error('ExecModule not set.');

    if (timeline.phase !== 'evaluated' && timeline.phase !== 'selected') {
      throw new Error(`Cannot merge timeline in phase "${timeline.phase}".`);
    }

    if (this.sandboxMode) {
      this.emit('timeline:merge:blocked:sandbox', { timelineId, name: timeline.name });
      return timeline;
    }

    // [20] + [13] Full async safety gate including drift check
    const safetyGate = await this.runSafetyGate(timeline);
    if (safetyGate.status === 'failed') {
      const failedChecks = safetyGate.checks.filter(c => c.status === 'failed').map(c => c.name);
      this.emit('timeline:merge:blocked:safetygate', { timelineId, failedChecks });
      this.recordPrevented(timeline, 'policy_denied', `Safety gate failed: ${failedChecks.join(', ')}`);
      return timeline;
    }

    // Pre-flight: a merge must be atomic. Every intent has to be committable
    // (known surface + successful shadow) before we apply ANY of them. If even
    // one intent cannot be committed we refuse the whole timeline instead of
    // silently skipping it and reporting a partially-applied timeline as a full
    // success.
    const uncommittable: number[] = [];
    for (let i = 0; i < timeline.intents.length; i++) {
      const intent = timeline.intents[i];
      const surface = this.surfaces.get(intent.surface);
      const shadowResult = timeline.shadowResults[i];
      if (!surface || !shadowResult || shadowResult.status !== 'success') {
        uncommittable.push(i + 1);
      }
    }
    if (uncommittable.length > 0) {
      this.emit('timeline:merge:blocked:incomplete', { timelineId, steps: uncommittable });
      this.recordPrevented(timeline, 'shadow_failed',
        `Refusing non-atomic merge: step(s) ${uncommittable.join(', ')} have no successful shadow result or surface.`);
      timeline.phase = 'evaluated';
      return timeline;
    }

    timeline.phase = 'committing';
    this.emit('timeline:merging', { timelineId, name: timeline.name });

    const committedTraces: TraceRecord[] = [];

    for (let i = 0; i < timeline.intents.length; i++) {
      const intent = timeline.intents[i];
      const surface = this.surfaces.get(intent.surface)!;
      const shadowResult = timeline.shadowResults[i];

      try {
        const trace = await this.commitIntent(intent, surface, shadowResult);
        committedTraces.push(trace);
        timeline.traces.push(trace);

        if (trace.status !== 'committed') {
          // A policy denial / approval rejection / failed commit blocks the
          // merge. Record it as a prevented future and roll back prior commits.
          this.emit('timeline:merge:blocked', { timelineId, step: i + 1, status: trace.status });
          this.recordPrevented(timeline, 'policy_denied',
            `Commit blocked at step ${i + 1} (status: ${trace.status}).`);
          // Rollback in reverse
          for (let j = committedTraces.length - 2; j >= 0; j--) {
            const ct = committedTraces[j];
            if (ct.commitResult?.rollbackToken) {
              try { await this.execModule.rollback(ct.commitResult.rollbackToken.id); } catch { /* best effort */ }
            }
          }
          timeline.phase = 'evaluated';
          return timeline;
        }
      } catch (err) {
        this.emit('timeline:merge:error', { timelineId, step: i + 1, error: String(err) });
        timeline.phase = 'evaluated';
        return timeline;
      }
    }

    timeline.phase = 'committed';
    timeline.committedAt = Date.now();

    // Update associated merge requests
    for (const mr of this.mergeRequests.values()) {
      if (mr.timelineId === timelineId && mr.status !== 'rejected') {
        mr.status = 'merged';
        mr.mergedAt = Date.now();
        mr.updatedAt = Date.now();
      }
    }

    this.emit('timeline:merged', { timelineId, name: timeline.name, committed: committedTraces.length });
    return timeline;
  }

  /**
   * Commit a single intent of a winning timeline. When a kernel is wired, the
   * commit is routed through the full safety lifecycle (identity, risk, policy,
   * blast radius, approval, shadow, commit) so the temporal path cannot bypass
   * policy. Without a kernel, it falls back to committing the pre-computed
   * shadow result directly.
   */
  private async commitIntent(
    intent: ActionIntent,
    surface: Surface,
    shadowResult: ShadowResult,
  ): Promise<TraceRecord> {
    if (this.kernel) {
      return this.kernel.execute(intent);
    }
    const commitResult = await this.execModule!.commit(shadowResult, surface);
    return {
      id: uuid(), intentId: intent.id, actor: intent.initiator,
      surface: intent.surface, intent, shadowResult, commitResult,
      events: [], startedAt: Date.now(), completedAt: Date.now(),
      status: commitResult.status === 'committed' ? 'committed' : 'failed',
    };
  }

  // -----------------------------------------------------------------------
  // [5] Prune + Select
  // -----------------------------------------------------------------------

  prune(timelineId: string): void {
    const tl = this.requireTimeline(timelineId);
    if (tl.phase === 'committed') throw new Error('Cannot prune committed timeline.');
    tl.phase = 'pruned';
    // Cascade prune children
    for (const child of this.getChildren(timelineId)) {
      if (child.phase !== 'committed') { child.phase = 'pruned'; }
    }
    this.emit('timeline:pruned', { timelineId, name: tl.name });
  }

  select(timelineId: string): Timeline {
    const tl = this.requireTimeline(timelineId);
    tl.phase = 'selected';
    this.emit('timeline:selected', { timelineId, name: tl.name, score: tl.score });
    return tl;
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  getTimeline(id: string): Timeline | undefined { return this.timelines.get(id); }
  listTimelines(phase?: TimelinePhase): Timeline[] {
    const all = Array.from(this.timelines.values());
    return phase ? all.filter(t => t.phase === phase) : all;
  }
  getChildren(parentId: string): Timeline[] {
    const ids = this.childIndex.get(parentId);
    if (!ids || ids.size === 0) return [];
    return Array.from(ids)
      .map(id => this.timelines.get(id))
      .filter((t): t is Timeline => t !== undefined);
  }
  getPreventedFutures(): PreventedFuture[] { return [...this.preventedFutures]; }
  getNonSelectionProofs(): NonSelectionProof[] { return [...this.nonSelectionProofs]; }

  // -----------------------------------------------------------------------
  // [16] Action Diffs — with content preview
  // -----------------------------------------------------------------------

  buildActionDiffs(timeline: Timeline): RealityActionDiff[] {
    const diffs: RealityActionDiff[] = [];

    for (let i = 0; i < timeline.intents.length; i++) {
      const intent = timeline.intents[i];
      const shadow = timeline.shadowResults[i];
      const sideEffects: string[] = [];
      if (shadow) {
        const snap = shadow.evidence.find(e => e.type === 'snapshot');
        const se = (snap?.data as any)?.sideEffects;
        if (Array.isArray(se)) sideEffects.push(...se);
      }

      const surface = this.surfaces.get(intent.surface);
      const cap = surface?.capabilities.find(c => c.action === intent.action);

      // Content preview for write-type actions
      let contentPreview: string | undefined;
      let estimatedSize: number | undefined;
      const content = intent.params.content;
      if (typeof content === 'string') {
        contentPreview = content.length > 200 ? content.slice(0, 200) + '...' : content;
        estimatedSize = Buffer.byteLength(content, 'utf-8');
      }

      diffs.push({
        intentId: intent.id,
        surfaceId: intent.surface,
        action: intent.action,
        params: intent.params,
        changes: shadow?.predictedDelta?.changes ?? [],
        sideEffects,
        riskLevel: cap?.riskLevel ?? shadow?.risk?.level ?? 'medium',
        reversible: cap?.reversible ?? false,
        rollbackAction: inferRollbackAction(intent.action),
        contentPreview,
        estimatedSize,
      });
    }
    return diffs;
  }

  // -----------------------------------------------------------------------
  // [17] Multi-Strategy Planning — with auto-inference
  // -----------------------------------------------------------------------

  generateStrategies(
    baseIntent: ActionIntent,
    variants: Array<{ name: string; paramOverrides: Record<string, unknown>; metadata?: Record<string, unknown> }>,
  ): TimelineForkRequest[] {
    return variants.map(v => ({
      name: v.name,
      intents: [{ ...baseIntent, id: uuid(), params: { ...baseIntent.params, ...v.paramOverrides } }],
      metadata: v.metadata,
    }));
  }

  /** Auto-infer strategy variants from a single intent. */
  autoStrategies(intent: ActionIntent): TimelineForkRequest[] {
    const strategies: TimelineForkRequest[] = [];

    // Always include the original as "default"
    strategies.push({
      name: 'default',
      intents: [{ ...intent, id: uuid() }],
      metadata: { auto: true, strategy: 'default' },
    });

    // If it's a write action, generate minimal and verbose variants
    if (intent.action.includes('write') && typeof intent.params.content === 'string') {
      const content = intent.params.content as string;

      // Minimal variant: first line only
      const firstLine = content.split('\n')[0];
      if (firstLine !== content) {
        strategies.push({
          name: 'minimal',
          intents: [{ ...intent, id: uuid(), params: { ...intent.params, content: firstLine } }],
          metadata: { auto: true, strategy: 'minimal' },
        });
      }
    }

    // If it's a create/write, add a dry-run variant that only reads
    if (intent.action.includes('write') || intent.action.includes('create')) {
      const readIntent = {
        ...intent,
        id: uuid(),
        action: intent.action.replace('write', 'read').replace('create', 'list'),
        params: { path: intent.params.path },
      };
      strategies.push({
        name: 'read-first',
        intents: [readIntent, { ...intent, id: uuid() }],
        metadata: { auto: true, strategy: 'read-first' },
      });
    }

    return strategies;
  }

  // -----------------------------------------------------------------------
  // Pairwise Timeline Diff
  // -----------------------------------------------------------------------

  diffTimelines(leftId: string, rightId: string): TimelinePairwiseDiff {
    const left = this.requireTimeline(leftId);
    const right = this.requireTimeline(rightId);

    // Dimension comparison
    const leftDims = new Map(left.scoreBreakdown.map(d => [d.dimension, d]));
    const rightDims = new Map(right.scoreBreakdown.map(d => [d.dimension, d]));
    const allDims = new Set([...leftDims.keys(), ...rightDims.keys()]);

    const dimensions: TimelinePairwiseDiff['dimensions'] = [];
    for (const dim of allDims) {
      const ls = leftDims.get(dim)?.score ?? 0;
      const rs = rightDims.get(dim)?.score ?? 0;
      const delta = rs - ls;
      dimensions.push({
        dimension: dim,
        leftScore: ls,
        rightScore: rs,
        delta,
        advantage: Math.abs(delta) < 1 ? 'tied' : delta > 0 ? 'right' : 'left',
      });
    }

    // Change comparison
    const leftPaths = new Set(left.predictedDelta.changes.map(c => c.path));
    const rightPaths = new Set(right.predictedDelta.changes.map(c => c.path));
    const uniqueToLeft = left.predictedDelta.changes.filter(c => !rightPaths.has(c.path));
    const uniqueToRight = right.predictedDelta.changes.filter(c => !leftPaths.has(c.path));
    const common = left.predictedDelta.changes.filter(c => rightPaths.has(c.path));

    // Summary
    const summary: string[] = [];
    const scoreDelta = right.score - left.score;
    summary.push(`Score: "${left.name}" ${round2(left.score)} vs "${right.name}" ${round2(right.score)} (delta: ${scoreDelta > 0 ? '+' : ''}${round2(scoreDelta)})`);

    const leftAdvantages = dimensions.filter(d => d.advantage === 'left').map(d => d.dimension);
    const rightAdvantages = dimensions.filter(d => d.advantage === 'right').map(d => d.dimension);
    if (leftAdvantages.length) summary.push(`"${left.name}" leads in: ${leftAdvantages.join(', ')}`);
    if (rightAdvantages.length) summary.push(`"${right.name}" leads in: ${rightAdvantages.join(', ')}`);
    if (uniqueToLeft.length) summary.push(`${uniqueToLeft.length} change(s) unique to "${left.name}"`);
    if (uniqueToRight.length) summary.push(`${uniqueToRight.length} change(s) unique to "${right.name}"`);

    return {
      leftId, leftName: left.name, rightId, rightName: right.name,
      scoreDelta,
      confidenceDelta: right.confidence - left.confidence,
      dimensions, uniqueToLeft, uniqueToRight, common, summary,
    };
  }

  // -----------------------------------------------------------------------
  // [18] Visualization
  // -----------------------------------------------------------------------

  visualize(timelineIds?: string[]): string {
    const timelines = timelineIds
      ? timelineIds.map(id => this.requireTimeline(id))
      : Array.from(this.timelines.values());

    if (!timelines.length) return '  (no timelines)';

    const lines: string[] = [];
    lines.push('  TEMPORAL BRANCH TREE');
    lines.push('  ' + '='.repeat(60));

    const sorted = [...timelines].sort((a, b) => b.score - a.score);

    for (let i = 0; i < sorted.length; i++) {
      const tl = sorted[i];
      const isWinner = i === 0 && tl.phase !== 'pruned';
      const prefix = isWinner ? '  >> ' : '     ';
      const badge = isWinner ? ' [WINNER]'
        : tl.phase === 'pruned' ? ' [PRUNED]'
        : tl.phase === 'committed' ? ' [COMMITTED]' : '';
      const prevented = this.preventedFutures.find(p => p.timelineId === tl.id);

      lines.push('');
      lines.push(`${prefix}${tl.name}${badge}`);
      lines.push(`${prefix}  Score:      ${bar(tl.score, 20)} ${round2(tl.score)}`);
      lines.push(`${prefix}  Confidence: ${(tl.confidence * 100).toFixed(1)}%`);
      lines.push(`${prefix}  Risk:       ${tl.risk.level} (score: ${Math.round(tl.risk.score)})`);
      lines.push(`${prefix}  Changes:    ${tl.predictedDelta.changes.length} predicted`);
      lines.push(`${prefix}  Steps:      ${tl.intents.length} intents, ${tl.shadowResults.filter(r => r.status === 'success').length} succeeded`);
      lines.push(`${prefix}  Cost:       ${tl.evaluationCostMs}ms`);
      lines.push(`${prefix}  Phase:      ${tl.phase}`);

      if (prevented) {
        lines.push(`${prefix}  Prevented:  ${prevented.reason} — ${prevented.explanation}`);
      }

      if (tl.scoreBreakdown.length) {
        lines.push(`${prefix}  Breakdown:`);
        for (const dim of tl.scoreBreakdown) {
          lines.push(`${prefix}    ${dim.dimension.padEnd(14)} ${bar(dim.score, 10)} ${dim.score.toFixed(1)} (w:${dim.weight.toFixed(2)})`);
        }
      }
    }

    lines.push('');
    lines.push('  ' + '='.repeat(60));
    return lines.join('\n');
  }

  /** Render a side-by-side diff of two timelines. */
  visualizeDiff(leftId: string, rightId: string): string {
    const diff = this.diffTimelines(leftId, rightId);
    const lines: string[] = [];
    lines.push(`  PAIRWISE DIFF: "${diff.leftName}" vs "${diff.rightName}"`);
    lines.push('  ' + '='.repeat(60));
    lines.push('');

    // Dimensions
    lines.push('  Dimension        Left       Right      Delta');
    lines.push('  ' + '-'.repeat(56));
    for (const d of diff.dimensions) {
      const arrow = d.advantage === 'left' ? ' <' : d.advantage === 'right' ? ' >' : ' =';
      lines.push(`  ${d.dimension.padEnd(16)} ${d.leftScore.toFixed(1).padStart(8)}   ${d.rightScore.toFixed(1).padStart(8)}   ${(d.delta > 0 ? '+' : '') + d.delta.toFixed(1).padStart(6)}${arrow}`);
    }
    lines.push('');

    // Score summary
    lines.push(`  Score delta: ${diff.scoreDelta > 0 ? '+' : ''}${round2(diff.scoreDelta)}`);
    lines.push(`  Confidence delta: ${diff.confidenceDelta > 0 ? '+' : ''}${(diff.confidenceDelta * 100).toFixed(1)}%`);
    lines.push('');

    // Changes
    if (diff.uniqueToLeft.length) {
      lines.push(`  Unique to "${diff.leftName}": ${diff.uniqueToLeft.map(c => c.path).join(', ')}`);
    }
    if (diff.uniqueToRight.length) {
      lines.push(`  Unique to "${diff.rightName}": ${diff.uniqueToRight.map(c => c.path).join(', ')}`);
    }
    if (diff.common.length) {
      lines.push(`  Common changes: ${diff.common.map(c => c.path).join(', ')}`);
    }

    lines.push('');
    for (const s of diff.summary) { lines.push(`  ${s}`); }
    lines.push('  ' + '='.repeat(60));
    return lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // [20] Safety Gate — with custom checks
  // -----------------------------------------------------------------------

  async runSafetyGate(timeline: Timeline): Promise<SafetyGateResult> {
    const checks: SafetyGateCheck[] = [
      this.checkRiskLevel(timeline),
      this.checkConfidence(timeline),
      this.checkShadowSuccess(timeline),
      await this.checkRealityDrift(timeline),
      this.checkBudget(timeline),
    ];

    // Custom checks
    for (const custom of this.customGateChecks) {
      try {
        const status = custom.evaluate(timeline);
        checks.push({ name: custom.name, status, description: custom.description, custom: true });
      } catch (err) {
        checks.push({ name: custom.name, status: 'warning', description: custom.description, detail: `Error: ${err}`, custom: true });
      }
    }

    const overall: SafetyGateStatus = checks.some(c => c.status === 'failed') ? 'failed'
      : checks.some(c => c.status === 'warning') ? 'warning' : 'passed';

    return { status: overall, checks, evaluatedAt: Date.now(), asyncChecksRun: true };
  }

  private runSafetyGateSync(timeline: Timeline): SafetyGateResult {
    const checks: SafetyGateCheck[] = [
      this.checkRiskLevel(timeline),
      this.checkConfidence(timeline),
      this.checkShadowSuccess(timeline),
      this.checkBudget(timeline),
    ];

    for (const custom of this.customGateChecks) {
      try {
        checks.push({ name: custom.name, status: custom.evaluate(timeline), description: custom.description, custom: true });
      } catch { /* skip */ }
    }

    const overall: SafetyGateStatus = checks.some(c => c.status === 'failed') ? 'failed'
      : checks.some(c => c.status === 'warning') ? 'warning' : 'passed';

    return { status: overall, checks, evaluatedAt: Date.now(), asyncChecksRun: false };
  }

  private checkRiskLevel(tl: Timeline): SafetyGateCheck {
    const w = RISK_WEIGHT[tl.risk.level];
    return {
      name: 'risk_level',
      status: w >= 4 ? 'failed' : w >= 3 ? 'warning' : 'passed',
      description: 'Aggregate risk within acceptable bounds',
      detail: `Risk: ${tl.risk.level} (score: ${Math.round(tl.risk.score)})`,
    };
  }

  private checkConfidence(tl: Timeline): SafetyGateCheck {
    return {
      name: 'confidence',
      status: tl.confidence < 0.3 ? 'failed' : tl.confidence < 0.7 ? 'warning' : 'passed',
      description: 'Shadow confidence meets threshold',
      detail: `Confidence: ${(tl.confidence * 100).toFixed(1)}%`,
    };
  }

  private checkShadowSuccess(tl: Timeline): SafetyGateCheck {
    const s = tl.shadowResults.filter(r => r.status === 'success').length;
    const t = tl.intents.length;
    return {
      name: 'shadow_success',
      status: s === t && t > 0 ? 'passed' : s === 0 ? 'failed' : 'warning',
      description: 'All shadow executions succeeded',
      detail: `${s}/${t} steps succeeded`,
    };
  }

  private async checkRealityDrift(tl: Timeline): Promise<SafetyGateCheck> {
    if (!this.stateProvider) {
      return { name: 'reality_drift', status: 'warning', description: 'No drift since shadow', detail: 'No state provider — cannot verify' };
    }
    try {
      for (const intent of tl.intents) {
        const current = await this.stateProvider.getActualState(intent.surface);
        for (const change of tl.predictedDelta.changes) {
          if (JSON.stringify(current[change.path]) !== JSON.stringify(tl.predictedDelta.before[change.path])) {
            return { name: 'reality_drift', status: 'failed', description: 'No drift since shadow', detail: `Drift at "${change.path}"` };
          }
        }
      }
      return { name: 'reality_drift', status: 'passed', description: 'No drift since shadow', detail: 'Reality matches shadow assumptions' };
    } catch (err) {
      return { name: 'reality_drift', status: 'warning', description: 'No drift since shadow', detail: `Check error: ${err}` };
    }
  }

  private checkBudget(tl: Timeline): SafetyGateCheck {
    const total = Array.from(this.timelines.values()).reduce((s, t) => s + t.intents.length, 0);
    return {
      name: 'budget',
      status: total > this.budget.maxTotalIntents ? 'warning' : 'passed',
      description: 'Within budget limits',
      detail: `${total}/${this.budget.maxTotalIntents} total intents`,
    };
  }

  // -----------------------------------------------------------------------
  // [3] Scoring — normalized weights + reversibility dimension
  // -----------------------------------------------------------------------

  private scoreTimeline(timeline: Timeline): TimelineScoreDimension[] {
    const raw: Array<{ dimension: string; score: number; rawWeight: number; rationale: string }> = [];

    // 1. Confidence
    raw.push({ dimension: 'confidence', score: timeline.confidence * 100, rawWeight: this.scoring.confidence, rationale: `Shadow confidence: ${(timeline.confidence * 100).toFixed(1)}%` });

    // 2. Safety
    raw.push({ dimension: 'safety', score: RISK_SCORE[timeline.risk.level] ?? 50, rawWeight: this.scoring.safety, rationale: `Risk: ${timeline.risk.level} (${timeline.risk.score})` });

    // 3. Minimality
    const totalSE = timeline.shadowResults.reduce((sum, r) => {
      const se = (r.evidence.find(e => e.type === 'snapshot')?.data as any)?.sideEffects;
      return sum + (Array.isArray(se) ? se.length : 0);
    }, 0);
    raw.push({ dimension: 'minimality', score: Math.max(0, 100 - totalSE * 10), rawWeight: this.scoring.minimality, rationale: `${totalSE} side effect(s)` });

    // 4. Completeness
    const succ = timeline.shadowResults.filter(r => r.status === 'success').length;
    raw.push({ dimension: 'completeness', score: timeline.intents.length > 0 ? (succ / timeline.intents.length) * 100 : 0, rawWeight: this.scoring.completeness, rationale: `${succ}/${timeline.intents.length} succeeded` });

    // 5. Speed
    const dur = timeline.shadowResults.reduce((s, r) => s + r.durationMs, 0);
    raw.push({ dimension: 'speed', score: Math.max(0, 100 - Math.log10(Math.max(1, dur / 100)) * 30), rawWeight: this.scoring.speed, rationale: `${dur}ms total` });

    // 6. Reversibility — % of actions that are reversible
    const totalActions = timeline.intents.length;
    const reversibleCount = timeline.intents.reduce((count, intent) => {
      const surface = this.surfaces.get(intent.surface);
      const cap = surface?.capabilities.find(c => c.action === intent.action);
      // Pass the surface so the shared helper can use capability-declared rollbacks.
      return count + (cap?.reversible || inferRollbackAction(intent.action, surface) ? 1 : 0);
    }, 0);
    const revScore = totalActions > 0 ? (reversibleCount / totalActions) * 100 : 100;
    raw.push({ dimension: 'reversibility', score: revScore, rawWeight: this.scoring.reversibility, rationale: `${reversibleCount}/${totalActions} reversible` });

    // 7. Custom dimensions
    if (this.scoring.custom) {
      for (const c of this.scoring.custom) {
        try {
          raw.push({ dimension: c.name, score: clamp(c.evaluate(timeline), 0, 100), rawWeight: c.weight, rationale: `Custom: ${c.name}` });
        } catch { /* skip */ }
      }
    }

    // Normalize weights so they sum to 1.0
    const totalWeight = raw.reduce((s, d) => s + d.rawWeight, 0);
    return raw.map(d => ({
      dimension: d.dimension,
      score: d.score,
      weight: totalWeight > 0 ? d.rawWeight / totalWeight : 0,
      rationale: d.rationale,
    }));
  }

  // -----------------------------------------------------------------------
  // [11] Budget enforcement
  // -----------------------------------------------------------------------

  private enforceBudget(request: TimelineForkRequest, parentId?: string): void {
    const active = Array.from(this.timelines.values()).filter(t => t.phase !== 'pruned');
    if (active.length >= this.budget.maxTimelines) {
      throw new Error(`Budget: max ${this.budget.maxTimelines} timelines (${active.length} active).`);
    }
    if (parentId) {
      // Use the parent's already-stored depth — O(1), no re-traversal.
      const parent = this.timelines.get(parentId);
      const childDepth = parent ? parent.depth + 1 : 1;
      if (childDepth >= this.budget.maxDepth) {
        throw new Error(`Budget: max depth ${this.budget.maxDepth} (would be: ${childDepth}).`);
      }
    }
    const total = Array.from(this.timelines.values()).reduce((s, t) => s + t.intents.length, 0) + request.intents.length;
    if (total > this.budget.maxTotalIntents) throw new Error(`Budget: max ${this.budget.maxTotalIntents} intents (would be ${total}).`);
  }

  // -----------------------------------------------------------------------
  // [12] Multi-strategy pruning heuristics
  // -----------------------------------------------------------------------

  private shouldEarlyPrune(timeline: Timeline, stepIndex: number, latestResult: ShadowResult): boolean {
    // Strategy 1: Score threshold — partial score using normalized weights so
    // the threshold is always in the same 0–100 range as the final score.
    if (this.pruningStrategies.has('score_threshold')) {
      const partial = timeline.shadowResults.slice(0, stepIndex + 1);
      const partialSucc = partial.filter(r => r.status === 'success');
      // Geometric mean for consistency with the evaluate() confidence formula.
      const partialConf = partialSucc.length > 0
        ? Math.pow(partialSucc.reduce((a, r) => a * r.confidence, 1), 1 / partialSucc.length)
        : 0;
      // Normalize the two sampled dimensions so the max partial score is 100.
      const wSum = this.scoring.confidence + this.scoring.completeness;
      const wConf = wSum > 0 ? this.scoring.confidence / wSum : 0;
      const wComp = wSum > 0 ? this.scoring.completeness / wSum : 0;
      const partialScore = partialConf * 100 * wConf
        + (partialSucc.length / timeline.intents.length) * 100 * wComp;
      if (partialScore < this.budget.earlyPruneThreshold) return true;
    }

    // Strategy 2: Confidence decay — any step drops below minimum
    if (this.pruningStrategies.has('confidence_decay')) {
      if (latestResult.confidence < this.budget.minStepConfidence && latestResult.status === 'success') return true;
    }

    // Strategy 3: Risk ceiling — any step hits max risk
    if (this.pruningStrategies.has('risk_ceiling')) {
      if (RISK_WEIGHT[latestResult.risk.level] >= RISK_WEIGHT[this.budget.maxStepRisk]) return true;
    }

    // Strategy 4: Diminishing returns — score improvement < 1% over last 2 steps
    if (this.pruningStrategies.has('diminishing_returns') && stepIndex >= 2) {
      const results = timeline.shadowResults;
      const prevChanges = results.slice(0, stepIndex).reduce((s, r) => s + r.predictedDelta.changes.length, 0);
      const currChanges = results.slice(0, stepIndex + 1).reduce((s, r) => s + r.predictedDelta.changes.length, 0);
      if (currChanges === prevChanges) return true; // No new changes
    }

    return false;
  }

  // -----------------------------------------------------------------------
  // [6] Counterfactual with pairwise diffs
  // -----------------------------------------------------------------------

  private buildCounterfactualAnalysis(winner: Timeline, all: Timeline[]): CounterfactualAnalysis {
    const selectedOutcome = this.buildOutcome(winner);
    const rejected = all.filter(t => t.id !== winner.id);
    const rejectedOutcomes = rejected.map(t => this.buildOutcome(t));

    const keyDifferences: string[] = [];
    const avoidsRisks: string[] = [];
    const sacrificedBenefits: string[] = [];
    const pairwiseDiffs: TimelinePairwiseDiff[] = [];

    for (const rej of rejected) {
      // Pairwise diff
      pairwiseDiffs.push(this.diffTimelines(winner.id, rej.id));

      if (RISK_WEIGHT[rej.risk.level] > RISK_WEIGHT[winner.risk.level]) {
        avoidsRisks.push(`Avoided ${rej.risk.level}-risk "${rej.name}" (score: ${Math.round(rej.risk.score)}).`);
      }
      if (rej.predictedDelta.changes.length > selectedOutcome.predictedChanges.length) {
        sacrificedBenefits.push(`"${rej.name}": ${rej.predictedDelta.changes.length} changes vs ${selectedOutcome.predictedChanges.length}.`);
      }
      const delta = winner.score - rej.score;
      if (delta > 0) {
        keyDifferences.push(`"${winner.name}" scored ${round2(delta)} higher than "${rej.name}".`);
      }
    }

    if (!keyDifferences.length) keyDifferences.push(`"${winner.name}" was the only viable timeline.`);

    return { selectedOutcome, rejectedOutcomes, keyDifferences, avoidsRisks, sacrificedBenefits, pairwiseDiffs };
  }

  private buildOutcome(tl: Timeline): CounterfactualOutcome {
    const se = tl.shadowResults.reduce((s, r) => {
      const arr = (r.evidence.find(e => e.type === 'snapshot')?.data as any)?.sideEffects;
      return s + (Array.isArray(arr) ? arr.length : 0);
    }, 0);
    return {
      timelineId: tl.id, timelineName: tl.name,
      predictedChanges: tl.predictedDelta.changes,
      risk: tl.risk, confidence: tl.confidence, sideEffectCount: se,
      summary: `"${tl.name}": ${tl.intents.length} action(s), ${tl.predictedDelta.changes.length} change(s), confidence ${(tl.confidence * 100).toFixed(0)}%, risk ${tl.risk.level}.`,
    };
  }

  // -----------------------------------------------------------------------
  // [9] Non-selection proofs — with chain hash
  // -----------------------------------------------------------------------

  private buildNonSelectionProof(loser: Timeline, winner: Timeline): NonSelectionProof {
    const shadowData = loser.shadowResults.map(r => ({
      intentId: r.intentId, status: r.status, confidence: r.confidence,
      changes: r.predictedDelta.changes.length,
    }));
    const shadowResultsHash = createHash('sha256').update(JSON.stringify(shadowData)).digest('hex');

    const loserDims = new Map(loser.scoreBreakdown.map(d => [d.dimension, d]));
    const winnerDims = new Map(winner.scoreBreakdown.map(d => [d.dimension, d]));
    const dimComp: NonSelectionProof['dimensionComparison'] = [];

    for (const [dim, ld] of loserDims) {
      const wd = winnerDims.get(dim);
      dimComp.push({ dimension: dim, thisScore: ld.score, winnerScore: wd?.score ?? 0, delta: (wd?.score ?? 0) - ld.score });
    }

    const worst = [...dimComp].sort((a, b) => b.delta - a.delta)[0];
    const reasoning = worst
      ? `"${loser.name}" lost on ${worst.dimension} (${worst.thisScore.toFixed(1)} vs ${worst.winnerScore.toFixed(1)}). Score: ${round2(loser.score)} vs ${round2(winner.score)}.`
      : `"${loser.name}" outscored: ${round2(loser.score)} vs ${round2(winner.score)}.`;

    return {
      timelineId: loser.id, timelineName: loser.name,
      shadowResultsHash,
      winnerTimelineId: winner.id, winnerTimelineName: winner.name,
      scoreDelta: winner.score - loser.score,
      dimensionComparison: dimComp,
      reasoning,
      timestamp: Date.now(),
    };
  }

  /** Chain all proof hashes into a single Merkle-style exploration hash. */
  private chainProofHashes(proofs: NonSelectionProof[]): string {
    if (proofs.length === 0) return createHash('sha256').update('empty-exploration').digest('hex');

    let running = '';
    for (const proof of proofs) {
      running = createHash('sha256').update(running + proof.shadowResultsHash + proof.timelineId).digest('hex');
    }
    return running;
  }

  // -----------------------------------------------------------------------
  // [8] Prevented futures
  // -----------------------------------------------------------------------

  private recordPrevented(tl: Timeline, reason: PreventionReason, explanation: string): void {
    this.preventedFutures.push({
      timelineId: tl.id, timelineName: tl.name, reason, explanation,
      wouldHaveDone: this.buildActionDiffs(tl),
      avoidedRisk: tl.risk, score: tl.score, timestamp: Date.now(),
    });
    this.emit('future:prevented', { timelineId: tl.id, reason, explanation });
  }

  // -----------------------------------------------------------------------
  // Exploration stats
  // -----------------------------------------------------------------------

  private computeExplorationStats(timelines: Timeline[], startMs: number): ExplorationStats {
    const evaluated = timelines.filter(t => t.phase !== 'created');
    const scores = evaluated.map(t => t.score);
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const variance = scores.length > 0 ? scores.reduce((s, v) => s + (v - avgScore) ** 2, 0) / scores.length : 0;
    const avgConf = evaluated.length > 0 ? evaluated.reduce((s, t) => s + t.confidence, 0) / evaluated.length : 0;

    const riskDist: Record<RiskLevel, number> = { none: 0, low: 0, medium: 0, high: 0, critical: 0 };
    for (const t of evaluated) riskDist[t.risk.level]++;

    const totalIntents = timelines.reduce((s, t) => s + t.intents.length, 0);
    const totalCostMs = evaluated.reduce((s, t) => s + t.evaluationCostMs, 0);
    const budgetUtil = Math.min(1, totalIntents / this.budget.maxTotalIntents);

    return {
      totalTimelines: timelines.length,
      evaluatedCount: evaluated.length,
      preventedCount: this.preventedFutures.length,
      totalIntents,
      totalCostMs,
      avgScore: round2(avgScore),
      scoreStdDev: round2(Math.sqrt(variance)),
      avgConfidence: round2(avgConf),
      riskDistribution: riskDist,
      budgetUtilization: round2(budgetUtil),
    };
  }

  // -----------------------------------------------------------------------
  // Reasoning
  // -----------------------------------------------------------------------

  private generateReasoning(ranked: Timeline[]): string[] {
    if (ranked.length === 0) return ['No timelines to compare.'];
    if (ranked.length === 1) return [`Only one timeline: "${ranked[0].name}" wins by default.`];

    const reasoning: string[] = [];
    const w = ranked[0], r = ranked[1];
    reasoning.push(`Winner: "${w.name}" (score: ${round2(w.score)}) over "${r.name}" (score: ${round2(r.score)}).`);

    const wDims = new Map(w.scoreBreakdown.map(d => [d.dimension, d]));
    const rDims = new Map(r.scoreBreakdown.map(d => [d.dimension, d]));

    for (const [dim, wd] of wDims) {
      const rd = rDims.get(dim);
      if (rd && wd.score > rd.score + 5) reasoning.push(`  "${w.name}" leads on ${dim}: ${wd.score.toFixed(1)} vs ${rd.score.toFixed(1)}.`);
    }
    for (const [dim, rd] of rDims) {
      const wd = wDims.get(dim);
      if (wd && rd.score > wd.score + 5) reasoning.push(`  "${r.name}" better on ${dim}: ${rd.score.toFixed(1)} vs ${wd.score.toFixed(1)}, but overall lower.`);
    }

    if (w.risk.level !== r.risk.level) reasoning.push(`  Risk: "${w.name}" = ${w.risk.level}, "${r.name}" = ${r.risk.level}.`);

    const prevented = this.preventedFutures.filter(p => p.reason !== 'outscored');
    if (prevented.length) reasoning.push(`  ${prevented.length} future(s) prevented before ranking.`);

    return reasoning;
  }

  // -----------------------------------------------------------------------
  // MR description
  // -----------------------------------------------------------------------

  private generateMergeDescription(tl: Timeline, diffs: RealityActionDiff[]): string {
    const lines: string[] = [];
    lines.push(`## Timeline: ${tl.name}`);
    lines.push(`Score: ${round2(tl.score)} | Confidence: ${(tl.confidence * 100).toFixed(1)}% | Risk: ${tl.risk.level} | Cost: ${tl.evaluationCostMs}ms`);
    lines.push('');
    lines.push('### Actions');
    for (const d of diffs) {
      let line = `- **${d.action}** on \`${d.surfaceId}\` — ${d.changes.length} change(s), risk: ${d.riskLevel}`;
      if (d.reversible) line += ' (reversible)';
      if (d.contentPreview) line += `\n  Preview: \`${d.contentPreview.slice(0, 80)}\``;
      lines.push(line);
    }
    lines.push('');
    lines.push(`### Summary`);
    lines.push(`${tl.intents.length} intent(s), ${tl.predictedDelta.changes.length} total change(s), depth ${tl.depth}.`);
    return lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private requireTimeline(id: string): Timeline {
    const tl = this.timelines.get(id);
    if (!tl) throw new Error(`Timeline "${id}" not found.`);
    return tl;
  }

  private buildPlanForIntent(intent: ActionIntent, surface: Surface): ActionPlan {
    if (this.planBuilder) return this.planBuilder.buildPlan(intent, surface);
    return {
      intentId: intent.id,
      steps: [{ id: uuid(), action: intent.action, params: { ...intent.params }, expectedResult: {}, rollbackAction: inferRollbackAction(intent.action) }],
      expectedDelta: { before: {}, after: {}, changes: [] },
      risk: { level: 'none', factors: [], score: 0, requiresApproval: false, mitigations: [] },
      policy: { allowed: true, reason: 'temporal-branch', conditions: [], requiredApprovals: [], maxRiskLevel: 'critical', forceShadow: false, forceHumanReview: false },
      createdAt: Date.now(),
    };
  }

  private failedShadowResult(intent: ActionIntent, error: string): ShadowResult {
    return {
      intentId: intent.id, planId: '', status: 'failure',
      predictedDelta: { before: {}, after: {}, changes: [] },
      evidence: [{ type: 'log', data: { error }, timestamp: Date.now(), confidence: 0, source: 'temporal' }],
      confidence: 0,
      risk: { level: 'critical', factors: [{ type: 'error', severity: 'critical', description: error, mitigatable: false }], score: 100, requiresApproval: true, mitigations: [] },
      timestamp: Date.now(), durationMs: 0,
    };
  }

  private emit(event: string, data: Record<string, unknown>): void {
    for (const listener of [...this.listeners]) {
      try { listener(event, data); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Module helpers
// ---------------------------------------------------------------------------
// Note: inferRollbackAction is imported from '../helpers.js'

function round2(n: number): number { return Math.round(n * 100) / 100; }
function clamp(n: number, min: number, max: number): number { return Math.max(min, Math.min(max, n)); }
function bar(score: number, w: number): string {
  const f = Math.round((score / 100) * w);
  return '[' + '#'.repeat(f) + '.'.repeat(w - f) + ']';
}
