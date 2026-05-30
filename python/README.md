# sentinel-shield (Python SDK)

A zero-dependency Python client for the [SENTINEL](https://github.com/byte271/sentinel)
Shield — the out-of-band agent-safety sidecar. Connect any Python agent to a
running Shield and screen tool calls before they execute. Also ships
`sentinel_langchain.SentinelCallback` for LangChain.

```bash
pip install -e .          # from this directory
```

```python
from sentinel_shield import session, ShieldBlocked

with session("my-agent", port=9090) as shield:
    shield.guard("shell", {"cmd": "ls"})          # allowed
    try:
        shield.guard("shell", {"cmd": "rm -rf /"})  # raises ShieldBlocked
    except ShieldBlocked as exc:
        print("denied:", exc)
```

Start a Shield first (from the repo root):

```bash
npm run build
sentinel-shield start --port 9090
```

See [docs/python-sdk.md](../docs/python-sdk.md) and
[docs/plugins.md](../docs/plugins.md) for full documentation.

## Testing

```bash
pip install -e ".[test]"
PYTHONPATH=src pytest
```

The unit suite is self-contained (a fake Shield server fixture). The
cross-language integration test drives the real Node Shield and is skipped when
Node or the compiled `dist/` build is unavailable — run `npm run build` in the
repo root first to exercise it.
