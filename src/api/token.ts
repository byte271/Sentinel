// ---------------------------------------------------------------------------
// SENTINEL API Token Manager (B4)
// ---------------------------------------------------------------------------
// The HTTP server historically shipped without authentication (audit finding,
// P3). v0.2.0 closes that gap: every endpoint requires an `X-Sentinel-Token`
// header. This module owns the lifecycle of that token:
//
//   - auto-generated on first run (cryptographically random, 256-bit)
//   - persisted to a single JSON file with owner-only (0600) permissions
//   - rotatable via `sentinel rotate-token` (invalidates the previous token)
//   - verified in constant time to avoid leaking the token via timing
//
// It is dependency-free (Node `crypto`/`fs` only) so it works in any runtime
// without pulling in a secrets manager.
// ---------------------------------------------------------------------------

import { randomBytes, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

interface TokenFile {
  token: string;
  createdAt: number;
  rotatedAt?: number;
}

/** Default on-disk location for the persisted API token. */
export function defaultTokenPath(): string {
  return join(process.env.SENTINEL_HOME ?? join(homedir(), '.sentinel'), 'token.json');
}

export class TokenManager {
  private readonly path: string;
  private cached: TokenFile | null = null;

  constructor(path: string = defaultTokenPath()) {
    this.path = path;
  }

  /**
   * Return the current token, generating and persisting a fresh one on first
   * use. Idempotent: repeated calls return the same token until it is rotated.
   */
  getToken(): string {
    if (this.cached) return this.cached.token;
    if (existsSync(this.path)) {
      try {
        const parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as TokenFile;
        if (parsed && typeof parsed.token === 'string' && parsed.token.length > 0) {
          this.cached = parsed;
          return parsed.token;
        }
      } catch {
        // Corrupt file — fall through and regenerate.
      }
    }
    return this.generate();
  }

  /** Rotate the token, invalidating the previous value. Returns the new token. */
  rotate(): string {
    const previous = existsSync(this.path);
    const next: TokenFile = {
      token: TokenManager.newToken(),
      createdAt: this.cached?.createdAt ?? Date.now(),
      rotatedAt: previous ? Date.now() : undefined,
    };
    this.write(next);
    return next.token;
  }

  /** Constant-time verification of a presented token against the current one. */
  verify(presented: string | undefined | null): boolean {
    if (!presented) return false;
    const current = this.getToken();
    const a = Buffer.from(presented);
    const b = Buffer.from(current);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** Absolute path of the token file (for display to the operator). */
  location(): string {
    return this.path;
  }

  // ---- internals ----------------------------------------------------------

  private generate(): string {
    const file: TokenFile = { token: TokenManager.newToken(), createdAt: Date.now() };
    this.write(file);
    return file.token;
  }

  private write(file: TokenFile): void {
    mkdirSync(dirname(this.path), { recursive: true });
    // mode 0600: readable/writable only by the owner.
    writeFileSync(this.path, JSON.stringify(file, null, 2), { mode: 0o600 });
    this.cached = file;
  }

  private static newToken(): string {
    return randomBytes(32).toString('hex');
  }
}
