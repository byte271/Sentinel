// ---------------------------------------------------------------------------
// SENTINEL A2A Safety Bridge
// ---------------------------------------------------------------------------
// The Agent-to-Agent (A2A) protocol standardizes how agents *communicate*, but
// not how they *trust* one another. When Agent A delegates a task to Agent B,
// A2A defines the message format — it does not decide whether Agent A should be
// allowed to make B do that.
//
// The A2A Safety Bridge is that missing trust layer. It receives a delegation
// (an A2A-style request), attributes a trust level to the *originating* agent
// (never honoring self-claimed trust by default), and routes the requested
// action through the full SENTINEL kernel lifecycle — identity, policy, blast
// radius, shadow execution, approval, commit — before any real effect occurs.
//
//   Agent A (untrusted) --A2A--> [ A2A Safety Bridge ] --> Kernel lifecycle
//                                                          (shadow→policy→approval→commit)
//                                                              --> Agent B (trusted execution)
//
// "A2A handles communication. SENTINEL handles trust."
// ---------------------------------------------------------------------------

import { v4 as uuid } from 'uuid';
import { makeIntent } from '../helpers.js';
import type {
  ActionIntent,
  ActorIdentity,
  TraceRecord,
  TrustLevel,
} from '../kernel/types.js';

/** A published description of a remote agent participating over A2A. */
export interface A2AAgentCard {
  id: string;
  name: string;
  /** Trust level granted to this agent by the operator (not self-asserted). */
  trust: TrustLevel;
  /** Scopes this agent is permitted to act within. */
  scopes: string[];
  /** Optional A2A endpoint URL — informational only. */
  endpoint?: string;
}

/** An incoming A2A delegation: Agent A asking for an action to be performed. */
export interface A2ADelegation {
  /** Stable id for this delegation message. Generated if omitted. */
  id?: string;
  /** The agent originating the request. */
  from: A2AAgentCard;
  /** Target surface the action operates on. */
  surface: string;
  /** The action requested. */
  action: string;
  /** Action parameters. */
  params: Record<string, unknown>;
  /** Optional natural-language task description carried in the A2A message. */
  task?: string;
  /**
   * Optional cryptographic proof of identity (e.g. a signature over the
   * delegation). Passed verbatim to a configured `verifyIdentity` callback.
   * Without a verifier configured this field is informational only.
   */
  proof?: string;
  /** Additional A2A message metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Pluggable identity verifier. Given a delegation and the matching registered
 * agent card, returns whether the sender has cryptographically proven it is
 * that registered agent. Returning false (or throwing) causes the bridge to
 * refuse to honor the registered trust and downgrade the sender.
 */
export type A2AIdentityVerifier = (
  delegation: A2ADelegation,
  registeredAgent: A2AAgentCard,
) => boolean | Promise<boolean>;

/** The bridge's trust decision for a delegation. */
export type A2ATrustDecision = 'trusted' | 'rejected' | 'pending_approval' | 'error';

/** The structured outcome of mediating a delegation. */
export interface A2ABridgeResult {
  delegationId: string;
  decision: A2ATrustDecision;
  /** Whether the source agent was found in the bridge's registry. */
  agentKnown: boolean;
  /**
   * Whether the sender cryptographically proved its registered identity. True
   * only when a registered agent passed the configured `verifyIdentity` check.
   * Always false for unregistered agents, for registered agents that failed
   * verification, and (conservatively) when no verifier is configured.
   */
  identityVerified: boolean;
  /** Trust level the bridge actually attributed (never the self-claimed one). */
  attributedTrust: TrustLevel;
  /** The kernel trace id, if the lifecycle ran. */
  traceId?: string;
  /** The full kernel trace, if the lifecycle ran. */
  trace?: TraceRecord;
  /** Whether the action was committed to reality. */
  committed: boolean;
  /** Human-readable reasoning for the decision. */
  reason: string;
  evaluatedAt: number;
}

/** Minimal kernel contract the bridge depends on. */
export interface BridgeKernel {
  execute(intent: ActionIntent): Promise<TraceRecord>;
}

/** Configuration for the bridge's trust policy. */
export interface A2ABridgeOptions {
  /** Trust level applied to agents not found in the registry. Default 'untrusted'. */
  trustUnregisteredAs?: TrustLevel;
  /**
   * Optional cryptographic identity verifier. When set, a delegation that
   * claims to come from a registered agent must pass this check before the
   * bridge will honor that agent's operator-granted trust. If verification
   * fails, the sender is downgraded to `trustUnregisteredAs` with no scopes —
   * exactly as if it were unregistered. When unset, registry membership alone
   * (a plain id match) is trusted, which is only appropriate on a trusted
   * transport.
   */
  verifyIdentity?: A2AIdentityVerifier;
}

export class A2ASafetyBridge {
  private readonly kernel: BridgeKernel;
  private readonly registry: Map<string, A2AAgentCard> = new Map();
  private readonly trustUnregisteredAs: TrustLevel;
  private readonly verifyIdentity?: A2AIdentityVerifier;

  constructor(kernel: BridgeKernel, options: A2ABridgeOptions = {}) {
    this.kernel = kernel;
    this.trustUnregisteredAs = options.trustUnregisteredAs ?? 'untrusted';
    this.verifyIdentity = options.verifyIdentity;
  }

