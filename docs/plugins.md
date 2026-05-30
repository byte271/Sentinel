# Framework Plugins (S7)

SENTINEL integrates with agent frameworks through a thin adapter that routes
every tool invocation through the Shield before it executes. The reference
implementation is for **LangChain**; the same pattern applies to any framework
with a tool/callback hook.

## LangChain

`sentinel_langchain.SentinelCallback` is a LangChain callback handler. Drop it
into any agent or chain and every tool call is screened by the Shield first.

```python
from sentinel_shield import session
from sentinel_langchain import SentinelCallback

with session("langchain-agent", port=9090) as shield:
    cb = SentinelCallback(shield)               # raise_on_block=True by default
    agent.run("summarise the repo", callbacks=[cb])
    # a blocked tool raises ShieldBlocked, halting the chain
```

### Audit-only mode

For shadow deployments, record blocks without halting the chain:

```python
cb = SentinelCallback(shield, raise_on_block=False)
agent.run("...", callbacks=[cb])
print(cb.block_count)   # how many tool calls would have been blocked
print(cb.blocked)        # [{tool, input, verdict, score}, ...]
```

### Hooks

| Hook | When | Behaviour |
|------|------|-----------|
| `on_tool_start(serialized, input_str)` | Before a tool runs | Scan `{tool, input}`; block → raise/record |
| `on_agent_action(action)` | Older agent API | Scan `action.tool` + `action.tool_input` |

The callback works even when `langchain` is not installed — it falls back to a
local base class, so it is fully unit-testable with a mock framework.

## Other frameworks

The integration is intentionally minimal: **call `shield.guard(...)` (or
`shield.scan(...)`) before a tool executes**. To support another framework, wrap
its tool-invocation hook the same way:

- **LlamaIndex** — wrap tools in a `BaseToolSpec` shim that calls `shield.guard`.
- **CrewAI** — subclass the tool base and guard in `_run`.
- **AutoGen** — register a `register_hook("process_message_before_send", ...)`
  that scans outgoing tool calls.
- **Custom** — anywhere you dispatch a tool, call `shield.guard(tool, args)` and
  let `ShieldBlocked` propagate.

Because all safety logic lives in the out-of-band Shield, every framework shares
the same firewall, kill switch, and audit trail — there is no per-framework
policy to keep in sync.
