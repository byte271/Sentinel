"""SENTINEL ↔ LangChain integration.

Drop :class:`SentinelCallback` into any LangChain agent or chain to route every
tool invocation through the out-of-band Shield before it runs. A blocked tool
raises :class:`~sentinel_shield.ShieldBlocked`, which halts the chain.

The same pattern (a callback/middleware that calls ``shield.guard`` before a
tool executes) applies to any agent framework — LlamaIndex, CrewAI, AutoGen,
etc. See ``docs/plugins.md``.
"""

from __future__ import annotations

from .callback import SentinelCallback

__all__ = ["SentinelCallback"]
__version__ = "0.3.0"
