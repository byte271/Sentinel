# EU AI Act Compliance (S3)

A runtime-verified compliance report for **Regulation (EU) 2024/1689** (the EU
AI Act). Unlike a generic template, every requirement is mapped to an actual
Sentinel capability, so the report reflects what your deployment can really do.

## What it assesses

- **Risk tier classification** — prohibited / high-risk / limited / minimal
- **Annex IV technical documentation** — 10 requirements, scored 0–100
- **Article 14 human oversight** — 5 measures
- **Transparency obligations** — 3 items
- **Article 9 risk management** — 4 items
- **Post-market monitoring** — 3 items
- **Enforcement countdown** — days until **2026-08-02**

## Scoring

Each requirement is graded against the enabled capability set:

- `satisfied` → 1.0
- `partial` → 0.5
- `gap` → 0.0
- `not-applicable` → excluded from the denominator

`annexIVScore = (satisfied + 0.5·partial) / applicable × 100`. Readiness is
`ready` (≥ 90), `partial` (≥ 60), or `not-ready` (< 60).

## Capability mapping (examples)

| EU AI Act requirement | Sentinel capability |
|------------------------|---------------------|
| Annex IV §2(g) — accuracy/robustness logging | Deterministic Replay + Merkle trace |
| Article 14 — human oversight | Approval Gateway + Kill Switch |
| Article 12 — record-keeping | Trace store + tamper-evident Merkle chain |
| Article 15 — accuracy & cybersecurity | Agent Firewall + HMAC A2A + replay protection |
| Article 9 — risk management system | OWASP ASI assessor + Red Team engine |
| Article 72 — post-market monitoring | Observable Agent Protocol (OTLP) |

## CLI

```bash
sentinel-compliance --framework eu-ai-act                          # text summary
sentinel-compliance --framework eu-ai-act --format markdown -o eu.md
sentinel-compliance --framework eu-ai-act --format json -o eu.json
```

## Programmatic use

```typescript
import { EuAiActAssessor, DEFAULT_CAPABILITIES } from 'sentinel';

const assessor = new EuAiActAssessor();
const report = assessor.assess(DEFAULT_CAPABILITIES);

console.log(report.riskTier);              // 'high-risk'
console.log(report.annexIVScore);           // 100
console.log(report.readiness);              // 'ready'
console.log(report.daysUntilEnforcement);   // e.g. 65
console.log(report.gaps);                   // []

const markdown = EuAiActAssessor.renderMarkdown(report);
```

## Extension point

The Markdown output is suitable for conversion to PDF via weasyprint or pandoc.
The report is a self-assessment aid tied to runtime capabilities — final
conformity assessment still requires human review and, for high-risk systems,
notified-body involvement.
