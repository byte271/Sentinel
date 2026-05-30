import { describe, it, expect, beforeEach } from 'vitest';
import { BlastRadiusAnalyzer } from '../src/safe/blast-radius.js';

describe('BlastRadiusAnalyzer', () => {
  let analyzer: BlastRadiusAnalyzer;

  beforeEach(() => {
    analyzer = new BlastRadiusAnalyzer();
  });

  it('analyzes impact for a single resource', () => {
    analyzer.registerResource('s1', { id: 'file1', name: 'file1.txt', type: 'file' });
    const result = analyzer.analyze('i1', 's1', 'write_file', { path: 'file1.txt' });
    expect(result.directImpact).toBeGreaterThan(0);
    expect(result.summary).toBeTruthy();
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('tracks transitive dependencies', () => {
    analyzer.registerResource('s1', { id: 'a', name: 'a', type: 'file' });
    analyzer.registerResource('s2', { id: 'b', name: 'b', type: 'file' });
    analyzer.registerDependency({
      fromSurface: 's1', toSurface: 's2',
      relationship: 'triggers', description: 's1 triggers s2',
    });
    const result = analyzer.analyze('i1', 's1', 'write_file', {});
    expect(result.transitiveImpact).toBeGreaterThan(0);
  });

  it('produces visualization', () => {
    analyzer.registerResource('s1', { id: 'f1', name: 'f1', type: 'file' });
    const result = analyzer.analyze('i1', 's1', 'write_file', { path: 'f1' });
    const viz = analyzer.visualize(result);
    expect(viz).toBeTruthy();
    expect(viz).toContain('s1');
  });
});
