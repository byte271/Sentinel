// ---------------------------------------------------------------------------
// SENTINEL OpenClaw Security Bridge (Feature 7)
// ---------------------------------------------------------------------------
// OpenClaw-style agents keep their long-term memory in a plaintext file (e.g.
// `MEMORY.md`) that can be silently rewritten — by a buggy agent, a
// prompt-injected one, or an attacker with file access. This bridge wraps such
// a file with the Memory Integrity Layer to provide:
//
//   - Sealing: snapshot the file's content hash into a signed, append-only
//     ledger entry with provenance.
//   - Tamper detection: verify the on-disk file still matches the last sealed
//     hash; out-of-band edits are detected.
//   - Authenticated writes: write-through that updates the file and seals the
//     new content atomically, so every change is attributable and auditable.
//   - Verifiable audit export of the whole memory history.
//
// It is a reference bridge: it secures any MEMORY.md-style file on disk and is
// framework-agnostic. Dependency-free beyond Node's `fs`/`crypto`.
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { MemoryLedger } from '../memory/ledger.js';
import type { MemoryEntry, MemoryProvenance } from '../memory/ledger.js';

export interface IntegrityCheck {
  intact: boolean;
  fileExists: boolean;
  currentHash: string;
  sealedHash?: string;
  reason?: string;
}

export interface OpenClawBridgeOptions {
  /** HMAC secret for signing ledger entries. */
  signingSecret?: string;
  /** Inject an existing ledger (e.g. restored from an audit export). */
  ledger?: MemoryLedger;
  /** The memory key used in the ledger. Default: the file path. */
  memoryKey?: string;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export class OpenClawMemoryGuard {
  private readonly filePath: string;
  private readonly ledger: MemoryLedger;
  private readonly key: string;

  constructor(filePath: string, options: OpenClawBridgeOptions = {}) {
    this.filePath = filePath;
    this.ledger = options.ledger ?? new MemoryLedger({ signingSecret: options.signingSecret });
    this.key = options.memoryKey ?? filePath;
  }

  /** Read the current on-disk content (empty string if the file is absent). */
  private readFile(): string {
    return existsSync(this.filePath) ? readFileSync(this.filePath, 'utf-8') : '';
  }

  /**
   * Seal the current file content: append a signed ledger entry recording its
   * content hash and provenance. Call this after a trusted write to establish
   * the baseline.
   */
  seal(provenance: MemoryProvenance, at?: number): MemoryEntry {
    const content = this.readFile();
    const contentHash = sha256(content);
    return this.ledger.append(this.key, contentHash, { ...provenance, inputHash: contentHash }, at);
  }

  /** Verify the on-disk file still matches the last sealed content hash. */
  check(): IntegrityCheck {
    const fileExists = existsSync(this.filePath);
    const currentHash = sha256(this.readFile());
    const sealed = this.ledger.get(this.key);

    if (!sealed) {
      return { intact: false, fileExists, currentHash, reason: 'no sealed baseline; call seal() first' };
    }
    if (sealed.value !== currentHash) {
      return { intact: false, fileExists, currentHash, sealedHash: sealed.value, reason: 'file modified out of band since last seal' };
    }
    // Also confirm the ledger itself hasn't been tampered with.
    const ledgerOk = this.ledger.verify().valid;
    if (!ledgerOk) {
      return { intact: false, fileExists, currentHash, sealedHash: sealed.value, reason: 'memory ledger integrity broken' };
    }
    return { intact: true, fileExists, currentHash, sealedHash: sealed.value };
  }

  /**
   * Authenticated write-through: write new content to the file and seal it in
   * one step, so the change is attributable and the baseline stays current.
   */
  write(content: string, provenance: MemoryProvenance, at?: number): MemoryEntry {
    writeFileSync(this.filePath, content, { mode: 0o600 });
    return this.seal(provenance, at);
  }

  /** Full sealed history for this memory file. */
  history(): MemoryEntry[] {
    return this.ledger.history(this.key);
  }

  /** Verifiable audit export of the memory ledger. */
  exportAudit(): ReturnType<MemoryLedger['export']> {
    return this.ledger.export();
  }
}
