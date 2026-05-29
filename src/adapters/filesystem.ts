// ---------------------------------------------------------------------------
// SENTINEL Filesystem Adapter — Reference ActionAdapter Implementation
// ---------------------------------------------------------------------------
// Bridges SENTINEL to real filesystem operations. Supports shadow (dry-run) and
// real execution with rollback via in-memory backups.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, sep } from 'path';
import { createHash } from 'crypto';
import { v4 as uuid } from 'uuid';
import type { Evidence, RollbackAction, DiffEntry, Surface, SurfaceCapability } from '../kernel/types.js';
import type { ActionAdapter } from '../exec/shadow.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileInfo {
  size: number;
  mtime: string;
}

// ---------------------------------------------------------------------------
// FilesystemAdapter
// ---------------------------------------------------------------------------

export class FilesystemAdapter implements ActionAdapter {
  id: string;
  surfaceId: string;
  basePath: string;

  /** In-memory backups for rollback support. Key = `${surfaceId}:${absolutePath}`, value = file content (or null). */
  private backups: Map<string, string | null> = new Map();

  private backupKey(filePath: string): string {
    return `${this.surfaceId}:${filePath}`;
  }

  constructor(surfaceId: string, basePath: string) {
    this.id = uuid();
    this.surfaceId = surfaceId;
    this.basePath = basePath;
  }

  // -----------------------------------------------------------------------
  // getState — shallow recursive directory listing
  // -----------------------------------------------------------------------

  async getState(): Promise<Record<string, unknown>> {
    const state: Record<string, FileInfo> = {};
    this.walkDir(this.basePath, state);
    return state;
  }

