"""A LangChain callback handler that enforces Shield verdicts on tool use."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from sentinel_shield import SentinelShield, ShieldBlocked, ToolCall

try:  # pragma: no cover - exercised only when langchain is installed
    from langchain_core.callbacks.base import BaseCallbackHandler as _Base
except ImportError:  # keep the plugin usable (and testable) without langchain
    class _Base:  # type: ignore[no-redef]
        """Minimal stand-in for langchain_core's BaseCallbackHandler."""


class SentinelCallback(_Base):
    """Route LangChain tool invocations through the SENTINEL Shield.

    Parameters
    ----------
    shield:
        A connected :class:`~sentinel_shield.SentinelShield` instance.
    raise_on_block:
        When ``True`` (default) a blocked tool raises
        :class:`~sentinel_shield.ShieldBlocked`, halting the chain. When
        ``False`` the block is recorded in :attr:`blocked` and the tool is
        allowed to proceed (useful for audit-only / shadow deployments).
    """

    def __init__(self, shield: SentinelShield, raise_on_block: bool = True) -> None:
        super().__init__()
        self.shield = shield
        self.raise_on_block = raise_on_block
        self.blocked: List[Dict[str, Any]] = []
        self.allowed: List[Dict[str, Any]] = []

    # LangChain calls this synchronously right before a tool runs.
    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        **kwargs: Any,
    ) -> None:
        tool_name = (serialized or {}).get("name", "tool")
        call = ToolCall(tool=tool_name, args={"input": input_str}, text=input_str)
        verdict = self.shield.scan(call)
        record = {"tool": tool_name, "input": input_str, "verdict": verdict.verdict, "score": verdict.score}
        if verdict.blocked:
            self.blocked.append(record)
            if self.raise_on_block:
                raise ShieldBlocked(verdict, tool_name)
        else:
            self.allowed.append(record)

    # Agent action hook (older LangChain agent API). Best-effort, same policy.
    def on_agent_action(self, action: Any, **kwargs: Any) -> None:
        tool_name = getattr(action, "tool", None)
        tool_input = getattr(action, "tool_input", None)
        if tool_name is None:
            return
        text = tool_input if isinstance(tool_input, str) else str(tool_input)
        verdict = self.shield.scan(ToolCall(tool=tool_name, args={"input": tool_input}, text=text))
        record = {"tool": tool_name, "input": tool_input, "verdict": verdict.verdict, "score": verdict.score}
        if verdict.blocked:
            self.blocked.append(record)
            if self.raise_on_block:
                raise ShieldBlocked(verdict, tool_name)
        else:
            self.allowed.append(record)

    @property
    def block_count(self) -> int:
        return len(self.blocked)
