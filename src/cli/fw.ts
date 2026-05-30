#!/usr/bin/env node
// ---------------------------------------------------------------------------
// sentinel-fw — Agent Firewall CLI (Feature 1)
// ---------------------------------------------------------------------------
// One command to scan tool calls (or whole agent source files) for prompt
// injection, data exfiltration, privilege escalation, and credential access
// using the deterministic AgentFirewall ruleset. Framework-agnostic, local,
// no API key, no cloud.
//
//   sentinel-fw scan shell cmd="rm -rf /" --policy strict
//   sentinel-fw scan-file ./my-agent.ts
//   sentinel-fw patterns
// ---------------------------------------------------------------------------

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { AgentFirewall, SENTINEL_VERSION } from '../index.js';
import type { FirewallPolicy, FirewallResult, DetectionPatternSpec } from '../index.js';

function parseParams(args: string[]): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const a of args) {
    const i = a.indexOf('=');
    if (i > 0) p[a.slice(0, i)] = a.slice(i + 1);
  }
  return p;
}

function buildFirewall(opts: { policy?: string; rules?: string }): AgentFirewall {
  const policy = (opts.policy as FirewallPolicy) ?? 'balanced';
  const fw = new AgentFirewall({ policy });
  if (opts.rules) {
    const specs = JSON.parse(readFileSync(opts.rules, 'utf-8')) as DetectionPatternSpec[];
    fw.loadPatterns(specs);
  }
  return fw;
}

function verdictBadge(v: FirewallResult['verdict']): string {
  if (v === 'block') return chalk.bgRed.white.bold(' BLOCK ');
  if (v === 'warn') return chalk.bgYellow.black.bold(' WARN ');
  return chalk.bgGreen.black.bold(' ALLOW ');
}

function printResult(label: string, r: FirewallResult): void {
  console.log();
  console.log(`${verdictBadge(r.verdict)} ${chalk.bold(label)}`);
  console.log(chalk.dim(`  policy=${r.policy}  risk=${r.risk}  score=${r.score}  latency=${r.latencyMs.toFixed(3)}ms`));
  if (r.matches.length === 0) {
    console.log(chalk.green('  No threats detected.'));
    return;
  }
  for (const m of r.matches) {
    const sev = m.severity === 'critical' || m.severity === 'high'
      ? chalk.red(m.severity.toUpperCase())
      : chalk.yellow(m.severity.toUpperCase());
    console.log(`  ${chalk.red('⛔')} [${sev}] ${chalk.bold(m.patternId)} (${m.category})`);
    console.log(chalk.dim(`     ${m.description}`));
    console.log(chalk.dim(`     evidence: ${m.evidence}`));
  }
}

const program = new Command();
program
  .name('sentinel-fw')
  .description(`Sentinel Agent Firewall v${SENTINEL_VERSION} — deterministic tool-call scanning`)
  .version(SENTINEL_VERSION);

program.command('scan <tool> [params...]')
  .description('Scan a single tool call (params as key=value)')
  .option('-p, --policy <policy>', 'strict | balanced | permissive', 'balanced')
  .option('-t, --text <text>', 'Free-form text to include in the scan')
  .option('-r, --rules <file>', 'Path to a custom rules JSON file')
  .action((tool: string, params: string[], opts: { policy: string; text?: string; rules?: string }) => {
    const fw = buildFirewall(opts);
    const r = fw.scan({ tool, args: parseParams(params), text: opts.text });
    printResult(`${tool}`, r);
    process.exitCode = r.verdict === 'block' ? 2 : 0;
  });

program.command('scan-file <path>')
  .description('Statically scan an agent source/config file for risky patterns')
  .option('-p, --policy <policy>', 'strict | balanced | permissive', 'balanced')
  .option('-r, --rules <file>', 'Path to a custom rules JSON file')
  .action((path: string, opts: { policy: string; rules?: string }) => {
    const fw = buildFirewall(opts);
    const text = readFileSync(path, 'utf-8');
    const r = fw.scan({ tool: path, text });
    printResult(path, r);
    process.exitCode = r.verdict === 'block' ? 2 : 0;
  });

program.command('patterns')
  .description('List the active detection patterns')
  .option('-r, --rules <file>', 'Path to a custom rules JSON file')
  .action((opts: { rules?: string }) => {
    const fw = buildFirewall(opts);
    console.log(chalk.bold.cyan(`\n=== Detection patterns (${fw.patternCount}) ===`));
    for (const pat of fw.listPatterns()) {
      console.log(`  ${chalk.bold(pat.id)}  ${chalk.dim(`[${pat.category}/${pat.severity}]`)}`);
      console.log(chalk.dim(`     ${pat.description}`));
    }
  });

program.parse();
