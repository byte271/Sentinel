# SENTINEL — The Shield Release

[![version](https://img.shields.io/badge/version-0.3.0-blue.svg)](./CHANGELOG.md)
[![tests](https://img.shields.io/badge/tests-274%20passing-brightgreen.svg)](#testing)
[![python](https://img.shields.io/badge/python%20SDK-27%20tests-brightgreen.svg)](#python-sdk)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![OWASP ASI](https://img.shields.io/badge/OWASP%20ASI-9%2F10%20full-success.svg)](#owasp-asi-top-10-coverage)
[![EU AI Act](https://img.shields.io/badge/EU%20AI%20Act-Annex%20IV%20100%25-success.svg)](#eu-ai-act-compliance)

A TypeScript framework for controlled AI execution. SENTINEL wraps every AI-initiated action in a structured lifecycle: **shadow-execute first, verify the diff, then commit to reality** — with full audit trails, policy enforcement, and rollback capability.

> **v0.3.0 "The Shield Release"** puts safety out-of-band. The agent no longer polices itself — SENTINEL runs as a separate process, intercepting at the transport layer. A deterministic **Shield Sidecar** with a JSONL protocol, a **Red Team** engine that proves your defenses work, an **EU AI Act** compliance generator with enforcement countdown, a **Deterministic Shadow Sandbox** for bit-for-bit reproducible runs, an **Enterprise Dashboard** with live telemetry, a **Python SDK** with `@protect` decorators, and a **LangChain plugin** for instant integration. Deterministic, local-first, framework-agnostic — no API key, no cloud.

## What's New in v0.3.0

| # | Feature | Ship | CLI / API |
| --- | --------- | ------ | ----------- |
| S1 | **Shield Sidecar** — out-of-band TCP/Unix-socket process; agent can't see/kill it; SIGKILL on rogue; software watchdog + forensic snapshot | Shipped | `sentinel-shield start`, `sentinel connect`, `ShieldServer` / `ShieldClient` |
| S2 | **Red Team Engine** — deterministic 34-vector adversarial suite (7 categories); defense score 0–100; coverage matrix | Shipped | `sentinel-redteam run`, `RedTeamEngine` |
| S3 | **EU AI Act Compliance** — runtime-verified report (risk tier, Annex IV, Article 14 human oversight, enforcement countdown) | Shipped | `sentinel-compliance --framework eu-ai-act`, `EuAiActAssessor` |
| S4 | **Deterministic Shadow Sandbox** — virtual FS, recorded network, virtual clock, seeded PRNG; bit-for-bit snapshot/restore | Shipped | `DeterministicSandbox` |
| S5 | **Enterprise Dashboard** — static HTML polling Shield API; live firewall stats, OWASP 10/10, EU AI Act countdown, kill button | Shipped | `sentinel-shield start --http 8080`, `buildDashboardState` |
| S6 | **Python SDK** — `sentinel-shield` client over protocol; `@protect`, `with session()`, `py.typed`, cross-language verified | Shipped | `pip install ./python`, `SentinelShield` |
| S7 | **LangChain Plugin** — `SentinelCallback` routes tool invocations through Shield; audit-only mode; no langchain dep required | Shipped | `SentinelCallback` |

Plus all v0.2.0 features (Agent Firewall, Deterministic Replay, Kill Switch, Context Guardian, Memory Integrity, Trust Graph, OWASP ASI, NIST AI RMF, Observable Agent Protocol, Prevented Futures TUI).

See [CHANGELOG.md](./CHANGELOG.md) for the full release history.

> **Honest engineering note:** SENTINEL ships the real, tested *logical cores* of these features with zero heavy dependencies. Where the design references external infrastructure, SENTINEL provides the deterministic core and documents the extension point rather than fabricating it:
>
> - **WASM isolation**: the sandbox runs in-process; compile to a real WASM boundary for memory isolation
> - **Hardware watchdog**: software dead-man's switch ships; wire a hardware timer for production
> - **PDF reports**: compliance outputs Markdown/JSON; pipe through weasyprint/pandoc for PDF
> - **PyPI publishing**: the Python SDK ships as source; publish when ready
> - **D3 trust graph**: exports JSON; render with D3/Mermaid for interactive visualization

## How It Works

When an AI agent wants to take an action (write a file, call an API, modify a database), SENTINEL interposes a safety layer:

1. **Shadow execution** — run the action in a sandbox, capture predicted side effects
2. **Policy check** — evaluate against declarative rules (DSL) and risk thresholds
3. **Approval gate** — route high-risk actions for human review
4. **Commit** — apply the change to the real system
5. **Trace** — record everything in a tamper-evident Merkle chain

With v0.3.0, this lifecycle runs **out-of-band**: the Shield is a separate process and the agent connects over TCP. The agent cannot see, modify, or kill the Shield. If the agent goes rogue, the Shield sends SIGKILL to its process group — no negotiation.

## Quick Start

```bash
# Install and build
npm install && npm run build

# Run the interactive demo
npm run demo

# Start the Shield sidecar (separate terminal)
sentinel-shield start --port 9090 --http 8080

# Connect and scan a tool call
sentinel connect -t shell -c "ls -la" --port 9090    # → ALLOW
sentinel connect -t shell -c "rm -rf /" --port 9090  # → BLOCK

# Run the adversarial self-test
sentinel-redteam run --policy strict   # → 100/100 (A+)

# Generate an EU AI Act compliance report
sentinel-compliance --framework eu-ai-act --format markdown -o report.md

# Open the dashboard
open http://localhost:8080
```

### Python Quick Start

```bash
cd python && pip install -e .
```

```python
from sentinel_shield import SentinelShield, ShieldBlocked, session

with session("my-agent", port=9090) as shield:
    shield.guard("shell", {"cmd": "ls"})         # allowed
    shield.guard("shell", {"cmd": "rm -rf /"})   # raises ShieldBlocked
```

### LangChain Integration

```python
from sentinel_shield import session
from sentinel_langchain import SentinelCallback

with session("langchain-agent", port=9090) as shield:
    cb = SentinelCallback(shield)
    # pass cb as a callback to any LangChain agent/chain
    agent.run("...", callbacks=[cb])
```

## Core Modules

### Shield Sidecar (`shield/`) *(v0.3.0)*

The centerpiece of v0.3.0. A separate Node.js process that owns all safety logic:

- **Protocol**: newline-delimited JSON over TCP or Unix domain socket (language-agnostic)
- **ShieldCore**: wraps AgentFirewall + KillSwitch + per-session token registry (deterministic, no networking)
- **ShieldServer**: TCP/Unix listener, child-process supervision, SIGKILL on kill, optional dashboard HTTP server
- **ShieldClient**: TypeScript reference client for the protocol
- **Watchdog**: dead-man's switch — internal heartbeat proves the event loop is alive; on expiry: revoke all tokens + write forensic snapshot to disk

```typescript
import { ShieldServer, ShieldClient } from 'sentinel';

const server = new ShieldServer({ port: 9090, policy: 'strict', httpPort: 8080 });
await server.listen();

const client = new ShieldClient({ port: 9090 });
await client.connect('my-agent');
const verdict = await client.scan({ tool: 'shell', args: { cmd: 'ls' } });
console.log(verdict.allowed); // true
```

### Red Team Engine (`redteam/`) *(v0.3.0)*

Deterministic adversarial self-testing. 34 attack vectors across 7 OWASP-ASI threat categories:

| Category | Vectors | Examples |
| ---------- | --------- | --------- |
| Prompt injection | 4 | Ignore previous instructions, persona override, system-prompt leak |
| Jailbreak | 6 | DAN, dev-mode, grandma, roleplay, base64 marker |
| Tool abuse | 6 | rm -rf /, forkbomb, chmod 777, sudo, docker --privileged |
| Data exfiltration | 6 | curl POST, pipe-to-net, reverse shell, webhook, base64-exec |
| Credential access | 7 | /etc/shadow, SSH keys, AWS creds, .env, env dump |
| Context pollution | 2 | RAG poison, trust-decay exploit |
| Memory tampering | 3 | MEMORY.md rewrite, authorized_keys, cron persistence |

```typescript
import { AgentFirewall, RedTeamEngine } from 'sentinel';

const engine = new RedTeamEngine(new AgentFirewall({ policy: 'strict' }));
const report = engine.run();
console.log(report.defenseScore); // 100
console.log(report.grade);        // 'A+'
```

### EU AI Act Compliance (`compliance/eu-ai-act.ts`) *(v0.3.0)*

Runtime-verified compliance report for Regulation 2024/1689, tied to actual Sentinel capabilities:

- **Risk tier classification** (prohibited / high-risk / limited / minimal)
- **Annex IV** technical documentation (10 requirements, scored 0–100)
- **Article 14** human oversight measures (5 items)
- **Transparency** obligations, **risk management** (Article 9), **post-market monitoring**
- **Enforcement countdown** to 2026-08-02

```typescript
import { EuAiActAssessor, DEFAULT_CAPABILITIES } from 'sentinel';

const report = new EuAiActAssessor().assess(DEFAULT_CAPABILITIES);
console.log(report.annexIVScore); // 100
console.log(report.readiness);     // 'ready'
console.log(report.daysUntilEnforcement); // days until 2026-08-02
```

### Deterministic Shadow Sandbox (`sandbox/`) *(v0.3.0)*

A fully deterministic execution environment for shadow runs:

- **Virtual filesystem** — in-memory, never touches disk
- **Recorded network** — captures requests, never sends them
- **Virtual clock** — `now()` and `advanceTime()` for repeatable timing
- **Seeded PRNG** — same seed = same random stream = bit-for-bit identical output
- **Snapshot/restore** — SHA-256 integrity hash, `fromSnapshot()` resumes deterministically

```typescript
import { DeterministicSandbox } from 'sentinel';

const sb = new DeterministicSandbox({ seed: 'audit-run-42', startTime: 0 });
sb.writeFile('/workspace/plan.md', '# Plan');
sb.captureRequest('POST', 'http://api.example.com/data', 'payload');
sb.advanceTime(1000);

const snap = sb.snapshot();
console.log(DeterministicSandbox.verifySnapshot(snap)); // true
```

### Enterprise Dashboard (`public/dashboard.html`) *(v0.3.0)*

A single static HTML file (no build step, no database) that polls the Shield's HTTP API:

- **Agent feed** — connected agents, operation counts, status
- **Firewall stats** — allowed / warned / blocked
- **Kill switch** — status + per-agent kill button
- **OWASP ASI** — 10/10 score and grade
- **EU AI Act** — Annex IV readiness and enforcement countdown

Start with: `sentinel-shield start --port 9090 --http 8080`

### Kernel, Safety, Execution, Firewall, Replay, Memory, Trust Graph, Compliance, Observability

All v0.2.0 modules remain — see [CHANGELOG.md](./CHANGELOG.md) for the full list. The Agent Firewall (32 patterns, 3 policies), Kill Switch + Forensics, Memory Integrity Layer, Multi-Agent Trust Graph, Deterministic Replay, Context Guardian, OWASP ASI Dashboard, NIST AI RMF Profile, Observable Agent Protocol, and Prevented Futures TUI are all wired into the Shield runtime.

## OWASP ASI Top-10 Coverage

A fully-configured SENTINEL v0.3.0 deployment scores **95/100 (A+)** — 9 risks fully covered, 1 partial.

| ASI Risk | Coverage | Mechanism |
| ---------- | ---------- | ----------- |
| ASI01 Agent Goal Hijack | Full | Firewall pattern matching + Red Team injection suite |
| ASI02 Tool Misuse | Full | Pre-execution tool-call scanning + Shield sidecar interception |
| ASI03 Excessive Agency | Full | Kill Switch + Shield SIGKILL + approval + permission narrowing |
| ASI04 Inter-Agent Communication Hijack | Full | HMAC-SHA256 mutual auth + replay protection |
| ASI05 Memory & State Manipulation | Full | Memory Integrity Layer + sandbox isolation |
| ASI06 Delegated Trust Abuse | Full | Trust Graph + delegation depth limits |
| ASI07 Resource Exhaustion | Full | Rate limiting + context budget + watchdog |
| ASI08 Rogue Agent Generation | Partial | Agent identity + spawn detection (full WASM isolation is extension point) |
| ASI09 Sensitive Data Exposure | Full | PII redaction + credential pattern detection |
| ASI10 Model Theft | Full | Sandbox + model access auditing |

## EU AI Act Compliance

A fully-configured SENTINEL v0.3.0 deployment achieves **100% Annex IV readiness** with 0 gaps, tied to actual runtime capabilities:

```bash
sentinel-compliance --framework eu-ai-act
# EU AI Act Compliance — Annex IV score 100% (readiness: ready)
# Risk tier: high-risk
# Days until enforcement: 65
# Gaps: 0
```

## CLI Reference

### `sentinel` — Core lifecycle

```bash
sentinel execute <surface> <action> [params...]   # full lifecycle execution
sentinel shadow <surface> <action> [params...]     # preview only
sentinel trace list / show <id> / export [id]      # audit trail
sentinel chain verify / show                        # Merkle chain
sentinel policy add '<expr>' / list                 # policy DSL
sentinel nist [--json]                              # NIST AI RMF
sentinel status                                     # system status
sentinel rollback <traceId>                         # rollback
sentinel demo                                       # interactive demo
sentinel connect -t <tool> -c <cmd> --port <port>  # connect to Shield (v0.3.0)
sentinel serve -p 7077                              # HTTP API server
sentinel rotate-token                               # rotate API token
```

### `sentinel-shield` — Shield Sidecar *(v0.3.0)*

```bash
sentinel-shield start --port 9090 --policy strict --http 8080  # start the sidecar
sentinel-shield status --port 9090                              # query running Shield
```

### `sentinel-fw` — Agent Firewall

```bash
sentinel-fw scan shell cmd="rm -rf /" --policy strict
sentinel-fw scan-file ./my-agent.ts
sentinel-fw patterns
```

### `sentinel-compliance` — Compliance Reports

```bash
sentinel-compliance --framework owasp-asi
sentinel-compliance --framework nist-ai-rmf --format json -o report.json
sentinel-compliance --framework eu-ai-act --format markdown -o report.md
```

### `sentinel-redteam` — Adversarial Self-Testing *(v0.3.0)*

```bash
sentinel-redteam run --policy strict              # full 34-vector suite → A+
sentinel-redteam run --policy permissive -f json   # JSON output
sentinel-redteam vectors                           # list all attack vectors
```

### `sentinel-tui` — Prevented Futures

```bash
sentinel-tui --demo
sentinel-tui --input ./recording.json
sentinel-tui --asi
```

## Python SDK

The `sentinel-shield` Python package (in `python/`) provides a zero-dependency client for the Shield protocol:

- `SentinelShield` — blocking client: `connect`, `scan`, `guard`, `begin/complete`, `kill`, `status`, `ping`
- `@protect(shield)` — decorator: scan a tool call before each invocation; raises `ShieldBlocked` on block
- `session(agent, port=...)` — context manager: connect on enter, close on exit
- `ToolCall`, `Verdict`, `ShieldBlocked`, `ShieldError` — protocol types
- `py.typed` — PEP 561 type stubs

See [docs/python-sdk.md](./docs/python-sdk.md).

## LangChain Plugin

The `sentinel_langchain` package (in `python/src/sentinel_langchain/`) drops into any LangChain agent:

```python
from sentinel_langchain import SentinelCallback

cb = SentinelCallback(shield, raise_on_block=True)
agent.run("...", callbacks=[cb])
```

The same pattern (a callback/middleware that calls `shield.guard` before a tool executes) applies to LlamaIndex, CrewAI, AutoGen, etc. See [docs/plugins.md](./docs/plugins.md).

## Project Structure

```text
src/
  kernel/       Kernel orchestrator + type definitions
  safe/         Policy engine, DSL, approval gateway, blast radius
  exec/         Shadow executor, transactions, pipelines, temporal branching, kill switch
  shield/       Shield sidecar: protocol, core, server, client, watchdog, dashboard  (v0.3.0)
  firewall/     Agent Firewall + 32 detection patterns
  redteam/      Adversarial Red Team engine (34 vectors, 7 categories)                (v0.3.0)
  sandbox/      Deterministic shadow sandbox (virtual FS/net/clock/PRNG)              (v0.3.0)
  replay/       Deterministic record & replay engine
  memory/       Memory Integrity Layer (signed append-only ledger)
  observe/      Observable Agent Protocol (OTEL-style tracer)
  tui/          Prevented Futures terminal renderer
  compliance/   NIST AI RMF + OWASP ASI + EU AI Act compliance                       (v0.3.0)
  id/           Identity and authorization
  trace/        Trace store + Merkle chain
  info/         State management, drift detection, Context Guardian
  magic/        Recovery strategies
  api/          Transport layer + HTTP server
  adapters/     Reference filesystem adapter
  persist/      Durable persistence stores (in-memory + JSON file)
  bridge/       A2A safety bridge, Trust Graph, OpenClaw guard
  spec/         Protocol versioning
  cli/          sentinel, sentinel-fw, sentinel-compliance, sentinel-tui,
                sentinel-shield, sentinel-redteam                                     (v0.3.0)
  index.ts      Public API exports
public/
  dashboard.html  Enterprise dashboard (static, no build)                             (v0.3.0)
python/
  src/sentinel_shield/     Python SDK                                                 (v0.3.0)
  src/sentinel_langchain/  LangChain plugin                                           (v0.3.0)
  tests/                   pytest suite (27 tests)                                    (v0.3.0)
docs/                      Feature documentation                                      (v0.3.0)
```

Zero runtime dependencies beyond `chalk`, `commander`, and `uuid`. The test suite spans two languages:

- **TypeScript**: `npm test` (Vitest) — **274 tests** across 33 files
- **Python**: `cd python && pytest` — **27 tests** (protocol, client, decorators, LangChain, cross-language integration)

## Testing

```bash
# TypeScript
npm install
npm run build   # tsc — no type errors
npm test        # vitest — 274 tests passing

# Python SDK + LangChain plugin
cd python
pip install -e ".[test]"
PYTHONPATH=src pytest     # 27 tests passing
```

## Limitations

- This is a protocol framework, not a production-deployed system. It demonstrates the architecture for controlled AI execution.
- The **Shield sidecar** is a faithful software implementation. Hardware-backed watchdog and true WASM memory isolation are documented extension points.
- The **Red Team engine** uses a fixed deterministic attack catalogue. Model-based synthesized variants (adversarial LLM prompts) are an extension point.
- The **EU AI Act** compliance report is a self-assessment tool tied to actual Sentinel capabilities, not a certified attestation. Final compliance requires human review.
- The **Shadow Sandbox** runs in-process (same Node VM); compiling the harness into a WASM boundary for true memory isolation is the production extension point.
- The **Enterprise Dashboard** is a static HTML file polling JSON. The D3 force-directed trust graph and PDF export are documented extension points.
- The **Python SDK** ships as source in `python/`; publish to PyPI when ready.
- The Agent Firewall is deterministic regex matching — fast and explainable, but pair it with the Shield sidecar and OS-level isolation.
- A2A Identity Verifier ships HMAC-SHA256 + replay nonces; full mTLS/SPIFFE PKI is an integration point.
- Compliance scoring (OWASP, NIST, EU AI Act) reflects enabled capabilities; it is configuration-aware, not a certification.

## License

MIT
