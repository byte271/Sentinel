#!/usr/bin/env node
// ---------------------------------------------------------------------------
// sentinel-shield — out-of-band agent safety sidecar CLI (v0.3.0)
// ---------------------------------------------------------------------------
// Start the Shield as a separate process to intercept every tool call at the
// protocol level. Agents connect over TCP or a Unix domain socket and receive
// a token. The kill switch is wired at the OS level — if the agent goes rogue,
// it dies with SIGKILL (no negotiation).
//
//   sentinel-shield --port 9090 --policy strict --watchdog 5000
//   sentinel-shield --port 9090 --status
// ---------------------------------------------------------------------------

import { Command } from 'commander';
import chalk from 'chalk';
import { SENTINEL_VERSION } from '../index.js';
import { ShieldServer } from '../shield/server.js';
import { ShieldClient } from '../shield/client.js';
import type { FirewallPolicy } from '../index.js';

const program = new Command();
program
  .name('sentinel-shield')
  .description(`Sentinel Shield sidecar v${SENTINEL_VERSION}`)
  .version(SENTINEL_VERSION);

program.command('start')
  .description('Start the Shield sidecar process')
  .option('-p, --port <port>', 'TCP port to listen on', '9090')
  .option('-s, --socket <path>', 'Unix domain socket path')
  .option('--host <host>', 'Bind address', '127.0.0.1')
  .option('--policy <policy>', 'Firewall policy (strict|balanced|permissive)', 'strict')
  .option('--watchdog <ms>', 'Watchdog window in ms (0 to disable)', '5000')
  .option('--http <port>', 'Also serve the enterprise dashboard + JSON API on this HTTP port')
  .action(async (opts: { port: string; socket?: string; host: string; policy: string; watchdog: string; http?: string }) => {
    const server = new ShieldServer({
      port: parseInt(opts.port, 10),
      host: opts.host,
      socketPath: opts.socket,
      policy: opts.policy as FirewallPolicy,
      watchdogMs: parseInt(opts.watchdog, 10) || undefined,
      httpPort: opts.http ? parseInt(opts.http, 10) : undefined,
    });
    await server.listen();
    console.log(chalk.green(`Shield running on ${opts.host}:${opts.port}  policy=${opts.policy}  watchdog=${opts.watchdog}ms`));
    if (opts.http) console.log(chalk.green(`Dashboard:  http://${opts.host}:${opts.http}`));
    console.log(chalk.dim('Press Ctrl+C to stop.'));
    const shutdown = async () => {
      console.log(chalk.yellow('\nShutting down Shield...'));
      await server.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });

program.command('status')
  .description('Query a running Shield for its current status')
  .option('-p, --port <port>', 'Shield port', '9090')
  .option('--host <host>', 'Shield host', '127.0.0.1')
  .option('-s, --socket <path>', 'Unix socket path')
  .action(async (opts: { port: string; host: string; socket?: string }) => {
    const client = new ShieldClient({
      port: opts.socket ? undefined : parseInt(opts.port, 10),
      host: opts.host,
      socketPath: opts.socket,
    });
    try {
      await client.connect('status-probe');
      const s = await client.status();
      console.log(chalk.bold.cyan('Shield Status'));
      console.log(`  Version:     ${s.shieldVersion}`);
      console.log(`  Policy:      ${s.policy}`);
      console.log(`  Uptime:      ${(s.uptimeMs / 1000).toFixed(1)}s`);
      console.log(`  Kill Switch: ${s.killSwitch === 'armed' ? chalk.green('ARMED') : chalk.red('FIRED')}`);
      console.log(`  Agents:      ${s.agents.length}`);
      for (const a of s.agents) {
        console.log(chalk.dim(`    ${a.agent} — ${a.status} (${a.operations} ops)`));
      }
      console.log(`  Stats:       ${chalk.green(String(s.stats.allowed))} allowed / ${chalk.yellow(String(s.stats.warned))} warned / ${chalk.red(String(s.stats.blocked))} blocked`);
    } catch (err) {
      console.error(chalk.red(`Cannot reach Shield: ${(err as Error).message}`));
      process.exitCode = 1;
    } finally {
      client.close();
    }
  });

program.parse();
