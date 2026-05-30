# Changelog

All notable changes to SENTINEL are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — The Shield Release

v0.2.0 made the agent safer from the inside. v0.3.0 moves safety **out-of-band**:
the Shield runs as a separate process, the agent connects to it over a socket,
and the agent can neither see nor kill it. On top of the Shield, this release
adds adversarial self-testing, EU AI Act compliance, a deterministic sandbox, an
enterprise dashboard, and first-class Python + LangChain integration.

All features are implemented as real, tested logical cores with no heavy
dependencies. The suite is now **274 TypeScript tests** (Vitest) across 33 files
plus **27 Python tests** (pytest), including a cross-language integration test
that drives the real Node Shield from Python.

### Added

- **S1 — Shield Sidecar** (`shield/`, `sentinel-shield`, `sentinel connect`) — an
  out-of-band control plane. A separate Node process exposes a newline-delimited
  JSON protocol over TCP and Unix domain sockets, wraps the firewall + kill
  switch + per-session token registry, supervises the agent as a child process,
  and sends `SIGKILL` to its process group on a kill. Includes a software
  watchdog (dead-man's switch) with internal heartbeat that revokes all tokens
  and writes a forensic snapshot on expiry. Ships `ShieldCore` (transport-free),
  `ShieldServer`, `ShieldClient`, and `Watchdog`.
- **S2 — Red Team Engine** (`redteam/`, `sentinel-redteam`) — a deterministic
  adversarial suite of 34 attack vectors across 7 categories (prompt injection,
  jailbreak, tool abuse, data exfiltration, credential access, context pollution,
  memory tampering). Produces a 0–100 defense score, an A+–F grade, a
  per-category coverage matrix, and a weaknesses list. No randomness, no
  model-in-the-loop — CI-gateable.
- **S3 — EU AI Act Compliance** (`compliance/eu-ai-act.ts`,
  `sentinel-compliance --framework eu-ai-act`) — a runtime-verified report for
  Regulation (EU) 2024/1689: risk-tier classification, Annex IV technical
  documentation (scored 0–100), Article 14 human oversight, transparency,
  Article 9 risk management, post-market monitoring, and a countdown to the
  2026-08-02 enforcement date. Markdown + JSON output.
- **S4 — Deterministic Shadow Sandbox** (`sandbox/`) — a virtual filesystem,
  recorded (never-sent) network, virtual clock, and seeded xorshift128+ PRNG.
  `snapshot()` produces a SHA-256-hashed state; identical seed + inputs yield a
  bit-for-bit identical hash. `verifySnapshot()` checks integrity and
  `fromSnapshot()` restores state and resumes the PRNG at the exact position.
- **S5 — Enterprise Dashboard** (`public/dashboard.html`,
  `sentinel-shield start --http`) — a single static HTML file (no build, no DB)
  polling the Shield's JSON API: agent feed, firewall stats, kill switch with a
  per-agent kill button, OWASP ASI 10/10 score, and EU AI Act enforcement
  countdown. Served by the Shield via `createDashboardServer` / `buildDashboardState`.
- **S6 — Python SDK** (`python/`, `sentinel-shield`) — a zero-dependency Python
  client for the Shield protocol: `SentinelShield` (`connect`, `scan`, `guard`,
  `begin`/`complete`, `kill`, `status`, `ping`), a `session()` context manager, a
  `@protect` decorator, `py.typed` stubs, and a pytest suite. A cross-language
  integration test verifies it against the real Node Shield.
- **S7 — LangChain Plugin** (`python/src/sentinel_langchain/`) —
  `SentinelCallback`, a LangChain callback handler that routes every tool
  invocation through the Shield (`on_tool_start`, `on_agent_action`), with an
  audit-only mode. Works without `langchain` installed (falls back to a local
  base class) and is unit-tested with a mock framework.

### Changed

- Version bumped to **0.3.0** (single source of truth in `package.json`, read by
  `src/spec/version.ts`).
- New CLI binaries registered: `sentinel-shield`, `sentinel-redteam`, plus the
  `sentinel connect` subcommand.
- Documentation rewritten for release: expanded `README.md`, a new `docs/`
  folder (shield, red-team, compliance, sandbox, enterprise, python-sdk,
  plugins), and updated `SECURITY.md` and `CONTRIBUTING.md`.

### Engineering notes

Honest extension points (documented, not fabricated): hardware-backed watchdog,
true WASM memory isolation for the sandbox, PDF rendering of compliance reports
(weasyprint/pandoc), PyPI publishing of the Python SDK, and a D3 force-directed
trust graph for the dashboard.

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

[0.3.0]: https://github.com/byte271/sentinel/releases/tag/v0.3.0
[0.2.0]: https://github.com/byte271/sentinel/releases/tag/v0.2.0
[0.1.0]: https://github.com/byte271/sentinel/releases/tag/v0.1.0
