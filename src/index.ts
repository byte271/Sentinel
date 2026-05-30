// ---------------------------------------------------------------------------
// SENTINEL — AI-Operable Software Protocol
// ---------------------------------------------------------------------------
// Main entry point. Re-exports all public types, modules, and provides a
// convenience factory for quick setup.
// ---------------------------------------------------------------------------

// Re-export all types
export * from './kernel/types.js';

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------
export { Kernel, buildPlan } from './kernel/kernel.js';
export type {
  SafeModule,
  ExecModule,
  TraceModule,
  InfoModule,
  IdModule,
  ApprovalModule,
  BlastRadiusModule,
} from './kernel/kernel.js';

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------
export { PolicyEngine } from './safe/policy.js';
export type { PolicyRule } from './safe/policy.js';
export { ApprovalGateway } from './safe/approval.js';
export { BlastRadiusAnalyzer } from './safe/blast-radius.js';
export { PolicyDSL } from './safe/dsl.js';
export type { DSLContext } from './safe/dsl.js';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
export { IdentityManager } from './id/identity.js';

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------
export { ShadowExecutor } from './exec/shadow.js';
export type { ActionAdapter } from './exec/shadow.js';
export { TransactionCoordinator } from './exec/transaction.js';
export type { TransactionExecutor } from './exec/transaction.js';
export { PipelineEngine } from './exec/pipeline.js';
export type { PipelineKernel } from './exec/pipeline.js';
export { TemporalBranchEngine } from './exec/temporal.js';
export type { PlanBuilder, TemporalStateProvider } from './exec/temporal.js';
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
export { KillSwitch, AgentSession } from './exec/killswitch.js';
export type {
  KillMode,
  AgentStatus,
  AgentOperation,
  ForensicsSnapshot,
  RecoveryPlan,
  KillOptions,
  CompensationRecord,
} from './exec/killswitch.js';
<<<<<<< HEAD
=======
=======
>>>>>>> e550e260dcc2f57c57596854a8be22259fd660ce
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7

// ---------------------------------------------------------------------------
// Trace & Audit
// ---------------------------------------------------------------------------
export { TraceStore } from './trace/store.js';
export { MerkleChain } from './trace/merkle.js';

// ---------------------------------------------------------------------------
// Info
// ---------------------------------------------------------------------------
export { StateManager } from './info/state.js';
export { DriftDetector } from './info/drift.js';
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
export { ContextGuardian } from './info/context.js';
export type {
  ContextChunk,
  ContextHealth,
  ContextSource,
  ContextGuardianOptions,
} from './info/context.js';
<<<<<<< HEAD
=======
=======
>>>>>>> e550e260dcc2f57c57596854a8be22259fd660ce
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7

// ---------------------------------------------------------------------------
// Magic
// ---------------------------------------------------------------------------
export { MagicRecovery } from './magic/recovery.js';

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------
export { SpecManager, SENTINEL_VERSION, SENTINEL_PROTOCOL_VERSION } from './spec/version.js';

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
export { ApiLayer } from './api/transport.js';
export { HttpServer } from './api/server.js';
<<<<<<< HEAD
export type { ServerConfig, AuthConfig, SentinelServices } from './api/server.js';
export { TokenManager, defaultTokenPath } from './api/token.js';
=======
<<<<<<< HEAD
export type { ServerConfig, AuthConfig, SentinelServices } from './api/server.js';
export { TokenManager, defaultTokenPath } from './api/token.js';
=======
>>>>>>> e550e260dcc2f57c57596854a8be22259fd660ce
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------
export { FilesystemAdapter, createFilesystemSurface } from './adapters/filesystem.js';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
export { InMemoryPersistenceStore, JsonFilePersistenceStore } from './persist/index.js';
export type { PersistenceStore } from './persist/index.js';
export type { TraceStoreSnapshot } from './trace/store.js';
export { TRACE_SNAPSHOT_KEY } from './trace/store.js';

// ---------------------------------------------------------------------------
// Compliance — NIST AI RMF profile
// ---------------------------------------------------------------------------
export { NistComplianceProfile, gatherEvidence } from './compliance/index.js';
export type {
  NistFunction,
  ControlStatus,
  ComplianceEvidence,
  ControlAssessment,
  FunctionCoverage,
  NistComplianceReport,
  EvidenceSources,
  EvidenceOverrides,
} from './compliance/index.js';
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
export { OwaspAsiAssessor, ASI_RISKS, DEFAULT_CAPABILITIES } from './compliance/index.js';
export type {
  Capability,
  Coverage,
  AsiRiskDefinition,
  AsiRiskResult,
  AsiAssessment,
} from './compliance/index.js';
<<<<<<< HEAD
export { EuAiActAssessor } from './compliance/index.js';
export type {
  AiActRiskTier,
  ConformityStatus,
  AnnexIVRequirement,
  HumanOversightMeasure,
  EuAiActReport,
  EuAiActOptions,
} from './compliance/index.js';
=======
=======
>>>>>>> e550e260dcc2f57c57596854a8be22259fd660ce
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7

