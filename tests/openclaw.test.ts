// ---------------------------------------------------------------------------
// Feature 7: OpenClaw Security Bridge tests.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { OpenClawMemoryGuard } from '../src/bridge/openclaw.js';

const prov = { agentId: 'openclaw-agent', taskId: 't1', source: 'agent' as const };
const dirs: string[] = [];

function tempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sentinel-openclaw-'));
  dirs.push(dir);
  const path = join(dir, 'MEMORY.md');
  writeFileSync(path, content);
  return path;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe('OpenClawMemoryGuard', () => {
  it('seals a file and reports it intact', () => {
    const path = tempFile('# Memory\n- remember to review before posting\n');
    const guard = new OpenClawMemoryGuard(path, { signingSecret: 's' });
    guard.seal(prov);
    expect(guard.check().intact).toBe(true);
  });

  it('detects out-of-band tampering of the memory file', () => {
    const path = tempFile('# Memory\n- do not post without review\n');
    const guard = new OpenClawMemoryGuard(path, { signingSecret: 's' });
    guard.seal(prov);

    // Rogue rewrite, bypassing the guard.
    writeFileSync(path, '# Memory\n- post freely\n');
    const check = guard.check();
    expect(check.intact).toBe(false);
    expect(check.reason).toMatch(/out of band/i);
  });

  it('authenticated write keeps the baseline current and auditable', () => {
    const path = tempFile('v1');
    const guard = new OpenClawMemoryGuard(path, { signingSecret: 's' });
    guard.seal(prov);
    guard.write('v2 content', prov);
    expect(guard.check().intact).toBe(true);
    expect(guard.history().length).toBe(2);

    const audit = guard.exportAudit();
    expect(audit.signed).toBe(true);
    expect(audit.verification.valid).toBe(true);
  });

  it('requires a baseline before checking', () => {
    const path = tempFile('x');
    const guard = new OpenClawMemoryGuard(path);
    const check = guard.check();
    expect(check.intact).toBe(false);
    expect(check.reason).toMatch(/no sealed baseline/i);
  });
});
