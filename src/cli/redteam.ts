#!/usr/bin/env node
// ---------------------------------------------------------------------------
// sentinel-redteam — Adversarial Self-Testing CLI (v0.3.0)
// ---------------------------------------------------------------------------

import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { AgentFirewall, SENTINEL_VERSION } from '../index.js';
import { RedTeamEngine, generateAttacks } from '../redteam/index.js';
import type { FirewallPolicy, RedTeamReport } from '../index.js';

const program = new Command();
program
  .name('sentinel-redteam')
  .description(`Sentinel Red Team v${SENTINEL_VERSION} — adversarial self-testing`)
  .version(SENTINEL_VERSION);

program.command('run')
  .description('Run the full adversarial attack suite against the firewall')
  .option('-a, --agent <name>', 'Agent name for the report', 'agent')
  .option('-p, --policy <policy>', 'Firewall policy (strict|balanced|permissive)', 'balanced')
  .option('-f, --format <fmt>', 'Output format (text|json)', 'text')
  .option('-o, --output <path>', 'Write the report to a file')
  .action((opts: { agent: string; policy: string; format: string; output?: string }) => {
    const fw = new AgentFirewall({ policy: opts.policy as FirewallPolicy });
    const engine = new RedTeamEngine(fw);
    const report = engine.run({ agent: opts.agent });

    if (opts.format === 'json') {
      const json = JSON.stringify(report, null, 2);
      if (opts.output) { writeFileSync(opts.output, json, 'utf-8'); console.log(chalk.green(`Written to ${opts.output}`)); }
      else console.log(json);
    } else {
      const text = RedTeamEngine.renderReport(report);
      if (opts.output) { writeFileSync(opts.output, text, 'utf-8'); console.log(chalk.green(`Written to ${opts.output}`)); }
      else console.log(text);
      printSummary(report);
    }
    process.exitCode = report.allowed > 0 ? 1 : 0;
  });

program.command('vectors')
  .description('List the attack vectors that will be generated')
  .option('-c, --category <category>', 'Filter by threat category')
  .action((opts: { category?: string }) => {
    let attacks = generateAttacks();
    if (opts.category) attacks = attacks.filter((v) => v.category === opts.category);
    console.log(chalk.bold.cyan(`\n=== Attack catalogue (${attacks.length} vectors) ===`));
    for (const v of attacks) {
      console.log(`  ${chalk.bold(v.id)}  ${chalk.dim(`[${v.category}/${v.severity}]`)}  ${v.name}`);
    }
  });

function printSummary(r: RedTeamReport): void {
  console.log();
  const scoreColor = r.defenseScore >= 90 ? chalk.green : r.defenseScore >= 70 ? chalk.yellow : chalk.red;
  console.log(`  Defense score: ${scoreColor(`${r.defenseScore}/100 (${r.grade})`)}`);
  console.log(`  Blocked: ${chalk.green(String(r.blocked))}  Warned: ${chalk.yellow(String(r.warned))}  Allowed: ${chalk.red(String(r.allowed))}`);
  if (r.weaknesses.length > 0) {
    console.log(chalk.red('\n  Weaknesses (attacks that slipped through):'));
    for (const w of r.weaknesses) {
      console.log(chalk.dim(`    ${w.attack.id}: ${w.attack.name} [${w.attack.severity}]`));
    }
  }
}

program.parse();
