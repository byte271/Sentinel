import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilesystemAdapter, createFilesystemSurface } from '../src/adapters/filesystem.js';

describe('FilesystemAdapter', () => {
  let adapter: FilesystemAdapter;
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `sentinel-test-fs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    adapter = new FilesystemAdapter('test-fs', dir);
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('creates a surface with capabilities', () => {
    const surface = createFilesystemSurface('fs1', 'Test FS', dir);
    expect(surface.id).toBe('fs1');
    expect(surface.capabilities.length).toBe(5);
    expect(surface.capabilities.map(c => c.action)).toContain('write_file');
  });

  it('shadow-executes write without real changes', async () => {
    const result = await adapter.executeShadow('write_file', { path: 'test.txt', content: 'hello' });
    expect(result.result).toBeDefined();
    expect(result.sideEffects.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'test.txt'))).toBe(false);
  });

  it('real-executes write and creates file', async () => {
    const result = await adapter.executeReal('write_file', { path: 'test.txt', content: 'hello' });
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'test.txt'))).toBe(true);
    expect(readFileSync(join(dir, 'test.txt'), 'utf-8')).toBe('hello');
  });

  it('reads a file', async () => {
    await adapter.executeReal('write_file', { path: 'r.txt', content: 'data' });
    const result = await adapter.executeReal('read_file', { path: 'r.txt' });
    expect(result.result.content).toBe('data');
  });

  it('lists directory contents', async () => {
    await adapter.executeReal('write_file', { path: 'a.txt', content: '1' });
    await adapter.executeReal('write_file', { path: 'b.txt', content: '2' });
    const result = await adapter.executeReal('list_dir', { path: '.' });
    expect(result.result.entries.length).toBe(2);
  });

  it('creates directories', async () => {
    const result = await adapter.executeReal('create_dir', { path: 'subdir' });
    expect(result.result.created).toBe(true);
    expect(existsSync(join(dir, 'subdir'))).toBe(true);
  });

  it('deletes files', async () => {
    await adapter.executeReal('write_file', { path: 'del.txt', content: 'bye' });
    expect(existsSync(join(dir, 'del.txt'))).toBe(true);
    await adapter.executeReal('delete_file', { path: 'del.txt' });
    expect(existsSync(join(dir, 'del.txt'))).toBe(false);
  });

  it('gets surface state', async () => {
    await adapter.executeReal('write_file', { path: 'x.txt', content: 'val' });
    const state = await adapter.getState();
    expect(state).toBeDefined();
    expect(Object.keys(state).length).toBeGreaterThan(0);
  });

  it('shadow-executes read correctly', async () => {
    await adapter.executeReal('write_file', { path: 'sr.txt', content: 'shadow-read' });
    const result = await adapter.executeShadow('read_file', { path: 'sr.txt' });
    expect(result.result).toBeDefined();
    expect(result.sideEffects.length).toBe(0);
  });
});
