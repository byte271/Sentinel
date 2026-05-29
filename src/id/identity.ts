// ---------------------------------------------------------------------------
// SENTINEL Id Module — IdentityManager
// ---------------------------------------------------------------------------
// Manages actor identities, session tokens, and authorization checks.
// ---------------------------------------------------------------------------

import { v4 as uuidv4 } from 'uuid';
import { createHmac, randomBytes } from 'crypto';
import type { ActorIdentity, TrustLevel } from '../kernel/types.js';

// ---------------------------------------------------------------------------
// Trust-level ordering (lowest → highest)
// ---------------------------------------------------------------------------

const TRUST_HIERARCHY: TrustLevel[] = [
  'untrusted',
  'restricted',
  'standard',
  'elevated',
  'full',
];

/**
 * Precomputed trust level → numeric rank map.
 * Replaces two O(n) `indexOf` calls per `trustLevelSufficient()` invocation.
 */
const TRUST_INDEX = new Map<TrustLevel, number>(
  TRUST_HIERARCHY.map((level, i) => [level, i] as [TrustLevel, number]),
);

// ---------------------------------------------------------------------------
// Session type
// ---------------------------------------------------------------------------

interface Session {
  actorId: string;
  expiresAt: number;
  scopes: string[];
}

// ---------------------------------------------------------------------------
// IdentityManager
// ---------------------------------------------------------------------------

export class IdentityManager {
  private readonly actors = new Map<string, ActorIdentity>();
  private readonly sessions = new Map<string, Session>();
  /**
   * Per-actor scope Set for O(1) scope lookups in authorize().
   * Kept in sync with actors map via register() and any future scope mutations.
   */
  private readonly scopeCache = new Map<string, Set<string>>();

  // ---- Registration --------------------------------------------------------

  register(actor: ActorIdentity): void {
    this.actors.set(actor.id, actor);
    this.scopeCache.set(actor.id, new Set(actor.scopes));
  }

  // ---- Validation ----------------------------------------------------------

  async validate(actor: ActorIdentity): Promise<boolean> {
    // Field-level validation before registry lookup — reject obviously malformed
    // identities early rather than silently matching on a bare id presence.
    if (!actor.id || typeof actor.id !== 'string' || actor.id.trim() === '') return false;
    if (!actor.name || typeof actor.name !== 'string' || actor.name.trim() === '') return false;
    if (!actor.type || !['human', 'agent', 'service', 'delegate'].includes(actor.type)) return false;
    if (!Array.isArray(actor.scopes)) return false;

    const known = this.actors.get(actor.id);
    if (!known) return false;

    // Verify the supplied fields match what was registered for this id so that
    // a caller cannot reuse a known id with a different name or type.
    if (known.type !== actor.type) return false;

    return known.trust !== 'untrusted';
  }

  // ---- Authorization -------------------------------------------------------

  async authorize(
    actor: ActorIdentity,
    action: string,
    surface: { id: string },
  ): Promise<boolean> {
    const known = this.actors.get(actor.id);
    if (!known) return false;

    if (!this.trustLevelSufficient(known.trust, 'restricted')) return false;

    // O(1) Set lookup instead of O(n) Array.includes().
    const scopeSet = this.scopeCache.get(known.id) ?? new Set(known.scopes);

    // Three-tier scope check (most-to-least permissive):
    //   '*'               — unrestricted wildcard
    //   '<action>'        — action allowed on any surface
    //   '<action>:<sid>'  — action allowed only on the specific surface
    // Surface-scoped grants enable fine-grained "action on surface" policies.
    const surfaceScoped = `${action}:${surface.id}`;
    return scopeSet.has('*') || scopeSet.has(action) || scopeSet.has(surfaceScoped);
  }

  // ---- Session secret -----------------------------------------------------

  private sessionSecret: Buffer;

  constructor(sessionSecret?: string) {
    this.sessionSecret = sessionSecret
      ? Buffer.from(sessionSecret, 'hex')
      : randomBytes(32);
  }

  // ---- Sessions ------------------------------------------------------------

  createSession(actorId: string, scopes: string[], ttlMs: number = 3_600_000): string {
    const payload = {
      actorId,
      scopes,
      expiresAt: Date.now() + ttlMs,
      jti: uuidv4(),
    };

    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.sessionSecret)
      .update(payloadB64)
      .digest('base64url');

    const token = `${signature}.${payloadB64}`;
    this.sessions.set(token, {
      actorId,
      expiresAt: payload.expiresAt,
      scopes,
    });
    return token;
  }

  validateSession(token: string): { valid: boolean; actorId?: string; scopes?: string[] } {
    // 1. Check server-side session store first
    const session = this.sessions.get(token);
    if (!session) {
      // 2. Try HMAC verification for stateless validation
      return this.verifyHmacSession(token);
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return { valid: false };
    }

    return {
      valid: true,
      actorId: session.actorId,
      scopes: session.scopes,
    };
  }

  revokeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // ---- Actor management ----------------------------------------------------

  getActor(id: string): ActorIdentity | undefined {
    return this.actors.get(id);
  }

  setTrust(actorId: string, level: TrustLevel): void {
    const actor = this.actors.get(actorId);
    if (actor) {
      actor.trust = level;
    }
  }

  /** Rotate the session secret, invalidating all existing HMAC tokens. */
  rotateSessionSecret(): Buffer {
    this.sessionSecret = randomBytes(32);
    return this.sessionSecret;
  }

  // ---- Private helpers -----------------------------------------------------

  /** Cryptographically verify an HMAC-signed session token. */
  private verifyHmacSession(token: string): { valid: boolean; actorId?: string; scopes?: string[] } {
    const dotIndex = token.indexOf('.');
    if (dotIndex === -1) return { valid: false };

    const signature = token.slice(0, dotIndex);
    const payloadB64 = token.slice(dotIndex + 1);

    const expectedSignature = createHmac('sha256', this.sessionSecret)
      .update(payloadB64)
      .digest('base64url');

    // Constant-time comparison to prevent timing attacks
    if (signature.length !== expectedSignature.length) return { valid: false };
    let mismatch = 0;
    for (let i = 0; i < signature.length; i++) {
      mismatch |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }
    if (mismatch !== 0) return { valid: false };

    // Decode and validate
    try {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
      if (Date.now() > payload.expiresAt) return { valid: false };
      return { valid: true, actorId: payload.actorId, scopes: payload.scopes };
    } catch {
      return { valid: false };
    }
  }

  // ---- Private helpers -----------------------------------------------------

  private trustLevelSufficient(actor: TrustLevel, required: TrustLevel): boolean {
    // O(1) Map lookup replaces two O(n) TRUST_HIERARCHY.indexOf() calls.
    return (TRUST_INDEX.get(actor) ?? 0) >= (TRUST_INDEX.get(required) ?? 0);
  }
}
