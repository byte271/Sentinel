# SENTINEL Documentation

Feature documentation for SENTINEL v0.3.0 "The Shield Release". For an overview,
start with the top-level [README](../README.md) and [CHANGELOG](../CHANGELOG.md).

## v0.3.0 features

| Doc | Feature |
|-----|---------|
| [shield.md](./shield.md) | **S1** — Shield Sidecar: out-of-band control plane, JSONL protocol, watchdog, SIGKILL supervision |
| [red-team.md](./red-team.md) | **S2** — Red Team Engine: 34-vector deterministic adversarial suite + defense score |
| [compliance.md](./compliance.md) | **S3** — EU AI Act compliance report generator |
| [sandbox.md](./sandbox.md) | **S4** — Deterministic Shadow Sandbox: virtual FS/net/clock/PRNG, bit-for-bit snapshots |
| [enterprise.md](./enterprise.md) | **S5** — Enterprise Dashboard: static HTML + Shield JSON API |
| [python-sdk.md](./python-sdk.md) | **S6** — Python SDK: `SentinelShield`, `@protect`, `session()` |
| [plugins.md](./plugins.md) | **S7** — LangChain plugin and the framework-integration pattern |

## Quick reference

```bash
# Start the Shield + dashboard
sentinel-shield start --port 9090 --http 8080

# Connect and scan
sentinel connect -t shell -c "rm -rf /" --port 9090

# Adversarial self-test
sentinel-redteam run --policy strict

# Compliance
sentinel-compliance --framework eu-ai-act --format markdown -o report.md
```
