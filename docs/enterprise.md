# Enterprise Dashboard (S5)

A single static HTML file (`public/dashboard.html`) — no build step, no
database, no framework. It polls the Shield's HTTP/JSON API every 2 seconds and
renders live operational telemetry.

## Panels

- **Kill Switch** — armed/fired state, active policy, uptime
- **Firewall Activity** — allowed / warned / blocked counts
- **OWASP ASI Top-10** — live score, grade, fully-covered count
- **EU AI Act** — Annex IV readiness bar and **enforcement countdown** to 2026-08-02
- **Connected Agents** — per-agent feed with status, operation count, and a **KILL** button

## Starting it

The dashboard is served by the Shield itself:

```bash
sentinel-shield start --port 9090 --http 8080
# Shield protocol on 9090, dashboard on http://127.0.0.1:8080
```

Then open `http://localhost:8080`.

## API

The dashboard consumes a tiny JSON API exposed on the HTTP port:

| Route | Method | Returns |
|-------|--------|---------|
| `/` | GET | The static dashboard HTML |
| `/api/status` | GET | `DashboardState` JSON (Shield + OWASP + EU AI Act) |
| `/api/kill` | POST | Fire the kill switch: `{ agent, reason? }` → `{ killed, snapshot }` |

```bash
curl http://localhost:8080/api/status
curl -XPOST http://localhost:8080/api/kill -d '{"agent":"worker","reason":"manual"}'
```

`/api/kill` can be disabled (`allowKill: false`) for read-only/observer
deployments.

## Programmatic use

```typescript
import { ShieldCore, buildDashboardState, createDashboardServer } from 'sentinel';

const core = new ShieldCore({ policy: 'strict' });
const server = createDashboardServer(core, { port: 8080, allowKill: true });

// Or just build the state object yourself:
const state = buildDashboardState(core);
```

## Extension points

- **D3 force-directed trust graph** — the Trust Graph exports JSON/Mermaid/DOT;
  render it as an interactive force-directed graph with D3 in the browser.
- **PDF export** — the compliance view can be exported to PDF via the same
  Markdown→PDF pipeline used by `sentinel-compliance`.
- **Authentication** — front the HTTP API with the existing token auth
  (`sentinel serve` uses `X-Sentinel-Token`) or a reverse proxy.
