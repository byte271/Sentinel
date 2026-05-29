# SENTINEL — AI-Operable Software Protocol

A TypeScript framework for controlled AI execution. SENTINEL wraps every AI-initiated action in a structured lifecycle: **shadow-execute first, verify the diff, then commit to reality** — with full audit trails, policy enforcement, and rollback capability.

## What It Does

When an AI agent wants to take an action (write a file, call an API, modify a database), SENTINEL interposes a safety layer:

1. **Shadow execution** — run the action in a sandbox, capture predicted side effects
2. **Policy check** — evaluate against declarative rules (DSL) and risk thresholds
3. **Approval gate** — route high-risk actions for human review
4. **Commit** — apply the change to the real system
5. **Trace** — record everything in a tamper-evident Merkle chain

This is the core loop. On top of it, SENTINEL adds **temporal branching** — the ability to fork execution into multiple parallel timelines, score all outcomes, and only commit the winner.

## Core Modules

### Kernel
The orchestrator. Wires together all modules and drives the 10-step execution lifecycle (identity validation, state fetch, risk assessment, policy evaluation, blast radius analysis, shadow execution, approval, commit, state update, trace recording).

### Safety (`safe/`)
- **PolicyEngine** — programmatic policy rules with risk-level gating
- **PolicyDSL** — declarative rules like `DENY WHEN action MATCHES "delete_*"`
- **ApprovalGateway** — human-in-the-loop approval for high-risk actions
- **BlastRadiusAnalyzer** — graph-based impact analysis with transitive dependency tracking

### Execution (`exec/`)
- **ShadowExecutor** — preview actions without real side effects via pluggable adapters
- **TransactionCoordinator** — atomic multi-step execution with ordered rollback
- **PipelineEngine** — multi-stage pipelines with conditional branching and parallel stages
- **TemporalBranchEngine** — parallel timeline exploration (see below)

### Identity (`id/`)
- **IdentityManager** — actor registration, trust levels, scope-based authorization

### Trace & Audit (`trace/`)
- **TraceStore** — structured event recording with query, export, and statistics
- **MerkleChain** — append-only hash chain for tamper-evident audit trails with per-entry proofs

### Observability (`info/`)
- **StateManager** — surface state snapshots with history and diffing
- **DriftDetector** — detect unauthorized out-of-band changes by comparing expected vs. actual state

### Recovery (`magic/`)
- **MagicRecovery** — automatic recovery strategies for failed operations

### API (`api/`)
- **ApiLayer** — JSON message transport for remote SENTINEL operations
- **HttpServer** — HTTP server wrapping the API layer

### Adapters (`adapters/`)
- **FilesystemAdapter** — reference implementation for local filesystem operations (read, write, delete, list, mkdir) with shadow support and rollback

### Persistence (`persist/`)
- **PersistenceStore** — minimal, dependency-free key/value contract for durable audit state
- **InMemoryPersistenceStore** — volatile backend for tests and ephemeral runs
- **JsonFilePersistenceStore** — one JSON document per key with atomic writes (temp file + rename) so a crash mid-write never corrupts an existing snapshot

The `TraceStore` can `snapshot()` / `restore()` its full state (traces, event log, and Merkle chain), and `persist()` / `hydrate()` against any `PersistenceStore` — so the tamper-evident audit trail survives process restarts.

### Compliance (`compliance/`)
- **NistComplianceProfile** — maps SENTINEL's runtime safety mechanisms onto the four functions of the **NIST AI RMF 1.0** (Govern / Map / Measure / Manage), grades each control as satisfied / partial / unsatisfied, scores coverage, and emits an exportable JSON report with a prioritized gap list
- **gatherEvidence** — derives a compliance evidence snapshot directly from a live SENTINEL instance

### Bridge (`bridge/`)
- **A2ASafetyBridge** — the trust layer for the Agent-to-Agent (A2A) protocol. A2A standardizes how agents *communicate*; the bridge decides whether a delegation should be *trusted*. It attributes a trust level to the originating agent (never honoring self-claimed trust by default) and routes the requested action through the full kernel lifecycle (shadow → policy → approval → commit) before any real effect occurs. *"A2A handles communication. SENTINEL handles trust."*

## Temporal Branching

The standout feature. Given an intent (e.g., "set up a project"), SENTINEL can:

