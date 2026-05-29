// ---------------------------------------------------------------------------
// Feature 2: Deterministic Replay Engine tests.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { ExecutionRecorder, ReplayCursor, NonDeterminismError } from '../src/replay/recorder.js';

function recordSession(): ExecutionRecorder {
  const r = new ExecutionRecorder();
  r.recordToolCall('http.get', { url: 'https://api.github.com' }, { status: 200 }, 1);
  r.recordStateMutation('init', { step: 1, done: false }, 2);
  r.recordInference('gpt', { prompt: 'plan' }, { text: 'do X' }, 3);
  r.recordStateMutation('progress', { step: 2 }, 4);
  r.recordBlocked('shell', { cmd: 'rm -rf /' }, { rule: 'destr-rm-rf-root' }, 5);
  return r;
}

describe('ExecutionRecorder — recording & integrity', () => {
  it('chains events and verifies clean', () => {
    const r = recordSession();
    expect(r.length).toBe(5);
    expect(r.verify().valid).toBe(true);
    expect(r.digest()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('detects tampering of a recorded output', () => {
    const r = recordSession();
    (r.log()[0].output as { status: number }).status = 500; // mutate a copy? log() is a copy
    // Mutating the copy must not affect integrity; mutate the real store via import round-trip.
    const data = r.export();
    (data.events[0].output as { status: number }).status = 500;
    const tampered = ExecutionRecorder.import(data);
    expect(tampered.verify().valid).toBe(false);
  });

  it('produces a stable digest for identical sessions', () => {
    expect(recordSession().digest()).toBe(recordSession().digest());
  });
});

describe('ReplayCursor — deterministic replay', () => {
  it('returns recorded outputs for matching inputs', () => {
    const cursor = new ReplayCursor(recordSession());
    expect(cursor.next('tool_call', 'http.get', { url: 'https://api.github.com' })).toEqual({ status: 200 });
    cursor.step(); // skip state mutation
    expect(cursor.next('inference', 'gpt', { prompt: 'plan' })).toEqual({ text: 'do X' });
  });

  it('throws on input divergence (non-determinism)', () => {
    const cursor = new ReplayCursor(recordSession());
    expect(() => cursor.next('tool_call', 'http.get', { url: 'https://evil.test' }))
      .toThrow(NonDeterminismError);
  });

  it('throws when the event type/name does not match', () => {
    const cursor = new ReplayCursor(recordSession());
    expect(() => cursor.next('tool_call', 'fs.read', {})).toThrow(NonDeterminismError);
  });
});

describe('ReplayCursor — time travel', () => {
  it('reconstructs merged state at a point in time', () => {
    const cursor = new ReplayCursor(recordSession());
    expect(cursor.stateAt(1)).toEqual({ step: 1, done: false });
    expect(cursor.stateAt(4)).toEqual({ step: 2, done: false });
  });

  it('can seek, step, and rewind', () => {
    const cursor = new ReplayCursor(recordSession());
    cursor.seek(3);
    expect(cursor.position).toBe(3);
    cursor.rewind(0);
    expect(cursor.position).toBe(0);
  });

  it('lists blocked actions for a prevented-futures report', () => {
    const cursor = new ReplayCursor(recordSession());
    const blocked = cursor.filter('blocked');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].name).toBe('shell');
  });
});

describe('ExecutionRecorder — export/import', () => {
  it('round-trips through JSON preserving the digest', () => {
    const r = recordSession();
    const json = JSON.parse(JSON.stringify(r.export()));
    const restored = ExecutionRecorder.import(json);
    expect(restored.digest()).toBe(r.digest());
    expect(restored.verify().valid).toBe(true);
  });
});
