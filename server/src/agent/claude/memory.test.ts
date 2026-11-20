import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { saveMemory } from '../memory.js';
import { chatMemory, claudeInstructionFiles } from './memory.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'agentview-memory-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('chatMemory', () => {
  it('lists the repo CLAUDE.md, the account CLAUDE.md and memory files with MEMORY.md first', async () => {
    const cwd = path.join(root, 'my_repo');
    const account = path.join(root, 'account');
    const mem = path.join(account, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
    mkdirSync(cwd);
    mkdirSync(mem, { recursive: true });
    writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Repo\n');
    writeFileSync(path.join(mem, 'MEMORY.md'), '- [Git](git.md)\n');
    writeFileSync(path.join(mem, 'git.md'), '---\nname: git-workflow\ndescription: "push after rebase"\n---\n\nAlways rebase.\n');
    const linked = path.join(root, 'linked');
    mkdirSync(linked);
    symlinkSync(path.join(account, 'projects'), path.join(linked, 'projects'));
    const files = await chatMemory(cwd, [account, linked, path.join(root, 'missing')]);
    expect(files.map((f) => [f.name, f.description, f.text])).toEqual([
      ['CLAUDE.md', '', '# Repo'],
      ['MEMORY.md', '', '- [Git](git.md)'],
      ['git-workflow', 'push after rebase', 'Always rebase.'],
    ]);
  });

  describe('saveMemory', () => {
    const cwd = path.join(root, 'save_repo');
    const account = path.join(root, 'save-account');
    const mem = path.join(account, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
    const git = path.join(mem, 'git.md');
    mkdirSync(cwd);
    mkdirSync(mem, { recursive: true });
    writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Repo\n');
    writeFileSync(path.join(account, 'CLAUDE.md'), '# Account\n');
    writeFileSync(path.join(mem, 'MEMORY.md'), '- [Git](git.md)\n');
    writeFileSync(path.join(mem, 'big.md'), 'x'.repeat(20_001));
    writeFileSync(path.join(mem, 'notes.txt'), 'not markdown');
    const outside = path.join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.md'), 'secret');
    symlinkSync(path.join(outside, 'secret.md'), path.join(mem, 'link.md'));
    const list = () => chatMemory(cwd, [account]);
    const reset = () => writeFileSync(git, '---\nname: git-workflow\ndescription: "push after rebase"\n---\n\nAlways rebase.\n');

    it('flags only memory files under the cap as editable', async () => {
      reset();
      const flags = Object.fromEntries((await list()).map((f) => [path.basename(f.path), f.editable]));
      expect(flags).toEqual({ 'CLAUDE.md': false, 'MEMORY.md': true, 'git.md': true, 'big.md': false, 'link.md': false });
    });

    it('keeps the front matter, returns the previous body and undo restores it', async () => {
      reset();
      const { previous } = await saveMemory(await list(), git, 'Always merge.');
      expect(previous).toBe('Always rebase.');
      expect(readFileSync(git, 'utf8')).toBe('---\nname: git-workflow\ndescription: "push after rebase"\n---\n\nAlways merge.\n');
      await saveMemory(await list(), git, previous);
      expect(readFileSync(git, 'utf8')).toBe('---\nname: git-workflow\ndescription: "push after rebase"\n---\n\nAlways rebase.\n');
    });

    it('edits MEMORY.md', async () => {
      await saveMemory(await list(), path.join(mem, 'MEMORY.md'), '- [Git](git.md)\n- [New](new.md)');
      expect(readFileSync(path.join(mem, 'MEMORY.md'), 'utf8')).toBe('- [Git](git.md)\n- [New](new.md)\n');
    });

    it('refuses instruction files, files over the cap, non-md files and paths not in the list', async () => {
      const files = await list();
      for (const p of [path.join(cwd, 'CLAUDE.md'), path.join(account, 'CLAUDE.md'), path.join(mem, 'big.md'), path.join(mem, 'notes.txt'), path.join(mem, 'missing.md')]) {
        await expect(saveMemory(files, p, 'changed')).rejects.toThrow();
      }
      expect(readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('# Repo\n');
      expect(readFileSync(path.join(account, 'CLAUDE.md'), 'utf8')).toBe('# Account\n');
    });

    it('refuses traversal and symlinks out of the memory folder', async () => {
      const files = await list();
      await expect(saveMemory(files, path.join(mem, '..', '..', '..', '..', 'outside', 'secret.md'), 'changed')).rejects.toThrow();
      await expect(saveMemory(files, path.join(mem, 'link.md'), 'changed')).rejects.toThrow();
      expect(readFileSync(path.join(outside, 'secret.md'), 'utf8')).toBe('secret');
    });

    it('refuses a file in a memory folder that is not under a projects folder', async () => {
      const stray = path.join(root, 'stray', 'memory');
      mkdirSync(stray, { recursive: true });
      writeFileSync(path.join(stray, 'a.md'), 'a');
      await expect(saveMemory([{ path: path.join(stray, 'a.md'), name: 'a', description: '', text: 'a', editable: true }], path.join(stray, 'a.md'), 'changed')).rejects.toThrow();
      expect(readFileSync(path.join(stray, 'a.md'), 'utf8')).toBe('a');
    });

    it('refuses a text over the cap', async () => {
      await expect(saveMemory(await list(), git, 'x'.repeat(20_001))).rejects.toThrow();
    });
  });

  it('claudeInstructionFiles lists the repo file first, then each account once', () => {
    expect(claudeInstructionFiles('/r', ['/a', '/b', '/a', undefined])).toEqual(['/r/CLAUDE.md', '/a/CLAUDE.md', '/b/CLAUDE.md']);
  });
});
