// ---------------------------------------------------------------------------
// Feature 10: Prevented Futures renderer tests.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { renderPreventedFutures } from '../src/tui/prevented.js';
import type { PreventedAction } from '../src/tui/prevented.js';

const actions: PreventedAction[] = [
  { time: '14:32:01', actor: 'AGENT', action: 'delete /etc/shadow', verdict: 'blocked', risk: 'CRITICAL', score: 95, rule: 'cred-shadow-passwd', justification: 'system credential file' },
  { time: '14:31:45', actor: 'AGENT', action: 'GET https://api.github.com', verdict: 'approved', risk: 'LOW', score: 8, rule: 'public-api-access' },
];

describe('renderPreventedFutures', () => {
  it('renders a framed timeline with a safety bar', () => {
    const out = renderPreventedFutures({ actions });
    expect(out).toContain('Prevented Futures');
    expect(out).toContain('50% safe (1/2 actions)');
    expect(out).toContain('Blocked');
    expect(out).toContain('Approved');
    expect(out).toContain('cred-shadow-passwd');
  });

  it('reports 100% safe when nothing was blocked', () => {
    const out = renderPreventedFutures({ actions: [actions[1]] });
    expect(out).toContain('100% safe (1/1 actions)');
  });

  it('handles an empty timeline', () => {
    const out = renderPreventedFutures({ actions: [] });
    expect(out).toContain('100% safe (0/0 actions)');
    expect(out).toContain('(none)');
  });
});
