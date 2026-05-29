import { v4 as uuid } from 'uuid';
import type {
  PipelineStep,
  Pipeline,
  PipelineStepResult,
  PipelineExecution,
  PipelineExecutionStatus,
  ActionIntent,
  ActorIdentity,
  TraceRecord,
  CommitResult,
} from '../kernel/types.js';
import { makeIntent } from '../helpers.js';

// ── Local extensions ──────────────────────────────────────────────────────────

/** Pipeline-level rollback strategies (re-exported from types.ts for convenience). */
export type PipelineRollbackStrategy = 'all' | 'completed' | 'none';

/**
 * Minimal kernel contract the pipeline engine depends on. Every action step is
 * driven through `execute()` so it passes the full safety lifecycle — identity,
 * risk, policy, blast radius, shadow, approval, and commit — rather than hitting
 * a raw executor. Rollback of committed steps is delegated to the kernel.
 */
export interface PipelineKernel {
  execute(intent: ActionIntent): Promise<TraceRecord>;
  rollback(commitId: string): Promise<CommitResult>;
}

/**
 * Minimal approval gateway contract the pipeline engine depends on.
 * Decoupled from the concrete ApprovalGateway so the interface stays
 * stable and the engine can be tested with lightweight fakes.
 */
export interface PipelineApprovalGateway {
  request(
    intentId: string,
    traceId: string,
    requester: { id: string; name: string },
    approvers: string[],
    reason: string,
    risk: { level: string; score: number },
  ): { id: string; status: string };
  waitForResolution(
    requestId: string,
    timeoutMs?: number,
  ): Promise<{ status: string; resolvedBy?: string }>;
}

/** Derive a human-readable failure reason from a non-committed kernel trace. */
function stepErrorFromTrace(trace: TraceRecord): string {
  const event = [...trace.events]
    .reverse()
    .find((e) => e.level === 'error' || e.type === 'policy:denied' || e.type === 'approval:denied');
  if (event) {
    const reason = event.data.message ?? event.data.reason ?? event.data.status;
    return reason ? String(reason) : event.type;
  }
  return `Step did not commit (status: ${trace.status}).`;
}

// ── Engine ─────────────────────────────────────────────────────────────────────

export class PipelineEngine {
  private pipelines: Map<string, Pipeline> = new Map();
  private executions: Map<string, PipelineExecution> = new Map();
  private kernel: PipelineKernel | undefined;
  private defaultInitiator: ActorIdentity | undefined;
  private approvalGateway: PipelineApprovalGateway | undefined;

  /**
   * Wire the safety kernel that every action step is routed through. An
   * initiator may be set here as the default actor for pipeline steps, or
   * supplied per-run via `execute(...)`.
   */
  setKernel(kernel: PipelineKernel, initiator?: ActorIdentity): void {
    this.kernel = kernel;
    if (initiator) this.defaultInitiator = initiator;
  }

  /**
   * Wire the ApprovalGateway used by `approval` pipeline steps.
   * Without this, any pipeline containing an approval step will fail-closed
   * (throw) rather than silently passing through without a real approval.
   */
  setApprovalGateway(gateway: PipelineApprovalGateway): void {
    this.approvalGateway = gateway;
  }

  define(pipeline: Pipeline): void {
    this.pipelines.set(pipeline.id, pipeline);
  }

  getPipeline(id: string): Pipeline | undefined {
    return this.pipelines.get(id);
  }

  listPipelines(): Pipeline[] {
    return Array.from(this.pipelines.values());
  }

