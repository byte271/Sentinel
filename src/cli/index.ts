#!/usr/bin/env node
// ---------------------------------------------------------------------------
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
// Sentinel CLI — Shadow-First Execution for AI Actions
// ---------------------------------------------------------------------------
// The CLI version string is read from the single canonical source
// (package.json via SENTINEL_VERSION), so it can never drift from the package
// version (B1).
<<<<<<< HEAD
=======
=======
// Sentinel CLI v0.1.0 — Shadow-First Execution for AI Actions
>>>>>>> e550e260dcc2f57c57596854a8be22259fd660ce
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
// ---------------------------------------------------------------------------

import { Command } from 'commander';
import chalk from 'chalk';
import { v4 as uuid } from 'uuid';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'fs';
import {
  createSentinel,
  createFilesystemSurface,
  FilesystemAdapter,
  TemporalBranchEngine,
  gatherEvidence,
<<<<<<< HEAD
  SENTINEL_VERSION,
  HttpServer,
  TokenManager,
  ShieldClient,
} from '../index.js';
import type { SentinelServices } from '../index.js';
=======
<<<<<<< HEAD
  SENTINEL_VERSION,
  HttpServer,
  TokenManager,
} from '../index.js';
import type { SentinelServices } from '../index.js';
=======
} from '../index.js';
>>>>>>> e550e260dcc2f57c57596854a8be22259fd660ce
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
import type { ActorIdentity, ActionIntent, TimelineForkRequest, PruningStrategy } from '../kernel/types.js';

// ---------------------------------------------------------------------------
// Shared instance
// ---------------------------------------------------------------------------

const sentinel = createSentinel();

const CLI_ACTOR: ActorIdentity = {
  id: 'cli-user',
  type: 'human',
  name: 'CLI User',
  trust: 'elevated',
  scopes: ['*'],
};
sentinel.identity.register(CLI_ACTOR);

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const H = (t: string) => { console.log(); console.log(chalk.bold.cyan(`=== ${t} ===`)); };
const I = (t: string) => console.log(chalk.cyan(`  ${t}`));
const S = (t: string) => console.log(chalk.green(`  ${t}`));
const W = (t: string) => console.log(chalk.yellow(`  ${t}`));
const F = (t: string) => console.log(chalk.red(`  ${t}`));
const D = (t: string) => console.log(chalk.dim(`  ${t}`));
const B = (t: string) => console.log(chalk.bold(`  ${t}`));

function makeIntent(surface: string, action: string, params: Record<string, unknown>): ActionIntent {
  return { id: uuid(), surface, action, params, initiator: CLI_ACTOR, timestamp: Date.now(), metadata: { source: 'cli' } };
}

function parseParams(args: string[]): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const a of args) { const i = a.indexOf('='); if (i > 0) p[a.slice(0, i)] = a.slice(i + 1); }
  return p;
}

