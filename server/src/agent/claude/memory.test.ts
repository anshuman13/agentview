import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chatMemory } from './memory.js';

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
});
