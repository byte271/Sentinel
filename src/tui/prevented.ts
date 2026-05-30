// ---------------------------------------------------------------------------
// SENTINEL Prevented Futures view (Feature 10)
// ---------------------------------------------------------------------------
// Safety is invisible until you can see what *would* have happened. This module
// renders a branching timeline of agent decisions — what the agent wanted to do
// versus what was allowed — as a terminal frame. Each blocked action shows its
// risk score, the rule that caught it, and a one-line justification.
//
// The renderer is pure (returns a string), so it is trivially testable and can
// be driven from a live session, a recorded execution log, or firewall scans.
// ---------------------------------------------------------------------------

export type PreventedVerdict = 'blocked' | 'approved';

export interface PreventedAction {
  /** Display timestamp, e.g. "14:32:01". */
  time: string;
  actor: string;
  /** Human-readable action, e.g. "delete /etc/shadow". */
  action: string;
  verdict: PreventedVerdict;
  /** Risk label, e.g. "CRITICAL". */
  risk: string;
  /** Numeric risk score 0–100. */
  score: number;
  rule?: string;
  justification?: string;
}

export interface PreventedFuturesData {
  actions: PreventedAction[];
}

const WIDTH = 60;

function bar(ratio: number, width = 28): string {
  const filled = Math.round(ratio * width);
  return '#'.repeat(filled) + '.'.repeat(Math.max(0, width - filled));
}

function line(text = ''): string {
  const trimmed = text.length > WIDTH ? text.slice(0, WIDTH - 1) + '…' : text;
  return `│ ${trimmed.padEnd(WIDTH)} │`;
}

/** Render the Prevented Futures frame as a plain string. */
export function renderPreventedFutures(data: PreventedFuturesData): string {
  const total = data.actions.length;
  const approved = data.actions.filter((a) => a.verdict === 'approved').length;
  const ratio = total > 0 ? approved / total : 1;
  const pct = Math.round(ratio * 100);

  const top = '┌─ Sentinel ─ Prevented Futures ' + '─'.repeat(WIDTH - 30) + '┐';
  const bottom = '└' + '─'.repeat(WIDTH + 2) + '┘';
  const out: string[] = [top];
  out.push(line());
  out.push(line(`${bar(ratio)}  ${pct}% safe (${approved}/${total} actions)`));
  out.push(line());

  const blocked = data.actions.filter((a) => a.verdict === 'blocked');
  const allowed = data.actions.filter((a) => a.verdict === 'approved');

  out.push(line('── Blocked ' + '─'.repeat(WIDTH - 11)));
  if (blocked.length === 0) out.push(line('  (none)'));
  for (const a of blocked) {
    out.push(line(`X [${a.time}] ${a.actor} -> ${a.action}`));
    out.push(line(`   Risk: ${a.risk} (${a.score})  Rule: ${a.rule ?? 'n/a'}`));
    if (a.justification) out.push(line(`   "${a.justification}"`));
    out.push(line());
  }

  out.push(line('── Approved ' + '─'.repeat(WIDTH - 12)));
  if (allowed.length === 0) out.push(line('  (none)'));
  for (const a of allowed) {
    out.push(line(`+ [${a.time}] ${a.actor} -> ${a.action}`));
    out.push(line(`   Risk: ${a.risk} (${a.score})  Rule: ${a.rule ?? 'n/a'}`));
  }

  out.push(line());
  out.push(line("Press 'd' details, 'r' replay, 'q' quit"));
  out.push(bottom);
  return out.join('\n');
}
