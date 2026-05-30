// ---------------------------------------------------------------------------
// Sentinel Shield — out-of-band agent-safety sidecar (v0.3.0, S1)
// ---------------------------------------------------------------------------
export { ShieldCore } from './core.js';
export type { ShieldCoreOptions, ShieldStats } from './core.js';
export { ShieldServer } from './server.js';
export type { ShieldServerOptions } from './server.js';
export { ShieldClient } from './client.js';
export type { ShieldClientOptions } from './client.js';
export { Watchdog } from './watchdog.js';
export type { WatchdogState, WatchdogOptions } from './watchdog.js';
export { buildDashboardState, createDashboardServer } from './dashboard.js';
export type { DashboardState, DashboardServerOptions } from './dashboard.js';
export {
  SHIELD_PROTOCOL_VERSION,
  encodeMessage,
  LineDecoder,
} from './protocol.js';
export type {
  ShieldToolCall,
  ShieldRequest,
  ShieldResponse,
  HelloRequest,
  ScanRequest,
  BeginRequest,
  CompleteRequest,
  KillRequest,
  StatusRequest,
  PingRequest,
  WelcomeResponse,
  VerdictResponse,
  OkResponse,
  KilledResponse,
  StatusResponse,
  PongResponse,
  ErrorResponse,
  RevokedNotice,
} from './protocol.js';
