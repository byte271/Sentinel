# Changelog

All notable changes to SENTINEL are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0]

The agent-safety release. v0.1.0 shipped a controlled-execution kernel
(shadow-first execution, temporal branching, tamper-evident audit). v0.2.0 turns
it into a complete agent safety toolkit with a deterministic firewall,
record-and-replay, a transactional kill switch, cryptographic memory integrity,
a multi-agent trust graph, OWASP ASI compliance scoring, OpenTelemetry-native
observability, and a Prevented Futures terminal view.

All features are implemented as real, tested logical cores with no heavy
dependencies. The full suite is **214 tests passing** across 28 files.

### Added

- **Agent Firewall** (`firewall/`, `sentinel-fw`) — deterministic, framework-agnostic
  scanning of tool calls and agent source files against 32 built-in detection
  patterns (prompt injection, data exfiltration, privilege escalation, credential
  access, destructive operations, persistence). Pure regex, sub-millisecond, with
  `strict`/`balanced`/`permissive` policy presets and runtime-loadable custom rules.
- **Deterministic Replay Engine** (`replay/`) — `ExecutionRecorder` records every
  tool call, inference, state mutation, and blocked action into a hash-chained,
  tamper-evident log; `ReplayCursor` re-drives it deterministically (input
  divergence raises `NonDeterminismError`), reconstructs historical state
  (`stateAt`), supports seek/step/rewind time-travel, and exports to JSON.
- **Kill Switch + Forensics** (`exec/killswitch.ts`) — `KillSwitch` / `AgentSession`
  provide graceful (bounded safe-checkpoint window) and hard kill modes,
  compensation-based rollback in reverse order, a full forensic snapshot, and a
  `KillSwitch.recover()` post-mortem recovery plan.
- **Context Guardian** (`info/context.ts`) — real-time context-window health:
  token budget/utilization, normalized Shannon entropy, pollution score, untrusted
  source boundaries, lost-in-the-middle detection, and trust-aware compaction.
- **Memory Integrity Layer** (`memory/`) — `MemoryLedger`, a signed, append-only,
  hash-chained memory ledger with cryptographic provenance, in-place tamper
  detection, and temporal-decay trust scoring.
- **Multi-Agent Trust Graph** (`bridge/trust-graph.ts`) — `TrustGraph` enforces
  delegation depth limits and permission narrowing (subset-only; escalation flagged),
  per-hop trust decay, and HMAC-SHA256 inter-agent message signing with
  timestamp-bound nonce replay protection. Exports Mermaid and Graphviz DOT.
- **OpenClaw Security Bridge** (`bridge/openclaw.ts`) — `OpenClawMemoryGuard`
  wraps a plaintext `MEMORY.md`-style file with the Memory Integrity Layer for
  sealing, out-of-band tamper detection, and authenticated write-through.
- **OWASP ASI 10/10 Dashboard** (`compliance/owasp.ts`, `sentinel-compliance`) —
  `OwaspAsiAssessor` scores coverage of all 10 OWASP ASI Top-10 risks from the
  capabilities actually enabled, with a renderable text dashboard.
- **Observable Agent Protocol** (`observe/`) — `Tracer` / `Span`, an
  OpenTelemetry-style span emitter with agent semantic conventions and
  OTLP-compatible JSON export for Jaeger/Grafana/Datadog.
- **Prevented Futures TUI** (`tui/`, `sentinel-tui`) — `renderPreventedFutures`
  renders a branching timeline of blocked vs. allowed actions with risk scores,
  the triggering rule, justifications, and an overall safety bar.
- **New CLIs** — `sentinel-fw`, `sentinel-compliance`, `sentinel-tui` registered
  in `package.json` `bin`.
- Documentation: `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, and an expanded
  README with quick starts, an OWASP ASI coverage matrix, and a testing section.

### Changed

- **A2A Identity Verifier v2** — inter-agent identity is now cryptographically
  verified per message (HMAC-SHA256 + replay-bound nonces) with JIT, per-task
  permission narrowing via the Trust Graph, rather than per-session, header-asserted
  identity.
- **Temporal Branching v2** — timeline scoring now spans 6 weighted, auto-normalizing
  dimensions (confidence, safety, minimality, completeness, speed, reversibility).
- Bumped package version to `0.2.0`; canonical version sourced from `src/spec/version.ts`.

### Fixed

- **B1** — version consistency across `package.json`, the protocol spec, and the CLI.
- **B2** — corrected/expanded `package.json` keywords for discoverability.
- **B4** — HTTP API authentication is enforced and compared in constant time.
- **B5** — session tokens are signed (HMAC) and verified with `timingSafeEqual`.

> **Honest engineering note:** Where the design references external infrastructure
> (WASM runtime, full mTLS/SPIFFE PKI, PDF/D3 rendering), SENTINEL ships the
> deterministic core and documented extension points rather than fabricating the
> infrastructure. Replay maps onto a SQLite/WASM store; the trust graph exports
> Mermaid/DOT; compliance exports Markdown/JSON for PDF rendering; observability
> exports OTLP JSON for any collector.

## [0.1.0]

Initial release.

### Added

- **Kernel** — 10-step controlled-execution lifecycle (identity, state, risk,
  policy, blast radius, shadow, approval, commit, state update, trace).
- **Safety** — PolicyEngine, declarative PolicyDSL, ApprovalGateway, BlastRadiusAnalyzer.
- **Execution** — ShadowExecutor, TransactionCoordinator, PipelineEngine,
  TemporalBranchEngine (fork → shadow → score → commit the winner).
- **Identity** — actor registration, trust levels, scope-based authorization.
- **Trace & Audit** — TraceStore with query/export/stats and an append-only,
  tamper-evident MerkleChain with per-entry proofs.
- **Observability** — StateManager and DriftDetector.
- **Recovery** — MagicRecovery strategies.
- **API** — JSON transport layer and HTTP server.
- **Adapters** — reference FilesystemAdapter with shadow + rollback.
- **Persistence** — `PersistenceStore` contract with in-memory and atomic JSON-file backends.
- **Compliance** — NIST AI RMF 1.0 profile generator with prioritized gap list.
- **Bridge** — A2ASafetyBridge cross-agent trust layer.
- **CLI** — `sentinel` with full lifecycle, trace/chain/policy commands, NIST report, and demo.

[0.2.0]: https://github.com/byte271/sentinel/releases/tag/v0.2.0
[0.1.0]: https://github.com/byte271/sentinel/releases/tag/v0.1.0
