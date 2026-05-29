// ---------------------------------------------------------------------------
// SENTINEL Boot — Cold Start Accelerator
// ---------------------------------------------------------------------------
// The eager `createSentinel()` factory constructs all 16 modules and wires 7 of
// them into the kernel on every call — even when the consumer only touches
// one or two. This module provides:
//
//   1. Lazy proxies  — modules are constructed on first property access
//   2. Module groups — declare what you need; skip the rest entirely
//   3. Warmup API    — selectively pre-initialize specific modules
//   4. Snapshot/restore — serialize a warmed SENTINEL instance to JSON and
//      restore it without re-running constructors
//   5. Boot timing   — instrument every phase for profiling
//
// Usage:
//   import { boot } from 'sentinel';
//   const sentinel = boot({ modules: ['kernel', 'policy', 'trace'] });
//   // Only kernel, policy engine, and trace store are constructed.
//   // Accessing sentinel.temporal later will construct it on demand.
// ---------------------------------------------------------------------------

import type { SentinelConfig } from '../kernel/types.js';

// Module constructors — imported once, deferred via lazy proxy
import { Kernel as _Kernel } from '../kernel/kernel.js';
import { PolicyEngine as _PolicyEngine } from '../safe/policy.js';
import { ApprovalGateway as _ApprovalGateway } from '../safe/approval.js';
import { BlastRadiusAnalyzer as _BlastRadiusAnalyzer } from '../safe/blast-radius.js';
import { PolicyDSL as _PolicyDSL } from '../safe/dsl.js';
import { IdentityManager as _IdentityManager } from '../id/identity.js';
import { ShadowExecutor as _ShadowExecutor } from '../exec/shadow.js';
import { TransactionCoordinator as _TransactionCoordinator } from '../exec/transaction.js';
import { PipelineEngine as _PipelineEngine } from '../exec/pipeline.js';
import { TemporalBranchEngine as _TemporalBranchEngine } from '../exec/temporal.js';
import { TraceStore as _TraceStore } from '../trace/store.js';
import { MerkleChain as _MerkleChain } from '../trace/merkle.js';
import { StateManager as _StateManager } from '../info/state.js';
import { DriftDetector as _DriftDetector } from '../info/drift.js';
import type { DriftStateProvider } from '../info/drift.js';
import { MagicRecovery as _MagicRecovery } from '../magic/recovery.js';
import { SpecManager as _SpecManager } from '../spec/version.js';
import { ApiLayer as _ApiLayer } from '../api/transport.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Every module that createSentinel returns. */
export type SentinelModuleName =
  | 'kernel' | 'policy' | 'approval' | 'blastRadius' | 'dsl'
  | 'identity' | 'executor' | 'transactions' | 'pipelines'
  | 'temporal' | 'trace' | 'merkle' | 'state' | 'drift'
  | 'magic' | 'spec' | 'api';

/** Predefined module groups for common use cases. */
export type ModuleGroup = 'core' | 'safety' | 'execution' | 'audit' | 'observability' | 'all';

/** A single timing entry. */
export interface BootTiming {
  module: string;
  phase: 'construct' | 'wire' | 'warmup' | 'snapshot' | 'restore';
  durationMs: number;
  timestamp: number;
}

/** The full boot report. */
export interface BootReport {
  totalMs: number;
  timings: BootTiming[];
  modulesEager: string[];
  modulesDeferred: string[];
  fromSnapshot: boolean;
}

/** Options for the boot() factory. */
export interface BootOptions {
  /** Partial SENTINEL config (same as createSentinel). */
  config?: Partial<SentinelConfig>;

  /** Which modules to construct eagerly. Unlisted modules become lazy. */
  modules?: Array<SentinelModuleName | ModuleGroup>;

  /** Restore from a previous snapshot instead of constructing fresh. */
  snapshot?: SentinelSnapshot;

  /**
   * Provider for the DriftDetector. When supplied, `drift.check(surfaceId)`
   * works immediately after boot(). When omitted, `drift.setProvider()` must
   * be called manually before `drift.check()` is used.
   */
  driftProvider?: DriftStateProvider;
}

