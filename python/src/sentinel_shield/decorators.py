"""Ergonomic helpers built on :class:`SentinelShield`.

``@protect`` guards a function so every invocation is screened by the Shield
before the body runs, and ``session`` provides a connected client as a context
manager.
"""

from __future__ import annotations

import functools
from contextlib import contextmanager
from typing import Any, Callable, Dict, Iterator, Optional, TypeVar

from .client import SentinelShield
from .protocol import ToolCall

F = TypeVar("F", bound=Callable[..., Any])


@contextmanager
def session(
    agent: str,
    port: Optional[int] = None,
    host: str = "127.0.0.1",
    socket_path: Optional[str] = None,
    timeout: float = 5.0,
) -> Iterator[SentinelShield]:
    """Connect to the Shield for the duration of a ``with`` block.

    Example::

        with session("my-agent", port=9090) as shield:
            shield.guard("shell", {"cmd": "ls"})
    """
    shield = SentinelShield(port=port, host=host, socket_path=socket_path, timeout=timeout)
    shield.connect(agent)
    try:
        yield shield
    finally:
        shield.close()


def protect(
    shield: SentinelShield,
    tool: Optional[str] = None,
    args_from: Optional[Callable[..., Dict[str, Any]]] = None,
) -> Callable[[F], F]:
    """Guard a callable: scan a derived tool call before each invocation.

    The tool name defaults to the wrapped function's name. ``args_from`` maps
    the call's ``*args/**kwargs`` to the dict presented to the firewall; by
    default the keyword arguments are used directly. If the Shield blocks the
    call, :class:`ShieldBlocked` is raised and the body never runs.
    """

    def decorator(fn: F) -> F:
        tool_name = tool or fn.__name__

        @functools.wraps(fn)
        def wrapper(*a: Any, **kw: Any) -> Any:
            payload = args_from(*a, **kw) if args_from is not None else dict(kw)
            shield.guard(ToolCall(tool=tool_name, args=payload))
            return fn(*a, **kw)

        return wrapper  # type: ignore[return-value]

    return decorator