  async execute(
    pipelineId: string,
    context: Record<string, unknown> = {},
    initiator?: ActorIdentity,
  ): Promise<PipelineExecution> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }
    if (!this.kernel) {
      throw new Error('No kernel configured');
    }
    const actor = initiator ?? this.defaultInitiator;
    if (!actor) {
      throw new Error('No initiator configured for pipeline execution');
    }

    const execution: PipelineExecution = {
      id: uuid(),
      pipelineId,
      status: 'running',
      stepResults: [],
      startedAt: Date.now(),
      context: { ...context },
    };
    this.executions.set(execution.id, execution);

    const stepsById = new Map<string, PipelineStep>();
    for (const step of pipeline.steps) {
      stepsById.set(step.id, step);
    }

    try {
      await this.walkStep(execution, stepsById, pipeline.entryPoint, actor);

      if (execution.status === 'running') {
        execution.status = 'completed';
      }
    } catch (err: unknown) {
      execution.status = 'failed';

      // Rollback if strategy allows
      if (pipeline.rollbackStrategy === 'all' || pipeline.rollbackStrategy === 'completed') {
        await this.performRollback(execution, stepsById, pipeline.rollbackStrategy);
      }
    }

    execution.completedAt = Date.now();
    return execution;
  }

  async rollback(executionId: string): Promise<PipelineExecution> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    const pipeline = this.pipelines.get(execution.pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${execution.pipelineId}`);
    }

    const stepsById = new Map<string, PipelineStep>();
    for (const step of pipeline.steps) {
      stepsById.set(step.id, step);
    }

    await this.performRollback(execution, stepsById, 'completed');
    execution.status = 'rolled_back';
    execution.completedAt = Date.now();
    return execution;
  }

  getExecution(id: string): PipelineExecution | undefined {
    return this.executions.get(id);
  }

  listExecutions(): PipelineExecution[] {
    return Array.from(this.executions.values());
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async walkStep(
    execution: PipelineExecution,
    stepsById: Map<string, PipelineStep>,
    stepId: string,
    actor: ActorIdentity,
    visited: Set<string> = new Set(),
  ): Promise<void> {
    // Cycle detection
    if (visited.has(stepId)) {
      throw new Error(`Pipeline cycle detected at step "${stepId}".`);
    }
    visited.add(stepId);

    const step = stepsById.get(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    const start = Date.now();

    switch (step.type) {
      case 'action': {
        if (!step.surface || !step.action) {
          throw new Error(`Action step ${step.id} missing surface or action`);
        }
        try {
          // Route the step through the kernel's full safety lifecycle instead
          // of a raw executor. A step "succeeds" only if the kernel commits it
          // (or completes a shadow-only run); a policy denial or approval
          // rejection surfaces as a failed step.
          const intent = makeIntent(step.surface, step.action, step.params ?? {}, actor, {
            pipelineExecutionId: execution.id,
            pipelineStepId: step.id,
          });
          const trace = await this.kernel!.execute(intent);
          const succeeded = trace.status === 'committed' || trace.status === 'shadow';
          const output = trace.commitResult?.realDelta.after ?? {};

          const stepResult: PipelineStepResult = {
            stepId: step.id,
            status: succeeded ? 'success' : 'failure',
            traceId: trace.id,
            output,
            error: succeeded ? undefined : stepErrorFromTrace(trace),
            durationMs: Date.now() - start,
          };
          execution.stepResults.push(stepResult);

          // Merge committed output into context
          if (succeeded) {
            Object.assign(execution.context, output);
          }

          if (succeeded && step.onSuccess) {
            await this.walkStep(execution, stepsById, step.onSuccess, actor, new Set(visited));
          } else if (!succeeded) {
            if (step.onFailure) {
              await this.walkStep(execution, stepsById, step.onFailure, actor, new Set(visited));
            } else {
              throw new Error(`Step ${step.id} failed: ${stepResult.error ?? 'unknown error'}`);
            }
          }
        } catch (err: unknown) {
          if (execution.stepResults.find((r) => r.stepId === step.id)) {
            throw err; // already recorded
          }
          execution.stepResults.push({
            stepId: step.id,
            status: 'failure',
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - start,
          });
          if (step.onFailure) {
            await this.walkStep(execution, stepsById, step.onFailure, actor, new Set(visited));
          } else {
            throw err;
          }
        }
        break;
      }

      case 'condition': {
        const conditionMet = this.evaluateCondition(step.condition ?? '', execution.context);
        execution.stepResults.push({
          stepId: step.id,
          status: 'success',
          output: { conditionMet },
          durationMs: Date.now() - start,
        });

        if (conditionMet && step.onSuccess) {
          await this.walkStep(execution, stepsById, step.onSuccess, actor, new Set(visited));
        } else if (!conditionMet && step.onFailure) {
          await this.walkStep(execution, stepsById, step.onFailure, actor, new Set(visited));
        }
        break;
      }

      case 'parallel': {
        if (!step.children || step.children.length === 0) {
          execution.stepResults.push({
            stepId: step.id,
            status: 'success',
            durationMs: Date.now() - start,
          });
          break;
        }

        const childPromises = step.children.map((childId) =>
          this.walkStep(execution, stepsById, childId, actor, new Set(visited)),
        );
        await Promise.all(childPromises);

        execution.stepResults.push({
          stepId: step.id,
          status: 'success',
          durationMs: Date.now() - start,
        });

        if (step.onSuccess) {
          await this.walkStep(execution, stepsById, step.onSuccess, actor, new Set(visited));
        }
        break;
      }

      case 'approval': {
        // Fail-closed: if no ApprovalGateway is configured, block the step
        // rather than silently passing through. Callers must wire a gateway
        // via setApprovalGateway() before running pipelines with approval steps.
        if (!this.approvalGateway) {
          throw new Error(
            `Approval step "${step.id}" requires an ApprovalGateway. ` +
            `Call setApprovalGateway() before executing pipelines with approval steps.`,
          );
        }

        // Extract configuration from the step's params. Approvers and reason
        // should be declared when the pipeline is defined.
        const approvers: string[] = Array.isArray(step.params?.approvers)
          ? (step.params!.approvers as string[])
          : [];
        const reason: string = typeof step.params?.reason === 'string'
          ? step.params.reason
          : `Approval required for pipeline step "${step.id}"`;

        // Register the approval request and wait for a human decision.
        // Approval steps are treated as high-risk by default — the whole
        // point of the step type is to gate high-impact operations.
        const approvalReq = this.approvalGateway.request(
          execution.id,
          execution.id,
          { id: actor.id, name: actor.name },
          approvers,
          reason,
          { level: 'high', score: 0.75 },
        );

        const resolution = await this.approvalGateway.waitForResolution(
          approvalReq.id,
          step.timeout,
        );

        const approved = resolution.status === 'approved';

        execution.stepResults.push({
          stepId: step.id,
          status: approved ? 'success' : 'failure',
          output: { gate: approved ? 'approved' : 'denied', resolvedBy: resolution.resolvedBy },
          error: approved
            ? undefined
            : `Approval ${resolution.status} for step "${step.id}"`,
          durationMs: Date.now() - start,
        });

        if (approved && step.onSuccess) {
          await this.walkStep(execution, stepsById, step.onSuccess, actor, new Set(visited));
        } else if (!approved) {
          if (step.onFailure) {
            await this.walkStep(execution, stepsById, step.onFailure, actor, new Set(visited));
          } else {
            throw new Error(
              `Approval denied or timed out for pipeline step "${step.id}" ` +
              `(status: ${resolution.status})`,
            );
          }
        }
        break;
      }

      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  private evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
    const trimmed = condition.trim();
    if (!trimmed) return false;

    // "key exists" — presence check without string coercion
    const existsMatch = /^(\w[\w.]*)\s+exists$/.exec(trimmed);
    if (existsMatch) {
      const v = context[existsMatch[1]];
      return v !== undefined && v !== null;
    }

    // Binary operator: "key OP value"
    // Multi-char operators are matched before single-char to avoid ">=" being
    // tokenised as ">" followed by "=".
    const opMatch = /^(.+?)\s*(>=|<=|!=|==|contains|>|<)\s*(.+)$/.exec(trimmed);
    if (opMatch) {
      const [, leftRaw, op, rightRaw] = opMatch;
      const key = leftRaw.trim();
      const rhs = rightRaw.trim().replace(/^['"]|['"]$/g, ''); // strip optional quotes
      const lhs = context[key];
      switch (op) {
        case '>=':       return Number(lhs) >= Number(rhs);
        case '<=':       return Number(lhs) <= Number(rhs);
        case '!=':       return String(lhs) !== rhs;
        case '==':       return String(lhs) === rhs;
        case '>':        return Number(lhs) > Number(rhs);
        case '<':        return Number(lhs) < Number(rhs);
        case 'contains': return String(lhs ?? '').includes(rhs);
      }
    }

    // Fallback: truthy check on a bare key name
    return Boolean(context[trimmed]);
  }

  private async performRollback(
    execution: PipelineExecution,
    stepsById: Map<string, PipelineStep>,
    strategy: 'all' | 'completed' | 'none',
  ): Promise<void> {
    if (strategy === 'none' || !this.kernel) return;

    const toRollback = strategy === 'completed'
      ? execution.stepResults.filter((r) => r.status === 'success')
      : execution.stepResults;

    const rollbackResults: PipelineStepResult[] = [];

    // Rollback in reverse order, via the kernel's rollback path.
    for (const result of [...toRollback].reverse()) {
      const step = stepsById.get(result.stepId);
      if (!step || step.type !== 'action' || !step.surface || !step.action || !result.traceId) {
        continue;
      }

      const start = Date.now();
      try {
        const rollbackResult = await this.kernel.rollback(result.traceId);
        rollbackResults.push({
          stepId: step.id,
          status: rollbackResult.status === 'rolled_back' ? 'success' : 'failure',
          durationMs: Date.now() - start,
        });
      } catch (err: unknown) {
        rollbackResults.push({
          stepId: step.id,
          status: 'failure',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        });
      }
    }

    // Attach rollback results to execution context
    execution.context._rollbackResults = rollbackResults;
  }
}