- **Fork** the intent into multiple competing strategies (minimal, standard, full-scaffold, etc.)
- **Shadow-execute** all strategies in parallel, capturing predicted diffs for each
- **Score** each timeline across 6 weighted dimensions: confidence, safety, minimality, completeness, speed, and reversibility — with auto-normalizing weights
- **Rank** timelines with risk-aware tiebreaking (score → risk level → reversibility)
- **Commit** only the winning timeline to reality
- **Prune** losing timelines (with cascade to child branches)

Additional temporal features:

- **Reality Merge Requests** — PR-style review objects with quorum-based approval and auto-expiry
- **Pairwise Timeline Diffs** — side-by-side comparison of any two timelines with per-dimension breakdown
- **Counterfactual Analysis** — "what if we'd picked the other timeline?" with avoided risks and sacrificed benefits
- **Prevented Futures Report** — tracks timelines that were blocked (high risk, low confidence, budget exceeded, policy denied)
- **Non-Selection Proofs** — SHA-256 hashed evidence of why each losing timeline lost, chained via Merkle-style hashing
- **Branch Budgeting** — limits on timeline count, fork depth, total intents, and wall-clock time
- **4 Pruning Strategies** — `score_threshold`, `confidence_decay`, `risk_ceiling`, `diminishing_returns` (independently configurable)
- **Commit-Time Revalidation** — re-checks reality drift before merging
- **Sandbox Mode** — explore alternate futures with no real mutations
- **Future Search Engine** — query/filter timelines by score, risk, confidence, phase, name, surface
- **Custom Safety Gate Checks** — register dynamic pre-merge validation functions
- **Action Diffs** — structured per-action diff with content preview and size estimation
- **Auto-Strategy Inference** — generate strategy variants from a single intent
- **Exploration Statistics** — avg score, standard deviation, risk distribution, budget utilization

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run the interactive demo (12 steps covering the full feature set)
npm run demo
```

### Programmatic Usage

```typescript
import { createSentinel, createFilesystemSurface, FilesystemAdapter } from 'sentinel';

const sentinel = createSentinel();

// Register a surface (the thing being acted upon)
const surface = createFilesystemSurface('my-fs', 'My Filesystem', '/tmp/workspace');
sentinel.kernel.registerSurface(surface);
sentinel.executor.registerAdapter(new FilesystemAdapter('my-fs', '/tmp/workspace'));

// Register an actor
sentinel.identity.register({
  id: 'agent-1', type: 'ai', name: 'My Agent',
  trust: 'elevated', scopes: ['my-fs/*'],
});

// Execute with full lifecycle
const trace = await sentinel.kernel.execute({
  id: 'intent-1',
  surface: 'my-fs',
  action: 'write_file',
  params: { path: 'hello.txt', content: 'Hello, world!' },
  initiator: { id: 'agent-1', type: 'ai', name: 'My Agent', trust: 'elevated', scopes: ['my-fs/*'] },
  timestamp: Date.now(),
  metadata: {},
});

console.log(trace.status); // 'committed'
```

### Temporal Branching Usage

```typescript
const { temporal, executor } = createSentinel();

temporal.setExecModule(executor as any);
temporal.registerSurface(surface);
temporal.setBudget({ maxTimelines: 10, maxDepth: 3, maxTotalIntents: 50 });

const result = await temporal.explore([
  { name: 'approach-a', intents: [/* ... */], metadata: {} },
  { name: 'approach-b', intents: [/* ... */], metadata: {} },
]);

console.log(result.comparison.winner.name);  // best strategy
console.log(result.stats.avgScore);           // exploration statistics
console.log(result.explorationProofHash);     // tamper-evident hash

// Commit the winner — each intent is committed through the kernel's full
// safety lifecycle (identity → risk → policy → blast radius → approval →
// shadow → commit), so a policy-denied timeline cannot be merged to reality.
await temporal.merge(result.comparison.winner.id);
```

> **Safety note:** `TemporalBranchEngine` and `PipelineEngine` never apply
> changes to reality on their own. `createSentinel()` wires both engines to the
> kernel, so every committed action passes the same safety lifecycle as
> `kernel.execute()`. `PipelineEngine.execute(id, context, initiator)` runs each
> action step as a full kernel transaction and fails closed if no kernel is
> configured.

### Durable Audit (Persistence)

```typescript
import { createSentinel, JsonFilePersistenceStore } from 'sentinel';