/** Serialized snapshot of an SENTINEL instance's restorable state. */
export interface SentinelSnapshot {
  version: number;
  config: SentinelConfig;
  /** Per-module serialized state. Only stateful modules are included. */
  modules: Record<string, unknown>;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Module group resolution
// ---------------------------------------------------------------------------

const MODULE_GROUPS: Record<ModuleGroup, SentinelModuleName[]> = {
  core:          ['kernel', 'identity', 'executor'],
  safety:        ['policy', 'approval', 'blastRadius', 'dsl'],
  execution:     ['executor', 'transactions', 'pipelines', 'temporal'],
  audit:         ['trace', 'merkle'],
  observability: ['state', 'drift'],
  all: [
    'kernel', 'policy', 'approval', 'blastRadius', 'dsl',
    'identity', 'executor', 'transactions', 'pipelines',
    'temporal', 'trace', 'merkle', 'state', 'drift',
    'magic', 'spec', 'api',
  ],
};

/** Kernel wiring requires these modules to be available. */
const KERNEL_DEPS: SentinelModuleName[] = [
  'policy', 'executor', 'trace', 'state', 'identity', 'approval', 'blastRadius',
  // Multi-step execution engines must always be connected to the kernel's full
  // security lifecycle. Including them here ensures they are eagerly constructed
  // and wired whenever kernel is requested — preventing security checks from
  // being bypassed if temporal or pipelines are lazy-initialized later.
  'temporal', 'pipelines',
];

function resolveModules(requested: Array<SentinelModuleName | ModuleGroup>): Set<SentinelModuleName> {
  const result = new Set<SentinelModuleName>();
  for (const item of requested) {
    if (item in MODULE_GROUPS) {
      for (const m of MODULE_GROUPS[item as ModuleGroup]) result.add(m);
    } else {
      result.add(item as SentinelModuleName);
    }
  }
  // If kernel is requested, auto-include its wiring dependencies
  if (result.has('kernel')) {
    for (const dep of KERNEL_DEPS) result.add(dep);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Lazy proxy factory
// ---------------------------------------------------------------------------

/**
 * Creates a proxy that defers construction of `factory()` until the first
 * property access or method call. Once initialized, all subsequent access
 * goes directly to the real object.
 */
function lazyProxy<T extends object>(
  factory: () => T,
  onInit?: (instance: T, durationMs: number) => void,
): T {
  let instance: T | undefined;

  const handler: ProxyHandler<object> = {
    get(_target, prop, receiver) {
      if (!instance) {
        const start = performance.now();
        instance = factory();
        onInit?.(instance, performance.now() - start);
      }
      const value = Reflect.get(instance, prop, receiver);
      if (typeof value === 'function') return value.bind(instance);
      return value;
    },
    set(_target, prop, value) {
      if (!instance) {
        const start = performance.now();
        instance = factory();
        onInit?.(instance, performance.now() - start);
      }
      return Reflect.set(instance, prop, value);
    },
    has(_target, prop) {
      if (!instance) {
        const start = performance.now();
        instance = factory();
        onInit?.(instance, performance.now() - start);
      }
      return Reflect.has(instance, prop);
    },
  };

  return new Proxy(Object.create(null) as object, handler) as T;
}

// ---------------------------------------------------------------------------
// Default config (duplicated to avoid importing index.ts)
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: SentinelConfig = {
  defaultRiskThreshold: 'high',
  requireShadowFirst: true,
  requireApprovalAbove: 'high',
  traceEnabled: true,
  maxShadowDurationMs: 30000,
  adapters: {},
};

// ---------------------------------------------------------------------------
// Snapshot support
// ---------------------------------------------------------------------------

/** Modules that support snapshot/restore. */
interface Snapshotable {
  exportState?: () => unknown;
  restoreState?: (data: unknown) => void;
}

function trySnapshot(name: string, mod: unknown): unknown | undefined {
  const s = mod as Snapshotable;
  if (typeof s?.exportState === 'function') return s.exportState();
  return undefined;
}

function tryRestore(name: string, mod: unknown, data: unknown): void {
  const s = mod as Snapshotable;
  if (typeof s?.restoreState === 'function' && data !== undefined) {
    s.restoreState(data);
  }
}

// ---------------------------------------------------------------------------
// Boot — the main factory
// ---------------------------------------------------------------------------

export type SentinelInstance = ReturnType<typeof boot>;

export function boot(options: BootOptions = {}) {
  const bootStart = performance.now();
  const timings: BootTiming[] = [];
  const config: SentinelConfig = { ...DEFAULT_CONFIG, ...options.config };

  const eagerSet = options.modules
    ? resolveModules(options.modules)
    : resolveModules(['all']);

  const eagerModules: string[] = [...eagerSet];
  const allModules = MODULE_GROUPS.all;
  const deferredModules = allModules.filter(m => !eagerSet.has(m));

  // -- Timing helper --------------------------------------------------------

  function recordTiming(module: string, phase: BootTiming['phase'], fn: () => void): void {
    const start = performance.now();
    fn();
    timings.push({ module, phase, durationMs: performance.now() - start, timestamp: Date.now() });
  }

  // -- Module factories ------------------------------------------------------
  // All modules are already in Node's module cache from the barrel re-exports
  // in index.ts. The real cost we eliminate is deferring constructor calls and
  // kernel wiring until the module is actually needed.

  const factories: Record<SentinelModuleName, () => unknown> = {
    kernel:       () => new _Kernel(config),
    policy:       () => new _PolicyEngine(config),
    approval:     () => new _ApprovalGateway(),
    blastRadius:  () => new _BlastRadiusAnalyzer(),
    dsl:          () => new _PolicyDSL(),
    identity:     () => new _IdentityManager(),
    executor:     () => new _ShadowExecutor(config),
    transactions: () => new _TransactionCoordinator(),
    pipelines:    () => new _PipelineEngine(),
    temporal:     () => new _TemporalBranchEngine(),
    trace:        () => new _TraceStore(),
    merkle:       () => new _MerkleChain(),
    state:        () => new _StateManager(),
    drift:        () => new _DriftDetector(),
    magic:        () => new _MagicRecovery(),
    spec:         () => new _SpecManager(),
    api:          () => new _ApiLayer(),
  };

  // -- Construct eager modules, lazy-proxy the rest -------------------------

  const instances: Record<string, unknown> = {};

  for (const name of allModules) {
    if (eagerSet.has(name)) {
      recordTiming(name, 'construct', () => {
        instances[name] = factories[name]();
      });
    } else {
      instances[name] = lazyProxy(
        factories[name] as () => object,
        (_inst, durationMs) => {
          timings.push({ module: name, phase: 'construct', durationMs, timestamp: Date.now() });
        },
      );
    }
  }

  // -- Wire kernel if it was eagerly constructed ----------------------------

  if (eagerSet.has('kernel')) {
    recordTiming('kernel', 'wire', () => {
      const kernel = instances.kernel as any;
      kernel.setSafeModule(instances.policy);
      kernel.setExecModule(instances.executor);
      kernel.setTraceModule(instances.trace);
      kernel.setInfoModule(instances.state);
      kernel.setIdModule(instances.identity);
      kernel.setApprovalModule(instances.approval);
      kernel.setBlastModule(instances.blastRadius);

      // Mirror createSentinel(): wire multi-step execution engines through the
      // kernel so every committed action passes the full security lifecycle.
      // temporal and pipelines are in KERNEL_DEPS so they are always present
      // here — this prevents security checks from being bypassed when these
      // modules would otherwise be lazy-initialized after boot() returns.
      (instances.temporal as any).setExecModule(instances.executor);
      (instances.temporal as any).setKernel(kernel);
      (instances.pipelines as any).setKernel(kernel);

      // Wire ApprovalGateway into PipelineEngine so `approval` pipeline steps
      // trigger real human-in-the-loop approval rather than passing silently.
      (instances.pipelines as any).setApprovalGateway(instances.approval);
    });
  }

  // -- Restore from snapshot if provided ------------------------------------

  const fromSnapshot = !!options.snapshot;
  if (options.snapshot) {
    for (const [name, data] of Object.entries(options.snapshot.modules)) {
      if (instances[name]) {
        recordTiming(name, 'restore', () => {
          tryRestore(name, instances[name], data);
        });
      }
    }
  }

  // -- Wire DriftDetector provider if supplied -------------------------------

  if (options.driftProvider && instances.drift) {
    (instances.drift as _DriftDetector).setProvider(options.driftProvider);
  }

  // -- Public API -----------------------------------------------------------

  const totalMs = performance.now() - bootStart;

  /** Get the boot performance report. */
  function getBootReport(): BootReport {
    return {
      totalMs,
      timings: [...timings],
      modulesEager: eagerModules,
      modulesDeferred: deferredModules,
      fromSnapshot,
    };
  }

  /** Warmup specific modules that are currently lazy. */
  function warmup(...modules: SentinelModuleName[]): void {
    for (const name of modules) {
      if (instances[name]) {
        // Accessing a property forces the lazy proxy to initialize
        const mod = instances[name] as any;
        recordTiming(name, 'warmup', () => {
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          mod.constructor;
        });
      }
    }
  }

  /** Take a snapshot of all stateful modules for fast restore later. */
  function snapshot(): SentinelSnapshot {
    const moduleData: Record<string, unknown> = {};
    const start = performance.now();

    for (const name of allModules) {
      const data = trySnapshot(name, instances[name]);
      if (data !== undefined) moduleData[name] = data;
    }

    timings.push({
      module: '*',
      phase: 'snapshot',
      durationMs: performance.now() - start,
      timestamp: Date.now(),
    });

    return {
      version: 1,
      config,
      modules: moduleData,
      createdAt: Date.now(),
    };
  }

  return {
    // Modules — same shape as createSentinel()
    kernel:       instances.kernel       as _Kernel,
    policy:       instances.policy       as _PolicyEngine,
    approval:     instances.approval     as _ApprovalGateway,
    blastRadius:  instances.blastRadius  as _BlastRadiusAnalyzer,
    dsl:          instances.dsl          as _PolicyDSL,
    identity:     instances.identity     as _IdentityManager,
    executor:     instances.executor     as _ShadowExecutor,
    transactions: instances.transactions as _TransactionCoordinator,
    pipelines:    instances.pipelines    as _PipelineEngine,
    temporal:     instances.temporal     as _TemporalBranchEngine,
    trace:        instances.trace        as _TraceStore,
    merkle:       instances.merkle       as _MerkleChain,
    chain:        instances.merkle       as _MerkleChain,  // alias
    state:        instances.state        as _StateManager,
    drift:        instances.drift        as _DriftDetector,
    magic:        instances.magic        as _MagicRecovery,
    spec:         instances.spec         as _SpecManager,
    api:          instances.api          as _ApiLayer,
    config,

    // Boot-specific API
    getBootReport,
    warmup,
    snapshot,
  };
}
