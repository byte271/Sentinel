// ---------------------------------------------------------------------------
// SENTINEL Shield Watchdog (v0.3.0, S1)
// ---------------------------------------------------------------------------
// The Summer Yue incident proved that a kill switch living inside the agent's
// own process is useless. The Shield runs out-of-band, but we still need a
// guarantee that if the *Shield* stops servicing the control loop — hangs,
// crashes, or is killed — every agent token is revoked and a forensic record
// is preserved. The watchdog is that guarantee.
//
// It is a dead-man's switch: the control loop must "feed" it within the
// configured window. If a feed does not arrive in time, the watchdog fires its
// `onExpire` callback (revoke tokens + snapshot). A hardware-backed timer is
// the production extension point; this is a faithful software implementation
// with the same semantics, fully testable with short windows.
// ---------------------------------------------------------------------------

export type WatchdogState = 'stopped' | 'armed' | 'expired';

export interface WatchdogOptions {
  /** Window in ms within which a feed must arrive. Default: 5000. */
  windowMs?: number;
  /** Fired exactly once when the window elapses without a feed. */
  onExpire: (info: { lastFedAt: number; expiredAt: number; windowMs: number }) => void;
  /** Injectable timer (for testing); defaults to global setTimeout/clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Injectable clock (for testing). */
  now?: () => number;
}

export class Watchdog {
  readonly windowMs: number;
  private state: WatchdogState = 'stopped';
  private handle: ReturnType<typeof setTimeout> | null = null;
  private lastFedAt = 0;
  private readonly onExpire: WatchdogOptions['onExpire'];
  private readonly setTimer: NonNullable<WatchdogOptions['setTimer']>;
  private readonly clearTimer: NonNullable<WatchdogOptions['clearTimer']>;
  private readonly now: NonNullable<WatchdogOptions['now']>;

  constructor(options: WatchdogOptions) {
    this.windowMs = options.windowMs ?? 5000;
    this.onExpire = options.onExpire;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h));
    this.now = options.now ?? (() => Date.now());
  }

  getState(): WatchdogState {
    return this.state;
  }

  /** Arm the watchdog and begin the countdown. */
  start(): void {
    if (this.state === 'armed') return;
    this.state = 'armed';
    this.feed();
  }

  /** Reset the countdown. Must be called within `windowMs` to avoid firing. */
  feed(): void {
    if (this.state !== 'armed') return;
    this.lastFedAt = this.now();
    if (this.handle !== null) this.clearTimer(this.handle);
    const unref = (h: ReturnType<typeof setTimeout>) => {
      // Don't keep the event loop alive solely for the watchdog.
      (h as unknown as { unref?: () => void }).unref?.();
      return h;
    };
    this.handle = unref(this.setTimer(() => this.fire(), this.windowMs));
  }

  /** Stop the watchdog cleanly (e.g., orderly shutdown). */
  stop(): void {
    if (this.handle !== null) this.clearTimer(this.handle);
    this.handle = null;
    this.state = 'stopped';
  }

  private fire(): void {
    if (this.state !== 'armed') return;
    this.state = 'expired';
    this.handle = null;
    this.onExpire({ lastFedAt: this.lastFedAt, expiredAt: this.now(), windowMs: this.windowMs });
  }

  /** @internal Force the expiry path immediately (for deterministic tests). */
  _forceExpire(): void {
    if (this.handle !== null) this.clearTimer(this.handle);
    this.handle = null;
    this.fire();
  }
}
