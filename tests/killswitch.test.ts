// ---------------------------------------------------------------------------
// Feature 3: Kill Switch + Forensics tests.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { KillSwitch } from '../src/exec/killswitch.js';

describe('KillSwitch — graceful stop', () => {
  it('lets the agent reach a safe checkpoint within the window', async () => {
    const ks = new KillSwitch();
    const s = ks.register('agent-1', 1000);
    const op = s.beginOperation('send email', () => { throw new Error('should not compensate'); });
    s.onGracefulStop(() => { s.completeOperation(op); });

    const snap = await ks.kill('agent-1', { mode: 'graceful' });
    expect(snap.reachedSafeCheckpoint).toBe(true);
    expect(snap.mode).toBe('graceful');
    expect(snap.compensations).toHaveLength(0);
    expect(snap.position.completed).toBe(1);
  });

  it('escalates to compensation when the window elapses with work in flight', async () => {
    const ks = new KillSwitch();
    const s = ks.register('agent-2', 20);
    let rolledBack = false;
    s.beginOperation('delete 100 emails', () => { rolledBack = true; });
    s.onGracefulStop(() => new Promise(() => { /* never resolves -> times out */ }));

    const snap = await ks.kill('agent-2', { mode: 'graceful', gracefulWindowMs: 20 });
    expect(snap.reachedSafeCheckpoint).toBe(false);
    expect(rolledBack).toBe(true);
    expect(snap.compensations[0].status).toBe('succeeded');
  });
});

describe('KillSwitch — hard kill', () => {
  it('immediately compensates in-flight operations in reverse order', async () => {
    const ks = new KillSwitch();
    const s = ks.register('agent-3');
    const order: string[] = [];
    s.beginOperation('op A', () => { order.push('A'); });
    const b = s.beginOperation('op B', () => { order.push('B'); });
    s.completeOperation(b); // B is done, should NOT be compensated
    s.beginOperation('op C', () => { order.push('C'); });

    const snap = await ks.kill('agent-3', { mode: 'hard', reason: 'panic' });
    expect(snap.mode).toBe('hard');
    expect(snap.reason).toBe('panic');
    // C then A (reverse), B excluded because completed.
    expect(order).toEqual(['C', 'A']);
    expect(snap.position.completed).toBe(1);
  });

  it('records failed compensations for ops without a rollback', async () => {
    const ks = new KillSwitch();
    const s = ks.register('agent-4');
    s.beginOperation('irreversible write'); // no compensation
    const snap = await ks.kill('agent-4', { mode: 'hard' });
    expect(snap.compensations[0].status).toBe('failed');
    expect(snap.compensations[0].error).toMatch(/no compensation/i);
  });
});

describe('KillSwitch — forensics & recovery', () => {
  it('produces a recovery plan listing outstanding compensations', async () => {
    const ks = new KillSwitch();
    const s = ks.register('agent-5');
    s.setState('lastEmailId', 'msg-42');
    s.beginOperation('irreversible send'); // no compensation -> failed
    const snap = await ks.kill('agent-5', { mode: 'hard' });

    const plan = KillSwitch.recover(snap);
    expect(plan.agentId).toBe('agent-5');
    expect(plan.outstandingCompensations).toHaveLength(1);
    expect(plan.state.lastEmailId).toBe('msg-42');
    expect(plan.summary).toMatch(/need manual recovery/i);
  });
});