// ---------------------------------------------------------------------------
// A2A Safety Bridge
// ---------------------------------------------------------------------------
export { A2ASafetyBridge } from './bridge/index.js';
export type {
  A2AAgentCard,
  A2ADelegation,
  A2ATrustDecision,
  A2ABridgeResult,
  A2ABridgeOptions,
  BridgeKernel,
} from './bridge/index.js';
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
export { OpenClawMemoryGuard } from './bridge/index.js';
export type { IntegrityCheck, OpenClawBridgeOptions } from './bridge/index.js';
export { TrustGraph } from './bridge/index.js';
export type {
  TrustNode,
  TrustEdge,
  TrustAnomaly,
  AnomalyType,
  DelegationResult,
  SignedMessage,
  MessageVerification,
  TrustGraphOptions,
} from './bridge/index.js';

// ---------------------------------------------------------------------------
// Agent Firewall — deterministic tool-call scanning
// ---------------------------------------------------------------------------
export { AgentFirewall, BUILTIN_PATTERNS } from './firewall/index.js';
export type {
  FirewallVerdict,
  FirewallCategory,
  FirewallPolicy,
  DetectionPattern,
  DetectionPatternSpec,
  ToolCall,
  PatternMatch,
  FirewallResult,
  AgentFirewallOptions,
} from './firewall/index.js';

// ---------------------------------------------------------------------------
// Deterministic Replay — record & replay agent execution
// ---------------------------------------------------------------------------
export { ExecutionRecorder, ReplayCursor, NonDeterminismError } from './replay/index.js';
export type { RecordedEvent, ReplayEventType, RecordingExport } from './replay/index.js';

// ---------------------------------------------------------------------------
// Memory Integrity Layer — signed, append-only memory ledger
// ---------------------------------------------------------------------------
export { MemoryLedger } from './memory/index.js';
export type {
  MemoryEntry,
  MemoryProvenance,
  MemorySource,
  MemoryVerification,
  MemoryLedgerOptions,
} from './memory/index.js';

// ---------------------------------------------------------------------------
// Observable Agent Protocol — OpenTelemetry-native span emitter
// ---------------------------------------------------------------------------
export { Tracer, Span, SpanNames } from './observe/index.js';
export type {
  SpanData,
  SpanEvent,
  SpanStatus,
  AttributeValue,
  TracerOptions,
} from './observe/index.js';

// ---------------------------------------------------------------------------
// Prevented Futures — terminal timeline renderer
// ---------------------------------------------------------------------------
export { renderPreventedFutures } from './tui/index.js';
export type { PreventedAction, PreventedVerdict, PreventedFuturesData } from './tui/index.js';
<<<<<<< HEAD

// ---------------------------------------------------------------------------
// Adversarial Self-Testing — Red Team engine (v0.3.0)
// ---------------------------------------------------------------------------
export { RedTeamEngine, generateAttacks } from './redteam/index.js';
export type {
  AttackCategory,
  AttackVector,
  AttackResult,
  CategoryCoverage,
  RedTeamReport,
  RedTeamOptions,
} from './redteam/index.js';

// ---------------------------------------------------------------------------
// Shield — out-of-band sidecar runtime (v0.3.0)
// ---------------------------------------------------------------------------
export { ShieldCore, ShieldServer, ShieldClient, Watchdog, SHIELD_PROTOCOL_VERSION } from './shield/index.js';
export type {
  ShieldCoreOptions,
  ShieldStats,
  ShieldServerOptions,
  ShieldClientOptions,
  WatchdogState,
  WatchdogOptions,
  ShieldToolCall,
  ShieldRequest,
  ShieldResponse,
} from './shield/index.js';

// ---------------------------------------------------------------------------
// Deterministic Shadow Sandbox (v0.3.0)
// ---------------------------------------------------------------------------
export { DeterministicSandbox } from './sandbox/index.js';
export type {
  VfsEntry,
  CapturedRequest,
  SandboxSnapshot,
  SandboxOptions,
} from './sandbox/index.js';
=======
=======
>>>>>>> e550e260dcc2f57c57596854a8be22259fd660ce
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------
export { makeIntent, inferRollbackAction } from './helpers.js';

// ---------------------------------------------------------------------------
// Boot — Cold Start Accelerator
// ---------------------------------------------------------------------------
export { boot } from './boot/preload.js';
export type {
  SentinelModuleName,
  ModuleGroup,
  BootOptions,
  BootTiming,
  BootReport,
  SentinelSnapshot,
  SentinelInstance,
} from './boot/preload.js';

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

