import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readFileWithOriginal, safeResolve } from './files.js';

describe('readFileWithOriginal access', () => {
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'av-files-')));
  const cwd = path.join(tmp, 'proj');
  const sshDir = path.join(tmp, '.ssh');
  mkdirSync(cwd);
  mkdirSync(sshDir);
  writeFileSync(path.join(cwd, 'a.txt'), 'hello');
  writeFileSync(path.join(sshDir, 'id_rsa'), 'key');
  symlinkSync(path.join(sshDir, 'id_rsa'), path.join(cwd, 'link.txt'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('reads a file in the cwd, absolute or relative', async () => {
    expect((await readFileWithOriginal(cwd, 'a.txt')).content).toBe('hello');
    expect((await readFileWithOriginal(cwd, path.join(cwd, 'a.txt'))).content).toBe('hello');
  });

  it('flags images and binary files without reading them as text', async () => {
    writeFileSync(path.join(cwd, 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]));
    writeFileSync(path.join(cwd, 'a.bin'), Buffer.from([1, 2, 0, 3]));
    expect(await readFileWithOriginal(cwd, 'a.png')).toMatchObject({ image: true, content: '' });
    expect(await readFileWithOriginal(cwd, 'a.bin')).toMatchObject({ binary: true, content: '' });
  });

  it('reads absolute paths outside the cwd', async () => {
    expect((await readFileWithOriginal(cwd, '/etc/hosts')).content).not.toBe('');
  });

  it('refuses a symlink that resolves into a denied folder', async () => {
    await expect(readFileWithOriginal(cwd, 'link.txt')).rejects.toThrow('path is not viewable');
  });

  it('refuses denied folders even inside the cwd', async () => {
    mkdirSync(path.join(cwd, '.ssh'));
    writeFileSync(path.join(cwd, '.ssh', 'id_rsa'), 'key');
    await expect(readFileWithOriginal(cwd, '.ssh/id_rsa')).rejects.toThrow('path is not viewable');
  });
});

describe('safeResolve', () => {
  it('resolves a relative path inside the project', () => {
    expect(safeResolve('/repo', 'src/a.ts')).toBe('/repo/src/a.ts');
    expect(safeResolve('/repo', '')).toBe('/repo');
    expect(safeResolve('/repo', 'src/../README.md')).toBe('/repo/README.md');
  });

  it('refuses paths that leave the project', () => {
    expect(() => safeResolve('/repo', '../x')).toThrow('path outside project');
    expect(() => safeResolve('/repo', '/etc/passwd')).toThrow('path outside project');
    expect(() => safeResolve('/repo', 'a/../../x')).toThrow('path outside project');
    expect(() => safeResolve('/repo', '/repo2/x')).toThrow('path outside project');
  });
});
