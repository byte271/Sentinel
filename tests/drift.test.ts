import { describe, it, expect, beforeEach } from 'vitest';
import { DriftDetector } from '../src/info/drift.js';

describe('DriftDetector', () => {
  let detector: DriftDetector;

  beforeEach(() => {
    detector = new DriftDetector();
  });

  it('throws without provider', async () => {
    await expect(detector.check('s1')).rejects.toThrow('No DriftStateProvider');
  });

  it('reports no drift when states match', async () => {
    const state = { files: ['a.txt', 'b.txt'] };
    detector.setProvider({
      getExpectedState: async () => state,
      getActualState: async () => ({ ...state }),
    });
    const report = await detector.check('s1');
    expect(report.drifted).toBe(false);
    expect(report.severity).toBe('none');
  });

  it('detects added keys', async () => {
    detector.setProvider({
      getExpectedState: async () => ({ a: 1 }),
      getActualState: async () => ({ a: 1, b: 2 }),
    });
    const report = await detector.check('s1');
    expect(report.drifted).toBe(true);
    expect(report.changes.length).toBe(1);
    expect(report.changes[0].op).toBe('add');
  });

  it('detects removed keys', async () => {
    detector.setProvider({
      getExpectedState: async () => ({ a: 1, b: 2 }),
      getActualState: async () => ({ a: 1 }),
    });
    const report = await detector.check('s1');
    expect(report.drifted).toBe(true);
    expect(report.changes.some(c => c.op === 'remove')).toBe(true);
  });

  it('classifies severity by change count', async () => {
    const expected: Record<string, unknown> = {};
    const actual: Record<string, unknown> = {};
    for (let i = 0; i < 15; i++) actual[`key${i}`] = i;
    detector.setProvider({
      getExpectedState: async () => expected,
      getActualState: async () => actual,
    });
    const report = await detector.check('s1');
    expect(report.severity).toBe('critical');
  });
});
