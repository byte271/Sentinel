import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuid } from 'uuid';
import { createSentinel, createFilesystemSurface, FilesystemAdapter } from '../src/index.js';
import type { ActionIntent, ActorIdentity, Pipeline } from '../src/kernel/types.js';

const actor: ActorIdentity = { id: 'test-user', type: 'human', name: 'Tester', trust: 'elevated', scopes: ['*'] };

function makeIntent(surface: string, action: string, params: Record<string, unknown>): ActionIntent {
  return { id: uuid(), surface, action, params, initiator: actor, timestamp: Date.now(), metadata: {} };
}

describe('createSentinel factory', () => {
  it('returns all modules', () => {
    const sentinel = createSentinel();
    expect(sentinel.kernel).toBeDefined();
    expect(sentinel.policy).toBeDefined();
    expect(sentinel.approval).toBeDefined();
    expect(sentinel.blastRadius).toBeDefined();
    expect(sentinel.dsl).toBeDefined();
    expect(sentinel.identity).toBeDefined();
    expect(sentinel.executor).toBeDefined();
    expect(sentinel.transactions).toBeDefined();
    expect(sentinel.pipelines).toBeDefined();
    expect(sentinel.temporal).toBeDefined();
    expect(sentinel.trace).toBeDefined();
    expect(sentinel.merkle).toBeDefined();
    expect(sentinel.state).toBeDefined();
    expect(sentinel.drift).toBeDefined();
    expect(sentinel.magic).toBeDefined();
    expect(sentinel.spec).toBeDefined();
    expect(sentinel.api).toBeDefined();
    expect(sentinel.nist).toBeDefined();
    expect(sentinel.bridge).toBeDefined();
    expect(sentinel.config).toBeDefined();
  });

  it('accepts partial config overrides', () => {
    const sentinel = createSentinel({ defaultRiskThreshold: 'critical', traceEnabled: false });
    expect(sentinel.config.defaultRiskThreshold).toBe('critical');
    expect(sentinel.config.traceEnabled).toBe(false);
    expect(sentinel.config.requireShadowFirst).toBe(true); // default preserved
  });
});

