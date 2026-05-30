"""Shared pytest fixtures: a self-contained fake Shield server.

The fake server speaks just enough of the JSONL protocol to exercise the SDK
without requiring the Node Shield to be running. A separate integration test
(``test_integration.py``) drives the real Shield when Node + the build are
available.
"""

from __future__ import annotations

import json
import socket
import threading
from typing import Dict, Iterator, List, Tuple

import pytest

# A tiny deterministic block-list mirroring the firewall's intent.
_BLOCK_SUBSTRINGS = ["rm -rf", "curl", "| bash", "/etc/shadow", "mkfs"]


def _verdict_for(call: Dict[str, object]) -> Tuple[str, str, int]:
    haystack = json.dumps(call).lower()
    for needle in _BLOCK_SUBSTRINGS:
        if needle in haystack:
            return "block", "critical", 95
    return "allow", "none", 0


class FakeShield:
    def __init__(self) -> None:
        self._server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server.bind(("127.0.0.1", 0))
        self._server.listen(8)
        self.port = self._server.getsockname()[1]
        self.killed: List[str] = []
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._running = True
        self._thread.start()

    def _serve(self) -> None:
        while self._running:
            try:
                conn, _ = self._server.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn: socket.socket) -> None:
        buffer = b""
        agent = "unknown"
        op_counter = 0
        with conn:
            while self._running:
                try:
                    chunk = conn.recv(65536)
                except OSError:
                    return
                if not chunk:
                    return
                buffer += chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    if not line.strip():
                        continue
                    msg = json.loads(line.decode("utf-8"))
                    t = msg.get("type")
                    if t == "hello":
                        agent = msg.get("agent", "unknown")
                        resp = {
                            "type": "welcome",
                            "shieldVersion": "0.3.0",
                            "protocol": 1,
                            "policy": "strict",
                            "sessionId": "sess-fake-1",
                            "token": "ab" * 32,
                        }
                    elif t == "scan":
                        verdict, risk, score = _verdict_for(msg["call"])
                        resp = {
                            "type": "verdict",
                            "id": msg["id"],
                            "verdict": verdict,
                            "risk": risk,
                            "score": score,
                            "matches": [],
                            "allowed": verdict != "block",
                        }
                    elif t == "begin":
                        op_counter += 1
                        resp = {"type": "ok", "id": msg["id"], "opId": f"op-{op_counter}"}
                    elif t == "complete":
                        resp = {"type": "ok", "id": msg["id"]}
                    elif t == "kill":
                        target = msg.get("agent", agent)
                        self.killed.append(target)
                        resp = {
                            "type": "killed",
                            "id": msg["id"],
                            "snapshot": {"agentId": target, "reason": msg.get("reason", "killed"), "status": "killed"},
                        }
                    elif t == "status":
                        resp = {
                            "type": "status",
                            "id": msg["id"],
                            "shieldVersion": "0.3.0",
                            "policy": "strict",
                            "uptimeMs": 1000,
                            "killSwitch": "armed",
                            "agents": [{"agent": agent, "status": "active", "operations": op_counter}],
                            "stats": {"allowed": 0, "warned": 0, "blocked": 0},
                        }
                    elif t == "ping":
                        resp = {"type": "pong", "id": msg["id"]}
                    else:
                        resp = {"type": "error", "id": msg.get("id"), "message": "unknown"}
                    conn.sendall((json.dumps(resp) + "\n").encode("utf-8"))

    def close(self) -> None:
        self._running = False
        try:
            self._server.close()
        except OSError:
            pass


@pytest.fixture
def fake_shield() -> Iterator[FakeShield]:
    shield = FakeShield()
    try:
        yield shield
    finally:
        shield.close()
