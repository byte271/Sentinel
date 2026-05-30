"""SENTINEL Shield wire protocol (Python reference).

A newline-delimited JSON ("JSONL") protocol, identical to the TypeScript
reference implementation in ``src/shield/protocol.ts``. Every request carries a
correlation ``id`` echoed by the matching response, so a single connection can
multiplex concurrent requests.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

PROTOCOL_VERSION = 1


@dataclass
class ToolCall:
    """A tool call as presented to the Shield."""

    tool: str
    args: Optional[Dict[str, Any]] = None
    text: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"tool": self.tool}
        if self.args is not None:
            out["args"] = self.args
        if self.text is not None:
            out["text"] = self.text
        return out


@dataclass
class Verdict:
    """The Shield's deterministic decision about a tool call."""

    verdict: str  # "allow" | "warn" | "block"
    risk: str
    score: int
    matches: List[Dict[str, Any]] = field(default_factory=list)
    allowed: bool = True

    @property
    def blocked(self) -> bool:
        return self.verdict == "block"

    @classmethod
    def from_response(cls, msg: Dict[str, Any]) -> "Verdict":
        return cls(
            verdict=msg["verdict"],
            risk=msg["risk"],
            score=msg["score"],
            matches=msg.get("matches", []),
            allowed=msg.get("allowed", msg["verdict"] != "block"),
        )


def encode(msg: Dict[str, Any]) -> bytes:
    """Encode a message as a single newline-terminated JSON line."""
    return (json.dumps(msg, separators=(",", ":")) + "\n").encode("utf-8")


class LineDecoder:
    """Stateful newline-delimited JSON decoder."""

    def __init__(self) -> None:
        self._buffer = b""

    def push(self, chunk: bytes) -> List[Dict[str, Any]]:
        self._buffer += chunk
        out: List[Dict[str, Any]] = []
        while b"\n" in self._buffer:
            line, self._buffer = self._buffer.split(b"\n", 1)
            line = line.strip()
            if line:
                out.append(json.loads(line.decode("utf-8")))
        return out


class ShieldError(RuntimeError):
    """Raised when the Shield returns an error response."""


class ShieldBlocked(RuntimeError):
    """Raised when a protected operation is blocked by the Shield."""

    def __init__(self, verdict: Verdict, tool: str) -> None:
        super().__init__(f"Shield blocked tool '{tool}' (risk={verdict.risk}, score={verdict.score})")
        self.verdict = verdict
        self.tool = tool
