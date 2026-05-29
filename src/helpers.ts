// ---------------------------------------------------------------------------
// SENTINEL Helpers — convenience utilities
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import { v4 as uuid } from 'uuid';
import type { ActionIntent, ActorIdentity, Surface } from './kernel/types.js';

/**
 * Convenience factory for ActionIntent. Fills in id, timestamp, and metadata
 * with sensible defaults so callers only need to specify the essentials.
 */
export function makeIntent(
  surface: string,
  action: string,
  params: Record<string, unknown>,
  initiator: ActorIdentity,
  metadata?: Record<string, unknown>,
): ActionIntent {
  return {
    id: uuid(),
    surface,
    action,
    params,
    initiator,
    timestamp: Date.now(),
    metadata: metadata ?? {},
  };
}

/**
 * Deterministic JSON serialization — sorts object keys so that logically
 * equivalent objects produce identical strings regardless of key insertion
 * order. Used by StateManager and DriftDetector for consistent hashing.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce<Record<string, unknown>>((sorted, k) => {
          sorted[k] = (val as Record<string, unknown>)[k];
          return sorted;
        }, {});
    }
    return val;
  });
}

/**
 * Compute a SHA-256 hash of an object via stable serialization.
 */
export function stableHash(data: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(data)).digest('hex');
}

/**
 * Infer the rollback action name for a given forward action, optionally
 * consulting the surface's registered capabilities for an explicit mapping.
 *
 * Resolution order:
 *  1. Surface-declared capability: if the capability is reversible, derive the
 *     inverse action from naming conventions (create_X ↔ delete_X,
 *     write_X / update_X / modify_X → restore_X or restore_<surfaceType>).
 *  2. Filesystem-style prefix heuristics as a universal fallback.
 *  3. Read/get/list actions return `undefined` — no rollback needed.
 *
 * This is the canonical implementation shared between the Kernel and the
 * TemporalBranchEngine so both paths stay in sync.
 */
export function inferRollbackAction(action: string, surface?: Surface): string | undefined {
  // 1. Surface-declared rollback via capability conventions
  if (surface) {
    const capability = surface.capabilities.find((c) => c.action === action);
    if (capability?.reversible) {
      if (action.startsWith('create_')) {
        const undo = action.replace('create_', 'delete_');
        if (surface.capabilities.some((c) => c.action === undo)) return undo;
      }
      if (action.startsWith('delete_')) {
        const undo = action.replace('delete_', 'create_');
        if (surface.capabilities.some((c) => c.action === undo)) return undo;
      }
      if (action.startsWith('write_') || action.startsWith('update_') || action.startsWith('modify_')) {
        const specific = 'restore_' + action.split('_').slice(1).join('_');
        if (surface.capabilities.some((c) => c.action === specific)) return specific;
        const generic = `restore_${surface.type}`;
        if (surface.capabilities.some((c) => c.action === generic)) return generic;
      }
    }
  }

  // 2. Filesystem-style prefix heuristics
  if (action.startsWith('write_') || action.startsWith('create_')) return 'restore_file';
  if (action.startsWith('delete_')) return 'restore_file';
  if (action.startsWith('update_') || action.startsWith('modify_')) return 'restore_file';

  // 3. Read-only actions need no rollback
  if (action.startsWith('get_') || action.startsWith('list_') || action.startsWith('read_')) {
    return undefined;
  }

  return undefined;
}
