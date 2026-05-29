import type { DriftSeverity, DriftRecommendation, DriftReport, DiffEntry } from '../kernel/types.js';
import { stableHash } from '../helpers.js';

export interface DriftStateProvider {
  getExpectedState(surfaceId: string): Promise<Record<string, unknown> | undefined>;
  getActualState(surfaceId: string): Promise<Record<string, unknown>>;
}

export class DriftDetector {
  private provider: DriftStateProvider | undefined;
  private reports: Map<string, DriftReport[]> = new Map();
  private monitors: Map<string, ReturnType<typeof setInterval>> = new Map();

  setProvider(provider: DriftStateProvider): void {
    this.provider = provider;
  }

  async check(surfaceId: string): Promise<DriftReport> {
    if (!this.provider) {
      throw new Error('No DriftStateProvider configured. Call setProvider() first.');
    }

    const expected = await this.provider.getExpectedState(surfaceId);
    const actual = await this.provider.getActualState(surfaceId);

    const expectedState = expected ?? {};
    const expectedHash = this.hashState(expectedState);
    const actualHash = this.hashState(actual);

    const drifted = expectedHash !== actualHash;
    const changes = drifted ? this.diffStates(expectedState, actual) : [];

    let severity: DriftSeverity;
    if (changes.length === 0) {
      severity = 'none';
    } else if (changes.length <= 3) {
      severity = 'minor';
    } else if (changes.length <= 10) {
      severity = 'significant';
    } else {
      severity = 'critical';
    }

    let recommendation: DriftRecommendation;
    switch (severity) {
      case 'none':
        recommendation = 'accept';
        break;
      case 'minor':
        recommendation = 'investigate';
        break;
      case 'significant':
        recommendation = 'alert';
        break;
      case 'critical':
        recommendation = 'rollback';
        break;
    }

    const report: DriftReport = {
      surfaceId,
      checkedAt: Date.now(),
      expectedHash,
      actualHash,
      drifted,
      changes,
      severity,
      recommendation,
      metadata: {},
    };

    if (!this.reports.has(surfaceId)) {
      this.reports.set(surfaceId, []);
    }
    this.reports.get(surfaceId)!.push(report);

    return report;
  }

  startMonitoring(surfaceId: string, intervalMs: number): void {
    if (this.monitors.has(surfaceId)) {
      this.stopMonitoring(surfaceId);
    }

    const handle = setInterval(() => {
      this.check(surfaceId).catch(() => {
        // Monitoring continues even if a single check fails
      });
    }, intervalMs);

    this.monitors.set(surfaceId, handle);
  }

  stopMonitoring(surfaceId: string): void {
    const handle = this.monitors.get(surfaceId);
    if (handle) {
      clearInterval(handle);
      this.monitors.delete(surfaceId);
    }
  }

  getHistory(surfaceId: string): DriftReport[] {
    return this.reports.get(surfaceId) ?? [];
  }

  getLatestReport(surfaceId: string): DriftReport | undefined {
    const history = this.reports.get(surfaceId);
    if (!history || history.length === 0) return undefined;
    return history[history.length - 1];
  }

  isMonitoring(surfaceId: string): boolean {
    return this.monitors.has(surfaceId);
  }

  /**
   * Destroy the detector, clearing all intervals and stored data.
   * Must be called before garbage collection to prevent memory leaks.
   */
  destroy(): void {
    // Stop all active monitors
    for (const handle of this.monitors.values()) {
      clearInterval(handle);
    }
    this.monitors.clear();
    this.reports.clear();
    this.provider = undefined;
  }

  format(report: DriftReport): string {
    const lines: string[] = [];
    lines.push(`Drift Report: ${report.surfaceId}`);
    lines.push(`  Checked at: ${new Date(report.checkedAt).toISOString()}`);
    lines.push(`  Drifted:    ${report.drifted ? 'YES' : 'NO'}`);
    lines.push(`  Severity:   ${report.severity}`);
    lines.push(`  Recommendation: ${report.recommendation}`);
    lines.push(`  Expected hash: ${report.expectedHash}`);
    lines.push(`  Actual hash:   ${report.actualHash}`);

    if (report.changes.length > 0) {
      lines.push(`  Changes (${report.changes.length}):`);
      for (const change of report.changes) {
        const detail = change.oldValue !== undefined || change.newValue !== undefined
          ? ` — ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}`
          : '';
        lines.push(`    [${change.op}] ${change.path}${detail}`);
      }
    } else {
      lines.push('  Changes: none');
    }

    return lines.join('\n');
  }

  private hashState(state: Record<string, unknown>): string {
    return stableHash(state);
  }

  private diffStates(
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
  ): DiffEntry[] {
    const changes: DiffEntry[] = [];
    const allKeys = new Set([...Object.keys(expected), ...Object.keys(actual)]);

    for (const key of allKeys) {
      const inExpected = key in expected;
      const inActual = key in actual;

      if (inExpected && !inActual) {
        changes.push({ path: key, op: 'remove', oldValue: expected[key] });
      } else if (!inExpected && inActual) {
        changes.push({ path: key, op: 'add', newValue: actual[key] });
      } else if (inExpected && inActual) {
        const expectedVal = JSON.stringify(expected[key]);
        const actualVal = JSON.stringify(actual[key]);
        if (expectedVal !== actualVal) {
          changes.push({
            path: key,
            op: 'replace',
            oldValue: expected[key],
            newValue: actual[key],
          });
        }
      }
    }

    return changes;
  }
}
