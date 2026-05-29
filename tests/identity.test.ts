import { describe, it, expect, beforeEach } from 'vitest';
import { IdentityManager } from '../src/id/identity.js';
import type { ActorIdentity } from '../src/kernel/types.js';

describe('IdentityManager', () => {
  let mgr: IdentityManager;

  const actor: ActorIdentity = {
    id: 'a1', type: 'agent', name: 'Agent', trust: 'elevated', scopes: ['*'],
  };

  const untrusted: ActorIdentity = {
    id: 'a2', type: 'agent', name: 'Bad', trust: 'untrusted', scopes: [],
  };

  beforeEach(() => {
    mgr = new IdentityManager();
  });

  it('registers and validates a known actor', async () => {
    mgr.register(actor);
    expect(await mgr.validate(actor)).toBe(true);
  });

  it('rejects unknown actors', async () => {
    expect(await mgr.validate(actor)).toBe(false);
  });

  it('rejects untrusted actors', async () => {
    mgr.register(untrusted);
    expect(await mgr.validate(untrusted)).toBe(false);
  });

  it('authorizes scoped actions', async () => {
    mgr.register(actor);
    expect(await mgr.authorize(actor, 'write_file', { id: 'fs/docs' })).toBe(true);
  });

  it('rejects out-of-scope actions', async () => {
    const limited: ActorIdentity = {
      id: 'a3', type: 'human', name: 'User', trust: 'standard', scopes: ['db/*'],
    };
    mgr.register(limited);
    expect(await mgr.authorize(limited, 'write_file', { id: 'fs/docs' })).toBe(false);
  });

  it('creates and validates sessions', () => {
    mgr.register(actor);
    const token = mgr.createSession(actor.id, ['*'], 60_000);
    expect(token).toBeTruthy();
    expect(mgr.validateSession(token).valid).toBe(true);
  });

  it('rejects expired sessions', () => {
    mgr.register(actor);
    const token = mgr.createSession(actor.id, ['*'], -1);
    expect(mgr.validateSession(token).valid).toBe(false);
  });
});