const sentinel = createSentinel();
// ... execute some actions ...

const backend = new JsonFilePersistenceStore('./sentinel-audit');
await sentinel.trace.persist(backend);          // snapshot traces + Merkle chain to disk

// Later, in a fresh process:
const next = createSentinel();
await next.trace.hydrate(backend);          // restore the verifiable audit trail
console.log(next.trace.verifyChain().valid); // true
```

### NIST AI RMF Compliance

```typescript
import { createSentinel, gatherEvidence } from 'sentinel';

const sentinel = createSentinel();
const report = sentinel.nist.generateReport(gatherEvidence(sentinel));

console.log(report.summary.coverageScore); // 0–100
console.log(report.summary.readiness);      // 'non-compliant' | 'developing' | 'substantial' | 'compliant'
console.log(report.gaps);                   // prioritized recommendations
```

### A2A Safety Bridge

```typescript
const sentinel = createSentinel();
// ... register surface + adapter ...

// Operator grants trust to a known remote agent (self-claimed trust is ignored).
sentinel.bridge.registerAgent({ id: 'agent-a', name: 'Planner', trust: 'elevated', scopes: ['*'] });
sentinel.identity.register({ id: 'agent-a', type: 'agent', name: 'Planner', trust: 'elevated', scopes: ['*'] });

const result = await sentinel.bridge.mediate({
  from: { id: 'agent-a', name: 'Planner', trust: 'elevated', scopes: ['*'] },
  surface: 'my-fs',
  action: 'write_file',
  params: { path: 'out.txt', content: 'delegated work' },
  task: 'persist the result',
});

console.log(result.decision);  // 'trusted' | 'rejected' | 'pending_approval' | 'error'
console.log(result.committed); // whether it reached reality
```

## CLI

```bash
# Full lifecycle execution
sentinel execute <surface> <action> [params...]

# Shadow-only (preview)
sentinel shadow <surface> <action> [params...]

# Trace management
sentinel trace list
sentinel trace show <id>
sentinel trace export [id]

# Merkle chain
sentinel chain verify
sentinel chain show

# Policy DSL
sentinel policy add '<expression>'
sentinel policy list

# NIST AI RMF compliance report (add --json for the full report)
sentinel nist
sentinel nist --json

# System status
sentinel status

# Rollback
sentinel rollback <traceId>

# Interactive demo
sentinel demo
```

## Project Structure

```
src/
  kernel/       Kernel orchestrator + type definitions
  safe/         Policy engine, DSL, approval gateway, blast radius
  exec/         Shadow executor, transactions, pipelines, temporal branching
  id/           Identity and authorization
  trace/        Trace store + Merkle chain (with snapshot/restore)
  info/         State management + drift detection
  magic/        Recovery strategies
  api/          Transport layer + HTTP server
  adapters/     Reference filesystem adapter
  persist/      Durable persistence stores (in-memory + JSON file)
  compliance/   NIST AI RMF compliance profile
  bridge/       A2A safety bridge (cross-agent trust layer)
  spec/         Protocol versioning
  cli/          CLI with full lifecycle demo + `nist` report
  index.ts      Public API exports + convenience factory
```

Zero runtime dependencies beyond `chalk`, `commander`, and `uuid`. The test suite
(`npm test`, Vitest) covers the kernel, safety, execution, trace/Merkle, persistence,
compliance, and A2A bridge modules.

## Limitations

- This is a protocol framework, not a production-ready system. It demonstrates the architecture for controlled AI execution.
- The shadow execution model depends on adapters faithfully simulating actions. The included filesystem adapter is a reference implementation.
- Temporal branching scores timelines based on shadow execution results. The scoring is only as good as the shadow predictions.
- The Merkle chain and trace store are in-memory by default, but can be snapshotted and persisted via a `PersistenceStore` (a JSON-file backend ships in `persist/`); a higher-throughput deployment would add a database-backed store implementing the same interface.
- The NIST compliance profile maps a curated, representative subset of AI RMF subcategories; it is a self-assessment aid, not a certified attestation.
- Policy DSL supports basic patterns (`MATCHES`, `CONTAINS`, `==`, `!=`, `>`, `>=`, `<`, `<=`, `IN`). Complex policies should use programmatic rules.

## License

MIT
