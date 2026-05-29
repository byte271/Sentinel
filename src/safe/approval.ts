import { v4 as uuid } from 'uuid';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'escalated' | 'timed_out';

export interface ApprovalRequest {
  id: string;
  intentId: string;
  traceId: string;
  requester: { id: string; name: string };
  approvers: string[];
  reason: string;
  risk: { level: string; score: number };
  status: ApprovalStatus;
  createdAt: number;
  expiresAt: number;
  resolvedBy?: string;
  resolvedAt?: number;
  escalationChain: string[];
  currentEscalationLevel: number;
  metadata: Record<string, unknown>;
}

export interface ApprovalOptions {
  timeoutMs?: number;
  escalationChain?: string[];
  metadata?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export class ApprovalGateway {
  private requests: Map<string, ApprovalRequest> = new Map();
  private listeners: Map<string, Array<(request: ApprovalRequest) => void>> = new Map();
  private pendingResolvers: Map<
    string,
    { resolve: (req: ApprovalRequest) => void; timer: ReturnType<typeof setTimeout> }
  > = new Map();

  request(
    intentId: string,
    traceId: string,
    requester: { id: string; name: string; [key: string]: unknown },
    approvers: string[],
    reason: string,
    risk: { level: string; score: number; [key: string]: unknown },
    options?: ApprovalOptions
  ): ApprovalRequest {
    const now = Date.now();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const req: ApprovalRequest = {
      id: uuid(),
      intentId,
      traceId,
      requester,
      approvers,
      reason,
      risk,
      status: 'pending',
      createdAt: now,
      expiresAt: now + timeoutMs,
      escalationChain: options?.escalationChain ?? [],
      currentEscalationLevel: 0,
      metadata: options?.metadata ?? {},
    };

    this.requests.set(req.id, req);
    this.emit('approval:requested', req);
    return req;
  }

  approve(requestId: string, actorId: string): ApprovalRequest {
    const req = this.requests.get(requestId);
    if (!req) {
      throw new Error(`Approval request not found: ${requestId}`);
    }
    if (req.status !== 'pending') {
      throw new Error(`Approval request is not pending: ${requestId} (status: ${req.status})`);
    }
    if (!req.approvers.includes(actorId)) {
      throw new Error(`Actor ${actorId} is not in the approvers list for request ${requestId}`);
    }

    req.status = 'approved';
    req.resolvedBy = actorId;
    req.resolvedAt = Date.now();

    this.emit('approval:approved', req);
    this.resolvePending(requestId, req);
    return req;
  }

  deny(requestId: string, actorId: string, reason?: string): ApprovalRequest {
    const req = this.requests.get(requestId);
    if (!req) {
      throw new Error(`Approval request not found: ${requestId}`);
    }
    if (req.status !== 'pending') {
      throw new Error(`Approval request is not pending: ${requestId} (status: ${req.status})`);
    }
    if (!req.approvers.includes(actorId)) {
      throw new Error(`Actor ${actorId} is not in the approvers list for request ${requestId}`);
    }

    req.status = 'denied';
    req.resolvedBy = actorId;
    req.resolvedAt = Date.now();
    if (reason) {
      req.metadata.denyReason = reason;
    }

    this.emit('approval:denied', req);
    this.resolvePending(requestId, req);
    return req;
  }

  escalate(requestId: string): ApprovalRequest {
    const req = this.requests.get(requestId);
    if (!req) {
      throw new Error(`Approval request not found: ${requestId}`);
    }
    if (req.status !== 'pending') {
      throw new Error(`Approval request is not pending: ${requestId} (status: ${req.status})`);
    }

    const nextLevel = req.currentEscalationLevel + 1;

    if (nextLevel >= req.escalationChain.length) {
      req.status = 'denied';
      req.resolvedAt = Date.now();
      req.metadata.denyReason = 'escalation exhausted';
      this.emit('approval:denied', req);
      this.resolvePending(requestId, req);
      return req;
    }

    req.currentEscalationLevel = nextLevel;
    req.approvers = [req.escalationChain[nextLevel]];
    req.status = 'pending';
    req.expiresAt = Date.now() + DEFAULT_TIMEOUT_MS;

    this.emit('approval:escalated', req);
    return req;
  }

  waitForResolution(requestId: string, timeoutMs?: number): Promise<ApprovalRequest> {
    const req = this.requests.get(requestId);
    if (!req) {
      return Promise.reject(new Error(`Approval request not found: ${requestId}`));
    }

    if (req.status !== 'pending') {
      return Promise.resolve(req);
    }

    return new Promise<ApprovalRequest>((resolve) => {
      const effectiveTimeout = timeoutMs ?? (req.expiresAt - Date.now());

      const timer = setTimeout(() => {
        this.pendingResolvers.delete(requestId);

        if (req.status !== 'pending') {
          resolve(req);
          return;
        }

        if (req.escalationChain.length > 0 && req.currentEscalationLevel + 1 < req.escalationChain.length) {
          this.escalate(requestId);
          this.waitForResolution(requestId, timeoutMs).then(resolve);
        } else {
          req.status = 'timed_out';
          req.resolvedAt = Date.now();
          this.emit('approval:timed_out', req);
          resolve(req);
        }
      }, Math.max(effectiveTimeout, 0));

      this.pendingResolvers.set(requestId, { resolve, timer });
    });
  }

  checkTimeouts(): ApprovalRequest[] {
    const now = Date.now();
    const timedOut: ApprovalRequest[] = [];

    for (const req of this.requests.values()) {
      if (req.status === 'pending' && now >= req.expiresAt) {
        if (req.escalationChain.length > 0 && req.currentEscalationLevel + 1 < req.escalationChain.length) {
          this.escalate(req.id);
        } else {
          req.status = 'timed_out';
          req.resolvedAt = now;
          this.emit('approval:timed_out', req);
          this.resolvePending(req.id, req);
          timedOut.push(req);
        }
      }
    }

    return timedOut;
  }

  getPending(): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter((r) => r.status === 'pending');
  }

  getRequest(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  getHistory(): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter((r) => r.status !== 'pending');
  }

  on(event: string, handler: (req: ApprovalRequest) => void): void {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
  }

  off(event: string, handler: (req: ApprovalRequest) => void): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }

  private emit(event: string, req: ApprovalRequest): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(req);
      } catch {
        // Swallow listener errors to avoid disrupting the approval flow
      }
    }
  }

  private resolvePending(requestId: string, req: ApprovalRequest): void {
    const pending = this.pendingResolvers.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingResolvers.delete(requestId);
      pending.resolve(req);
    }
  }
}
