import { v4 as uuid } from 'uuid';

// ── Types ──────────────────────────────────────────────────────────────────────

export type TransactionPhase = 'preparing' | 'prepared' | 'committing' | 'committed' | 'aborting' | 'aborted';

export interface TransactionParticipant {
  surfaceId: string;
  intentId: string;
  action: string;
  params: Record<string, unknown>;
  shadowResult?: { status: string; confidence: number; intentId: string; planId: string };
  commitResult?: { status: string; intentId: string };
  phase: TransactionPhase;
}

export interface MultiSurfaceTransaction {
  id: string;
  participants: TransactionParticipant[];
  coordinatorId: string;
  phase: TransactionPhase;
  createdAt: number;
  completedAt?: number;
  error?: string;
}

export interface TransactionResult {
  transactionId: string;
  phase: TransactionPhase;
  participants: TransactionParticipant[];
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface TransactionExecutor {
  shadowExecute(
    surfaceId: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<{ status: string; confidence: number; intentId: string; planId: string }>;

  commitExecute(
    surfaceId: string,
    intentId: string,
  ): Promise<{ status: string; intentId: string }>;

  rollbackExecute(
    surfaceId: string,
    intentId: string,
  ): Promise<{ status: string }>;
}

// ── Coordinator ────────────────────────────────────────────────────────────────

export class TransactionCoordinator {
  private transactions: Map<string, MultiSurfaceTransaction> = new Map();
  private executor: TransactionExecutor | undefined;

  setExecutor(executor: TransactionExecutor): void {
    this.executor = executor;
  }

  begin(
    participants: Array<{ surfaceId: string; action: string; params: Record<string, unknown> }>,
    coordinatorId: string,
  ): MultiSurfaceTransaction {
    const tx: MultiSurfaceTransaction = {
      id: uuid(),
      coordinatorId,
      phase: 'preparing',
      createdAt: Date.now(),
      participants: participants.map((p) => ({
        surfaceId: p.surfaceId,
        intentId: uuid(),
        action: p.action,
        params: p.params,
        phase: 'preparing' as TransactionPhase,
      })),
    };
    this.transactions.set(tx.id, tx);
    return tx;
  }

  async prepare(txId: string): Promise<TransactionResult> {
    const start = Date.now();
    const tx = this.transactions.get(txId);
    if (!tx) {
      return { transactionId: txId, phase: 'aborted', participants: [], success: false, error: 'Transaction not found', durationMs: Date.now() - start };
    }
    if (!this.executor) {
      return { transactionId: txId, phase: 'aborted', participants: tx.participants, success: false, error: 'No executor configured', durationMs: Date.now() - start };
    }

    tx.phase = 'preparing';

    // Phase 1 — shadow-execute every participant
    let abortErrorReason: string | undefined;
    const shadowPromises = tx.participants.map(async (p) => {
      try {
        const result = await this.executor!.shadowExecute(p.surfaceId, p.action, p.params);
        p.shadowResult = result;
        if (result.confidence < 0.5) {
          abortErrorReason = `Low confidence (${result.confidence}) for participant ${p.surfaceId}`;
        }
        p.phase = 'prepared';
      } catch (err: unknown) {
        abortErrorReason = `Shadow execute failed for ${p.surfaceId}: ${err instanceof Error ? err.message : String(err)}`;
        p.phase = 'aborted';
      }
    });

    await Promise.all(shadowPromises);

    if (abortErrorReason) {
      tx.phase = 'aborted';
      tx.error = abortErrorReason;
      tx.completedAt = Date.now();
      return { transactionId: tx.id, phase: 'aborted', participants: tx.participants, success: false, error: abortErrorReason, durationMs: Date.now() - start };
    }

    tx.phase = 'prepared';
    return { transactionId: tx.id, phase: 'prepared', participants: tx.participants, success: true, durationMs: Date.now() - start };
  }

  async commit(txId: string): Promise<TransactionResult> {
    const start = Date.now();
    const tx = this.transactions.get(txId);
    if (!tx) {
      return { transactionId: txId, phase: 'aborted', participants: [], success: false, error: 'Transaction not found', durationMs: Date.now() - start };
    }
    if (!this.executor) {
      return { transactionId: txId, phase: 'aborted', participants: tx.participants, success: false, error: 'No executor configured', durationMs: Date.now() - start };
    }

    tx.phase = 'committing';

    // Track which participants were actually committed (not just iteration index)
    const committedParticipants: TransactionParticipant[] = [];
    let commitError: string | undefined;

    for (let i = 0; i < tx.participants.length; i++) {
      const p = tx.participants[i];
      try {
        const result = await this.executor.commitExecute(p.surfaceId, p.intentId);
        p.commitResult = result;
        p.phase = 'committed';
        committedParticipants.push(p);
      } catch (err: unknown) {
        commitError = `Commit failed for ${p.surfaceId}: ${err instanceof Error ? err.message : String(err)}`;
        p.phase = 'aborted';
        break;
      }
    }

    if (commitError) {
      // Rollback only participants whose commit was confirmed complete
      for (const cp of committedParticipants.reverse()) {
        try {
          await this.executor.rollbackExecute(cp.surfaceId, cp.intentId);
          cp.phase = 'aborted';
        } catch {
          // best-effort rollback
        }
      }
      tx.phase = 'aborted';
      tx.error = commitError;
      tx.completedAt = Date.now();
      return { transactionId: tx.id, phase: 'aborted', participants: tx.participants, success: false, error: commitError, durationMs: Date.now() - start };
    }

    tx.phase = 'committed';
    tx.completedAt = Date.now();
    return { transactionId: tx.id, phase: 'committed', participants: tx.participants, success: true, durationMs: Date.now() - start };
  }

  async abort(txId: string): Promise<TransactionResult> {
    const start = Date.now();
    const tx = this.transactions.get(txId);
    if (!tx) {
      return { transactionId: txId, phase: 'aborted', participants: [], success: false, error: 'Transaction not found', durationMs: Date.now() - start };
    }
    if (!this.executor) {
      tx.phase = 'aborted';
      tx.completedAt = Date.now();
      return { transactionId: tx.id, phase: 'aborted', participants: tx.participants, success: true, durationMs: Date.now() - start };
    }

    tx.phase = 'aborting';

    // Rollback any participant that has been committed
    const committed = tx.participants.filter((p) => p.phase === 'committed');
    for (const p of committed.reverse()) {
      try {
        await this.executor.rollbackExecute(p.surfaceId, p.intentId);
      } catch {
        // best-effort
      }
      p.phase = 'aborted';
    }

    // Mark remaining participants as aborted
    for (const p of tx.participants) {
      if (p.phase !== 'aborted') {
        p.phase = 'aborted';
      }
    }

    tx.phase = 'aborted';
    tx.completedAt = Date.now();
    return { transactionId: tx.id, phase: 'aborted', participants: tx.participants, success: true, durationMs: Date.now() - start };
  }

  async executeAtomic(
    participants: Array<{ surfaceId: string; action: string; params: Record<string, unknown> }>,
    coordinatorId: string,
  ): Promise<TransactionResult> {
    const tx = this.begin(participants, coordinatorId);

    const prepareResult = await this.prepare(tx.id);
    if (!prepareResult.success) {
      return prepareResult;
    }

    const commitResult = await this.commit(tx.id);
    if (!commitResult.success) {
      await this.abort(tx.id);
      return commitResult;
    }

    return commitResult;
  }

  getTransaction(txId: string): MultiSurfaceTransaction | undefined {
    return this.transactions.get(txId);
  }

  listTransactions(): MultiSurfaceTransaction[] {
    return Array.from(this.transactions.values());
  }
}
