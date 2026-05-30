"""SENTINEL Shield — Python SDK.

Connect any Python agent to the out-of-band SENTINEL Shield sidecar. The Shield
holds all safety logic (deterministic firewall, transactional kill switch,
watchdog); this SDK is a thin, dependency-free client over the JSONL protocol.
"""

from __future__ import annotations

from .client import SentinelShield
from .decorators import protect, session
from .protocol import (
    PROTOCOL_VERSION,
    ShieldBlocked,
    ShieldError,
    ToolCall,
    Verdict,
)

__version__ = "0.3.0"

__all__ = [
    "SentinelShield",
    "protect",
    "session",
    "ToolCall",
    "Verdict",
    "ShieldBlocked",
    "ShieldError",
    "PROTOCOL_VERSION",
    "__version__",
]
