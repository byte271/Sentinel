// ---------------------------------------------------------------------------
// SENTINEL Kernel — Action Orchestration Engine
// ---------------------------------------------------------------------------
// The Kernel is the heart of the system. It receives action intents and
// shepherds them through the full lifecycle:
//
//   discover -> understand state -> create intent -> check safety ->
//   run in shadow -> verify -> create diff -> commit -> record trace ->
//   allow rollback
//
// All capabilities are provided via dependency-injected module interfaces so
// the kernel never couples to concrete implementations.
// ---------------------------------------------------------------------------

import { v4 as uuid } from 'uuid';

import type {
  SentinelConfig,
  SentinelError,
  ActionIntent,
  ActionPlan,
  ActorIdentity,
  CommitResult,
  DiffEntry,
  KernelEvent,
  PolicyDecision,
  RiskAssessment,
  RiskLevel,
  ShadowResult,
  StateSnapshot,
  Surface,
  TraceEvent,
  TraceRecord,
} from './types.js';
import { SentinelErrorImpl, isSentinelError } from './types.js';
import { inferRollbackAction } from '../helpers.js';

// ---------------------------------------------------------------------------
// Module interfaces — dependency-injection contracts
// ---------------------------------------------------------------------------
// The kernel depends on these interfaces rather than concrete implementations.
// Consumers wire up real modules via the corresponding setters.
// ---------------------------------------------------------------------------

/**
 * SafeModule — evaluates risk and policy for an action intent.
 */
export interface SafeModule {
  /** Full policy decision. Accepts optional pre-computed risk assessment. */
  assess(intent: ActionIntent, surface: Surface, riskAssessment?: RiskAssessment): Promise<PolicyDecision>;

  /** Quantitative risk assessment. */
  assessRisk(intent: ActionIntent, surface: Surface): Promise<RiskAssessment>;
}

/**
 * ExecModule — runs shadow executions, commits, and rollbacks.
 */
export interface ExecModule {
  /** Execute the plan in shadow mode (dry-run). */
  shadow(plan: ActionPlan, surface: Surface): Promise<ShadowResult>;

  /** Commit a shadow result for real. */
  commit(shadowResult: ShadowResult, surface: Surface): Promise<CommitResult>;

  /** Rollback a previously committed action using its rollback token id. */
  rollback(rollbackTokenId: string): Promise<CommitResult>;
}

/**
 * TraceModule — records and retrieves full audit traces.
 */
export interface TraceModule {
  /** Persist a trace record. */
  record(trace: TraceRecord): void;

  /** Retrieve a trace by id. */
  get(id: string): TraceRecord | undefined;

  /** List traces, optionally filtered by surface / status. */
  list(filter?: Partial<Pick<TraceRecord, 'surface' | 'status'>>): TraceRecord[];

  /** Append a lifecycle event to an existing trace. */
  addEvent(traceId: string, event: TraceEvent): void;
}

/**
 * InfoModule — surface state management.
 */
export interface InfoModule {
  /** Get the latest known state for a surface. */
  getState(surfaceId: string): Promise<StateSnapshot | undefined>;

  /** Store / update state for a surface. */
  updateState(surfaceId: string, state: StateSnapshot): void;
}

/**
 * IdModule — identity verification and authorization.
 */
export interface IdModule {
  /** Validate that an actor identity is authentic. */
  validate(actor: ActorIdentity): Promise<boolean>;

  /** Authorize an actor to perform a given action on a surface. */
  authorize(actor: ActorIdentity, action: string, surface: { id: string }): Promise<boolean>;
}

/**
 * ApprovalModule — human-in-the-loop approval gateway.
 */
export interface ApprovalModule {
  request(intentId: string, traceId: string, requester: ActorIdentity, approvers: string[], reason: string, risk: RiskAssessment): { id: string; status: string };
  waitForResolution(requestId: string, timeoutMs?: number): Promise<{ status: string; resolvedBy?: string }>;
}

/**
 * BlastRadiusModule — pre-execution impact analysis.
 */
