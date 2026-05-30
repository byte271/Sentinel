# Shield Sidecar (S1)

The Shield is an **out-of-band control plane**. It runs as a separate process
from the agent it protects. The agent connects to the Shield over a socket and
asks for verdicts; it cannot see, modify, or kill the Shield. If the agent goes
rogue, the Shield — as the parent process — sends `SIGKILL` to the agent's
process group. There is no negotiation.

## Why out-of-band?

In-process guardrails share the agent's memory and event loop. A compromised or
buggy agent can disable them. The Shield inverts the relationship: it is the
parent, the agent is the child, and all safety state (firewall, kill switch,
token registry, watchdog) lives in the Shield's process.

```
┌─────────────┐         JSONL over TCP / Unix socket        ┌──────────────┐
│   Agent     │  ──────────────────────────────────────▶   │    Shield     │
│  (child)    │     hello / scan / begin / complete         │   (parent)    │
│             │  ◀──────────────────────────────────────    │  firewall     │
│             │     welcome / verdict / ok / killed          │  kill switch  │
└─────────────┘                                              │  watchdog     │
       ▲                                                     └──────┬───────┘
       │                    SIGKILL (process group)                 │
       └─────────────────────────────────────────────────────────-─┘
```

## Protocol

Newline-delimited JSON ("JSONL"). Each request carries a correlation `id`
echoed in the matching response, so one connection multiplexes concurrent
requests. Protocol version is `1`.

### Client → Shield

| Type | Fields | Purpose |
|------|--------|---------|
| `hello` | `protocol`, `agent` | Handshake; returns a session token |
| `scan` | `id`, `call` | Ask for a verdict on a tool call |
| `begin` | `id`, `description` | Start a tracked operation |
| `complete` | `id`, `opId` | Complete a tracked operation |
| `kill` | `id`, `agent?`, `mode`, `reason?` | Fire the kill switch |
| `status` | `id` | Query Shield status |
| `ping` | `id` | Keepalive |

### Shield → Client

| Type | Fields | Purpose |
|------|--------|---------|
| `welcome` | `shieldVersion`, `protocol`, `policy`, `sessionId`, `token` | Handshake response |
| `verdict` | `id`, `verdict`, `risk`, `score`, `matches`, `allowed` | Firewall decision |
| `ok` | `id`, `opId?` | Operation acknowledged |
| `killed` | `id`, `snapshot` | Kill complete + forensic snapshot |
| `status` | `id`, `shieldVersion`, `policy`, `uptimeMs`, `killSwitch`, `agents`, `stats` | Status |
| `pong` | `id` | Keepalive response |
| `error` | `id?`, `message` | Error |
| `revoked` | `reason` | Token revoked (e.g. watchdog fired) |

## Watchdog

A software dead-man's switch. An internal heartbeat feeds the watchdog at half
the configured window, proving the event loop is alive. If the window elapses
without a feed (a hung or dead loop), the watchdog fires exactly once:

1. Revoke every session token (clients receive a `revoked` notice).
2. Write a forensic snapshot to `.sentinel-forensics/`.

Disable with `--watchdog 0`. The window defaults to 5000ms.

> **Extension point:** a software watchdog cannot detect its own process being
> SIGKILLed (the timer dies with the process). For true dead-man semantics, wire
> an external/hardware watchdog that the Shield must feed over IPC.

## CLI

```bash
# Start the sidecar
sentinel-shield start --port 9090 --policy strict --watchdog 5000 --http 8080

# Query a running Shield
sentinel-shield status --port 9090

# Connect an agent and scan a tool call (reference client)
sentinel connect -t shell -c "rm -rf /" --port 9090   # exit code 2 on block
```

## Programmatic use

```typescript
import { ShieldServer, ShieldClient } from 'sentinel';

const server = new ShieldServer({ port: 9090, policy: 'strict' });
await server.listen();

// Optionally spawn an agent as a supervised child:
server.spawnAgent('worker', 'node', ['agent.js']);

const client = new ShieldClient({ port: 9090 });
const welcome = await client.connect('worker');
const verdict = await client.scan({ tool: 'shell', args: { cmd: 'ls' } });
if (verdict.verdict === 'block') {
  await client.kill({ agent: 'worker', mode: 'hard', reason: 'policy violation' });
}
```

## Extension points

- **Hardware watchdog** — replace the in-process timer with an external feed.
- **mTLS** — wrap the TCP transport in TLS with client certs for authenticated agents.
- **Distributed deployment** — the protocol is transport-agnostic; run the Shield on a separate host.
