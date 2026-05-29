import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalGateway } from '../src/safe/approval.js';

describe('ApprovalGateway', () => {
  let gw: ApprovalGateway;

  beforeEach(() => {
    gw = new ApprovalGateway();
  });

  it('creates a pending approval request', () => {
    const req = gw.request(
      'intent-1', 'trace-1',
      { id: 'a1', name: 'Agent' },
      ['admin'],
      'High-risk action',
      { level: 'high', score: 0.7 },
    );
    expect(req.id).toBeTruthy();
    expect(req.status).toBe('pending');
    expect(req.approvers).toContain('admin');
  });

  it('lists pending requests', () => {
    gw.request('i1', 't1', { id: 'a1', name: 'A' }, ['admin'], 'reason', { level: 'high', score: 0.7 });
    gw.request('i2', 't2', { id: 'a1', name: 'A' }, ['admin'], 'reason', { level: 'medium', score: 0.4 });
    const pending = gw.getPending();
    expect(pending.length).toBe(2);
  });

  it('approves a request', () => {
    const req = gw.request('i1', 't1', { id: 'a1', name: 'A' }, ['admin'], 'reason', { level: 'high', score: 0.7 });
    gw.approve(req.id, 'admin');
    const updated = gw.getRequest(req.id);
    expect(updated?.status).toBe('approved');
    expect(updated?.resolvedBy).toBe('admin');
  });

  it('denies a request', () => {
    const req = gw.request('i1', 't1', { id: 'a1', name: 'A' }, ['admin'], 'reason', { level: 'high', score: 0.7 });
    gw.deny(req.id, 'admin', 'too risky');
    const updated = gw.getRequest(req.id);
    expect(updated?.status).toBe('denied');
  });
});