  /** Register (or update) a known agent and its operator-granted trust. */
  registerAgent(card: A2AAgentCard): void {
    this.registry.set(card.id, { ...card, scopes: [...card.scopes] });
  }

  /** Look up a registered agent card. */
  getAgent(id: string): A2AAgentCard | undefined {
    const card = this.registry.get(id);
    return card ? { ...card, scopes: [...card.scopes] } : undefined;
  }

  /** Remove a registered agent. */
  removeAgent(id: string): void {
    this.registry.delete(id);
  }

  /** List all registered agents. */
  listAgents(): A2AAgentCard[] {
    return Array.from(this.registry.values()).map((c) => ({ ...c, scopes: [...c.scopes] }));
  }

  /**
   * Resolve the identity the action will actually run as. Registered agents
   * use their operator-granted trust and scopes — but only after passing the
   * configured cryptographic identity verifier (if any). Unregistered agents,
   * and registered agents that fail verification, are always downgraded to
   * `trustUnregisteredAs` with no scopes. Self-claimed trust is never honored —
   * there is no opt-out, which is the whole point of the bridge.
   */
  private async resolveActor(
    delegation: A2ADelegation,
  ): Promise<{ actor: ActorIdentity; known: boolean; verified: boolean }> {
    const registered = this.registry.get(delegation.from.id);
    if (registered) {
      // A registry id match alone is not proof of identity. If a verifier is
      // configured, the sender must cryptographically prove it owns that id
      // before we honor the operator-granted trust. With no verifier, the id
      // match is honored (only safe on a trusted transport) but identity is
      // reported as unverified.
      let verified = false;
      if (this.verifyIdentity) {
        try {
          verified = await this.verifyIdentity(delegation, { ...registered, scopes: [...registered.scopes] });
        } catch {
          verified = false;
        }

        if (!verified) {
          // Verification failed: treat the sender as an impostor and downgrade.
          return {
            known: true,
            verified: false,
            actor: {
              id: delegation.from.id,
              type: 'agent',
              name: delegation.from.name,
              trust: this.trustUnregisteredAs,
              scopes: [],
              delegatedBy: delegation.from.id,
            },
          };
        }
      }

      return {
        known: true,
        verified,
        actor: {
          id: registered.id,
          type: 'agent',
          name: registered.name,
          trust: registered.trust,
          scopes: [...registered.scopes],
          delegatedBy: delegation.from.id,
        },
      };
    }

    // Unregistered agents never carry self-claimed trust or scopes into the
    // kernel. They are downgraded unconditionally.
    return {
      known: false,
      verified: false,
      actor: {
        id: delegation.from.id,
        type: 'agent',
        name: delegation.from.name,
        trust: this.trustUnregisteredAs,
        scopes: [],
        delegatedBy: delegation.from.id,
      },
    };
  }

  /**
   * Mediate a delegation: attribute trust, run the SENTINEL lifecycle, and return a
   * structured trust verdict. Never throws — execution failures are captured as
   * an `error`/`rejected` decision.
   */
  async mediate(delegation: A2ADelegation): Promise<A2ABridgeResult> {
    const delegationId = delegation.id ?? uuid();
    const { actor, known, verified } = await this.resolveActor(delegation);

    const base: Pick<A2ABridgeResult, 'delegationId' | 'agentKnown' | 'identityVerified' | 'attributedTrust' | 'evaluatedAt'> = {
      delegationId,
      agentKnown: known,
      identityVerified: verified,
      attributedTrust: actor.trust,
      evaluatedAt: Date.now(),
    };

    const intent = makeIntent(delegation.surface, delegation.action, delegation.params, actor, {
      ...(delegation.metadata ?? {}),
      a2a: {
        delegationId,
        from: delegation.from.id,
        task: delegation.task,
        agentKnown: known,
      },
    });

    let trace: TraceRecord;
    try {
      trace = await this.kernel.execute(intent);
    } catch (err) {
      return {
        ...base,
        decision: 'error',
        committed: false,
        reason: `Lifecycle execution threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const reason = describeOutcome(trace);

    switch (trace.status) {
      case 'committed':
        return { ...base, decision: 'trusted', traceId: trace.id, trace, committed: true, reason };
      case 'shadow':
        // Shadow succeeded but was not auto-committed — trusted, awaiting commit.
        return { ...base, decision: 'trusted', traceId: trace.id, trace, committed: false, reason };
      case 'pending_approval':
        return { ...base, decision: 'pending_approval', traceId: trace.id, trace, committed: false, reason };
      case 'pending':
      case 'failed':
      case 'rolled_back':
      default:
        return { ...base, decision: 'rejected', traceId: trace.id, trace, committed: false, reason };
    }
  }
}

/** Extract a concise reason from a trace's status and most severe event. */
function describeOutcome(trace: TraceRecord): string {
  const severe = [...trace.events]
    .reverse()
    .find((e) => e.level === 'error' || e.level === 'warn');
  if (severe) {
    const detail = typeof severe.data?.reason === 'string' ? `: ${severe.data.reason}` : '';
    return `${trace.status} (${severe.type}${detail})`;
  }
  return `lifecycle resolved with status "${trace.status}"`;
}
