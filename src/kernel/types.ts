// ============================================================================
// SENTINEL Core Types — AI-Operable Software Protocol
// ============================================================================
// Foundational type definitions for shadow-first execution. Every module in
// the system depends on these types. The overall flow is:
//
//   Intent -> Plan -> Shadow Execute -> Diff Review -> Commit (or Rollback)
//
// Like git diffs for real-world operations.
// ============================================================================

// ----------------------------------------------------------------------------
// Enums & Literal Unions
// ----------------------------------------------------------------------------

/** How much we trust an actor. Determines what they can do without approval. */
export type TrustLevel =
  | 'full'
  | 'elevated'
  | 'standard'
  | 'restricted'
  | 'untrusted';

/** The kind of external system a Surface represents. */
export type SurfaceType =
  | 'web'
  | 'api'
  | 'cli'
  | 'database'
  | 'filesystem'
  | 'service'
  | 'custom';

/** Categorical risk associated with an action or capability. */
export type RiskLevel =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

/** How the engine should run a given intent. */
export type ExecutionMode =
  | 'shadow'
  | 'commit'
  | 'dry-run'
  | 'replay';

// ----------------------------------------------------------------------------
// Identity
// ----------------------------------------------------------------------------

/** The entity initiating an action — human, AI agent, service, or delegate. */
export interface ActorIdentity {
  id: string;
  type: 'human' | 'agent' | 'service' | 'delegate';
  name: string;
  trust: TrustLevel;
  scopes: string[];
  sessionId?: string;
  delegatedBy?: string;
}

// ----------------------------------------------------------------------------
// Intent
// ----------------------------------------------------------------------------