function statusColor(s: string): string {
  if (s === 'committed') return chalk.green(s);
  if (s === 'failed' || s === 'rolled_back') return chalk.red(s);
  if (s === 'pending_approval') return chalk.magenta(s);
  return chalk.yellow(s);
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command();
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
program
  .name('sentinel')
  .description(`Sentinel v${SENTINEL_VERSION} — Shadow-First Execution for AI Actions`)
  .version(SENTINEL_VERSION);
<<<<<<< HEAD
=======
=======
program.name('sentinel').description('Sentinel v0.1.0 — Shadow-First Execution for AI Actions').version('0.1.0');
>>>>>>> e550e260dcc2f57c57596854a8be22259fd660ce
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7

// -- execute ----------------------------------------------------------------
program.command('execute <surface> <action> [params...]')
  .description('Full lifecycle execution (shadow -> verify -> commit)')
  .action(async (surface: string, action: string, paramArgs: string[]) => {
    H(`Execute: ${action} on ${surface}`);
    try {
      const trace = await sentinel.kernel.execute(makeIntent(surface, action, parseParams(paramArgs)));
      I(`Trace:  ${trace.id}`);
      I(`Status: ${statusColor(trace.status)}`);
      if (trace.shadowResult) W(`Shadow: ${trace.shadowResult.status} (confidence: ${trace.shadowResult.confidence})`);
      if (trace.commitResult) {
        (trace.commitResult.status === 'committed' ? S : F)(`Commit: ${trace.commitResult.status}`);
      }
      I(`Events: ${trace.events.length}`);
      I(`Chain:  entry #${sentinel.trace.getChainLength() - 1}, root ${sentinel.trace.getChainRoot().slice(0, 16)}...`);
    } catch (err) { F(`Error: ${err instanceof Error ? err.message : String(err)}`); }
  });

// -- shadow -----------------------------------------------------------------
program.command('shadow <surface> <action> [params...]')
  .description('Shadow-only execution (no commit)')
  .action(async (surface: string, action: string, paramArgs: string[]) => {
    H(`Shadow: ${action} on ${surface}`);
    const adapter = sentinel.executor.getAdapter(surface);
    if (!adapter) { F(`No adapter for "${surface}"`); return; }
    try {
      const r = await adapter.executeShadow(action, parseParams(paramArgs));
      W('Result:'); console.log(chalk.yellow(JSON.stringify(r.result, null, 2)));
      if (r.sideEffects.length) { W('Side effects:'); r.sideEffects.forEach(s => console.log(chalk.yellow(`    - ${s}`))); }
      else I('No side effects (read-only).');
    } catch (err) { F(`Error: ${err instanceof Error ? err.message : String(err)}`); }
  });

// -- trace ------------------------------------------------------------------
const traceCmd = program.command('trace').description('Trace & audit management');

traceCmd.command('list').description('List all traces').action(() => {
  const traces = sentinel.trace.list();
  if (!traces.length) { I('No traces.'); return; }
  H('Traces');
  for (const t of traces) {
    const time = new Date(t.startedAt).toISOString();
    console.log(`  ${chalk.dim(t.id.slice(0, 8))}  ${statusColor(t.status)}  ${t.surface}/${t.intent.action}  ${chalk.dim(time)}`);
  }
});

traceCmd.command('show <id>').description('Show trace detail').action((id: string) => {
  const traces = sentinel.trace.list();
  const t = traces.find(x => x.id === id || x.id.startsWith(id));
  if (!t) { F(`Not found: ${id}`); return; }
  H(`Trace ${t.id}`);
  I(`Intent:   ${t.intent.action} on ${t.surface}`);
  I(`Status:   ${statusColor(t.status)}`);
  I(`Actor:    ${t.actor.name} (${t.actor.type})`);
  I(`Started:  ${new Date(t.startedAt).toISOString()}`);
  if (t.completedAt) I(`Duration: ${t.completedAt - t.startedAt}ms`);
  if (t.events.length) {
    B('Events:');
    for (const ev of t.events) {
      const lvl = ev.level === 'error' ? chalk.red(ev.level) : ev.level === 'warn' ? chalk.yellow(ev.level) : chalk.dim(ev.level);
      console.log(`    ${chalk.dim(new Date(ev.timestamp).toISOString())}  ${lvl}  ${ev.type}`);
    }
  }
});

traceCmd.command('export [id]').description('Export as JSON').action((id?: string) => {
  console.log(id ? sentinel.trace.export(id) : sentinel.trace.exportAll());
});

// -- chain ------------------------------------------------------------------
const chainCmd = program.command('chain').description('Merkle trace chain');

chainCmd.command('verify').description('Verify chain integrity').action(() => {
  H('Chain Verification');
  const v = sentinel.trace.verifyChain();
  I(`Length: ${v.length} entries`);
  I(`Root:   ${sentinel.trace.getChainRoot() || '(empty)'}`);
  if (v.valid) S('Integrity: VALID — no tampering detected');
  else { F(`Integrity: BROKEN at entry #${v.brokenAt}`); F(`Reason: ${v.brokenReason}`); }
});

chainCmd.command('show').description('Show chain entries').action(() => {
  const entries = sentinel.trace.exportChain();
  if (!entries.length) { I('Chain is empty.'); return; }
  H(`Merkle Chain (${entries.length} entries)`);
  for (const e of entries) {
    console.log(`  ${chalk.bold(`#${e.sequenceNumber}`)}  ${chalk.dim(e.traceId.slice(0, 8))}  ${chalk.dim(e.contentHash.slice(0, 16))}...  prev:${chalk.dim(e.previousHash.slice(0, 8))}...`);
  }
  I(`Root: ${entries[entries.length - 1].merkleRoot.slice(0, 32)}...`);
});

// -- policy -----------------------------------------------------------------
const policyCmd = program.command('policy').description('Policy DSL management');

policyCmd.command('add <expression>').description('Add a DSL rule').action((expr: string) => {
  try { sentinel.policy.addDSLRule(expr); S(`Rule added: ${expr}`); }
  catch (err) { F(`Parse error: ${err instanceof Error ? err.message : String(err)}`); }
});

policyCmd.command('list').description('List DSL rules').action(() => {
  const rules = sentinel.policy.listDSLRules();
  if (!rules.length) { I('No DSL rules.'); return; }
  H('Policy DSL Rules');
  for (const r of rules) console.log(`  ${chalk.dim(r.id.slice(0, 8))}  ${chalk.bold(r.verdict)}  ${r.raw}`);
});

// -- nist -------------------------------------------------------------------
program.command('nist')
  .description('Generate a NIST AI RMF compliance report for this SENTINEL instance')
  .option('--json', 'Emit the full report as JSON')
  .action((opts: { json?: boolean }) => {
    const evidence = gatherEvidence(sentinel);
    const report = sentinel.nist.generateReport(evidence);

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    H('NIST AI RMF Compliance Report');
    I(`Framework:  ${report.framework}`);
    I(`Coverage:   ${report.summary.coverageScore}%  (${report.summary.readiness})`);
    I(`Controls:   ${report.summary.satisfied} satisfied / ${report.summary.partial} partial / ${report.summary.unsatisfied} unsatisfied`);
    for (const fn of Object.values(report.byFunction)) {
      console.log(`    ${chalk.bold(fn.function.padEnd(8))} ${fn.coverageScore}%  (${fn.satisfied}/${fn.applicable})`);
    }
    for (const c of report.controls) {
      const mark = c.status === 'satisfied' ? S : c.status === 'partial' ? W : F;
      mark(`${c.id.padEnd(12)} ${c.status.padEnd(12)} ${c.title}`);
    }
    if (report.gaps.length) {
      H('Gaps & Recommendations');
      for (const g of report.gaps) W(`${g.id}: ${g.recommendation}`);
    }
  });

// -- status -----------------------------------------------------------------
program.command('status').description('System status').action(() => {
<<<<<<< HEAD
  H(`Sentinel v${SENTINEL_VERSION} Status`);
=======
<<<<<<< HEAD
  H(`Sentinel v${SENTINEL_VERSION} Status`);
=======
  H('Sentinel v0.1.0 Status');
>>>>>>> e550e260dcc2f57c57596854a8be22259fd660ce
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
  const surfaces = sentinel.kernel.listSurfaces();
  I(`Surfaces:   ${surfaces.length}`);
  for (const s of surfaces) console.log(`    ${chalk.bold(s.id)}  ${s.name}  (${s.type}, ${s.capabilities.length} caps)`);
  const stats = sentinel.trace.getStats();
  I(`Traces:     ${stats.total}`);
  if (stats.total) {
    for (const [k, v] of Object.entries(stats.byStatus)) console.log(`    ${k}: ${v}`);
    I(`Avg duration: ${stats.avgDurationMs.toFixed(1)}ms`);
  }
  I(`Chain:      ${sentinel.trace.getChainLength()} entries`);
  if (sentinel.trace.getChainLength()) I(`Chain root: ${sentinel.trace.getChainRoot().slice(0, 32)}...`);
  const spec = sentinel.spec.getSpec();
  I(`Protocol:   v${spec.protocolVersion}`);
  I(`Modules:    ${spec.modules.join(', ')}`);
  const pending = sentinel.approval.getPending();
  if (pending.length) W(`Pending approvals: ${pending.length}`);
  const dslRules = sentinel.policy.listDSLRules();
  if (dslRules.length) I(`DSL rules:  ${dslRules.length}`);
});

// -- rollback ---------------------------------------------------------------
program.command('rollback <traceId>').description('Rollback a committed action').action(async (traceId: string) => {
  H(`Rollback: ${traceId}`);
  try {
    const r = await sentinel.kernel.rollback(traceId);
    (r.status === 'rolled_back' ? S : F)(`Status: ${r.status}`);
  } catch (err) { F(`Error: ${err instanceof Error ? err.message : String(err)}`); }
});

// -- demo -------------------------------------------------------------------
program.command('demo').description('Full v0.3.0 lifecycle demo').action(async () => {
  const demoDir = join(tmpdir(), `sentinel-demo-${Date.now()}`);
  mkdirSync(demoDir, { recursive: true });

  console.log();
  console.log(chalk.bold.white('  ╔══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.white('  ║') + chalk.bold.cyan('       SENTINEL v0.3.0 — Shadow-First Execution Demo             ') + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ║') + chalk.dim('       Git for Real-World AI Operations                      ') + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ╚══════════════════════════════════════════════════════════════╝'));
  D(`Working directory: ${demoDir}`);

  // ── 1. Register surface ──────────────────────────────────────────────────
  H('Step 1: Register Filesystem Surface');
  const sid = 'demo-fs';
  const surface = createFilesystemSurface(sid, 'Demo Filesystem', demoDir);
  sentinel.kernel.registerSurface(surface);
  const adapter = new FilesystemAdapter(sid, demoDir);
  sentinel.executor.registerAdapter(adapter);
  S(`Surface "${sid}" registered with 5 capabilities`);
  for (const c of surface.capabilities) {
    console.log(`    ${chalk.dim(c.riskLevel.padEnd(8))} ${c.action}`);
  }

  // ── 2. Policy DSL ────────────────────────────────────────────────────────
  H('Step 2: Add Policy DSL Rules');
  sentinel.policy.addDSLRule('DENY WHEN action MATCHES "delete_*"');
  sentinel.policy.addDSLRule('WARN WHEN surface.name CONTAINS "Demo"');
  S('Added 2 declarative policy rules:');
  for (const r of sentinel.policy.listDSLRules()) {
    console.log(`    ${chalk.bold(r.verdict.padEnd(18))} ${r.raw}`);
  }

  // ── 3. Blast radius analysis ─────────────────────────────────────────────
  H('Step 3: Blast Radius Analysis');
  sentinel.blastRadius.registerResource(sid, { id: 'hello.txt', name: 'hello.txt', type: 'file' });
  const blastIntent: ActionIntent = {
    id: 'demo-intent', surface: sid, action: 'write_file',
    params: { path: 'hello.txt' }, initiator: CLI_ACTOR, timestamp: Date.now(), metadata: {},
  };
  const blast = sentinel.blastRadius.analyze(blastIntent, surface);
  I(`Direct impact:     ${blast.directImpact} resource(s)`);
  I(`Transitive impact: ${blast.transitiveImpact} resource(s)`);
  I(`Risk amplification: ${blast.riskAmplification}x`);
  I(`Summary: ${blast.summary}`);
  const viz = sentinel.blastRadius.visualize(blast);
  if (viz) { console.log(); console.log(viz); }

  // ── 4. Shadow execution ──────────────────────────────────────────────────
  H('Step 4: Shadow Execute (Preview Only)');
  const shadowRes = await adapter.executeShadow('write_file', { path: 'hello.txt', content: 'Hello from SENTINEL v0.3!' });
  W('Predicted result (no real changes yet):');
  console.log(chalk.yellow(`    ${JSON.stringify(shadowRes.result)}`));
  for (const se of shadowRes.sideEffects) console.log(chalk.yellow(`    Side effect: ${se}`));

  // ── 5. Full lifecycle execution ──────────────────────────────────────────
  H('Step 5: Full Lifecycle — Shadow -> Verify -> Commit');
  const writeIntent = makeIntent(sid, 'write_file', { path: 'hello.txt', content: 'Hello from SENTINEL v0.3!' });
  const writeTrace = await sentinel.kernel.execute(writeIntent);
  I(`Trace ID: ${writeTrace.id}`);
  I(`Status:   ${statusColor(writeTrace.status)}`);
  if (writeTrace.status === 'committed') {
    S('File written through verified shadow-first lifecycle.');
  } else if (writeTrace.status === 'shadow') {
    W('Shadow-only. Committing directly...');
    await adapter.executeReal('write_file', { path: 'hello.txt', content: 'Hello from SENTINEL v0.3!' });
    S('File committed directly after shadow validation.');
  }
  I(`Lifecycle events: ${writeTrace.events.length}`);
  B('Event timeline:');
  for (const ev of writeTrace.events.slice(0, 8)) {
    const icon = ev.type.includes('done') ? chalk.green('*') : ev.type.includes('start') ? chalk.cyan('>') : chalk.dim('-');
    console.log(`    ${icon} ${ev.type}`);
  }
  if (writeTrace.events.length > 8) D(`  ... +${writeTrace.events.length - 8} more events`);

  // ── 6. Read file back ────────────────────────────────────────────────────
  H('Step 6: Verify — Read File Back');
  const readRes = await adapter.executeReal('read_file', { path: 'hello.txt' });
  S(`Content: "${readRes.result.content}"`);
  I(`Evidence collected: ${readRes.evidence.length} entries`);

  // ── 7. Merkle chain ──────────────────────────────────────────────────────
  H('Step 7: Merkle Trace Chain — Tamper-Evident Audit');
  const chainLen = sentinel.trace.getChainLength();
  I(`Chain length: ${chainLen} entries`);
  I(`Merkle root:  ${sentinel.trace.getChainRoot().slice(0, 48)}...`);
  const verification = sentinel.trace.verifyChain();
  if (verification.valid) {
    S(`Chain integrity: VALID (${verification.length} entries verified)`);
  } else {
    F(`Chain integrity: BROKEN at #${verification.brokenAt}`);
  }
  if (chainLen > 0) {
    const proof = sentinel.trace.getChainProof(0);
    I(`Merkle proof for entry #0: ${proof.length} sibling hashes`);
    D('(Any single entry can be independently verified without revealing others)');
  }

  // ── 8. Drift detection ──────────────────────────────────────────────────
  H('Step 8: Drift Detection');
  // Store current state as expected, then make an out-of-band change
  sentinel.state.updateStateFromData(sid, await adapter.getState());
  I('Captured expected state snapshot.');
  // Simulate unauthorized change
  writeFileSync(join(demoDir, 'unauthorized.txt'), 'This was not done through SENTINEL!');
  W('Simulated unauthorized change: created "unauthorized.txt" outside SENTINEL');
  // Set up drift provider
  sentinel.drift.setProvider({
    getExpectedState: async (surfaceId: string) => {
      const snap = await sentinel.state.getState(surfaceId);
      return snap?.data;
    },
    getActualState: async () => adapter.getState(),
  });
  const driftReport = await sentinel.drift.check(sid);
  if (driftReport.drifted) {
    F(`Drift detected! Severity: ${driftReport.severity}`);
    F(`Recommendation: ${driftReport.recommendation}`);
    I(`Changes found: ${driftReport.changes.length}`);
    for (const c of driftReport.changes) {
      console.log(`    ${chalk.red(c.op.padEnd(10))} ${c.path}`);
    }
  } else {
    S('No drift detected.');
  }

  // ── 9. Temporal Branching — Parallel Future Exploration ──────────────
  H('Step 9: Temporal Branching — Explore Parallel Futures');
  I('Forking reality into 3 parallel timelines...');

  // Set up the temporal engine with branch budget + pruning strategies
  sentinel.temporal.setExecModule(sentinel.executor as any);
  sentinel.temporal.registerSurface(surface);
  sentinel.temporal.setBudget({
    maxTimelines: 10, maxDepth: 3, maxTotalIntents: 50,
    maxExplorationMs: 60000, earlyPruneThreshold: 20,
    minStepConfidence: 0.1, maxStepRisk: 'critical',
  });
  sentinel.temporal.setPruningStrategies(['score_threshold', 'confidence_decay', 'risk_ceiling', 'diminishing_returns']);
  sentinel.temporal.setMergeRequestDefaults({ ttlMs: 300_000, quorum: 1 });
  D('Budget: 10 timelines, depth 3, 50 intents, 60s max');
  D('Pruning: score_threshold + confidence_decay + risk_ceiling + diminishing_returns');
  D('MR defaults: quorum=1, TTL=5min');

  // Register a custom safety gate check
  sentinel.temporal.registerGateCheck({
    name: 'no_production',
    description: 'Block production writes in demo',
    evaluate: (tl) => {
      const hasProd = tl.intents.some(i => JSON.stringify(i.params).includes('"env":"production"'));
      return hasProd ? 'warning' : 'passed';
    },
  });
  D('Custom gate: "no_production" registered');

  // [17] Define 3 competing strategies for creating project files
  const strategies: TimelineForkRequest[] = [
    {
      name: 'minimal',
      intents: [
        makeIntent(sid, 'write_file', { path: 'project/README.md', content: '# Project\nMinimal setup.' }),
      ],
      metadata: { approach: 'minimal — single file' },
    },
    {
      name: 'standard',
      intents: [
        makeIntent(sid, 'write_file', { path: 'project/README.md', content: '# Project\nStandard setup with config.' }),
        makeIntent(sid, 'write_file', { path: 'project/config.json', content: '{"version":"1.0"}' }),
      ],
      metadata: { approach: 'standard — two files' },
    },
    {
      name: 'full-scaffold',
      intents: [
        makeIntent(sid, 'write_file', { path: 'project/README.md', content: '# Project\nFull scaffold with source and tests.' }),
        makeIntent(sid, 'write_file', { path: 'project/config.json', content: '{"version":"1.0","env":"production"}' }),
        makeIntent(sid, 'write_file', { path: 'project/src/index.ts', content: 'export const main = () => console.log("hello");' }),
      ],
      metadata: { approach: 'full — three files with source code' },
    },
  ];

  // [2][15] Explore all futures in parallel
  const branchResult = await sentinel.temporal.explore(strategies);
  I(`Explored ${branchResult.timelines.length} parallel futures in ${branchResult.durationMs}ms`);
  console.log();

  // [NEW] Exploration stats
  B('Exploration Statistics:');
  const expStats = branchResult.stats;
  I(`Timelines: ${expStats.totalTimelines} total, ${expStats.evaluatedCount} evaluated, ${expStats.preventedCount} prevented`);
  I(`Intents: ${expStats.totalIntents} total | Cost: ${expStats.totalCostMs}ms`);
  I(`Avg score: ${expStats.avgScore} (std dev: ${expStats.scoreStdDev})`);
  I(`Avg confidence: ${(expStats.avgConfidence * 100).toFixed(1)}%`);
  I(`Risk distribution: ${Object.entries(expStats.riskDistribution).filter(([,v]) => v > 0).map(([k,v]) => `${k}:${v}`).join(', ')}`);
  I(`Budget utilization: ${(expStats.budgetUtilization * 100).toFixed(0)}%`);
  I(`Exploration proof hash: ${branchResult.explorationProofHash.slice(0, 32)}...`);
  console.log();

  // [18] Show the visual comparison tree
  const vizTemporal = sentinel.temporal.visualize(branchResult.timelines.map(t => t.id));
  console.log(vizTemporal);
  console.log();

  // [10] Show ranking reasoning
  B('Ranking Reasoning:');
  for (const reason of branchResult.comparison.reasoning) {
    console.log(chalk.cyan(`    ${reason}`));
  }
  console.log();

  // [NEW] Pairwise timeline diff — compare top two
  if (branchResult.comparison.ranked.length >= 2) {
    const top = branchResult.comparison.ranked[0];
    const runner = branchResult.comparison.ranked[1];
    B('Pairwise Diff (winner vs runner-up):');
    const pairViz = sentinel.temporal.visualizeDiff(top.id, runner.id);
    console.log(pairViz);
    console.log();
  }

  // [6] Counterfactual analysis — "what if" comparison
  B('Counterfactual Analysis:');
  I(`Selected: ${branchResult.counterfactual.selectedOutcome.summary}`);
  for (const rejected of branchResult.counterfactual.rejectedOutcomes) {
    D(`  What-if: ${rejected.summary}`);
  }
  if (branchResult.counterfactual.keyDifferences.length) {
    I('Key differences:');
    for (const diff of branchResult.counterfactual.keyDifferences) { D(`    ${diff}`); }
  }
  if (branchResult.counterfactual.sacrificedBenefits.length) {
    W('Sacrificed benefits:');
    for (const b of branchResult.counterfactual.sacrificedBenefits) { D(`    ${b}`); }
  }
  if (branchResult.counterfactual.pairwiseDiffs?.length) {
    I(`Pairwise diffs computed: ${branchResult.counterfactual.pairwiseDiffs.length}`);
  }
  console.log();

  // [8] Prevented futures report
  B('Prevented Futures:');
  if (branchResult.preventedFutures.length) {
    for (const pf of branchResult.preventedFutures) {
      console.log(`    ${chalk.red(pf.reason.padEnd(16))} "${pf.timelineName}" — ${pf.explanation}`);
    }
  } else {
    I('No futures were prevented (all were viable).');
  }
  console.log();

  // [9] Non-selection proofs
  B('Non-Selection Proofs:');
  for (const proof of branchResult.nonSelectionProofs) {
    D(`  "${proof.timelineName}" vs "${proof.winnerTimelineName}": score delta ${proof.scoreDelta.toFixed(1)}`);
    D(`    Hash: ${proof.shadowResultsHash.slice(0, 24)}...`);
    D(`    ${proof.reasoning}`);
  }
  console.log();

  // [7] Create a Reality Merge Request for the winner
  const winner = branchResult.comparison.winner;
  B('Reality Merge Request:');
  const mergeReq = sentinel.temporal.createMergeRequest(winner.id, CLI_ACTOR, `Merge "${winner.name}" — project scaffold`);
  I(`MR #${mergeReq.id.slice(0, 8)}: "${mergeReq.title}"`);
  I(`Status: ${mergeReq.status} | Actions: ${mergeReq.actionDiffs.length} | Risk: ${mergeReq.risk.level}`);
  I(`Quorum: ${mergeReq.requiredApprovals} approval(s) required | Expires: ${mergeReq.expiresAt > 0 ? new Date(mergeReq.expiresAt).toISOString() : 'never'}`);

  // [16] Show action diffs with content previews
  B('Action Diffs:');
  for (const ad of mergeReq.actionDiffs) {
    let line = `    ${chalk.bold(ad.action)} on ${ad.surfaceId} — ${ad.changes.length} change(s), ${ad.sideEffects.length} side effect(s), risk: ${ad.riskLevel}`;
    if (ad.reversible) line += ' (reversible)';
    if (ad.estimatedSize) line += ` [${ad.estimatedSize}B]`;
    console.log(line);
    if (ad.contentPreview) {
      D(`    Preview: "${ad.contentPreview.slice(0, 60)}${ad.contentPreview.length > 60 ? '...' : ''}"`);
    }
  }

  // [20] Safety gate with custom checks
  B('Safety Gate:');
  for (const check of mergeReq.safetyGate.checks) {
    const icon = check.status === 'passed' ? chalk.green('PASS') : check.status === 'warning' ? chalk.yellow('WARN') : chalk.red('FAIL');
    const tag = (check as any).custom ? chalk.dim(' [custom]') : '';
    console.log(`    ${icon}  ${check.name.padEnd(16)} ${check.detail || check.description}${tag}`);
  }
  I(`Gate: ${mergeReq.safetyGate.status.toUpperCase()} | Async checks: ${mergeReq.safetyGate.asyncChecksRun ? 'yes' : 'no'}`);
  console.log();

  // Auto-approve and merge
  sentinel.temporal.reviewMergeRequest(mergeReq.id, { reviewer: 'cli-demo', verdict: 'approve', comment: 'Auto-approved by demo.', timestamp: Date.now() });
  I(`MR approved (quorum met: 1/${mergeReq.requiredApprovals}). Merging winner: "${winner.name}" (score: ${winner.score.toFixed(1)})`);
  const merged = await sentinel.temporal.merge(winner.id);
  if (merged.phase === 'committed') {
    S(`Timeline "${merged.name}" committed to reality. ${merged.traces.length} action(s) applied.`);
    S(`Depth: ${merged.depth} | Cost: ${merged.evaluationCostMs}ms`);
  } else {
    W(`Merge phase: ${merged.phase}`);
  }

  // [NEW] Future search engine — find evaluated timelines
  const searchResults = sentinel.temporal.searchFutures({ minScore: 0, maxRisk: 'high' });
  D(`Future search: ${searchResults.length} timeline(s) with score>=0 and risk<=high`);

  // [5] Prune the losers (cascade prune)
  for (const tl of branchResult.timelines) {
    if (tl.id !== winner.id && tl.phase !== 'committed') {
      sentinel.temporal.prune(tl.id);
    }
  }
  D(`Pruned ${branchResult.timelines.length - 1} losing timeline(s) (cascade prune enabled).`);

  // ── 10. Policy enforcement (delete blocked) ──────────────────────────────
  H('Step 10: Policy Enforcement — Blocked Action');
  const deleteIntent = makeIntent(sid, 'delete_file', { path: 'hello.txt' });
  const deleteTrace = await sentinel.kernel.execute(deleteIntent);
  if (deleteTrace.status === 'failed') {
    F(`Action BLOCKED: delete_file → ${deleteTrace.status}`);
    const deniedEvent = deleteTrace.events.find(e => e.type === 'policy:denied' || e.type === 'dsl:denied');
    if (deniedEvent) F(`Reason: ${JSON.stringify(deniedEvent.data)}`);
    S('DSL rule "DENY WHEN action MATCHES delete_*" enforced.');
  } else {
    W(`Delete trace status: ${deleteTrace.status}`);
  }

  // ── 11. Rollback ─────────────────────────────────────────────────────────
  H('Step 11: Rollback — Undo the Write');
  const fileExistsBefore = existsSync(join(demoDir, 'hello.txt'));
  I(`File exists before rollback: ${fileExistsBefore}`);
  await adapter.rollback([{ action: 'restore_file', params: { path: 'hello.txt' }, order: 0 }]);
  const fileExistsAfter = existsSync(join(demoDir, 'hello.txt'));
  if (!fileExistsAfter) S('File removed by rollback. State restored.');
  else W('File still exists (was overwrite, not create).');

  // ── 12. Final chain verification ─────────────────────────────────────────
  H('Step 12: Final Audit');
  const finalStats = sentinel.trace.getStats();
  I(`Total traces: ${finalStats.total}`);
  for (const [k, v] of Object.entries(finalStats.byStatus)) {
    console.log(`    ${statusColor(k)}: ${v}`);
  }
  I(`Chain length: ${sentinel.trace.getChainLength()}`);
  const finalVerify = sentinel.trace.verifyChain();
  (finalVerify.valid ? S : F)(`Chain integrity: ${finalVerify.valid ? 'VALID' : 'BROKEN'}`);
  I(`Merkle root: ${sentinel.trace.getChainRoot().slice(0, 48)}...`);

  // Cleanup
  try { rmSync(demoDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log();
  console.log(chalk.bold.white('  ╔══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.white('  ║') + chalk.bold.green('  Demo complete.                                             ') + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ║                                                              ║'));
  console.log(chalk.bold.white('  ║') + chalk.dim('  SENTINEL = Shadow-First Execution + Git for Real-World Actions  ') + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ║                                                              ║'));
  console.log(chalk.bold.white('  ║') + chalk.cyan('  Lifecycle: Intent -> Shadow -> Verify -> Commit -> Trace    ') + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ║') + chalk.cyan('  Safety:    Policy DSL + Blast Radius + Approval Gateway     ') + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ║') + chalk.cyan('  Integrity: Merkle Chain + Drift Detection + Rollback        ') + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ║') + chalk.cyan('  Temporal: Fork -> Explore -> Score -> Diff -> Merge          ') + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ╚══════════════════════════════════════════════════════════════╝'));
  console.log();
});

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
// -- rotate-token (B4) -------------------------------------------------------
program.command('rotate-token')
  .description('Rotate the X-Sentinel-Token used to authenticate the HTTP API')
  .action(() => {
    const tm = new TokenManager();
    const token = tm.rotate();
    H('Sentinel API Token Rotated');
    S('Previous token is now invalid.');
    I(`Stored at: ${tm.location()}`);
    B(`X-Sentinel-Token: ${token}`);
    D('Send this value in the X-Sentinel-Token header on every API request.');
  });

// -- serve (B4) --------------------------------------------------------------
program.command('serve')
  .description('Start the Sentinel HTTP API (token-authenticated by default)')
  .option('-p, --port <port>', 'Port to listen on', '7077')
  .option('-h, --host <host>', 'Host to bind', '127.0.0.1')
  .option('--no-auth', 'Disable authentication (NOT recommended)')
  .action(async (opts: { port: string; host: string; auth: boolean }) => {
    const tm = new TokenManager();
    const token = tm.getToken();
    const services = buildHttpServices();
    const server = new HttpServer(services, {
      port: Number(opts.port),
      host: opts.host,
      auth: opts.auth ? { method: 'token', sentinelToken: tm } : undefined,
    });
    await server.start();
    H('Sentinel HTTP API');
    S(`Listening on http://${opts.host}:${opts.port}`);
    if (opts.auth) {
      I('Auth: X-Sentinel-Token (required on every endpoint except /api/status)');
      B(`X-Sentinel-Token: ${token}`);
      D(`Rotate with: sentinel rotate-token  (file: ${tm.location()})`);
    } else {
      W('Auth DISABLED — every endpoint is public. Do not expose this port.');
    }
    D('Press Ctrl+C to stop.');
    const shutdown = async () => { await server.stop(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

/** Build the HTTP service adapter over the shared kernel instance. */
function buildHttpServices(): SentinelServices {
  return {
    execute: async (intent) => {
      const t = await sentinel.kernel.execute(intent as unknown as ActionIntent);
      return t as unknown as Record<string, unknown>;
    },
    shadow: async (intent) => {
      const i = intent as unknown as ActionIntent;
      const adapter = sentinel.executor.getAdapter(i.surface);
      if (!adapter) return { error: `No adapter for "${i.surface}"` };
      return (await adapter.executeShadow(i.action, i.params)) as unknown as Record<string, unknown>;
    },
    listTraces: (filter) => sentinel.trace.list(filter as never) as unknown as Record<string, unknown>[],
    getTrace: (id) => sentinel.trace.get(id) as unknown as Record<string, unknown> | undefined,
    rollback: async (traceId) => (await sentinel.kernel.rollback(traceId)) as unknown as Record<string, unknown>,
    listSurfaces: () => sentinel.kernel.listSurfaces() as unknown as Record<string, unknown>[],
    verifyChain: () => sentinel.trace.verifyChain() as unknown as Record<string, unknown>,
    approve: (requestId, actorId) => sentinel.approval.approve(requestId, actorId) as unknown as Record<string, unknown>,
    deny: (requestId, actorId, reason) => sentinel.approval.deny(requestId, actorId, reason) as unknown as Record<string, unknown>,
    getPendingApprovals: () => sentinel.approval.getPending() as unknown as Record<string, unknown>[],
    getStatus: () => ({
      version: SENTINEL_VERSION,
      surfaces: sentinel.kernel.listSurfaces().length,
      traces: sentinel.trace.getStats().total,
      chainLength: sentinel.trace.getChainLength(),
    }),
    checkDrift: async (surfaceId) => (await sentinel.drift.check(surfaceId)) as unknown as Record<string, unknown>,
  };
}

<<<<<<< HEAD
// -- connect (S1) ------------------------------------------------------------
program.command('connect')
  .description('Connect to a running Shield sidecar and scan a tool call')
  .requiredOption('-t, --tool <name>', 'Tool name to scan')
  .option('-c, --cmd <command>', 'Command/argument string to evaluate')
  .option('-a, --agent <name>', 'Agent name to register as', 'cli-agent')
  .option('-p, --port <port>', 'Shield port', '9090')
  .option('--host <host>', 'Shield host', '127.0.0.1')
  .option('-s, --socket <path>', 'Shield Unix socket path')
  .action(async (opts: { tool: string; cmd?: string; agent: string; port: string; host: string; socket?: string }) => {
    const client = new ShieldClient({
      port: opts.socket ? undefined : Number(opts.port),
      host: opts.host,
      socketPath: opts.socket,
    });
    try {
      const welcome = await client.connect(opts.agent);
      H('Connected to Shield');
      I(`Shield v${welcome.shieldVersion} · policy=${welcome.policy} · session=${welcome.sessionId}`);
      const verdict = await client.scan({ tool: opts.tool, args: opts.cmd ? { cmd: opts.cmd } : undefined, text: opts.cmd });
      H('Verdict');
      const line = `${verdict.verdict.toUpperCase()} (risk=${verdict.risk}, score=${verdict.score})`;
      if (verdict.verdict === 'block') F(line);
      else if (verdict.verdict === 'warn') W(line);
      else S(line);
      if (verdict.matches.length > 0) {
        D('Matched patterns:');
        for (const m of verdict.matches) D(`  - ${m.patternId}: ${m.description}`);
      }
      process.exitCode = verdict.verdict === 'block' ? 2 : 0;
    } catch (err) {
      F(`Cannot reach Shield: ${(err as Error).message}`);
      process.exitCode = 1;
    } finally {
      client.close();
    }
  });

=======
=======
>>>>>>> e550e260dcc2f57c57596854a8be22259fd660ce
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
// ---------------------------------------------------------------------------
program.parse();
