import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from '../src/info/state.js';

describe('StateManager', () => {
  let mgr: StateManager;

  beforeEach(() => {
    mgr = new StateManager();
  });

  it('returns undefined for unknown surface', async () => {
    expect(await mgr.getState('unknown')).toBeUndefined();
  });

  it('stores and retrieves state from data', async () => {
    mgr.updateStateFromData('s1', { file: 'hello.txt' });
    const snap = await mgr.getState('s1');
    expect(snap).toBeDefined();
    expect(snap!.surfaceId).toBe('s1');
    expect(snap!.data.file).toBe('hello.txt');
    expect(snap!.hash).toBeTruthy();
  });

  it('maintains state history', () => {
    mgr.updateStateFromData('s1', { v: 1 });
    mgr.updateStateFromData('s1', { v: 2 });
    mgr.updateStateFromData('s1', { v: 3 });
    const history = mgr.getHistory('s1');
    expect(history.length).toBe(3);
    expect(history[0].data.v).toBe(1);
    expect(history[2].data.v).toBe(3);
  });

  it('limits history retrieval', () => {
    mgr.updateStateFromData('s1', { v: 1 });
    mgr.updateStateFromData('s1', { v: 2 });
    mgr.updateStateFromData('s1', { v: 3 });
    const last2 = mgr.getHistory('s1', 2);
    expect(last2.length).toBe(2);
    expect(last2[0].data.v).toBe(2);
  });

  it('compares two state snapshots', () => {
    const a = mgr.updateStateFromData('s1', { x: 1, y: 2 });
    const b = mgr.updateStateFromData('s1', { x: 1, y: 3, z: 4 });
    const diff = mgr.compareStates(a, b);
    expect(diff.changes.length).toBeGreaterThan(0);
    const yChange = diff.changes.find(c => c.path === 'y');
    expect(yChange).toBeDefined();
    expect(yChange!.old).toBe(2);
    expect(yChange!.new).toBe(3);
  });
});
