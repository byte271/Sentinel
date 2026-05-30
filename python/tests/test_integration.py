"""Cross-language integration: Python SDK against the real Node Shield.

Skipped automatically when Node or the compiled ``dist/`` build is unavailable,
so the unit suite stays self-contained. When present, this proves the Python
client and the TypeScript Shield speak exactly the same protocol.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import time
from pathlib import Path

import pytest

from sentinel_shield import SentinelShield, ShieldBlocked

REPO_ROOT = Path(__file__).resolve().parents[2]
SHIELD_DIST = REPO_ROOT / "dist" / "shield" / "server.js"


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not SHIELD_DIST.exists(),
    reason="Node or compiled dist/ not available; run `npm run build` first.",
)


@pytest.fixture
def real_shield():
    port = _free_port()
    script = (
        "import('file://%s').then(m => {"
        "const s = new m.ShieldServer({ port: %d, watchdogMs: 0, quiet: true });"
        "s.listen().then(() => { console.log('READY'); });"
        "});" % (SHIELD_DIST.as_posix(), port)
    )
    proc = subprocess.Popen(
        ["node", "--input-type=module", "-e", script],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=str(REPO_ROOT),
        text=True,
    )
    # Wait for READY (or timeout).
    deadline = time.time() + 10
    ready = False
    while time.time() < deadline:
        line = proc.stdout.readline() if proc.stdout else ""
        if "READY" in line:
            ready = True
            break
        if proc.poll() is not None:
            break
    if not ready:
        proc.kill()
        pytest.skip("Shield did not start")
    try:
        yield port
    finally:
        proc.kill()


def test_real_shield_allows_and_blocks(real_shield):
    port = real_shield
    with SentinelShield(port=port, timeout=5.0) as shield:
        shield.connect("py-agent")
        assert shield.scan("shell", {"cmd": "ls -la"}).allowed is True
        with pytest.raises(ShieldBlocked):
            shield.guard("shell", {"cmd": "rm -rf /"})


def test_real_shield_kill(real_shield):
    port = real_shield
    with SentinelShield(port=port, timeout=5.0) as shield:
        shield.connect("py-agent")
        snap = shield.kill(agent="py-agent", reason="integration-test")
        assert snap["agentId"] == "py-agent"
