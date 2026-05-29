import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createSentinel,
  createFilesystemSurface,
  FilesystemAdapter,
  A2ASafetyBridge,
} from '../src/index.js';
import type { A2ADelegation, A2AAgentCard } from '../src/index.js';
import type { ActorIdentity } from '../src/kernel/types.js';

const sid = 'a2a-fs';

function setup(dir: string) {
  const sentinel = createSentinel();
  const surface = createFilesystemSurface(sid, 'A2A FS', dir);
  sentinel.kernel.registerSurface(surface);
  sentinel.executor.registerAdapter(new FilesystemAdapter(sid, dir));
  return sentinel;
}

function delegation(from: A2AAgentCard, action: string, params: Record<string, unknown>): A2ADelegation {
  return { from, surface: sid, action, params, task: `please ${action}` };
}

const trustedCard: A2AAgentCard = { id: 'agent-b-caller', name: 'Caller', trust: 'elevated', scopes: ['*'] };

describe('A2ASafetyBridge', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `sentinel-a2a-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('rejects an unknown agent by downgrading it to untrusted', async () => {
    const sentinel = setup(dir);
    const bridge = new A2ASafetyBridge(sentinel.kernel);

    const result = await bridge.mediate(
      // The agent self-claims 'full' trust; the bridge must ignore that.
      delegation({ id: 'rogue', name: 'Rogue', trust: 'full', scopes: ['*'] }, 'write_file', {
        path: 'x.txt',
        content: 'hi',
      }),
    );

    expect(result.agentKnown).toBe(false);
    expect(result.attributedTrust).toBe('untrusted');
    expect(result.decision).toBe('rejected');
    expect(result.committed).toBe(false);
  });

  it('trusts and commits a delegation from a registered, identity-known agent', async () => {
    const sentinel = setup(dir);
    const bridge = sentinel.bridge;
    bridge.registerAgent(trustedCard);
    // The kernel identity layer must also know the actor.
    sentinel.identity.register({
      id: trustedCard.id, type: 'agent', name: trustedCard.name,
      trust: 'elevated', scopes: ['*'],
    } as ActorIdentity);

    const result = await bridge.mediate(delegation(trustedCard, 'write_file', {
      path: 'ok.txt',
      content: 'trusted write',
    }));

    expect(result.agentKnown).toBe(true);
    expect(result.attributedTrust).toBe('elevated');
    expect(result.decision).toBe('trusted');
    expect(result.committed).toBe(true);
    expect(result.trace?.status).toBe('committed');
  });

  it('rejects a delegation blocked by a policy rule', async () => {
    const sentinel = setup(dir);
    sentinel.policy.addDSLRule('DENY WHEN action MATCHES "delete_*"');
    sentinel.bridge.registerAgent(trustedCard);
    sentinel.identity.register({
      id: trustedCard.id, type: 'agent', name: trustedCard.name,
      trust: 'elevated', scopes: ['*'],
    } as ActorIdentity);

    const result = await sentinel.bridge.mediate(delegation(trustedCard, 'delete_file', { path: 'ok.txt' }));
    expect(result.decision).toBe('rejected');
    expect(result.committed).toBe(false);
    expect(result.reason).toContain('failed');
  });

  it('never honors self-claimed trust for unregistered agents', async () => {
    const sentinel = setup(dir);
    const bridge = new A2ASafetyBridge(sentinel.kernel);
    const result = await bridge.mediate(
      delegation({ id: 'claimer', name: 'Claimer', trust: 'elevated', scopes: ['*'] }, 'write_file', {
        path: 'c.txt', content: 'x',
      }),
    );
    // The agent claims 'elevated' + ['*'] but is unregistered, so it is
    // downgraded to 'untrusted'. There is no opt-in that can override this.
    expect(result.agentKnown).toBe(false);
    expect(result.attributedTrust).toBe('untrusted');
  });

  it('manages a registry of agents', () => {
    const sentinel = setup(dir);
    sentinel.bridge.registerAgent(trustedCard);
    expect(sentinel.bridge.getAgent(trustedCard.id)?.trust).toBe('elevated');
    expect(sentinel.bridge.listAgents().length).toBeGreaterThanOrEqual(1);
    sentinel.bridge.removeAgent(trustedCard.id);
    expect(sentinel.bridge.getAgent(trustedCard.id)).toBeUndefined();
  });

  it('captures lifecycle errors as an error decision', async () => {
    const failingKernel = {
      execute: async () => { throw new Error('boom'); },
    };
    const bridge = new A2ASafetyBridge(failingKernel);
    bridge.registerAgent(trustedCard);
    const result = await bridge.mediate(delegation(trustedCard, 'write_file', { path: 'z.txt', content: 'z' }));
    expect(result.decision).toBe('error');
    expect(result.reason).toContain('boom');
  });
});
