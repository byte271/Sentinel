#!/usr/bin/env node
// ---------------------------------------------------------------------------
// sentinel-tui — Prevented Futures terminal view (Feature 10)
// ---------------------------------------------------------------------------
// Renders the branching timeline of agent decisions: what the agent wanted to
// do vs. what Sentinel allowed. Drive it from a recorded execution log
// (produced by the Deterministic Replay engine) or run the bundled demo.
//
//   sentinel-tui --demo
//   sentinel-tui --input ./recording.json
//   sentinel-tui --asi            # OWASP ASI dashboard view
// ---------------------------------------------------------------------------

import { Command } from 'commander';
import { readFileSync } from 'fs';
import {
  SENTINEL_VERSION,
  renderPreventedFutures,
  OwaspAsiAssessor,
  DEFAULT_CAPABILITIES,
} from '../index.js';
import type { PreventedAction, RecordingExport } from '../index.js';

function hhmmss(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19);
}

/** Build prevented-futures actions from a recorded execution log. */
function fromRecording(rec: RecordingExport): PreventedAction[] {
  return rec.events
    .filter((e) => e.type === 'tool_call' || e.type === 'blocked')
    .map((e) => {
      if (e.type === 'blocked') {
        const reason = (e.output ?? {}) as { rule?: string; risk?: string; score?: number; justification?: string };
        return {
          time: hhmmss(e.timestamp),
          actor: 'AGENT',
          action: `${e.name} ${JSON.stringify(e.input)}`,
          verdict: 'blocked' as const,
          risk: (reason.risk ?? 'HIGH').toUpperCase(),
          score: reason.score ?? 80,
          rule: reason.rule,
          justification: reason.justification,
        };
      }
      return {
        time: hhmmss(e.timestamp),
        actor: 'AGENT',
        action: `${e.name} ${JSON.stringify(e.input)}`,
        verdict: 'approved' as const,
        risk: 'LOW',
        score: 8,
        rule: 'allowed',
      };
    });
}

const DEMO: PreventedAction[] = [
  { time: '14:32:01', actor: 'AGENT', action: 'delete /etc/shadow', verdict: 'blocked', risk: 'CRITICAL', score: 95, rule: 'cred-shadow-passwd', justification: 'Agent attempted to read system credential file' },
  { time: '14:32:18', actor: 'AGENT', action: 'POST https://api.internal/hr/data', verdict: 'blocked', risk: 'HIGH', score: 82, rule: 'exfil-curl-post', justification: 'Agent attempted to exfiltrate employee data' },
  { time: '14:31:45', actor: 'AGENT', action: 'GET https://api.github.com/repos', verdict: 'approved', risk: 'LOW', score: 8, rule: 'public-api-access' },
];

const program = new Command();
program
  .name('sentinel-tui')
  .description('Prevented Futures terminal view')
  .version(SENTINEL_VERSION)
  .option('--demo', 'Render the bundled demo timeline')
  .option('-i, --input <path>', 'Render from a recorded execution log (JSON)')
  .option('--asi', 'Render the OWASP ASI compliance dashboard instead')
  .action((opts: { demo?: boolean; input?: string; asi?: boolean }) => {
    if (opts.asi) {
      const assessment = new OwaspAsiAssessor().assess(DEFAULT_CAPABILITIES);
      console.log(OwaspAsiAssessor.renderDashboard(assessment));
      return;
    }

    let actions: PreventedAction[];
    if (opts.input) {
      const rec = JSON.parse(readFileSync(opts.input, 'utf-8')) as RecordingExport;
      actions = fromRecording(rec);
    } else if (opts.demo) {
      actions = DEMO;
    } else {
      console.log('Nothing to show. Try --demo, --input <recording.json>, or --asi.');
      return;
    }
    console.log(renderPreventedFutures({ actions }));
  });

program.parse();
