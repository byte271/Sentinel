import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TemporalBranchEngine } from '../src/exec/temporal.js';
import { ShadowExecutor } from '../src/exec/shadow.js';
import { FilesystemAdapter, createFilesystemSurface } from '../src/adapters/filesystem.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuid } from 'uuid';
import type { ActionIntent, TimelineForkRequest, ActorIdentity } from '../src/kernel/types.js';

const actor: ActorIdentity = { id: 'test', type: 'ai', name: 'Test', trust: 'elevated', scopes: ['*'] };

function makeIntent(sid: string, action: string, params: Record<string, unknown>): ActionIntent {
  return { id: uuid(), surface: sid, action, params, initiator: actor, timestamp: Date.now(), metadata: {} };
}

describe('TemporalBranchEngine', () => {
  let engine: TemporalBranchEngine;
  let dir: string;
  const sid = 'temp-fs';

  beforeEach(() => {
    dir = join(tmpdir(), `sentinel-test-temporal-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });

    engine = new TemporalBranchEngine();
    const surface = createFilesystemSurface(sid, 'Temp FS', dir);
    const executor = new ShadowExecutor({ defaultRiskThreshold: 'high', requireShadowFirst: true, requireApprovalAbove: 'high', traceEnabled: true, maxShadowDurationMs: 30000, adapters: {} });
    executor.registerAdapter(new FilesystemAdapter(sid, dir));

    engine.setExecModule(executor as any);
    engine.registerSurface(surface);
    engine.setBudget({ maxTimelines: 10, maxDepth: 3, maxTotalIntents: 50, maxExplorationMs: 60000, earlyPruneThreshold: 20 });
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('forks a timeline', () => {
    const tl = engine.fork({
      name: 'test', intents: [makeIntent(sid, 'write_file', { path: 'a.txt', content: 'hi' })], metadata: {},
    });
    expect(tl.id).toBeTruthy();
    expect(tl.name).toBe('test');
    expect(tl.phase).toBe('created');
    expect(tl.depth).toBe(0);
  });

  it('evaluates a timeline with scoring', async () => {
    const tl = engine.fork({
      name: 'eval', intents: [makeIntent(sid, 'write_file', { path: 'e.txt', content: 'data' })], metadata: {},
    });
    const evaluated = await engine.evaluate(tl.id);
    expect(evaluated.phase).toBe('evaluated');
    expect(evaluated.score).toBeGreaterThan(0);
    expect(evaluated.confidence).toBeGreaterThan(0);
    expect(evaluated.scoreBreakdown.length).toBeGreaterThanOrEqual(6);

    // Check all 6 dimensions
    const dims = evaluated.scoreBreakdown.map(d => d.dimension);
    expect(dims).toContain('confidence');
    expect(dims).toContain('safety');
    expect(dims).toContain('minimality');
    expect(dims).toContain('completeness');
    expect(dims).toContain('speed');
    expect(dims).toContain('reversibility');
  });

  it('explores multiple strategies and picks a winner', async () => {
    const strategies: TimelineForkRequest[] = [
      { name: 'one-file', intents: [makeIntent(sid, 'write_file', { path: 'a.txt', content: 'a' })], metadata: {} },
      { name: 'two-files', intents: [
        makeIntent(sid, 'write_file', { path: 'b.txt', content: 'b' }),
        makeIntent(sid, 'write_file', { path: 'c.txt', content: 'c' }),
      ], metadata: {} },
    ];

    const result = await engine.explore(strategies);
    expect(result.timelines.length).toBe(2);
    expect(result.comparison.winner).toBeDefined();
    expect(result.comparison.ranked.length).toBe(2);
    expect(result.comparison.reasoning.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('produces exploration statistics', async () => {
    const result = await engine.explore([
      { name: 'a', intents: [makeIntent(sid, 'write_file', { path: 'x.txt', content: 'x' })], metadata: {} },
      { name: 'b', intents: [makeIntent(sid, 'write_file', { path: 'y.txt', content: 'y' })], metadata: {} },
    ]);

    expect(result.stats).toBeDefined();
    expect(result.stats.totalTimelines).toBe(2);
    expect(result.stats.evaluatedCount).toBe(2);
    expect(result.stats.avgScore).toBeGreaterThan(0);
    expect(result.stats.budgetUtilization).toBeGreaterThan(0);
    expect(result.stats.riskDistribution).toBeDefined();
  });

  it('produces exploration proof hash', async () => {
    const result = await engine.explore([
      { name: 'a', intents: [makeIntent(sid, 'write_file', { path: 'p.txt', content: 'p' })], metadata: {} },
      { name: 'b', intents: [makeIntent(sid, 'write_file', { path: 'q.txt', content: 'q' })], metadata: {} },
    ]);

    expect(result.explorationProofHash).toBeTruthy();
    expect(result.explorationProofHash.length).toBe(64);
  });

  it('generates non-selection proofs', async () => {
    const result = await engine.explore([
      { name: 'winner', intents: [makeIntent(sid, 'write_file', { path: 'w.txt', content: 'w' })], metadata: {} },
      { name: 'loser', intents: [
        makeIntent(sid, 'write_file', { path: 'l1.txt', content: 'l1' }),
        makeIntent(sid, 'write_file', { path: 'l2.txt', content: 'l2' }),
      ], metadata: {} },
    ]);

    expect(result.nonSelectionProofs.length).toBeGreaterThan(0);
    const proof = result.nonSelectionProofs[0];
    expect(proof.shadowResultsHash).toBeTruthy();
    expect(proof.reasoning).toBeTruthy();
    expect(proof.dimensionComparison.length).toBeGreaterThan(0);
  });

  it('generates counterfactual analysis with pairwise diffs', async () => {
    const result = await engine.explore([
      { name: 'x', intents: [makeIntent(sid, 'write_file', { path: 'x.txt', content: 'x' })], metadata: {} },
      { name: 'y', intents: [makeIntent(sid, 'write_file', { path: 'y.txt', content: 'y' })], metadata: {} },
    ]);

    expect(result.counterfactual).toBeDefined();
    expect(result.counterfactual.selectedOutcome).toBeDefined();
    expect(result.counterfactual.rejectedOutcomes.length).toBe(1);
    expect(result.counterfactual.pairwiseDiffs.length).toBe(1);
    expect(result.counterfactual.pairwiseDiffs[0].dimensions.length).toBeGreaterThan(0);
  });

  it('creates and reviews merge requests with quorum', async () => {
    engine.setMergeRequestDefaults({ quorum: 2, ttlMs: 60_000 });
    const result = await engine.explore([
      { name: 'mr-test', intents: [makeIntent(sid, 'write_file', { path: 'mr.txt', content: 'mr' })], metadata: {} },
    ]);

    const mr = engine.createMergeRequest(result.comparison.winner.id, actor, 'Test MR');
    expect(mr.status).toBe('open');
    expect(mr.requiredApprovals).toBe(2);
    expect(mr.expiresAt).toBeGreaterThan(Date.now());

    // First approval — not enough for quorum
    engine.reviewMergeRequest(mr.id, { reviewer: 'r1', verdict: 'approve', comment: 'ok', timestamp: Date.now() });
    const after1 = engine.getMergeRequest(mr.id)!;
    expect(after1.status).toBe('reviewing');

    // Second approval — meets quorum
    engine.reviewMergeRequest(mr.id, { reviewer: 'r2', verdict: 'approve', comment: 'ok', timestamp: Date.now() });
    const after2 = engine.getMergeRequest(mr.id)!;
    expect(after2.status).toBe('approved');
  });

  it('rejects merge requests', async () => {
    const result = await engine.explore([
      { name: 'rej', intents: [makeIntent(sid, 'write_file', { path: 'rej.txt', content: 'r' })], metadata: {} },
    ]);
    const mr = engine.createMergeRequest(result.comparison.winner.id, actor);
    engine.reviewMergeRequest(mr.id, { reviewer: 'r1', verdict: 'reject', comment: 'no', timestamp: Date.now() });
    expect(engine.getMergeRequest(mr.id)!.status).toBe('rejected');
  });

  it('builds action diffs with content preview', async () => {
    const result = await engine.explore([
      { name: 'diff-test', intents: [makeIntent(sid, 'write_file', { path: 'd.txt', content: 'preview content here' })], metadata: {} },
    ]);
    const mr = engine.createMergeRequest(result.comparison.winner.id, actor);
    expect(mr.actionDiffs.length).toBe(1);
    expect(mr.actionDiffs[0].contentPreview).toBe('preview content here');
    expect(mr.actionDiffs[0].estimatedSize).toBeGreaterThan(0);
  });

  it('prunes timelines', async () => {
    const tl = engine.fork({ name: 'prune-me', intents: [makeIntent(sid, 'write_file', { path: 'p.txt', content: 'p' })], metadata: {} });
    await engine.evaluate(tl.id);
    engine.prune(tl.id);
    expect(engine.getTimeline(tl.id)!.phase).toBe('pruned');
  });

  it('prevents pruning committed timelines', async () => {
    const result = await engine.explore([
      { name: 'committed', intents: [makeIntent(sid, 'write_file', { path: 'c.txt', content: 'c' })], metadata: {} },
    ]);
    const mr = engine.createMergeRequest(result.comparison.winner.id, actor);
    engine.reviewMergeRequest(mr.id, { reviewer: 'r1', verdict: 'approve', comment: 'ok', timestamp: Date.now() });
    await engine.merge(result.comparison.winner.id);
    expect(() => engine.prune(result.comparison.winner.id)).toThrow('Cannot prune committed');
  });

  it('enables and disables sandbox mode', async () => {
    engine.enableSandbox();
    expect(engine.isSandboxMode()).toBe(true);

    const result = await engine.explore([
      { name: 'sandbox', intents: [makeIntent(sid, 'write_file', { path: 's.txt', content: 's' })], metadata: {} },
    ]);
    const mr = engine.createMergeRequest(result.comparison.winner.id, actor);
    engine.reviewMergeRequest(mr.id, { reviewer: 'r1', verdict: 'approve', comment: 'ok', timestamp: Date.now() });
    const merged = await engine.merge(result.comparison.winner.id);
    // In sandbox mode, merge should not actually commit
    expect(merged.phase).not.toBe('committed');

    engine.disableSandbox();
    expect(engine.isSandboxMode()).toBe(false);
  });

  it('searches futures', async () => {
    await engine.explore([
      { name: 'search-a', intents: [makeIntent(sid, 'write_file', { path: 'sa.txt', content: 'a' })], metadata: {} },
      { name: 'search-b', intents: [makeIntent(sid, 'write_file', { path: 'sb.txt', content: 'b' })], metadata: {} },
    ]);

    const all = engine.searchFutures({});
    expect(all.length).toBe(2);

    const byName = engine.searchFutures({ nameContains: 'search-a' });
    expect(byName.length).toBe(1);
    expect(byName[0].name).toBe('search-a');
  });

  it('diffs two timelines pairwise', async () => {
    const result = await engine.explore([
      { name: 'left', intents: [makeIntent(sid, 'write_file', { path: 'l.txt', content: 'l' })], metadata: {} },
      { name: 'right', intents: [
        makeIntent(sid, 'write_file', { path: 'r1.txt', content: 'r1' }),
        makeIntent(sid, 'write_file', { path: 'r2.txt', content: 'r2' }),
      ], metadata: {} },
    ]);

    const diff = engine.diffTimelines(result.timelines[0].id, result.timelines[1].id);
    expect(diff.leftName).toBeTruthy();
    expect(diff.rightName).toBeTruthy();
    expect(diff.dimensions.length).toBeGreaterThan(0);
    expect(diff.summary.length).toBeGreaterThan(0);
  });

  it('visualizes timelines', async () => {
    const result = await engine.explore([
      { name: 'viz', intents: [makeIntent(sid, 'write_file', { path: 'v.txt', content: 'v' })], metadata: {} },
    ]);
    const viz = engine.visualize(result.timelines.map(t => t.id));
    expect(viz).toContain('TEMPORAL BRANCH TREE');
    expect(viz).toContain('viz');
  });

  it('visualizes pairwise diff', async () => {
    const result = await engine.explore([
      { name: 'a', intents: [makeIntent(sid, 'write_file', { path: 'a.txt', content: 'a' })], metadata: {} },
      { name: 'b', intents: [makeIntent(sid, 'write_file', { path: 'b.txt', content: 'b' })], metadata: {} },
    ]);
    const viz = engine.visualizeDiff(result.timelines[0].id, result.timelines[1].id);
    expect(viz).toContain('PAIRWISE DIFF');
  });

  it('registers and runs custom safety gate checks', async () => {
    engine.registerGateCheck({
      name: 'custom-check',
      description: 'Always warns',
      evaluate: () => 'warning',
    });

    const result = await engine.explore([
      { name: 'gate', intents: [makeIntent(sid, 'write_file', { path: 'g.txt', content: 'g' })], metadata: {} },
    ]);

    const mr = engine.createMergeRequest(result.comparison.winner.id, actor);
    const customCheck = mr.safetyGate.checks.find(c => c.name === 'custom-check');
    expect(customCheck).toBeDefined();
    expect(customCheck!.status).toBe('warning');
    expect(customCheck!.custom).toBe(true);
  });

  it('configures pruning strategies', () => {
    engine.setPruningStrategies(['score_threshold', 'diminishing_returns']);
    // No direct way to verify, but it shouldn't throw
  });

  it('enforces budget limits', () => {
    engine.setBudget({ maxTimelines: 1, maxDepth: 1, maxTotalIntents: 5, maxExplorationMs: 1000, earlyPruneThreshold: 10 });
    engine.fork({ name: 'first', intents: [makeIntent(sid, 'write_file', { path: 'f.txt', content: 'f' })], metadata: {} });
    expect(() => engine.fork({
      name: 'second', intents: [makeIntent(sid, 'write_file', { path: 'g.txt', content: 'g' })], metadata: {},
    })).toThrow('Budget');
  });

  it('refuses a non-atomic merge instead of reporting partial success', async () => {
    // Build a two-intent timeline, then corrupt one shadow result so the
    // timeline can no longer be committed atomically.
    const result = await engine.explore([
      { name: 'atomic', intents: [
        makeIntent(sid, 'write_file', { path: 'first.txt', content: 'first' }),
        makeIntent(sid, 'write_file', { path: 'second.txt', content: 'second' }),
      ], metadata: {} },
    ]);
    const winner = result.comparison.winner;
    const timeline = engine.getTimeline(winner.id)!;

    // Simulate a step that did not produce a successful shadow result.
    timeline.shadowResults[1] = { ...timeline.shadowResults[1], status: 'failed' } as any;
    const preventedBefore = engine.getPreventedFutures().length;

    const merged = await engine.merge(winner.id);

    // The timeline must NOT be marked committed, and the refusal must be
    // recorded as a prevented future.
    expect(merged.phase).not.toBe('committed');
    expect(engine.getPreventedFutures().length).toBe(preventedBefore + 1);
  });

  it('emits events', async () => {
    const events: string[] = [];
    engine.onEvent((event) => events.push(event));

    await engine.explore([
      { name: 'events', intents: [makeIntent(sid, 'write_file', { path: 'ev.txt', content: 'ev' })], metadata: {} },
    ]);

    expect(events.length).toBeGreaterThan(0);
    expect(events).toContain('timeline:forked');
    expect(events).toContain('timeline:evaluated');
  });
});
