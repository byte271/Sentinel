import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuid } from 'uuid';
import { boot } from '../src/boot/preload.js';
import { createFilesystemSurface, FilesystemAdapter } from '../src/adapters/filesystem.js';
import type { ActionIntent, ActorIdentity } from '../src/kernel/types.js';

const actor: ActorIdentity = { id: 'boot-user', type: 'human', name: 'Tester', trust: 'elevated', scopes: ['*'] };

function makeIntent(surface: string, action: string, params: Record<string, unknown>): ActionIntent {
  return { id: uuid(), surface, action, params, initiator: actor, timestamp: Date.now(), metadata: {} };
}

describe('boot() — Cold Start Accelerator', () => {

  describe('module groups', () => {
    it('boots with all modules by default', () => {
      const sentinel = boot();
      expect(sentinel.kernel).toBeDefined();
      expect(sentinel.temporal).toBeDefined();
      expect(sentinel.trace).toBeDefined();
      expect(sentinel.config).toBeDefined();
    });

    it('boots with only core group', () => {
      const sentinel = boot({ modules: ['core'] });
      const report = sentinel.getBootReport();
      // core = kernel + identity + executor, plus kernel deps
      expect(report.modulesEager).toContain('kernel');
      expect(report.modulesEager).toContain('identity');
      expect(report.modulesEager).toContain('executor');
      expect(report.modulesDeferred.length).toBeGreaterThan(0);
    });

    it('boots with only audit group', () => {
      const sentinel = boot({ modules: ['audit'] });
      const report = sentinel.getBootReport();
      expect(report.modulesEager).toContain('trace');
      expect(report.modulesEager).toContain('merkle');
      // kernel should be deferred
      expect(report.modulesDeferred).toContain('temporal');
    });

    it('boots with specific modules', () => {
      const sentinel = boot({ modules: ['trace', 'merkle', 'state'] });
      const report = sentinel.getBootReport();
      expect(report.modulesEager).toContain('trace');
      expect(report.modulesEager).toContain('merkle');
      expect(report.modulesEager).toContain('state');
      expect(report.modulesDeferred).toContain('temporal');
      expect(report.modulesDeferred).toContain('pipelines');
    });
  });

  describe('lazy proxies', () => {
    it('defers construction of non-eager modules', () => {
      const sentinel = boot({ modules: ['audit'] });
      const report1 = sentinel.getBootReport();
      const constructedBefore = report1.timings.filter(t => t.phase === 'construct').map(t => t.module);
      expect(constructedBefore).not.toContain('temporal');

      // Accessing temporal triggers lazy construction
      const temporal = sentinel.temporal;
      expect(temporal).toBeDefined();
    });

    it('lazy modules are fully functional', () => {
      const sentinel = boot({ modules: ['audit'] });
      // temporal is lazy, but should work when accessed
      sentinel.temporal.setBudget({ maxTimelines: 5, maxDepth: 2, maxTotalIntents: 20, maxExplorationMs: 30000, earlyPruneThreshold: 10 });
      const timelines = sentinel.temporal.listTimelines();
      expect(Array.isArray(timelines)).toBe(true);
    });
  });

  describe('boot report', () => {
    it('includes timing data', () => {
      const sentinel = boot();
      const report = sentinel.getBootReport();
      expect(report.totalMs).toBeGreaterThanOrEqual(0);
      expect(report.timings.length).toBeGreaterThan(0);
      expect(report.fromSnapshot).toBe(false);
    });

    it('distinguishes eager vs deferred modules', () => {
      const sentinel = boot({ modules: ['trace'] });
      const report = sentinel.getBootReport();
      expect(report.modulesEager).toContain('trace');
      expect(report.modulesDeferred.length).toBeGreaterThan(0);
    });
  });

  describe('warmup', () => {
    it('pre-initializes deferred modules', () => {
      const sentinel = boot({ modules: ['audit'] });
      // temporal is deferred
      sentinel.warmup('temporal');
      // After warmup, it should still be accessible and functional
      expect(sentinel.temporal.listTimelines()).toEqual([]);
    });
  });

  describe('config', () => {
    it('passes config to modules', () => {
      const sentinel = boot({ config: { defaultRiskThreshold: 'critical', traceEnabled: false } });
      expect(sentinel.config.defaultRiskThreshold).toBe('critical');
      expect(sentinel.config.traceEnabled).toBe(false);
      expect(sentinel.config.requireShadowFirst).toBe(true);
    });
  });

  describe('snapshot/restore', () => {
    it('creates a snapshot', () => {
      const sentinel = boot();
      const snap = sentinel.snapshot();
      expect(snap.version).toBe(1);
      expect(snap.config).toBeDefined();
      expect(snap.createdAt).toBeGreaterThan(0);
    });

    it('restores from a snapshot', () => {
      const sentinel1 = boot();
      const snap = sentinel1.snapshot();
      const sentinel2 = boot({ snapshot: snap });
      const report = sentinel2.getBootReport();
      expect(report.fromSnapshot).toBe(true);
    });
  });

  describe('full lifecycle through boot()', () => {
    let dir: string;
    const sid = 'boot-fs';

    beforeEach(() => {
      dir = join(tmpdir(), `sentinel-boot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(dir, { recursive: true });
    });

    afterEach(() => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    });

    it('executes full lifecycle via boot() factory', async () => {
      const sentinel = boot({ modules: ['core', 'safety', 'audit'] });
      const surface = createFilesystemSurface(sid, 'Boot FS', dir);
      sentinel.kernel.registerSurface(surface);
      sentinel.executor.registerAdapter(new FilesystemAdapter(sid, dir));
      sentinel.identity.register(actor);

      const trace = await sentinel.kernel.execute(
        makeIntent(sid, 'write_file', { path: 'boot.txt', content: 'booted!' }),
      );

      expect(trace.status).toBe('committed');
      expect(existsSync(join(dir, 'boot.txt'))).toBe(true);
    });

    it('temporal branching works through boot()', async () => {
      const sentinel = boot({ modules: ['core', 'safety', 'execution', 'audit'] });
      const surface = createFilesystemSurface(sid, 'Boot FS', dir);
      sentinel.kernel.registerSurface(surface);
      sentinel.executor.registerAdapter(new FilesystemAdapter(sid, dir));
      sentinel.identity.register(actor);
      sentinel.temporal.setExecModule(sentinel.executor as any);
      sentinel.temporal.registerSurface(surface);

      const result = await sentinel.temporal.explore([
        { name: 'fast', intents: [makeIntent(sid, 'write_file', { path: 'f.txt', content: 'fast' })], metadata: {} },
        { name: 'slow', intents: [
          makeIntent(sid, 'write_file', { path: 's1.txt', content: 's1' }),
          makeIntent(sid, 'write_file', { path: 's2.txt', content: 's2' }),
        ], metadata: {} },
      ]);

      expect(result.comparison.winner).toBeDefined();
      expect(result.stats.totalTimelines).toBe(2);
    });
  });

  describe('boot is faster than createSentinel for partial loads', () => {
    it('deferred modules are not constructed until accessed', () => {
      const sentinel = boot({ modules: ['audit'] });
      const report = sentinel.getBootReport();
      const constructedModules = report.timings
        .filter(t => t.phase === 'construct')
        .map(t => t.module);

      // Only audit modules (trace, merkle) should be constructed
      expect(constructedModules).toContain('trace');
      expect(constructedModules).toContain('merkle');
      expect(constructedModules).not.toContain('temporal');
      expect(constructedModules).not.toContain('kernel');
      expect(constructedModules).not.toContain('pipelines');
    });
  });
});