import type { SentinelConfig } from './kernel/types.js';
import { Kernel } from './kernel/kernel.js';
import { PolicyEngine } from './safe/policy.js';
import { ApprovalGateway } from './safe/approval.js';
import { BlastRadiusAnalyzer } from './safe/blast-radius.js';
import { PolicyDSL } from './safe/dsl.js';
import { IdentityManager } from './id/identity.js';
import { ShadowExecutor } from './exec/shadow.js';
import { TransactionCoordinator } from './exec/transaction.js';
import { PipelineEngine } from './exec/pipeline.js';
import { TemporalBranchEngine } from './exec/temporal.js';
import { TraceStore } from './trace/store.js';
import { MerkleChain } from './trace/merkle.js';
import { StateManager } from './info/state.js';
import { DriftDetector } from './info/drift.js';
import type { DriftStateProvider } from './info/drift.js';
import { MagicRecovery } from './magic/recovery.js';
import { SpecManager } from './spec/version.js';
import { ApiLayer } from './api/transport.js';
import { NistComplianceProfile } from './compliance/nist.js';
import { A2ASafetyBridge } from './bridge/a2a.js';
import type { A2ABridgeOptions } from './bridge/a2a.js';

const DEFAULT_CONFIG: SentinelConfig = {
  defaultRiskThreshold: 'high',
  requireShadowFirst: true,
  requireApprovalAbove: 'high',
  traceEnabled: true,
  maxShadowDurationMs: 30000,
  adapters: {},
};

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Options for the createSentinel() convenience factory.
 */
export interface CreateSentinelOptions {
  /**
   * Options forwarded to A2ASafetyBridge. Supply `verifyIdentity` to enforce
   * cryptographic authentication of delegating agents — strongly recommended
   * in any environment where A2A messages may arrive over an untrusted transport.
   * Without a verifier, bridge trust decisions rely solely on registry id
   * matching, which is safe only on a fully trusted internal transport.
   */
  bridgeOptions?: A2ABridgeOptions;

  /**
   * Provider for the DriftDetector. When supplied, `drift.check(surfaceId)`
   * can be called immediately after factory construction to detect divergence
   * between expected and actual surface state. When omitted, `drift.setProvider()`
   * must be called manually before `drift.check()` is used.
   */
  driftProvider?: DriftStateProvider;
}

export function createSentinel(config?: Partial<SentinelConfig>, options?: CreateSentinelOptions) {
  const mergedConfig: SentinelConfig = { ...DEFAULT_CONFIG, ...config };

  const kernel = new Kernel(mergedConfig);
  const policy = new PolicyEngine(mergedConfig);
  const approval = new ApprovalGateway();
  const blastRadius = new BlastRadiusAnalyzer();
  const dsl = new PolicyDSL();
  const identity = new IdentityManager();
  const executor = new ShadowExecutor(mergedConfig);
  const transactions = new TransactionCoordinator();
  const pipelines = new PipelineEngine();
  const temporal = new TemporalBranchEngine();
  const trace = new TraceStore();
  const merkle = new MerkleChain();
  const state = new StateManager();
  const drift = new DriftDetector();
  const magic = new MagicRecovery();
  const spec = new SpecManager();
  const api = new ApiLayer();
  const nist = new NistComplianceProfile();

  // Wire kernel modules
  kernel.setSafeModule(policy);
  kernel.setExecModule(executor as any);  // ShadowExecutor has broader rollback sig
  kernel.setTraceModule(trace);
  kernel.setInfoModule(state);
  kernel.setIdModule(identity);
  kernel.setApprovalModule(approval as any);
  kernel.setBlastModule(blastRadius as any);

  // Route the multi-step execution engines through the kernel so every
  // committed action passes the full safety lifecycle (no bypass paths).
  temporal.setExecModule(executor as any);  // shadow scoring during evaluation
  temporal.setKernel(kernel);               // safe commit of the winning timeline
  pipelines.setKernel(kernel);              // each step is a full kernel transaction

  // Wire the ApprovalGateway into PipelineEngine so that `approval` pipeline
  // steps trigger real human-in-the-loop approval rather than passing through
  // silently. High-risk pipeline operations will block until resolved.
  pipelines.setApprovalGateway(approval as any);

  // A2A Safety Bridge mediates cross-agent delegations through the kernel.
  // Pass verifyIdentity so the bridge enforces cryptographic authentication
  // of the source actor — preventing impersonation attacks on A2A delegations.
  const bridge = new A2ASafetyBridge(kernel, options?.bridgeOptions ?? {});

  // Wire DriftDetector if a provider was supplied so drift.check() works
  // immediately without requiring manual setProvider() after construction.
  if (options?.driftProvider) {
    drift.setProvider(options.driftProvider);
  }

  return {
    kernel,
    policy,
    approval,
    blastRadius,
    dsl,
    identity,
    executor,
    transactions,
    pipelines,
    temporal,
    trace,
    merkle,
    chain: merkle,  // alias for convenience
    state,
    drift,
    magic,
    spec,
    api,
    nist,
    bridge,
    config: mergedConfig,
  };
}
