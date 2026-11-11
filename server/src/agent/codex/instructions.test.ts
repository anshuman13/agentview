import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, it } from 'bun:test';
import { codexInstructionFiles } from './instructions.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'agentview-codex-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

it('lists the repo AGENTS.md, or CLAUDE.md when there is none, then the user\'s own', () => {
  const home = path.join(root, 'home');
  expect(codexInstructionFiles(root, home)).toEqual([path.join(root, 'CLAUDE.md'), path.join(home, '.codex', 'AGENTS.md')]);
  writeFileSync(path.join(root, 'AGENTS.md'), '# Rules\n');
  expect(codexInstructionFiles(root, home)[0]).toBe(path.join(root, 'AGENTS.md'));
});
