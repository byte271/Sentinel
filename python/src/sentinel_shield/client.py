"""Synchronous SENTINEL Shield client.

Connects a Python agent to the out-of-band Shield sidecar over TCP or a Unix
domain socket and speaks the JSONL protocol. The Shield — not this client —
holds all safety logic; the client merely asks for verdicts and reports
operations so the Shield's transactional kill switch can act out-of-band.

Example::

    from sentinel_shield import SentinelShield, ShieldBlocked

    shield = SentinelShield(port=9090)
    shield.connect("my-agent")
    try:
        shield.guard("shell", {"cmd": "rm -rf /"})  # raises ShieldBlocked
    except ShieldBlocked as exc:
        print("denied:", exc)
    shield.close()
"""

from __future__ import annotations

import socket
import threading
import uuid
from types import TracebackType
from typing import Any, Dict, Optional, Type, Union

from .protocol import (
    PROTOCOL_VERSION,
    LineDecoder,
    ShieldBlocked,
    ShieldError,
    ToolCall,
    Verdict,
    encode,
)


class SentinelShield:
    """A blocking client for the Shield protocol."""

    def __init__(
        self,
        port: Optional[int] = None,
        host: str = "127.0.0.1",
        socket_path: Optional[str] = None,
        timeout: float = 5.0,
    ) -> None:
        if port is None and socket_path is None:
            raise ValueError("Provide either port (TCP) or socket_path (Unix socket)")
        self._port = port
        self._host = host
        self._socket_path = socket_path
        self._timeout = timeout
        self._sock: Optional[socket.socket] = None
        self._decoder = LineDecoder()
        self._lock = threading.Lock()
        self.session_id: Optional[str] = None
        self.token: Optional[str] = None
        self.policy: Optional[str] = None
        self.shield_version: Optional[str] = None
        self.agent: Optional[str] = None

    # ---- connection ------------------------------------------------------

    def connect(self, agent: str) -> Dict[str, Any]:
        """Open the connection and complete the hello handshake."""
        if self._socket_path is not None:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(self._timeout)
            sock.connect(self._socket_path)
        else:
            sock = socket.create_connection((self._host, self._port), timeout=self._timeout)
        self._sock = sock
        self.agent = agent
        welcome = self._round_trip(
            {"type": "hello", "protocol": PROTOCOL_VERSION, "agent": agent},
            expect="welcome",
            correlate=False,
        )
        self.session_id = welcome["sessionId"]
        self.token = welcome["token"]
        self.policy = welcome["policy"]
        self.shield_version = welcome["shieldVersion"]
        return welcome

    def close(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            finally:
                self._sock = None

    # ---- operations ------------------------------------------------------

    def scan(self, tool: Union[str, ToolCall], args: Optional[Dict[str, Any]] = None, text: Optional[str] = None) -> Verdict:
        """Ask the Shield for a verdict on a tool call (does not raise)."""
        call = tool if isinstance(tool, ToolCall) else ToolCall(tool=tool, args=args, text=text)
        rid = uuid.uuid4().hex
        resp = self._round_trip({"type": "scan", "id": rid, "call": call.to_dict()}, expect="verdict", request_id=rid)
        return Verdict.from_response(resp)

    def guard(self, tool: Union[str, ToolCall], args: Optional[Dict[str, Any]] = None, text: Optional[str] = None) -> Verdict:
        """Scan a tool call and raise :class:`ShieldBlocked` if it is blocked."""
        verdict = self.scan(tool, args, text)
        if verdict.blocked:
            tool_name = tool.tool if isinstance(tool, ToolCall) else tool
            raise ShieldBlocked(verdict, tool_name)
        return verdict

    def begin(self, description: str) -> str:
        rid = uuid.uuid4().hex
        resp = self._round_trip({"type": "begin", "id": rid, "description": description}, expect="ok", request_id=rid)
        return resp["opId"]

    def complete(self, op_id: str) -> None:
        rid = uuid.uuid4().hex
        self._round_trip({"type": "complete", "id": rid, "opId": op_id}, expect="ok", request_id=rid)

    def kill(self, agent: Optional[str] = None, mode: str = "hard", reason: Optional[str] = None) -> Dict[str, Any]:
        rid = uuid.uuid4().hex
        payload: Dict[str, Any] = {"type": "kill", "id": rid, "mode": mode}
        if agent is not None:
            payload["agent"] = agent
        if reason is not None:
            payload["reason"] = reason
        resp = self._round_trip(payload, expect="killed", request_id=rid)
        return resp["snapshot"]

    def status(self) -> Dict[str, Any]:
        rid = uuid.uuid4().hex
        return self._round_trip({"type": "status", "id": rid}, expect="status", request_id=rid)

    def ping(self) -> None:
        rid = uuid.uuid4().hex
        self._round_trip({"type": "ping", "id": rid}, expect="pong", request_id=rid)

    # ---- context manager -------------------------------------------------

    def __enter__(self) -> "SentinelShield":
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.close()

    # ---- internals -------------------------------------------------------

    def _round_trip(
        self,
        payload: Dict[str, Any],
        expect: str,
        request_id: Optional[str] = None,
        correlate: bool = True,
    ) -> Dict[str, Any]:
        if self._sock is None:
            raise ShieldError("not connected — call connect() first")
        with self._lock:
            self._sock.sendall(encode(payload))
            while True:
                chunk = self._sock.recv(65536)
                if not chunk:
                    raise ShieldError("connection closed by Shield")
                for msg in self._decoder.push(chunk):
                    matched = self._match(msg, expect, request_id, correlate)
                    if matched is not None:
                        return matched

    @staticmethod
    def _match(
        msg: Dict[str, Any],
        expect: str,
        request_id: Optional[str],
        correlate: bool,
    ) -> Optional[Dict[str, Any]]:
        if msg.get("type") == "error":
            raise ShieldError(msg.get("message", "unknown error"))
        if msg.get("type") == "revoked":
            raise ShieldError(f"token revoked: {msg.get('reason')}")
        if msg.get("type") != expect:
            return None
        if correlate and request_id is not None and msg.get("id") != request_id:
            return None
        return msg
