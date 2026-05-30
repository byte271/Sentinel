// ---------------------------------------------------------------------------
// SENTINEL Shield Client (v0.3.0, S1)
// ---------------------------------------------------------------------------
// A small TypeScript client for the Shield protocol. Any language can speak
// the JSONL protocol directly (see docs/shield.md); this client is the
// reference implementation used by `sentinel connect`, the test-suite, and as
// the basis for the Python SDK's behaviour.
// ---------------------------------------------------------------------------

import net from 'net';
import { randomUUID } from 'crypto';
import { encodeMessage, LineDecoder, SHIELD_PROTOCOL_VERSION } from './protocol.js';
import type {
  ShieldResponse,
  ShieldToolCall,
  WelcomeResponse,
  VerdictResponse,
  KilledResponse,
  StatusResponse,
} from './protocol.js';
import type { KillMode } from '../exec/killswitch.js';

export interface ShieldClientOptions {
  /** TCP port (use with host). */
  port?: number;
  host?: string;
  /** Unix domain socket path (alternative to host/port). */
  socketPath?: string;
  /** Per-request timeout in ms. Default: 5000. */
  timeoutMs?: number;
}

export class ShieldClient {
  private socket: net.Socket | null = null;
  private decoder = new LineDecoder<ShieldResponse>();
  private pending = new Map<string, { resolve: (r: ShieldResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private welcome: WelcomeResponse | null = null;
  private revokedReason: string | null = null;
  private readonly timeoutMs: number;

  constructor(private readonly options: ShieldClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  get token(): string | undefined { return this.welcome?.token; }
  get sessionId(): string | undefined { return this.welcome?.sessionId; }
  get revoked(): string | null { return this.revokedReason; }

  /** Connect and complete the hello handshake. */
  async connect(agent: string): Promise<WelcomeResponse> {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      if (this.options.socketPath) {
        this.socket = net.createConnection(this.options.socketPath, () => resolve());
      } else {
        this.socket = net.createConnection({ port: this.options.port!, host: this.options.host ?? '127.0.0.1' }, () => resolve());
      }
      this.socket.setEncoding('utf-8');
      this.socket.once('error', onError);
    });

    this.socket!.on('data', (chunk: string) => this.onData(chunk));
    this.socket!.on('error', () => this.failAll(new Error('socket error')));
    this.socket!.on('close', () => this.failAll(new Error('connection closed')));

    const welcome = await this.request<WelcomeResponse>('welcome', {
      type: 'hello', protocol: SHIELD_PROTOCOL_VERSION, agent,
    }, /* correlate */ false);
    this.welcome = welcome;
    return welcome;
  }

  /** Scan a tool call; returns the verdict. */
  async scan(call: ShieldToolCall): Promise<VerdictResponse> {
    const id = randomUUID();
    return this.request<VerdictResponse>('verdict', { type: 'scan', id, call });
  }

  async begin(description: string): Promise<string> {
    const id = randomUUID();
    const res = await this.request<{ type: 'ok'; id: string; opId?: string }>('ok', { type: 'begin', id, description });
    return res.opId!;
  }

  async complete(opId: string): Promise<void> {
    const id = randomUUID();
    await this.request('ok', { type: 'complete', id, opId });
  }

  async kill(options: { agent?: string; mode?: KillMode; reason?: string } = {}): Promise<KilledResponse> {
    const id = randomUUID();
    return this.request<KilledResponse>('killed', { type: 'kill', id, ...options });
  }

  async status(): Promise<StatusResponse> {
    const id = randomUUID();
    return this.request<StatusResponse>('status', { type: 'status', id });
  }

  async ping(): Promise<void> {
    const id = randomUUID();
    await this.request('pong', { type: 'ping', id });
  }

  close(): void {
    this.socket?.end();
    this.socket?.destroy();
    this.socket = null;
  }

  // ---- internals -----------------------------------------------------------

  private onData(chunk: string): void {
    let messages: ShieldResponse[];
    try {
      messages = this.decoder.push(chunk);
    } catch {
      return;
    }
    for (const msg of messages) {
      if (msg.type === 'revoked') {
        this.revokedReason = msg.reason;
        continue;
      }
      // Correlate by id when present; otherwise resolve the next waiter of this type.
      const id = 'id' in msg && msg.id ? msg.id : `__type__:${msg.type}`;
      const waiter = this.pending.get(id) ?? this.pending.get(`__type__:${msg.type}`);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.pending.delete(id);
        this.pending.delete(`__type__:${msg.type}`);
        waiter.resolve(msg);
      }
    }
  }

  private request<T extends ShieldResponse>(expectType: T['type'], payload: Parameters<typeof encodeMessage>[0], correlateById = true): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.socket) return reject(new Error('not connected'));
      const key = correlateById && 'id' in payload && payload.id ? payload.id : `__type__:${expectType}`;
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`Shield request timed out after ${this.timeoutMs}ms (${expectType})`));
      }, this.timeoutMs);
      this.pending.set(key, {
        resolve: (r) => {
          if (r.type === 'error') reject(new Error(r.message));
          else resolve(r as T);
        },
        reject,
        timer,
      });
      this.socket.write(encodeMessage(payload));
    });
  }

  private failAll(err: Error): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.pending.clear();
  }
}