describe('Full lifecycle integration', () => {
  let dir: string;
  const sid = 'integ-fs';

  beforeEach(() => {
    dir = join(tmpdir(), `sentinel-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('executes full shadow -> commit lifecycle', async () => {
    const sentinel = createSentinel();
    const surface = createFilesystemSurface(sid, 'Integration FS', dir);
    sentinel.kernel.registerSurface(surface);
    sentinel.executor.registerAdapter(new FilesystemAdapter(sid, dir));
    sentinel.identity.register(actor);

    const trace = await sentinel.kernel.execute(
      makeIntent(sid, 'write_file', { path: 'integ.txt', content: 'integration test' }),
    );

    expect(trace.status).toBe('committed');
    expect(trace.events.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'integ.txt'))).toBe(true);

    // Verify trace is recorded
    const traces = sentinel.trace.list();
    expect(traces.length).toBeGreaterThan(0);

    // Verify chain integrity
    const chainVerify = sentinel.trace.verifyChain();
    expect(chainVerify.valid).toBe(true);
  });

  it('blocks denied actions via DSL', async () => {
    const sentinel = createSentinel();
    const surface = createFilesystemSurface(sid, 'Integration FS', dir);
    sentinel.kernel.registerSurface(surface);
    sentinel.executor.registerAdapter(new FilesystemAdapter(sid, dir));
    sentinel.identity.register(actor);
    sentinel.policy.addDSLRule('DENY WHEN action MATCHES "delete_*"');

    const trace = await sentinel.kernel.execute(makeIntent(sid, 'delete_file', { path: 'x.txt' }));
    expect(trace.status).toBe('failed');
  });

  it('runs temporal exploration end-to-end', async () => {
    const sentinel = createSentinel();
    const surface = createFilesystemSurface(sid, 'Integration FS', dir);
    sentinel.kernel.registerSurface(surface);
    sentinel.executor.registerAdapter(new FilesystemAdapter(sid, dir));
    sentinel.identity.register(actor);

    sentinel.temporal.setExecModule(sentinel.executor as any);
    sentinel.temporal.registerSurface(surface);

    const result = await sentinel.temporal.explore([
      { name: 'plan-a', intents: [makeIntent(sid, 'write_file', { path: 'a.txt', content: 'a' })], metadata: {} },
      { name: 'plan-b', intents: [
        makeIntent(sid, 'write_file', { path: 'b1.txt', content: 'b1' }),
        makeIntent(sid, 'write_file', { path: 'b2.txt', content: 'b2' }),
      ], metadata: {} },
    ]);

    expect(result.comparison.winner).toBeDefined();
    expect(result.stats.totalTimelines).toBe(2);
    expect(result.nonSelectionProofs.length).toBe(1);
    expect(result.explorationProofHash.length).toBe(64);

    // Merge winner
    const mr = sentinel.temporal.createMergeRequest(result.comparison.winner.id, actor);
    sentinel.temporal.reviewMergeRequest(mr.id, { reviewer: 'tester', verdict: 'approve', comment: 'ok', timestamp: Date.now() });
    const merged = await sentinel.temporal.merge(result.comparison.winner.id);
    expect(merged.phase).toBe('committed');
  });

  it('pipeline routes action steps through the kernel safety lifecycle', async () => {
    const sentinel = createSentinel();
    const surface = createFilesystemSurface(sid, 'Integration FS', dir);
    sentinel.kernel.registerSurface(surface);
    sentinel.executor.registerAdapter(new FilesystemAdapter(sid, dir));
    sentinel.identity.register(actor);

    const pipeline: Pipeline = {
      id: 'p-safe', name: 'safe', description: '', entryPoint: 's1',
      rollbackStrategy: 'completed', metadata: {},
      steps: [{ id: 's1', type: 'action', surface: sid, action: 'write_file', params: { path: 'pipe.txt', content: 'hi' } }],
    };
    sentinel.pipelines.define(pipeline);

    const exec = await sentinel.pipelines.execute('p-safe', {}, actor);
    expect(exec.status).toBe('completed');
    expect(exec.stepResults[0].status).toBe('success');
    // The step produced a kernel trace — proof it went through the lifecycle.
    expect(exec.stepResults[0].traceId).toBeDefined();
    expect(sentinel.trace.get(exec.stepResults[0].traceId!)).toBeDefined();
    expect(existsSync(join(dir, 'pipe.txt'))).toBe(true);
  });

  it('pipeline blocks policy-denied steps (no bypass)', async () => {
    const sentinel = createSentinel();
    const surface = createFilesystemSurface(sid, 'Integration FS', dir);
    sentinel.kernel.registerSurface(surface);
    sentinel.executor.registerAdapter(new FilesystemAdapter(sid, dir));
    sentinel.identity.register(actor);
    sentinel.policy.addDSLRule('DENY WHEN action MATCHES "delete_*"');

    const pipeline: Pipeline = {
      id: 'p-deny', name: 'deny', description: '', entryPoint: 's1',
      rollbackStrategy: 'none', metadata: {},
      steps: [{ id: 's1', type: 'action', surface: sid, action: 'delete_file', params: { path: 'x.txt' } }],
    };
    sentinel.pipelines.define(pipeline);

    const exec = await sentinel.pipelines.execute('p-deny', {}, actor);
    expect(exec.status).toBe('failed');
    expect(exec.stepResults[0].status).toBe('failure');
  });

  it('pipeline refuses to run without a configured kernel (fails closed)', async () => {
    const { PipelineEngine } = await import('../src/index.js');
    const engine = new PipelineEngine();
    engine.define({
      id: 'p', name: 'p', description: '', entryPoint: 's1',
      rollbackStrategy: 'none', metadata: {},
      steps: [{ id: 's1', type: 'action', surface: sid, action: 'write_file', params: {} }],
    });
    await expect(engine.execute('p', {}, actor)).rejects.toThrow(/kernel/i);
  });

  it('temporal merge enforces policy at commit (no bypass)', async () => {
    const sentinel = createSentinel();
    const surface = createFilesystemSurface(sid, 'Integration FS', dir);
    sentinel.kernel.registerSurface(surface);
    sentinel.executor.registerAdapter(new FilesystemAdapter(sid, dir));
    sentinel.identity.register(actor);
    sentinel.temporal.registerSurface(surface);
    sentinel.policy.addDSLRule('DENY WHEN action MATCHES "write_*"');

    const result = await sentinel.temporal.explore([
      { name: 'blocked-plan', intents: [makeIntent(sid, 'write_file', { path: 'blocked.txt', content: 'x' })], metadata: {} },
    ]);

    const merged = await sentinel.temporal.merge(result.comparison.winner.id);
    // Policy denial at commit prevents the timeline from committing to reality.
    expect(merged.phase).not.toBe('committed');
    expect(existsSync(join(dir, 'blocked.txt'))).toBe(false);
    expect(sentinel.temporal.getPreventedFutures().length).toBeGreaterThan(0);
  });
});
