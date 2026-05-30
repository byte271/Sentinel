# Deterministic Shadow Sandbox (S4)

A fully deterministic execution environment for shadow runs. Given the same
seed and the same inputs, a sandbox produces a **bit-for-bit identical**
snapshot — verified by a SHA-256 integrity hash. This makes shadow runs
reproducible for audits, regression tests, and forensic replay.

## Components

| Component | Behaviour |
|-----------|-----------|
| **Virtual filesystem** | In-memory `Map`; `writeFile`, `readFile`, `deleteFile`, `mkdir`, `listDir`, `exists`, `stat`. Never touches disk. |
| **Recorded network** | `captureRequest(method, url, body?, headers?)` records but never sends. Retrieve with `getCapturedRequests()`. |
| **Virtual clock** | `now()` starts at `startTime`; advance with `advanceTime(ms)`. No wall-clock dependence. |
| **Seeded PRNG** | xorshift128+ seeded from a string. `random()`, `randomInt(min,max)`, `uuid()`. Same seed = same stream. |
| **Snapshot/restore** | `snapshot()` returns state + hash; `verifySnapshot()` checks integrity; `fromSnapshot()` restores and resumes the PRNG at the exact position. |

## Determinism guarantee

```typescript
import { DeterministicSandbox } from 'sentinel';

function run(seed: string) {
  const sb = new DeterministicSandbox({ seed, startTime: 0 });
  sb.writeFile('/log', 'start');
  sb.advanceTime(100);
  sb.random();
  sb.captureRequest('GET', 'http://api.test/data');
  sb.writeFile('/result', sb.uuid());
  return sb.snapshot();
}

run('audit-42').hash === run('audit-42').hash;  // true — bit-for-bit
```

## Snapshot & replay

```typescript
const sb = new DeterministicSandbox({ seed: 'replay' });
sb.writeFile('/keep', 'yes');
sb.random();
sb.advanceTime(42);
const snap = sb.snapshot();

// Integrity check
DeterministicSandbox.verifySnapshot(snap); // true

// Restore in a fresh process and continue deterministically
const restored = DeterministicSandbox.fromSnapshot(snap);
restored.readFile('/keep');  // 'yes'
restored.now();              // 42
restored.random();           // resumes the exact PRNG sequence
```

## Snapshot shape

```typescript
interface SandboxSnapshot {
  seed: string;
  clock: number;
  prngCalls: number;          // PRNG position, for exact replay
  fs: Record<string, VfsEntry>;
  network: CapturedRequest[];
  hash: string;               // SHA-256 over the canonical state
}
```

## Extension point

The sandbox runs in-process (the same Node VM as the caller). For true memory
isolation — so a hostile shadow run cannot reach the host — compile the harness
into a WASM module and run it behind a WASM boundary. The deterministic state
model (virtual FS/net/clock/PRNG) is the same; only the isolation boundary changes.
