import type { StateSnapshot } from '../kernel/types.js';
import { stableStringify, stableHash } from '../helpers.js';

export class StateManager {
  private snapshots: Map<string, StateSnapshot[]> = new Map();

  async getState(surfaceId: string): Promise<StateSnapshot | undefined> {
    const history = this.snapshots.get(surfaceId);
    if (!history || history.length === 0) {
      return undefined;
    }
    return history[history.length - 1];
  }

  updateState(surfaceId: string, state: StateSnapshot): void {
    // Use the provided snapshot directly (recompute hash if empty)
    const snapshot: StateSnapshot = {
      ...state,
      hash: state.hash || this.computeHash(state.data),
    };

    if (!this.snapshots.has(surfaceId)) {
      this.snapshots.set(surfaceId, []);
    }
    this.snapshots.get(surfaceId)!.push(snapshot);
  }

  /** Convenience wrapper that constructs a snapshot from raw data then delegates to updateState. */
  updateStateFromData(surfaceId: string, data: Record<string, unknown>): StateSnapshot {
    const snapshot: StateSnapshot = {
      surfaceId,
      timestamp: Date.now(),
      data,
      hash: this.computeHash(data),
      confidence: 1.0,
    };
    this.updateState(surfaceId, snapshot);
    return snapshot;
  }

  getHistory(surfaceId: string, limit?: number): StateSnapshot[] {
    const history = this.snapshots.get(surfaceId) ?? [];
    if (limit !== undefined && limit > 0) {
      return history.slice(-limit);
    }
    return [...history];
  }

  compareStates(
    a: StateSnapshot,
    b: StateSnapshot,
  ): { changes: Array<{ path: string; old: unknown; new: unknown }> } {
    const changes: Array<{ path: string; old: unknown; new: unknown }> = [];
    const allKeys = new Set([...Object.keys(a.data), ...Object.keys(b.data)]);

    for (const key of allKeys) {
      const oldVal = a.data[key];
      const newVal = b.data[key];
      if (stableStringify(oldVal) !== stableStringify(newVal)) {
        changes.push({ path: key, old: oldVal, new: newVal });
      }
    }

    return { changes };
  }

  private computeHash(data: Record<string, unknown>): string {
    return stableHash(data);
  }
}
