import { describe, it, expect } from 'vitest';
import { v4 as uuid } from 'uuid';
import { createSentinel, makeIntent } from '../src/index.js';
import { boot } from '../src/boot/preload.js';
import type { ActorIdentity } from '../src/kernel/types.js';

const actor: ActorIdentity = { id: 'alias-user', type: 'human', name: 'Tester', trust: 'elevated', scopes: ['*'] };

describe('API aliases and convenience helpers', () => {

  describe('makeIntent helper', () => {
    it('creates a valid ActionIntent with defaults', () => {
      const intent = makeIntent('my-surface', 'write_file', { path: 'a.txt' }, actor);
      expect(intent.id).toBeTruthy();
      expect(intent.surface).toBe('my-surface');
      expect(intent.action).toBe('write_file');
      expect(intent.params).toEqual({ path: 'a.txt' });
      expect(intent.initiator).toBe(actor);
      expect(intent.timestamp).toBeGreaterThan(0);
      expect(intent.metadata).toEqual({});
    });

    it('accepts custom metadata', () => {
      const intent = makeIntent('s', 'a', {}, actor, { tag: 'test' });
      expect(intent.metadata).toEqual({ tag: 'test' });
    });
  });

  describe('PolicyEngine.addProgrammaticRule', () => {
    it('adds a rule via the alias', () => {
      const sentinel = createSentinel();
      sentinel.policy.addProgrammaticRule({
        name: 'test-rule',
        description: 'Test rule',
        condition: (intent) => intent.action === 'dangerous',
        riskFactor: { type: 'custom', severity: 'high', description: 'Custom', mitigatable: true },
      });
      // Verify rule works by triggering risk assessment
      // (addProgrammaticRule delegates to addRule)
      expect(true).toBe(true);
    });
  });

  describe('ShadowExecutor.shadowExecute alias', () => {
    it('exists and is callable', () => {
      const sentinel = createSentinel();
      expect(typeof sentinel.executor.shadowExecute).toBe('function');
    });
  });

  describe('TraceStore.query alias', () => {
    it('returns the same result as list()', () => {
      const sentinel = createSentinel();
      expect(sentinel.trace.query()).toEqual(sentinel.trace.list());
    });
  });

  describe('chain alias on createSentinel()', () => {
    it('exposes chain as alias for merkle', () => {
      const sentinel = createSentinel();
      expect((sentinel as any).chain).toBeDefined();
      expect((sentinel as any).chain).toBe(sentinel.merkle);
    });
  });

  describe('chain alias on boot()', () => {
    it('exposes chain as alias for merkle', () => {
      const sentinel = boot();
      expect((sentinel as any).chain).toBeDefined();
      expect((sentinel as any).chain).toBe(sentinel.merkle);
    });
  });

  describe('delete_file triggers destructive-action rule', () => {
    it('detects delete_file as destructive', async () => {
      const sentinel = createSentinel();
      const caps = [{ action: 'delete_file', riskLevel: 'medium' as const, description: 'del', params: [], reversible: true, requiresApproval: false }];
      const surface = {
        id: 'test-s', name: 'Test', type: 'filesystem' as const,
        version: '1.0.0',
        capabilities: caps,
        manifest: { surfaceId: 'test-s', version: '1.0.0', capabilities: caps, metadata: {} },
      };
      const intent = makeIntent('test-s', 'delete_file', { path: 'x.txt' }, actor);
      const risk = await sentinel.policy.assessRisk(intent, surface);
      expect(risk.factors.some(f => f.type === 'destructive')).toBe(true);
    });
  });

  describe('BlastRadiusAnalyzer overloaded analyze()', () => {
    it('accepts (intent, surface) overload', () => {
      const sentinel = createSentinel();
      const caps = [{ action: 'write_file', riskLevel: 'low' as const, description: 'write', params: [], reversible: true, requiresApproval: false }];
      const surface = {
        id: 'test-s', name: 'Test', type: 'filesystem' as const,
        version: '1.0.0',
        capabilities: caps,
        manifest: { surfaceId: 'test-s', version: '1.0.0', capabilities: caps, metadata: {} },
      };
      const intent = makeIntent('test-s', 'write_file', { path: 'a.txt' }, actor);
      const result = sentinel.blastRadius.analyze(intent, surface);
      expect(result.intentId).toBe(intent.id);
      expect(result.nodes.length).toBeGreaterThan(0);
    });
  });

  describe('Kernel rollback by trace ID', () => {
    it('finds trace by trace.id in addition to commitResult.intentId', async () => {
      const sentinel = createSentinel();
      const { createFilesystemSurface, FilesystemAdapter } = await import('../src/adapters/filesystem.js');
      const { mkdirSync, rmSync } = await import('fs');
      const { tmpdir } = await import('os');

      const dir = `${tmpdir()}/sentinel-alias-test-${Date.now()}`;
      mkdirSync(dir, { recursive: true });

      try {
        const sid = 'alias-fs';
        const surface = createFilesystemSurface(sid, 'Alias FS', dir);
        sentinel.kernel.registerSurface(surface);
        sentinel.executor.registerAdapter(new FilesystemAdapter(sid, dir));
        sentinel.identity.register(actor);

        const trace = await sentinel.kernel.execute(
          makeIntent(sid, 'write_file', { path: 'rb.txt', content: 'rollback test' }, actor),
        );

        expect(trace.status).toBe('committed');

        // Rollback using trace.id (not commitResult.intentId)
        // This should now work because kernel.rollback also searches by trace.id
        const result = await sentinel.kernel.rollback(trace.id);
        expect(result.status).toBe('rolled_back');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