export interface BlastRadiusModule {
  analyze(intentId: string, surfaceId: string, action: string, params: Record<string, unknown>): { directImpact: number; transitiveImpact: number; riskAmplification: number; summary: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Numeric weight for risk levels — used for threshold comparisons. */
const RISK_WEIGHTS: Record<RiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Build an ActionPlan from the raw intent, current state, and safety
 * assessments. This is a pure function with no side-effects.
 */
export function buildPlan(
  intent: ActionIntent,
  _state: StateSnapshot | undefined,
  risk: RiskAssessment,
  policy: PolicyDecision,
  surface?: Surface,
): ActionPlan {
  const emptyDelta = {
    before: {},
    after: {},
    changes: [] as DiffEntry[],
  };

  return {
    intentId: intent.id,
    steps: [
      {
        id: uuid(),
        action: intent.action,
        params: { ...intent.params },
        expectedResult: {},
        rollbackAction: inferRollbackAction(intent.action, surface),
      },
    ],
    expectedDelta: emptyDelta,
    risk,
    policy,
    createdAt: Date.now(),
  };
}

/** Convenience factory for SentinelError. */
function makeError(
  code: string,
  message: string,
  module: string,
  context?: Record<string, unknown>,
  recoverable = false,
): SentinelError {
  return new SentinelErrorImpl(code, message, module, { recoverable, context });
}

/** Create a timestamped TraceEvent. */
function traceEvent(
  type: string,
  data: Record<string, unknown> = {},
  level: TraceEvent['level'] = 'info',
): TraceEvent {
  return { type, timestamp: Date.now(), data, level };
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

export class Kernel {
  // -- Registered surfaces --------------------------------------------------
  private readonly surfaces: Map<string, Surface> = new Map();

  // -- Pluggable modules (set after construction) ---------------------------
  private safeModule: SafeModule | undefined;
  private execModule: ExecModule | undefined;
  private traceModule: TraceModule | undefined;
  private infoModule: InfoModule | undefined;
  private idModule: IdModule | undefined;
  private approvalModule: ApprovalModule | undefined;
  private blastModule: BlastRadiusModule | undefined;

  // -- Typed event bus ------------------------------------------------------
  private eventHandlers: Map<string, Array<(event: KernelEvent) => void>> = new Map();

  // -- Configuration --------------------------------------------------------
  private readonly config: SentinelConfig;

  constructor(config: SentinelConfig) {
    this.config = config;
  }

  // ---- Module setters -----------------------------------------------------

  /** Inject the safety / policy module. */
  setSafeModule(mod: SafeModule): void {
    this.safeModule = mod;
  }

  /** Inject the execution module (shadow, commit, rollback). */
  setExecModule(mod: ExecModule): void {
    this.execModule = mod;
  }

  /** Inject the trace / audit module. */
  setTraceModule(mod: TraceModule): void {
    this.traceModule = mod;
  }

  /** Inject the state-information module. */
  setInfoModule(mod: InfoModule): void {
    this.infoModule = mod;
  }

  /** Inject the identity / authorization module. */
  setIdModule(mod: IdModule): void {
    this.idModule = mod;
  }

  /** Inject the approval gateway module. */
  setApprovalModule(mod: ApprovalModule): void {
    this.approvalModule = mod;
  }

  /** Inject the blast radius analysis module. */
  setBlastModule(mod: BlastRadiusModule): void {
    this.blastModule = mod;
  }

  // ---- Typed event bus ----------------------------------------------------

  /** Register a handler for a specific event type. */
  on(eventType: string, handler: (event: KernelEvent) => void): void {
    let handlers = this.eventHandlers.get(eventType);
    if (!handlers) {
      handlers = [];
      this.eventHandlers.set(eventType, handlers);
    }
    handlers.push(handler);
  }

  /** Unregister a handler for a specific event type. */
  off(eventType: string, handler: (event: KernelEvent) => void): void {
    const handlers = this.eventHandlers.get(eventType);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) {
      handlers.splice(idx, 1);
    }
  }

  /** Emit a KernelEvent to all registered handlers for the given type. */
  private emitKernelEvent(
    type: string,
    traceId: string,
    intentId: string,
    data: Record<string, unknown>,
  ): void {
    const event: KernelEvent = {
      type,
      traceId,
      intentId,
      timestamp: Date.now(),
      data,
    };
    const handlers = this.eventHandlers.get(type);
    if (handlers) {
      for (const handler of [...handlers]) {
        handler(event);
      }
    }
  }

  // ---- Surface management -------------------------------------------------

  /** Register a surface (target system) with the kernel. */
  registerSurface(surface: Surface): void {
    this.surfaces.set(surface.id, surface);
  }

  /** Retrieve a registered surface by its id. */
  getSurface(id: string): Surface | undefined {
    return this.surfaces.get(id);
  }

  /** Return all registered surfaces. */
  listSurfaces(): Surface[] {
    return Array.from(this.surfaces.values());
  }

  // ---- Main execute lifecycle ---------------------------------------------

  /**
   * Execute a full action lifecycle for the given intent.
   *
   * Steps:
   *  1. Validate actor identity  (IdModule)
   *  2. Resolve surface & authorize
   *  3. Get current state         (InfoModule)
   *  4. Assess risk & policy      (SafeModule)
   *  5. If denied, short-circuit with a failed trace
   *  6. Build an ActionPlan
   *  7. Run shadow execution      (ExecModule)
   *  8. Verify shadow result
   *  9. Auto-commit if config allows and shadow is clean
   * 10. Record & return trace     (TraceModule)
   */
  async execute(intent: ActionIntent): Promise<TraceRecord> {
    const traceId = uuid();
    const events: TraceEvent[] = [];

    // Helper: push an event and optionally forward it to the TraceModule.
    const emit = (
      type: string,
      data: Record<string, unknown> = {},
      level: TraceEvent['level'] = 'info',
    ): void => {
      const ev = traceEvent(type, data, level);
      events.push(ev);
      // If the trace has already been recorded we can append via the module.
      if (this.traceModule) {
        try {
          this.traceModule.addEvent(traceId, ev);
        } catch {
          // Trace not yet recorded — safe to ignore.
        }
      }
      // Also emit to the typed event bus.
      this.emitKernelEvent(type, traceId, intent.id, data);
    };

    // Start building the trace shell — fields are filled in as we progress.
    const trace: TraceRecord = {
      id: traceId,
      intentId: intent.id,
      actor: intent.initiator,
      surface: intent.surface,
      intent,
      events,
      startedAt: Date.now(),
      status: 'pending',
    };

    try {
      // ------------------------------------------------------------------
      // Step 1 — Validate actor identity
      // ------------------------------------------------------------------
      emit('identity:validate:start');
      this.requireModule('idModule', this.idModule);
      const identityValid = await this.idModule!.validate(intent.initiator);
      if (!identityValid) {
        throw makeError(
          'IDENTITY_INVALID',
          'Actor identity validation failed.',
          'kernel',
        );
      }
      emit('identity:validate:done', { valid: true });

      // ------------------------------------------------------------------
      // Step 1b — Resolve surface and authorize actor
      // ------------------------------------------------------------------
      emit('identity:authorize:start');
      const surface = this.surfaces.get(intent.surface);
      if (!surface) {
        throw makeError(
          'SURFACE_NOT_FOUND',
          `Surface "${intent.surface}" is not registered.`,
          'kernel',
        );
      }

      // Validate action against surface capabilities
      const capability = surface.capabilities.find((c) => c.action === intent.action);
      if (!capability) {
        throw makeError(
          'ACTION_NOT_ALLOWED',
          `Action "${intent.action}" is not a registered capability on surface "${intent.surface}".`,
          'kernel',
        );
      }

      const authorized = await this.idModule!.authorize(
        intent.initiator,
        intent.action,
        surface,
      );
      if (!authorized) {
        throw makeError(
          'UNAUTHORIZED',
          'Actor is not authorized for this action.',
          'kernel',
        );
      }
      emit('identity:authorize:done', { authorized: true });

      // ------------------------------------------------------------------
      // Step 2 — Get current state
      // ------------------------------------------------------------------
      emit('state:fetch:start');
      this.requireModule('infoModule', this.infoModule);
      const currentState = await this.infoModule!.getState(intent.surface);
      emit('state:fetch:done', {
        hasState: currentState !== undefined,
      });

      // ------------------------------------------------------------------
      // Step 3 — Assess risk
      // ------------------------------------------------------------------
      emit('safety:risk:start');
      this.requireModule('safeModule', this.safeModule);
      const risk = await this.safeModule!.assessRisk(intent, surface);
      emit('safety:risk:done', { level: risk.level, score: risk.score });

      // ------------------------------------------------------------------
      // Step 3b — Blast radius analysis
      // ------------------------------------------------------------------
      if (this.blastModule) {
        emit('blast:analyze:start');
        const blastRadius = this.blastModule.analyze(intent.id, intent.surface, intent.action, intent.params);
        emit('blast:analyze:done', {
          directImpact: blastRadius.directImpact,
          transitiveImpact: blastRadius.transitiveImpact,
          riskAmplification: blastRadius.riskAmplification,
          summary: blastRadius.summary,
        });

        // Amplify risk score based on blast radius
        if (blastRadius.riskAmplification > 1) {
          risk.score = Math.min(100, risk.score * blastRadius.riskAmplification);
        }
      }

      // ------------------------------------------------------------------
      // Step 4 — Assess policy (with amplified risk from blast radius)
      // ------------------------------------------------------------------
      emit('safety:policy:start');
      const policy = await this.safeModule!.assess(intent, surface, risk);
      emit('safety:policy:done', { allowed: policy.allowed });

      // ------------------------------------------------------------------
      // Step 5 — Short-circuit if denied
      // ------------------------------------------------------------------
      if (!policy.allowed) {
        // Check if this needs approval rather than outright denial
        if (policy.requiredApprovals.length > 0 && this.approvalModule) {
          emit('approval:requested', { approvers: policy.requiredApprovals });
          trace.status = 'pending_approval';

          const approvalReq = this.approvalModule.request(
            intent.id,
            traceId,
            intent.initiator,
            policy.requiredApprovals,
            policy.reason,
            risk,
          );

          // Wait for resolution (with timeout from config)
          const resolution = await this.approvalModule.waitForResolution(
            approvalReq.id,
            this.config.maxShadowDurationMs,
          );

          if (resolution.status !== 'approved') {
            trace.status = 'failed';
            trace.completedAt = Date.now();
            emit('approval:denied', { status: resolution.status, resolvedBy: resolution.resolvedBy }, 'warn');
            this.recordTrace(trace);
            return trace;
          }

          emit('approval:approved', { resolvedBy: resolution.resolvedBy });
          // Continue with execution...
        } else {
          trace.status = 'failed';
          trace.completedAt = Date.now();
          emit('policy:denied', { reason: policy.reason }, 'warn');
          if (this.config.traceEnabled) {
            this.recordTrace(trace);
          }
          return trace;
        }
      }

      // ------------------------------------------------------------------
      // Step 6 — Build execution plan
      // ------------------------------------------------------------------
      emit('plan:build:start');
      const plan = buildPlan(intent, currentState, risk, policy, surface);
      trace.plan = plan;
      emit('plan:build:done', { intentId: plan.intentId, stepCount: plan.steps.length });

      // ------------------------------------------------------------------
      // Step 7 — Shadow execution
      // ------------------------------------------------------------------
      emit('exec:shadow:start');
      this.requireModule('execModule', this.execModule);
      const shadowResult = await this.execModule!.shadow(plan, surface);
      trace.shadowResult = shadowResult;
      emit('exec:shadow:done', {
        status: shadowResult.status,
        confidence: shadowResult.confidence,
        changeCount: shadowResult.predictedDelta.changes.length,
      });

      // ------------------------------------------------------------------
      // Step 8 — Verify shadow result
      // ------------------------------------------------------------------
      emit('verify:start');
      this.verifyShadow(shadowResult, risk);
      emit('verify:done', { passed: true });

      // ------------------------------------------------------------------
      // Step 9 — Commit (if allowed by policy and shadow was clean)
      // ------------------------------------------------------------------
      const shouldCommit =
        !this.config.requireShadowFirst || // if shadow-first not required, commit
        (shadowResult.status === 'success' &&
          shadowResult.confidence >= 0.8 &&
          RISK_WEIGHTS[risk.level] <=
            RISK_WEIGHTS[this.config.requireApprovalAbove]);

      if (shouldCommit && !policy.forceShadow) {
        emit('exec:commit:start');
        const commitResult = await this.execModule!.commit(
          shadowResult,
          surface,
        );
        trace.commitResult = commitResult;

        if (commitResult.status === 'committed') {
          trace.status = 'committed';
          emit('exec:commit:done', { intentId: commitResult.intentId });

          // Update stored state from the commit's real delta.
          const newSnapshot: StateSnapshot = {
            surfaceId: intent.surface,
            timestamp: Date.now(),
            data: commitResult.realDelta.after,
            hash: '',
            confidence: shadowResult.confidence,
          };
          this.infoModule!.updateState(intent.surface, newSnapshot);
          emit('state:update:done');
        } else {
          trace.status = 'failed';
          emit('exec:commit:failed', { status: commitResult.status }, 'error');
        }
      } else {
        // Shadow-only — the caller can inspect the trace and commit later.
        trace.status = 'shadow';
        emit('exec:shadow_only', {
          reason: policy.forceShadow
            ? 'policy requires shadow-only mode'
            : this.config.requireShadowFirst
              ? 'shadow-first mode is enabled'
              : 'thresholds not met for auto-commit',
        });
      }

      // ------------------------------------------------------------------
      // Step 10 — Record trace
      // ------------------------------------------------------------------
      trace.completedAt = Date.now();
      this.recordTrace(trace);

      return trace;
    } catch (err) {
      // Catch-all: turn any unexpected error into a failed trace.
      const sentinelError = isSentinelError(err)
        ? err
        : makeError(
            'KERNEL_ERROR',
            (err as Error).message ?? String(err),
            'kernel',
          );

      trace.status = 'failed';
      trace.completedAt = Date.now();
      emit(
        'lifecycle:error',
        { code: sentinelError.code, message: sentinelError.message },
        'error',
      );

      this.recordTrace(trace);

      return trace;
    }
  }

  // ---- Rollback -----------------------------------------------------------

  /**
   * Roll back a previously committed action.
   *
   * @param commitId - The intentId from the CommitResult to undo.
   * @returns The resulting CommitResult with status 'rolled_back' or 'failed'.
   */
  async rollback(commitId: string): Promise<CommitResult> {
    this.requireModule('execModule', this.execModule);
    this.requireModule('traceModule', this.traceModule);

    // Find the trace that contains this commitId so we can retrieve the
    // rollback token that the ExecModule issued during commit.
    const traces = this.traceModule!.list();
    const owningTrace = traces.find(
      (t) => t.commitResult?.intentId === commitId || t.id === commitId,
    );

    if (!owningTrace) {
      throw makeError(
        'ROLLBACK_NO_TRACE',
        `No trace found for commit "${commitId}".`,
        'kernel',
      );
    }

    const rollbackToken = owningTrace.commitResult?.rollbackToken;
    if (!rollbackToken) {
      throw makeError(
        'ROLLBACK_NO_TOKEN',
        'The commit result did not provide a rollback token.',
        'kernel',
      );
    }

    if (!rollbackToken.valid) {
      throw makeError(
        'ROLLBACK_TOKEN_INVALID',
        'The rollback token has been invalidated.',
        'kernel',
      );
    }

    if (rollbackToken.expiresAt && Date.now() > rollbackToken.expiresAt) {
      throw makeError(
        'ROLLBACK_TOKEN_EXPIRED',
        'The rollback token has expired.',
        'kernel',
      );
    }

    const result = await this.execModule!.rollback(rollbackToken.id);

    // Update the trace status to reflect the rollback.
    if (result.status === 'rolled_back') {
      owningTrace.status = 'rolled_back';
      this.traceModule!.addEvent(
        owningTrace.id,
        traceEvent('rollback:done', { commitId }),
      );
    } else {
      this.traceModule!.addEvent(
        owningTrace.id,
        traceEvent('rollback:failed', { commitId }, 'error'),
      );
    }

    // Re-record the updated trace.
    this.traceModule!.record(owningTrace);

    return result;
  }

  // ---- Replay -------------------------------------------------------------

  /**
   * Replay a previously recorded action by re-executing its original intent.
   *
   * @param traceId - The id of the trace to replay.
   * @returns A new TraceRecord for the replayed execution.
   */
  async replay(traceId: string): Promise<TraceRecord> {
    this.requireModule('traceModule', this.traceModule);

    const original = this.traceModule!.get(traceId);
    if (!original) {
      throw makeError(
        'REPLAY_NOT_FOUND',
        `Trace "${traceId}" not found.`,
        'kernel',
      );
    }

    // Reconstruct an ActionIntent from the original trace, assigning a new id.
    const replayIntent: ActionIntent = {
      ...original.intent,
      id: uuid(),
      timestamp: Date.now(),
      metadata: {
        ...original.intent.metadata,
        replayOf: original.intentId,
      },
    };

    return this.execute(replayIntent);
  }

  // ---- Transaction execution ----------------------------------------------

  /**
   * Execute a group of intents as a transaction. All intents are first
   * shadow-executed; if any fails the already-committed traces are rolled back.
   */
  async executeTransaction(intents: ActionIntent[]): Promise<TraceRecord[]> {
    const traces: TraceRecord[] = [];
    const committedTraces: TraceRecord[] = [];

    for (const intent of intents) {
      const trace = await this.execute(intent);
      traces.push(trace);

      if (trace.status === 'committed') {
        committedTraces.push(trace);
      } else if (trace.status === 'failed') {
        // Rollback all previously committed traces in reverse
        for (let i = committedTraces.length - 1; i >= 0; i--) {
          const ct = committedTraces[i];
          if (ct.commitResult?.rollbackToken) {
            try {
              await this.rollback(ct.commitResult.intentId);
            } catch {
              // Best effort rollback
            }
          }
        }
        return traces;
      }
    }

    return traces;
  }

  // ---- Trace access -------------------------------------------------------

  /** Retrieve a trace record by id (delegates to TraceModule). */
  getTrace(traceId: string): TraceRecord | undefined {
    return this.traceModule?.get(traceId);
  }

  // ---- Private helpers ----------------------------------------------------

  /**
   * Ensure a required module has been injected. Throws a clear error if not.
   */
  private requireModule(name: string, mod: unknown): asserts mod {
    if (!mod) {
      throw makeError(
        'MODULE_MISSING',
        `Required module "${name}" has not been set. Call the corresponding setter before executing.`,
        'kernel',
      );
    }
  }

  /**
   * Verify that a shadow result meets minimum quality thresholds.
   * Throws an SentinelError if verification fails.
   */
  private verifyShadow(shadow: ShadowResult, risk: RiskAssessment): void {
    if (shadow.status === 'failure' || shadow.status === 'blocked') {
      throw makeError(
        'SHADOW_FAILED',
        `Shadow execution returned status "${shadow.status}".`,
        'exec',
      );
    }

    // Minimum confidence gate — require at least 50% confidence.
    const minConfidence = 0.5;
    if (shadow.confidence < minConfidence) {
      throw makeError(
        'SHADOW_LOW_CONFIDENCE',
        `Shadow confidence ${shadow.confidence} is below the required minimum ${minConfidence}.`,
        'exec',
        {
          confidence: shadow.confidence,
          required: minConfidence,
        },
      );
    }

    // Critical-risk actions need very high confidence.
    if (risk.level === 'critical' && shadow.confidence < 0.95) {
      throw makeError(
        'SHADOW_CRITICAL_LOW_CONFIDENCE',
        `Critical-risk action requires confidence >= 0.95, got ${shadow.confidence}.`,
        'exec',
        { confidence: shadow.confidence, required: 0.95 },
      );
    }
  }

  /** Persist a trace via the TraceModule (if available and tracing enabled). */
  private recordTrace(trace: TraceRecord): void {
    if (this.traceModule && this.config.traceEnabled) {
      this.traceModule.record(trace);
    }
  }
}


