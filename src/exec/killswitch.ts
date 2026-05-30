// ---------------------------------------------------------------------------
// SENTINEL Kill Switch + Forensics (Feature 3)
// ---------------------------------------------------------------------------
// "The stop button doesn't work" is the most common complaint about agents.
// A real kill switch must be transactional, not a flipped boolean: when an
// agent is killed mid-operation, its in-flight side effects need to be rolled
// back, and the operator needs a forensic record of exactly what happened.
//
// This module provides three guarantees, matching the spec:
//
//   1. Transaction boundaries around operations, each with an optional
//      compensating (rollback) action.
//   2. A graceful degradation window — the agent gets N ms to reach a safe
//      checkpoint; if it can't, we escalate to a hard kill.
//   3. Post-mortem forensics — a snapshot with the exact execution position,
//      completed vs in-flight actions, compensations run, and a state dump.
//
// It is storage- and kernel-agnostic; the supervisor tracks operations the
// agent reports and runs compensations on kill. Dependency-free.
// ---------------------------------------------------------------------------

export type KillMode = 'graceful' | 'hard';
export type AgentStatus = 'running' | 'degrading' | 'killed' | 'completed';
export type OperationStatus = 'in-flight' | 'completed' | 'compensated' | 'failed';

/** A compensating action that undoes an operation's side effects. */
export type Compensation = () => void | Promise<void>;

/** Handler the agent registers to reach a safe checkpoint on graceful stop. */
export type GracefulStopHandler = () => void | Promise<void>;

export interface AgentOperation {
  id: string;
  description: string;
  status: OperationStatus;
  startedAt: number;
  completedAt?: number;
  hasCompensation: boolean;
}

interface InternalOperation extends AgentOperation {
  compensate?: Compensation;
}

export interface CompensationRecord {
  opId: string;
  description: string;
  status: 'succeeded' | 'failed';
  error?: string;
}

export interface ForensicsSnapshot {
  agentId: string;
  killedAt: number;
  mode: KillMode;
  reason?: string;
  status: AgentStatus;
  reachedSafeCheckpoint: boolean;
  gracefulWindowMs: number;
  position: { completed: number; inFlight: number; total: number };
  completedActions: AgentOperation[];
  inFlightActions: AgentOperation[];
  compensations: CompensationRecord[];
  state: Record<string, unknown>;
}

export interface RecoveryPlan {
  agentId: string;
  /** Operations that were in-flight and had no successful compensation. */
  outstandingCompensations: AgentOperation[];
  /** Operations confirmed completed before the kill. */
  completedActions: AgentOperation[];
  /** The captured state, available for resuming work. */
  state: Record<string, unknown>;
  summary: string;
}

export interface KillOptions {
  mode?: KillMode;
  reason?: string;
  /** Override the session's graceful window for this kill. */
  gracefulWindowMs?: number;
}

let opCounter = 0;

/** A single supervised agent session. */
export class AgentSession {
  readonly agentId: string;
  status: AgentStatus = 'running';
  private operations: InternalOperation[] = [];
  private stateBag: Record<string, unknown> = {};
  private gracefulHandler?: GracefulStopHandler;
  readonly gracefulWindowMs: number;

  constructor(agentId: string, gracefulWindowMs = 5000) {
    this.agentId = agentId;
    this.gracefulWindowMs = gracefulWindowMs;
  }

  /** Begin a transactional operation. Returns its id. */
  beginOperation(description: string, compensate?: Compensation): string {
    const id = `op-${(opCounter++).toString(36)}`;
    this.operations.push({
      id,
      description,
      status: 'in-flight',
      startedAt: Date.now(),
      hasCompensation: Boolean(compensate),
      compensate,
    });
    return id;
  }

  /** Mark an operation as successfully completed (its side effects are durable). */
  completeOperation(id: string): void {
    const op = this.operations.find((o) => o.id === id);
    if (op && op.status === 'in-flight') {
      op.status = 'completed';
      op.completedAt = Date.now();
    }
  }

  /** Record arbitrary agent state for the forensics dump / recovery. */
  setState(key: string, value: unknown): void {
    this.stateBag[key] = value;
  }

  state(): Record<string, unknown> {
    return { ...this.stateBag };
  }

  /** Register a handler invoked during a graceful stop to reach a safe point. */
  onGracefulStop(handler: GracefulStopHandler): void {
    this.gracefulHandler = handler;
  }

  inFlight(): AgentOperation[] {
    return this.operations.filter((o) => o.status === 'in-flight').map(strip);
  }

  completed(): AgentOperation[] {
    return this.operations.filter((o) => o.status === 'completed').map(strip);
  }

  allOperations(): AgentOperation[] {
    return this.operations.map(strip);
  }