/** A declaration of what an actor wants to accomplish on a surface. */
export interface ActionIntent {
  id: string;
  surface: string;
  action: string;
  params: Record<string, unknown>;
  initiator: ActorIdentity;
  timestamp: number;
  metadata: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Surface — the operable target system
// ----------------------------------------------------------------------------

/** Schema for a single parameter accepted by a capability. */
export interface ParamSchema {
  name: string;
  type: string;
  required: boolean;
  description: string;
  constraints?: Record<string, unknown>;
}

/** A single operation a surface exposes to the protocol. */
export interface SurfaceCapability {
  action: string;
  description: string;
  params: ParamSchema[];
  riskLevel: RiskLevel;
  reversible: boolean;
  requiresApproval: boolean;
}

/** The full declarative description of a surface and its capabilities. */
export interface SurfaceManifest {
  surfaceId: string;
  version: string;
  capabilities: SurfaceCapability[];
  stateSchema?: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

/** Point-in-time snapshot of a surface's state. */
export interface StateSnapshot {
  surfaceId: string;
  timestamp: number;
  data: Record<string, unknown>;
  hash: string;
  /** Confidence that the snapshot accurately reflects reality (0-1). */
  confidence: number;
}

/** An operable target system registered with the protocol. */
export interface Surface {
  id: string;
  name: string;
  type: SurfaceType;
  version: string;
  capabilities: SurfaceCapability[];
  manifest: SurfaceManifest;
  state?: StateSnapshot;
}

// ----------------------------------------------------------------------------
// Risk
// ----------------------------------------------------------------------------

/** A single factor contributing to the overall risk of an action. */
export interface RiskFactor {
  type: string;
  severity: RiskLevel;
  description: string;
  mitigatable: boolean;
}

/** Full risk analysis for an action or plan. */
export interface RiskAssessment {
  level: RiskLevel;
  factors: RiskFactor[];
  /** Aggregate risk score (0-100). */
  score: number;
  requiresApproval: boolean;
  mitigations: string[];
}

// ----------------------------------------------------------------------------
// State Diffing
// ----------------------------------------------------------------------------

/** A single atomic change within a diff. */
export interface DiffEntry {
  path: string;
  op: 'add' | 'remove' | 'replace' | 'move';
  oldValue?: unknown;
  newValue?: unknown;
}

/** The delta between two state snapshots — the core "diff" concept. */
export interface StateDelta {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changes: DiffEntry[];
}

// ----------------------------------------------------------------------------
// Planning
// ----------------------------------------------------------------------------

/** A single step in an execution plan. */
export interface PlanStep {
  id: string;
  action: string;
  params: Record<string, unknown>;
  expectedResult: Record<string, unknown>;
  rollbackAction?: string;
  dependsOn?: string[];
}

/** Safety / policy gate applied to a plan before execution. */
export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  conditions: string[];
  requiredApprovals: string[];
  maxRiskLevel: RiskLevel;
  forceShadow: boolean;
  forceHumanReview: boolean;
}

/** The full execution plan derived from an intent. */
export interface ActionPlan {
  intentId: string;
  steps: PlanStep[];
  expectedDelta: StateDelta;
  risk: RiskAssessment;
  policy: PolicyDecision;
  createdAt: number;
}

// ----------------------------------------------------------------------------
// Execution — Shadow & Commit
// ----------------------------------------------------------------------------

/** Evidence collected during shadow or real execution. */
export interface Evidence {
  type:
    | 'state_change'
    | 'api_response'
    | 'snapshot'
    | 'log'
    | 'hash'
    | 'token'
    | 'test_result';
  data: unknown;
  timestamp: number;
  confidence: number;
  source: string;
}

/** Outcome of executing a plan in the shadow world. */
export interface ShadowResult {
  intentId: string;
  planId: string;
  status: 'success' | 'failure' | 'partial' | 'blocked';
  predictedDelta: StateDelta;
  actualDelta?: StateDelta;
  evidence: Evidence[];
  confidence: number;
  risk: RiskAssessment;
  timestamp: number;
  durationMs: number;
}

/** A single step required to undo a committed action. */
export interface RollbackAction {
  action: string;
  params: Record<string, unknown>;
  order: number;
}

/** Token that enables undoing a committed action. */
export interface RollbackToken {
  id: string;
  intentId: string;
  actions: RollbackAction[];
  expiresAt?: number;
  valid: boolean;
}

/** Outcome of committing a shadow-validated plan to reality. */
export interface CommitResult {
  intentId: string;
  shadowResultId: string;
  status: 'committed' | 'failed' | 'rolled_back';
  realDelta: StateDelta;
  evidence: Evidence[];
  rollbackToken?: RollbackToken;
  timestamp: number;
}

// ----------------------------------------------------------------------------
// Tracing & Audit
// ----------------------------------------------------------------------------

/** A single timestamped event within a trace. */
export interface TraceEvent {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
  level: 'debug' | 'info' | 'warn' | 'error';
}

/** Full audit record for an intent's lifecycle, from creation to completion. */
export interface TraceRecord {
  id: string;
  intentId: string;
  actor: ActorIdentity;
  surface: string;
  intent: ActionIntent;
  plan?: ActionPlan;
  shadowResult?: ShadowResult;
  commitResult?: CommitResult;
  events: TraceEvent[];
  startedAt: number;
  completedAt?: number;
  status: 'pending' | 'pending_approval' | 'shadow' | 'committed' | 'failed' | 'rolled_back';
}

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

/** Structured error that flows through the protocol. */
export interface SentinelError {
  code: string;
  message: string;
  module: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
}

/** Base error class that all SENTINEL modules should throw for consistent error handling. */
export class SentinelErrorImpl extends Error implements SentinelError {
  code: string;
  module: string;
  recoverable: boolean;
  context?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    module: string,
    options?: { recoverable?: boolean; context?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'SentinelError';
    this.code = code;
    this.module = module;
    this.recoverable = options?.recoverable ?? false;
    this.context = options?.context;
  }
}

/** Type guard: check if a value is an SentinelError (interface or class instance). */
export function isSentinelError(value: unknown): value is SentinelError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    'module' in value &&
    'recoverable' in value
  );
}

/** Extract an error code from any error type, falling back to 'UNKNOWN'. */
export function errorCode(err: unknown): string {
  if (isSentinelError(err)) return err.code;
  if (err instanceof Error) return 'INTERNAL_ERROR';
  return 'UNKNOWN';
}

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

