import pytest

from sentinel_shield import ShieldBlocked, session
from sentinel_shield.decorators import protect


def test_session_context_manager(fake_shield):
    with session("agent-1", port=fake_shield.port) as shield:
        assert shield.token is not None
        v = shield.scan("shell", {"cmd": "ls"})
        assert v.allowed is True


def test_protect_allows_safe_function(fake_shield):
    with session("agent-1", port=fake_shield.port) as shield:

        @protect(shield, tool="read_file")
        def read_file(path: str) -> str:
            return f"contents of {path}"

        # safe path → body runs
        assert read_file(path="notes.txt") == "contents of notes.txt"


def test_protect_blocks_dangerous_function(fake_shield):
    with session("agent-1", port=fake_shield.port) as shield:

        @protect(shield, tool="shell")
        def run(cmd: str) -> str:
            return "ran"

        with pytest.raises(ShieldBlocked):
            run(cmd="rm -rf /")


def test_protect_uses_args_from(fake_shield):
    with session("agent-1", port=fake_shield.port) as shield:
        calls = {}

        def mapper(*a, **kw):
            calls["seen"] = True
            return {"cmd": kw.get("command", "")}

        @protect(shield, tool="shell", args_from=mapper)
        def run(command: str) -> str:
            return "ok"

        assert run(command="echo hi") == "ok"
        assert calls["seen"] is True
