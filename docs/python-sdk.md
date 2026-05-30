# Python SDK (S6)

`sentinel-shield` is a zero-dependency Python client for the Shield protocol. It
lets any Python agent connect to the out-of-band Shield sidecar and ask for
verdicts before taking actions. The SDK speaks exactly the same JSONL protocol
as the TypeScript `ShieldClient` — this is verified by a cross-language
integration test that drives the real Node Shield from pytest.

## Install

```bash
cd python
pip install -e .          # or: pip install -e ".[test]" for the test extras
```

The package ships `py.typed` (PEP 561), so type checkers see full annotations.

## Usage

### Blocking client

```python
from sentinel_shield import SentinelShield, ShieldBlocked

shield = SentinelShield(port=9090)        # or socket_path="/tmp/shield.sock"
shield.connect("my-agent")

# scan() never raises — inspect the verdict
verdict = shield.scan("shell", {"cmd": "ls -la"})
print(verdict.allowed, verdict.verdict, verdict.score)

# guard() raises ShieldBlocked when the call is blocked
try:
    shield.guard("shell", {"cmd": "rm -rf /"})
except ShieldBlocked as exc:
    print("denied:", exc.verdict.risk)

shield.close()
```

### Context manager

```python
from sentinel_shield import session

with session("my-agent", port=9090) as shield:
    shield.guard("shell", {"cmd": "echo hi"})
# connection closed automatically
```

### Decorator

```python
from sentinel_shield import session
from sentinel_shield.decorators import protect

with session("my-agent", port=9090) as shield:

    @protect(shield, tool="read_file")
    def read_file(path: str) -> str:
        return open(path).read()

    read_file(path="notes.txt")   # scanned before the body runs
```

`protect` derives the tool name from the function name by default; override with
`tool=...`. Map call arguments to the firewall payload with `args_from=...`.

## API surface

| Symbol | Description |
|--------|-------------|
| `SentinelShield(port=, host=, socket_path=, timeout=)` | Blocking client |
| `.connect(agent)` | Handshake; returns the welcome dict |
| `.scan(tool, args=, text=)` | Returns a `Verdict` (never raises on block) |
| `.guard(tool, args=, text=)` | Raises `ShieldBlocked` if blocked |
| `.begin(description)` / `.complete(op_id)` | Operation tracking |
| `.kill(agent=, mode=, reason=)` | Fire the kill switch; returns the snapshot |
| `.status()` / `.ping()` / `.close()` | Status, keepalive, teardown |
| `session(agent, ...)` | Context manager yielding a connected client |
| `protect(shield, tool=, args_from=)` | Function decorator |
| `ToolCall`, `Verdict`, `ShieldBlocked`, `ShieldError` | Protocol types |

## Testing

```bash
cd python
pip install -e ".[test]"
PYTHONPATH=src pytest        # 27 tests
```

The suite uses a self-contained fake Shield server (`conftest.py`) so unit tests
run without Node. `test_integration.py` additionally drives the real Node Shield
when `node` and the compiled `dist/` build are present (run `npm run build`
first), proving the two implementations are protocol-compatible.

## Extension point

The SDK ships as source in `python/`. Publish it to PyPI (`python -m build &&
twine upload`) when you are ready to distribute it.