/** Top-level system configuration. */
export interface SentinelConfig {
  defaultRiskThreshold: RiskLevel;
  requireShadowFirst: boolean;
  requireApprovalAbove: RiskLevel;
  traceEnabled: boolean;
  maxShadowDurationMs: number;
  adapters: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Kernel Events
// ----------------------------------------------------------------------------

/** Typed event emitted during the action lifecycle. */
export interface KernelEvent {
  type: string;
  traceId: string;
  intentId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Merkle Trace Chain — Tamper-Evident Audit
// ----------------------------------------------------------------------------

/** A single entry in the cryptographic hash chain. */
export interface MerkleTraceEntry {
  sequenceNumber: number;
  traceId: string;
  contentHash: string;
  previousHash: string;
  merkleRoot: string;
  timestamp: number;
}

/** Result of verifying the chain integrity. */
export interface ChainVerification {
  valid: boolean;
  length: number;
  brokenAt?: number;
  brokenReason?: string;
}

// ----------------------------------------------------------------------------
// Approval Gateway — Human-in-the-Loop
// ----------------------------------------------------------------------------

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'escalated' | 'timed_out';

export interface ApprovalRequest {
  id: string;
  intentId: string;
  traceId: string;
  requester: ActorIdentity;
  approvers: string[];
  reason: string;
  risk: RiskAssessment;
  predictedDelta?: StateDelta;
  status: ApprovalStatus;
  createdAt: number;
  expiresAt: number;
  resolvedBy?: string;
  resolvedAt?: number;
  escalationChain: string[];
  metadata: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Blast Radius — Pre-Execution Impact Analysis
// ----------------------------------------------------------------------------

export interface BlastNode {
  id: string;
  type: 'resource' | 'surface' | 'actor' | 'external';
  name: string;
  impact: 'direct' | 'transitive';
  riskLevel: RiskLevel;
}

export interface BlastEdge {
  from: string;
  to: string;
  relationship: 'modifies' | 'depends_on' | 'triggers' | 'notifies';
}

export interface BlastRadius {
  intentId: string;
  nodes: BlastNode[];
  edges: BlastEdge[];
  directImpact: number;
  transitiveImpact: number;
  maxDepth: number;
  riskAmplification: number;
  summary: string;
}

// ----------------------------------------------------------------------------
// Multi-Surface Transactions — Atomic Cross-Surface Operations
// ----------------------------------------------------------------------------

export type TransactionPhase = 'preparing' | 'prepared' | 'committing' | 'committed' | 'aborting' | 'aborted';

export interface TransactionParticipant {
  surfaceId: string;
  intent: ActionIntent;
  shadowResult?: ShadowResult;
  commitResult?: CommitResult;
  phase: TransactionPhase;
}

export interface MultiSurfaceTransaction {
  id: string;
  participants: TransactionParticipant[];
  coordinator: ActorIdentity;
  phase: TransactionPhase;
  createdAt: number;
  completedAt?: number;
  traceId?: string;
}

// ----------------------------------------------------------------------------
// Drift Detection — Unauthorized State Change Monitoring
// ----------------------------------------------------------------------------

export type DriftSeverity = 'none' | 'minor' | 'significant' | 'critical';
export type DriftRecommendation = 'accept' | 'investigate' | 'rollback' | 'alert';

export interface DriftReport {
  surfaceId: string;
  checkedAt: number;
  expectedHash: string;
  actualHash: string;
  drifted: boolean;
  changes: DiffEntry[];
  severity: DriftSeverity;
  recommendation: DriftRecommendation;
  metadata: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Action Pipelines — Composable Action Chains
// ----------------------------------------------------------------------------

export type PipelineStepType = 'action' | 'condition' | 'parallel' | 'approval';
export type PipelineRollbackStrategy = 'all' | 'completed' | 'none';

export interface PipelineStep {
  id: string;
  type: PipelineStepType;
  surface?: string;
  action?: string;
  params?: Record<string, unknown>;
  /** DSL-style condition expression (e.g. "key == value"). */
  condition?: string;
  onSuccess?: string;
  onFailure?: string;
  children?: string[];
  dependsOn?: string[];
  /** Optional timeout in milliseconds for this step. */
  timeout?: number;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  steps: PipelineStep[];
  entryPoint: string;
  rollbackStrategy: PipelineRollbackStrategy;
  metadata: Record<string, unknown>;
}

export type PipelineExecutionStatus = 'running' | 'completed' | 'failed' | 'rolled_back' | 'paused';

export interface PipelineStepResult {
  stepId: string;
  status: 'success' | 'failure' | 'skipped';
  traceId?: string;
  output?: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

export interface PipelineExecution {
  id: string;
  pipelineId: string;
  status: PipelineExecutionStatus;
  stepResults: PipelineStepResult[];
  startedAt: number;
  completedAt?: number;
  context: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Policy DSL — Declarative Safety Rules
// ----------------------------------------------------------------------------

export type PolicyVerdict = 'allow' | 'warn' | 'require_approval' | 'deny';

export type DSLOperator = 'matches' | 'contains' | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in';
export type DSLLogical = 'and' | 'or' | 'not';

export interface DSLCondition {
  field: string;
  operator: DSLOperator;
  value: string | number | string[];
}

export interface DSLRule {
  id: string;
  verdict: PolicyVerdict;
  conditions: DSLCondition[];
  logic: DSLLogical;
  description: string;
  raw: string;
}

// ----------------------------------------------------------------------------
// Temporal Branching — Parallel Future Exploration
// ----------------------------------------------------------------------------
// Like git branches, but for reality. SENTINEL forks the world into multiple
// parallel timelines, runs different action strategies in each, scores all
// outcomes, and only commits the winning future.
// ----------------------------------------------------------------------------

/** A single timeline — an isolated execution branch exploring one possible future. */
export interface Timeline {
  id: string;
  /** Human-readable label (e.g. "aggressive-cleanup", "conservative-migrate"). */
  name: string;
  /** ID of the parent timeline this was forked from, or null for root. */
  parentId: string | null;
  /** Fork depth (0 = root, 1 = child of root, etc.). */
  depth: number;
  /** The sequence of intents to execute in this timeline. */
  intents: ActionIntent[];
  /** Shadow results from executing each intent. */
  shadowResults: ShadowResult[];
  /** Aggregated predicted state delta across all steps. */
  predictedDelta: StateDelta;
  /** Overall confidence for the timeline (product of step confidences). */
  confidence: number;
  /** Composite score used for ranking (0–100). Higher is better. */
  score: number;
  /** Scoring breakdown by dimension. */
  scoreBreakdown: TimelineScoreDimension[];
  /** Risk assessment aggregated across all steps. */
  risk: RiskAssessment;
  /** Current lifecycle phase. */
  phase: TimelinePhase;
  /** When this timeline was created. */
  createdAt: number;
  /** When evaluation completed (shadow pass done). */
  evaluatedAt?: number;
  /** When this timeline was committed (merged) to reality. */
  committedAt?: number;
  /** Wall-clock cost of evaluating this timeline (ms). */
  evaluationCostMs: number;
  /** Traces produced if this timeline was committed. */
  traces: TraceRecord[];
  /** Arbitrary metadata for strategy parameters, tags, etc. */
  metadata: Record<string, unknown>;
}

export type TimelinePhase =
  | 'created'     // Forked but not yet evaluated
  | 'evaluating'  // Shadow execution in progress
  | 'evaluated'   // Shadow complete, scored, ready for comparison
  | 'selected'    // Chosen as the winner
  | 'committing'  // Real execution in progress
  | 'committed'   // Merged to reality
  | 'pruned';     // Discarded

/** A single dimension contributing to a timeline's composite score. */
export interface TimelineScoreDimension {
  dimension: string;
  score: number;
  weight: number;
  rationale: string;
}

/** Configurable scoring weights for timeline comparison. */
export interface TimelineScoringCriteria {
  /** Weight for confidence (0–1). Default 0.25. */
  confidence: number;
  /** Weight for low risk (0–1). Default 0.20. */
  safety: number;
  /** Weight for fewer side effects (0–1). Default 0.10. */
  minimality: number;
  /** Weight for more changes matching intent (0–1). Default 0.20. */
  completeness: number;
  /** Weight for faster execution (0–1). Default 0.10. */
  speed: number;
  /** Weight for action reversibility (0–1). Default 0.15. */
  reversibility: number;
  /** Custom scoring functions. */
  custom?: Array<{
    name: string;
    weight: number;
    evaluate: (timeline: Timeline) => number;
  }>;
}

/** Result of comparing multiple timelines. */
export interface TimelineComparison {
  /** All timelines ranked by score (best first). */
  ranked: Timeline[];
  /** The winning timeline. */
  winner: Timeline;
  /** Per-dimension comparison matrix. */
  matrix: Record<string, Record<string, number>>;
  /** Human-readable explanation of the ranking. */
  reasoning: string[];
  /** Timestamp of comparison. */
  timestamp: number;
}

/** A fork request — defines a new timeline to explore. */
export interface TimelineForkRequest {
  /** Human-readable name for this branch. */
  name: string;
  /** Intents to execute in this timeline. */
  intents: ActionIntent[];
  /** Optional strategy metadata (e.g. { approach: 'aggressive' }). */
  metadata?: Record<string, unknown>;
}

/** Top-level result of a temporal branch exploration. */
export interface TemporalBranchResult {
  /** All timelines that were explored. */
  timelines: Timeline[];
  /** The comparison/ranking result. */
  comparison: TimelineComparison;
  /** The timeline that was committed (if any). */
  committed?: Timeline;
  /** Total wall-clock time for the exploration. */
  durationMs: number;
  /** Futures that were explored but rejected as dangerous or inferior. */
  preventedFutures: PreventedFuture[];
  /** Non-selection proofs for every non-winning timeline. */
  nonSelectionProofs: NonSelectionProof[];
  /** Counterfactual analysis comparing all "what if" outcomes. */
  counterfactual: CounterfactualAnalysis;
  /** Combined Merkle hash chaining all non-selection proofs for tamper evidence. */
  explorationProofHash: string;
  /** Statistical summary of the exploration. */
  stats: ExplorationStats;
}

/** Statistical summary of a temporal exploration run. */
export interface ExplorationStats {
  /** Total timelines forked. */
  totalTimelines: number;
  /** How many were evaluated. */
  evaluatedCount: number;
  /** How many were prevented (by risk, budget, pruning, etc.). */
  preventedCount: number;
  /** Total intents across all timelines. */
  totalIntents: number;
  /** Total evaluation cost across all timelines (ms). */
  totalCostMs: number;
  /** Average score across all evaluated timelines. */
  avgScore: number;
  /** Score standard deviation. */
  scoreStdDev: number;
  /** Average confidence across all evaluated timelines. */
  avgConfidence: number;
  /** Risk distribution: count per risk level. */
  riskDistribution: Record<RiskLevel, number>;
  /** Budget utilization (0–1). */
  budgetUtilization: number;
}

// ----------------------------------------------------------------------------
// Reality Merge Requests — Treat AI Actions Like PRs Against Reality
// ----------------------------------------------------------------------------

export type MergeRequestStatus =
  | 'open'        // Created, awaiting review
  | 'reviewing'   // Under active review
  | 'approved'    // Approved, ready to merge
  | 'rejected'    // Rejected, will not be merged
  | 'merged'      // Successfully committed to reality
  | 'cancelled';  // Withdrawn by the requester

/** A formal request to merge a timeline's predicted future into reality. */
export interface RealityMergeRequest {
  id: string;
  /** The timeline this merge request is for. */
  timelineId: string;
  timelineName: string;
  /** Who is proposing this merge. */
  author: ActorIdentity;
  /** Status of the merge request. */
  status: MergeRequestStatus;
  /** Human-readable title for the merge request. */
  title: string;
  /** Detailed description of what this future does. */
  description: string;
  /** The predicted delta that will be applied to reality. */
  predictedDelta: StateDelta;
  /** Action diffs — one per intent in the timeline. */
  actionDiffs: RealityActionDiff[];
  /** The timeline's composite score and breakdown. */
  score: number;
  scoreBreakdown: TimelineScoreDimension[];
  /** Risk assessment for this future. */
  risk: RiskAssessment;
  /** Review comments. */
  reviews: MergeReview[];
  /** Required approvals to merge (quorum). Default 1. */
  requiredApprovals: number;
  /** Safety gate status — must pass before merge is allowed. */
  safetyGate: SafetyGateResult;
  /** When this merge request was created. */
  createdAt: number;
  /** When this merge request was last updated. */
  updatedAt: number;
  /** When this MR expires and auto-cancels (0 = never). */
  expiresAt: number;
  /** When this was merged (if status === 'merged'). */
  mergedAt?: number;
  /** Reason if rejected. */
  rejectionReason?: string;
}

/** A review comment on a merge request. */
export interface MergeReview {
  reviewer: string;
  verdict: 'approve' | 'reject' | 'comment';
  comment: string;
  timestamp: number;
}

// ----------------------------------------------------------------------------
// Action Diffs for Reality — Structured Diff Objects per Action
// ----------------------------------------------------------------------------

/** A single real-world action expressed as a reviewable diff. */
export interface RealityActionDiff {
  /** Which intent produced this diff. */
  intentId: string;
  /** Surface this action targets. */
  surfaceId: string;
  /** The action being performed. */
  action: string;
  /** Parameters for the action. */
  params: Record<string, unknown>;
  /** What will change (predicted). */
  changes: DiffEntry[];
  /** Side effects predicted by the shadow pass. */
  sideEffects: string[];
  /** Risk level for this specific action. */
  riskLevel: RiskLevel;
  /** Whether this action is reversible. */
  reversible: boolean;
  /** The rollback action if reversible. */
  rollbackAction?: string;
  /** Content preview for write-type actions (truncated to 200 chars). */
  contentPreview?: string;
  /** Estimated byte size of the content being written. */
  estimatedSize?: number;
}

// ----------------------------------------------------------------------------
// Prevented Futures — Report on Rejected Dangerous Timelines
// ----------------------------------------------------------------------------

export type PreventionReason =
  | 'high_risk'           // Risk level too high
  | 'policy_denied'       // Policy DSL blocked it
  | 'low_confidence'      // Shadow confidence too low
  | 'shadow_failed'       // Shadow execution failed
  | 'budget_exceeded'     // Branch budget exhausted
  | 'early_pruned'        // Pruned early by heuristics
  | 'outscored';          // Lost the comparison

/** A future that was explored but prevented from being committed. */
export interface PreventedFuture {
  /** The timeline that was prevented. */
  timelineId: string;
  timelineName: string;
  /** Why this future was prevented. */
  reason: PreventionReason;
  /** Human-readable explanation. */
  explanation: string;
  /** What would have happened if this future had been committed. */
  wouldHaveDone: RealityActionDiff[];
  /** The risk that was avoided. */
  avoidedRisk: RiskAssessment;
  /** Score this timeline received. */
  score: number;
  /** Timestamp of prevention. */
  timestamp: number;
}

// ----------------------------------------------------------------------------
// Proof of Non-Selection — Evidence for Why Timelines Were Not Committed
// ----------------------------------------------------------------------------

/** Cryptographic + structured proof of why a timeline was not selected. */
export interface NonSelectionProof {
  /** The timeline that was not selected. */
  timelineId: string;
  timelineName: string;
  /** Hash of all shadow results for tamper evidence. */
  shadowResultsHash: string;
  /** The winning timeline it lost to. */
  winnerTimelineId: string;
  winnerTimelineName: string;
  /** Score comparison: this timeline vs the winner. */
  scoreDelta: number;
  /** Per-dimension comparison showing where it fell short. */
  dimensionComparison: Array<{
    dimension: string;
    thisScore: number;
    winnerScore: number;
    delta: number;
  }>;
  /** Human-readable summary of why it lost. */
  reasoning: string;
  /** Timestamp for audit trail. */
  timestamp: number;
}

// ----------------------------------------------------------------------------
// Branch Budgeting — Limits on Fork Count and Depth
// ----------------------------------------------------------------------------

/** Configuration for branch budgets. */
export interface BranchBudget {
  /** Maximum number of timelines that can be forked. */
  maxTimelines: number;
  /** Maximum depth of nested forks (fork from fork). */
  maxDepth: number;
  /** Maximum total intents across all timelines. */
  maxTotalIntents: number;
  /** Maximum wall-clock time for the entire exploration (ms). */
  maxExplorationMs: number;
  /** Minimum score threshold — timelines below this are pruned early. */
  earlyPruneThreshold: number;
  /** Minimum confidence for a step before triggering early prune. */
  minStepConfidence: number;
  /** Maximum risk level before triggering early prune. */
  maxStepRisk: RiskLevel;
}

/** Strategies for early branch pruning. */
export type PruningStrategy = 'score_threshold' | 'confidence_decay' | 'risk_ceiling' | 'diminishing_returns';

// ----------------------------------------------------------------------------
// Pairwise Timeline Diff — Side-by-Side Comparison
// ----------------------------------------------------------------------------

/** Side-by-side comparison of two timelines. */
export interface TimelinePairwiseDiff {
  leftId: string;
  leftName: string;
  rightId: string;
  rightName: string;
  /** Score difference (right - left). */
  scoreDelta: number;
  /** Confidence difference (right - left). */
  confidenceDelta: number;
  /** Per-dimension comparison. */
  dimensions: Array<{
    dimension: string;
    leftScore: number;
    rightScore: number;
    delta: number;
    advantage: 'left' | 'right' | 'tied';
  }>;
  /** Changes unique to left timeline. */
  uniqueToLeft: DiffEntry[];
  /** Changes unique to right timeline. */
  uniqueToRight: DiffEntry[];
  /** Changes present in both timelines. */
  common: DiffEntry[];
  /** Human-readable summary. */
  summary: string[];
}

// ----------------------------------------------------------------------------
// Counterfactual Analysis — "What If" Outcome Comparison
// ----------------------------------------------------------------------------

/** Full counterfactual analysis across all explored timelines. */
export interface CounterfactualAnalysis {
  /** What the winner achieves. */
  selectedOutcome: CounterfactualOutcome;
  /** What each rejected timeline would have achieved. */
  rejectedOutcomes: CounterfactualOutcome[];
  /** Key differences between the selected and best rejected outcome. */
  keyDifferences: string[];
  /** What risks were avoided by not selecting other timelines. */
  avoidsRisks: string[];
  /** What benefits were sacrificed by not selecting other timelines. */
  sacrificedBenefits: string[];
  /** Pairwise diffs between winner and each rejected timeline. */
  pairwiseDiffs: TimelinePairwiseDiff[];
}

/** A single "what if" outcome for a timeline. */
export interface CounterfactualOutcome {
  timelineId: string;
  timelineName: string;
  /** What would change in reality. */
  predictedChanges: DiffEntry[];
  /** Aggregate risk. */
  risk: RiskAssessment;
  /** Confidence that this outcome would succeed. */
  confidence: number;
  /** Net side effects. */
  sideEffectCount: number;
  /** Human-readable summary. */
  summary: string;
}

// ----------------------------------------------------------------------------
// Reality Commit Safety Gate — Pre-Merge Validation
// ----------------------------------------------------------------------------

export type SafetyGateStatus = 'pending' | 'passed' | 'failed' | 'warning';

/** Result of running all pre-merge safety checks. */
export interface SafetyGateResult {
  status: SafetyGateStatus;
  checks: SafetyGateCheck[];
  /** Timestamp of when the gate was evaluated. */
  evaluatedAt: number;
  /** Whether the gate was evaluated with async checks (drift, etc.). */
  asyncChecksRun: boolean;
}

/** A single safety gate check. */
export interface SafetyGateCheck {
  name: string;
  status: SafetyGateStatus;
  description: string;
  /** Details about what was checked. */
  detail?: string;
  /** Whether this check is a custom (user-registered) check. */
  custom?: boolean;
}

/** A custom safety gate check function. */
export interface CustomSafetyGateCheck {
  name: string;
  description: string;
  /** Evaluate the check. Return 'passed', 'warning', or 'failed'. */
  evaluate: (timeline: Timeline) => SafetyGateStatus;
}