  private walkDir(dir: string, state: Record<string, FileInfo>): void {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const normalizedBase = this.basePath.endsWith('/') ? this.basePath : this.basePath + '/';
      const relativePath = fullPath.slice(normalizedBase.length);

      if (entry.isFile()) {
        const stat = statSync(fullPath);
        state[relativePath] = {
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        };
      } else if (entry.isDirectory()) {
        this.walkDir(fullPath, state);
      }
    }
  }

  // -----------------------------------------------------------------------
  // executeShadow — simulate without side effects
  // -----------------------------------------------------------------------

  async executeShadow(
    action: string,
    params: Record<string, unknown>,
  ): Promise<{ result: Record<string, unknown>; sideEffects: string[] }> {
    const sideEffects: string[] = [];

    switch (action) {
      case 'read_file': {
        const filePath = this.resolvePath(params.path as string);
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${params.path}`);
        }
        const content = readFileSync(filePath, 'utf-8');
        return {
          result: { content, size: Buffer.byteLength(content, 'utf-8') },
          sideEffects,
        };
      }

      case 'list_dir': {
        const dirPath = this.resolvePath((params.path as string) ?? '.');
        if (!existsSync(dirPath)) {
          throw new Error(`Directory not found: ${params.path}`);
        }
        const entries = readdirSync(dirPath, { withFileTypes: true }).map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
        }));
        return { result: { entries }, sideEffects };
      }

      case 'write_file': {
        const filePath = this.resolvePath(params.path as string);
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
          sideEffects.push(`create_directory:${dir}`);
        }
        const existed = existsSync(filePath);
        sideEffects.push(existed ? `overwrite:${params.path}` : `create:${params.path}`);
        const content = params.content as string;
        return {
          result: {
            path: params.path,
            size: Buffer.byteLength(content, 'utf-8'),
            hash: createHash('sha256').update(content).digest('hex'),
            existed,
          },
          sideEffects,
        };
      }

      case 'delete_file': {
        const filePath = this.resolvePath(params.path as string);
        if (!existsSync(filePath)) {
          throw new Error(`File not found for deletion: ${params.path}`);
        }
        sideEffects.push(`delete:${params.path}`);
        return {
          result: { path: params.path, deleted: true },
          sideEffects,
        };
      }

      case 'create_dir': {
        const dirPath = this.resolvePath(params.path as string);
        const existed = existsSync(dirPath);
        if (!existed) {
          sideEffects.push(`create_directory:${params.path}`);
        }
        return {
          result: { path: params.path, created: !existed, existed },
          sideEffects,
        };
      }

      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }

  // -----------------------------------------------------------------------
  // executeReal — perform the actual operation
  // -----------------------------------------------------------------------

  async executeReal(
    action: string,
    params: Record<string, unknown>,
  ): Promise<{ result: Record<string, unknown>; evidence: Evidence[] }> {
    const evidence: Evidence[] = [];

    switch (action) {
      case 'read_file': {
        const filePath = this.resolvePath(params.path as string);
        const content = readFileSync(filePath, 'utf-8');
        evidence.push(this.createEvidence('snapshot', {
          action: 'read_file',
          path: params.path,
          hash: createHash('sha256').update(content).digest('hex'),
          size: Buffer.byteLength(content, 'utf-8'),
        }));
        return { result: { content, size: Buffer.byteLength(content, 'utf-8') }, evidence };
      }

      case 'list_dir': {
        const dirPath = this.resolvePath((params.path as string) ?? '.');
        const entries = readdirSync(dirPath, { withFileTypes: true }).map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
        }));
        evidence.push(this.createEvidence('snapshot', {
          action: 'list_dir',
          path: params.path ?? '.',
          entryCount: entries.length,
        }));
        return { result: { entries }, evidence };
      }

      case 'write_file': {
        const filePath = this.resolvePath(params.path as string);
        const content = params.content as string;

        // Backup before write
        if (existsSync(filePath)) {
          this.backups.set(this.backupKey(filePath), readFileSync(filePath, 'utf-8'));
        } else {
          this.backups.set(this.backupKey(filePath), null);
        }

        // Ensure parent directory exists
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        writeFileSync(filePath, content, 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex');

        evidence.push(this.createEvidence('state_change', {
          action: 'write_file',
          path: params.path,
          hash,
          size: Buffer.byteLength(content, 'utf-8'),
        }));
        evidence.push(this.createEvidence('hash', { hash, path: params.path }));

        return { result: { path: params.path, hash, size: Buffer.byteLength(content, 'utf-8') }, evidence };
      }

      case 'delete_file': {
        const filePath = this.resolvePath(params.path as string);

        // Backup before delete
        if (existsSync(filePath)) {
          this.backups.set(this.backupKey(filePath), readFileSync(filePath, 'utf-8'));
        }

        unlinkSync(filePath);

        evidence.push(this.createEvidence('state_change', {
          action: 'delete_file',
          path: params.path,
          deleted: true,
        }));

        return { result: { path: params.path, deleted: true }, evidence };
      }

      case 'create_dir': {
        const dirPath = this.resolvePath(params.path as string);
        const existed = existsSync(dirPath);
        if (!existed) {
          mkdirSync(dirPath, { recursive: true });
        }

        evidence.push(this.createEvidence('state_change', {
          action: 'create_dir',
          path: params.path,
          created: !existed,
        }));

        return { result: { path: params.path, created: !existed, existed }, evidence };
      }

      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }

  // -----------------------------------------------------------------------
  // rollback — restore from backups
  // -----------------------------------------------------------------------

  async rollback(
    actions: RollbackAction[],
  ): Promise<{ success: boolean; evidence: Evidence[] }> {
    const evidence: Evidence[] = [];
    let allSucceeded = true;

    for (const action of actions) {
      try {
        const filePath = this.resolvePath(action.params.path as string);

        switch (action.action) {
          case 'restore_file': {
            const backup = this.backups.get(this.backupKey(filePath));
            if (backup === null) {
              // File didn't exist before — delete it
              if (existsSync(filePath)) {
                unlinkSync(filePath);
              }
              evidence.push(this.createEvidence('state_change', {
                rollback: 'deleted_created_file',
                path: action.params.path,
              }));
            } else if (backup !== undefined) {
              // Restore original content
              writeFileSync(filePath, backup, 'utf-8');
              evidence.push(this.createEvidence('state_change', {
                rollback: 'restored_content',
                path: action.params.path,
                hash: createHash('sha256').update(backup).digest('hex'),
              }));
            }
            break;
          }

          case 'delete_created_file': {
            if (existsSync(filePath)) {
              unlinkSync(filePath);
            }
            evidence.push(this.createEvidence('state_change', {
              rollback: 'deleted_created_file',
              path: action.params.path,
            }));
            break;
          }

          default: {
            evidence.push(this.createEvidence('log', {
              warning: `Unknown rollback action: ${action.action}`,
            }));
            allSucceeded = false;
          }
        }
      } catch (err) {
        allSucceeded = false;
        evidence.push(this.createEvidence('log', {
          error: err instanceof Error ? err.message : String(err),
          action: action.action,
        }));
      }
    }

    // Clear backups after rollback
    this.backups.clear();

    return { success: allSucceeded, evidence };
  }

  // -----------------------------------------------------------------------
  // computeDiff — compare two state records
  // -----------------------------------------------------------------------

  computeDiff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): DiffEntry[] {
    const entries: DiffEntry[] = [];
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of allKeys) {
      const oldVal = before[key];
      const newVal = after[key];

      if (oldVal === undefined && newVal !== undefined) {
        entries.push({ path: key, op: 'add', newValue: newVal });
      } else if (oldVal !== undefined && newVal === undefined) {
        entries.push({ path: key, op: 'remove', oldValue: oldVal });
      } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        entries.push({ path: key, op: 'replace', oldValue: oldVal, newValue: newVal });
      }
    }

    return entries;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private resolvePath(relativePath: string): string {
    // Resolve both basePath and the target to absolute paths first,
    // then verify the result stays within the base directory.
    // This prevents bypass via relative basePath, case tricks on Windows,
    // and prefix-matching attacks (e.g. /data vs /data-evil).
    const normalizedBase = resolve(this.basePath);
    const resolved = resolve(normalizedBase, relativePath);
    if (!resolved.startsWith(normalizedBase + sep) && resolved !== normalizedBase) {
      throw new Error(`Path traversal detected: ${relativePath}`);
    }
    return resolved;
  }

  private createEvidence(type: Evidence['type'], data: unknown): Evidence {
    return {
      type,
      data,
      timestamp: Date.now(),
      confidence: 1.0,
      source: `filesystem:${this.surfaceId}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Surface factory helper
// ---------------------------------------------------------------------------

export function createFilesystemSurface(id: string, name: string, basePath: string): Surface {
  const capabilities: SurfaceCapability[] = [
    {
      action: 'read_file',
      description: 'Read the contents of a file',
      params: [
        { name: 'path', type: 'string', required: true, description: 'Relative file path' },
      ],
      riskLevel: 'none',
      reversible: true,
      requiresApproval: false,
    },
    {
      action: 'write_file',
      description: 'Write content to a file (creates or overwrites)',
      params: [
        { name: 'path', type: 'string', required: true, description: 'Relative file path' },
        { name: 'content', type: 'string', required: true, description: 'File content to write' },
      ],
      riskLevel: 'medium',
      reversible: true,
      requiresApproval: false,
    },
    {
      action: 'delete_file',
      description: 'Delete a file',
      params: [
        { name: 'path', type: 'string', required: true, description: 'Relative file path' },
      ],
      riskLevel: 'high',
      reversible: true,
      requiresApproval: true,
    },
    {
      action: 'list_dir',
      description: 'List directory contents',
      params: [
        { name: 'path', type: 'string', required: false, description: 'Relative directory path (defaults to root)' },
      ],
      riskLevel: 'none',
      reversible: true,
      requiresApproval: false,
    },
    {
      action: 'create_dir',
      description: 'Create a directory (recursive)',
      params: [
        { name: 'path', type: 'string', required: true, description: 'Relative directory path' },
      ],
      riskLevel: 'low',
      reversible: true,
      requiresApproval: false,
    },
  ];

  return {
    id,
    name,
    type: 'filesystem',
    version: '1.0.0',
    capabilities,
    manifest: {
      surfaceId: id,
      version: '1.0.0',
      capabilities,
      metadata: { basePath },
    },
  };
}
