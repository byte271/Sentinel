/**
 * SENTINEL-Exec module
 *
 * Re-exports the ShadowExecutor and ActionAdapter interface.
 */
export * from './shadow.js';
export {
  KillSwitch,
  AgentSession,
} from './killswitch.js';
export type {
  KillMode,
  AgentStatus,
  OperationStatus,
  AgentOperation,
  Compensation,
  GracefulStopHandler,
  CompensationRecord,
  ForensicsSnapshot,
  RecoveryPlan,
  KillOptions,
} from './killswitch.js';
