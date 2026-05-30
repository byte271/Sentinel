# Security Policy

SENTINEL is a safety and security framework for controlling AI-initiated
actions. We take the security of the project — and of the systems that rely on
it — seriously.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.3.x   | Yes       |
| 0.2.x   | Security fixes only |
| 0.1.x   | Security fixes only |
| < 0.1   | No        |

## Reporting a Vulnerability

Please report security vulnerabilities **privately**. Do not open a public
issue, pull request, or discussion for a suspected vulnerability.

- Use the repository's **private vulnerability reporting** (GitHub → Security →
  *Report a vulnerability*) where available, or contact the maintainers directly.
- Include: a description of the issue, affected module/version, reproduction
  steps or a proof of concept, and the potential impact.
- We aim to acknowledge reports within a few business days and to provide a
  remediation timeline after triage. Please allow reasonable time to release a
  fix before any public disclosure (coordinated disclosure).

## Scope

In scope:

- Bypasses of the execution lifecycle (e.g. committing an action that should
  have been blocked by policy, approval, or blast-radius checks).
- Defeating tamper-evidence: forging or altering the Merkle chain, the Memory
  Integrity ledger, or the Deterministic Replay log without detection.
- Authentication/authorization flaws: signature or token verification bypass,
  timing side channels, replay of inter-agent messages, or delegation/permission
  escalation in the Trust Graph.
- Firewall evasion: tool-call payloads that defeat the detection patterns for a
  documented threat category.
- **Shield control-plane bypass:** reaching the Shield protocol from a process
  that should not (token forgery, session-token replay, evading the watchdog), or
  an agent escaping the SIGKILL of its supervised process group.
- **Sandbox escape:** a shadow run reaching real disk, network, clock, or
  entropy instead of the deterministic virtual environment, or forging a
  snapshot that passes `verifySnapshot()`.

Out of scope:

- Issues that require an already-compromised host or privileged local access.
- The behavior of user-supplied adapters, policies, or custom patterns.
- Limitations explicitly documented in the README (e.g. the firewall is regex
  matching, not a sandbox; mTLS/SPIFFE PKI is an integration point).

## Security Model & Hardening Notes

SENTINEL is designed with these principles. When deploying, keep them in mind:

- **Fail closed.** Engines that could touch reality (temporal branching,
  pipelines) route every commit through the kernel lifecycle and refuse to act
  if no kernel is configured.
- **No self-asserted trust.** The A2A bridge and Trust Graph never honor an
  agent's self-claimed trust level; trust is operator-granted and decays across
  delegation hops.
- **Constant-time comparisons.** API keys, session tokens, and HMAC signatures
  are compared with `crypto.timingSafeEqual`.
- **Provide your own secrets.** Signing features (memory ledger, session tokens,
  inter-agent messages) take an HMAC secret. Supply a strong, unique secret via
  configuration/environment; never commit secrets to source control.
- **Tamper-evidence is detection, not prevention.** Hash chains let you *detect*
  tampering after the fact; combine them with OS-level access controls to
  prevent it.
- **Defense in depth.** The Agent Firewall is a fast, explainable first line of
  defense. Pair it with the kernel's policy/approval lifecycle and runtime
  sandboxing for sensitive operations.
- **Out-of-band control (v0.3.0).** The Shield runs as a separate process; the
  agent connects as a child and cannot see, modify, or kill it. A kill sends
  `SIGKILL` to the agent's process group — it cannot be negotiated or ignored.
  Bind the Shield to loopback (or a Unix socket) and never expose its port to
  untrusted networks; add mTLS or a reverse proxy for remote deployments.
- **Watchdog is software (v0.3.0).** The dead-man's switch detects a hung event
  loop and revokes tokens + snapshots forensics, but it cannot survive its own
  process being `SIGKILL`ed. For true dead-man semantics, feed an external or
  hardware watchdog over IPC.
- **Deterministic sandbox is in-process (v0.3.0).** It removes nondeterminism
  (virtual FS/network/clock/PRNG) but shares the host VM; it is not a security
  isolation boundary. Compile to WASM for memory isolation of hostile code.
