// ---------------------------------------------------------------------------
// Feature 8: OWASP ASI compliance tests.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { OwaspAsiAssessor, ASI_RISKS, DEFAULT_CAPABILITIES } from '../src/compliance/owasp.js';

describe('OwaspAsiAssessor', () => {
  it('covers all 10 ASI risks', () => {
    expect(ASI_RISKS).toHaveLength(10);
  });

  it('full configuration covers 9 fully and ASI08 partially (matches spec)', () => {
    const a = new OwaspAsiAssessor().assess(DEFAULT_CAPABILITIES);
    expect(a.fullyCovered).toBe(9);
    expect(a.partiallyCovered).toBe(1);
    expect(a.uncovered).toBe(0);
    const asi08 = a.risks.find((r) => r.id === 'ASI08');
    expect(asi08?.coverage).toBe('partial');
    // 9 full (1.0) + 1 partial (0.5) = 9.5 / 10 = 95.
    expect(a.score).toBe(95);
    expect(a.grade).toBe('A+');
  });

  it('reports missing capabilities and lowers the score', () => {
    const caps = DEFAULT_CAPABILITIES.filter((c) => c !== 'memory-integrity');
    const a = new OwaspAsiAssessor().assess(caps);
    const asi05 = a.risks.find((r) => r.id === 'ASI05');
    expect(asi05?.coverage).toBe('none');
    expect(asi05?.missing).toContain('memory-integrity');
    expect(a.score).toBeLessThan(95);
  });

  it('scores an unconfigured deployment at zero', () => {
    const a = new OwaspAsiAssessor().assess([]);
    expect(a.score).toBe(0);
    expect(a.grade).toBe('F');
  });

  it('renders a text dashboard', () => {
    const a = new OwaspAsiAssessor().assess(DEFAULT_CAPABILITIES);
    const dash = OwaspAsiAssessor.renderDashboard(a);
    expect(dash).toContain('OWASP ASI Top-10');
    expect(dash).toContain('ASI01');
    expect(dash).toContain('Grade: A+');
  });
});