  // ---- internal (used by supervisor) -------------------------------------

  /** @internal */
  _getGracefulHandler(): GracefulStopHandler | undefined {
    return this.gracefulHandler;
  }

  /** @internal Run compensations for all in-flight ops, newest first. */
  async _compensateInFlight(): Promise<CompensationRecord[]> {
    const records: CompensationRecord[] = [];
    const inflight = this.operations.filter((o) => o.status === 'in-flight').reverse();
    for (const op of inflight) {
      if (!op.compensate) {
        op.status = 'failed';
        records.push({ opId: op.id, description: op.description, status: 'failed', error: 'no compensation registered' });
        continue;
      }
      try {
        await op.compensate();
        op.status = 'compensated';
        records.push({ opId: op.id, description: op.description, status: 'succeeded' });
      } catch (err) {
        op.status = 'failed';
        records.push({ opId: op.id, description: op.description, status: 'failed', error: err instanceof Error ? err.message : String(err) });
      }
    }
    return records;
  }
}

/** Supervises agent sessions and executes the kill protocol. */
export class KillSwitch {
  private sessions = new Map<string, AgentSession>();

  /** Register a new supervised agent session. */
  register(agentId: string, gracefulWindowMs = 5000): AgentSession {
    const session = new AgentSession(agentId, gracefulWindowMs);
    this.sessions.set(agentId, session);
    return session;
  }

  get(agentId: string): AgentSession | undefined {
    return this.sessions.get(agentId);
  }

  list(): AgentSession[] {
    return [...this.sessions.values()];
  }

  /**
   * Kill an agent. In graceful mode the agent's stop handler is given a bounded
   * window to reach a safe checkpoint (no in-flight operations); if it fails to,
   * we escalate to a hard kill that compensates all in-flight operations. A
   * forensics snapshot is always produced.
   */
  async kill(agentId: string, options: KillOptions = {}): Promise<ForensicsSnapshot> {
    const session = this.sessions.get(agentId);
    if (!session) throw new Error(`KillSwitch: unknown agent "${agentId}"`);

    const mode: KillMode = options.mode ?? 'graceful';
    const windowMs = options.gracefulWindowMs ?? session.gracefulWindowMs;
    let reachedSafe = false;
    let compensations: CompensationRecord[] = [];

    if (mode === 'graceful') {
      session.status = 'degrading';
      const handler = session._getGracefulHandler();
      if (handler) {
        await raceWithTimeout(Promise.resolve().then(handler), windowMs);
      }
      reachedSafe = session.inFlight().length === 0;
      if (!reachedSafe) {
        // Escalate: graceful window elapsed with work still in flight.
        compensations = await session._compensateInFlight();
      }
    } else {
      compensations = await session._compensateInFlight();
    }

    session.status = 'killed';

    return {
      agentId,
      killedAt: Date.now(),
      mode,
      reason: options.reason,
      status: session.status,
      reachedSafeCheckpoint: reachedSafe,
      gracefulWindowMs: windowMs,
      position: {
        completed: session.completed().length,
        inFlight: session.allOperations().filter((o) => o.status === 'in-flight').length,
        total: session.allOperations().length,
      },
      completedActions: session.completed(),
      inFlightActions: session.allOperations().filter((o) => o.status === 'in-flight' || o.status === 'compensated' || o.status === 'failed'),
      compensations,
      state: session.state(),
    };
  }

  /** Build a recovery plan from a forensics snapshot. */
  static recover(snapshot: ForensicsSnapshot): RecoveryPlan {
    const outstanding = snapshot.compensations
      .filter((c) => c.status === 'failed')
      .map((c) => ({
        id: c.opId,
        description: c.description,
        status: 'failed' as OperationStatus,
        startedAt: snapshot.killedAt,
        hasCompensation: c.error !== 'no compensation registered',
      }));

    const summary = `Agent ${snapshot.agentId} killed (${snapshot.mode}) at ${new Date(snapshot.killedAt).toISOString()}: `
      + `${snapshot.position.completed} completed, ${snapshot.position.inFlight} in-flight, `
      + `${snapshot.compensations.filter((c) => c.status === 'succeeded').length} compensated, `
      + `${outstanding.length} need manual recovery.`;

    return {
      agentId: snapshot.agentId,
      outstandingCompensations: outstanding,
      completedActions: snapshot.completedActions,
      state: snapshot.state,
      summary,
    };
  }
}

function strip(op: InternalOperation): AgentOperation {
  const { compensate, ...rest } = op;
  void compensate;
  return { ...rest };
}

/** Resolve true if the promise settles before the timeout, false otherwise. */
function raceWithTimeout(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(false); }
    }, ms);
    promise.then(
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(true); } },
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(true); } },
    );
  });
}
