import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ADVISORS, advisorOf } from '../../../shared/advisors.js';
import { prepareAdvisor, projectIndex, readBacklog } from './advisors.js';

describe('prepareAdvisor', () => {
  it('writes the role with the memory import and keeps an existing memory', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'advisors-'));
    const dir = await prepareAdvisor(ADVISORS[0], ['/w/a', '/w/b'], home);
    const claude = await readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claude.startsWith('# PM')).toBe(true);
    expect(claude).toContain('build-kit/agents/pm.md');
    expect(claude.trimEnd().endsWith('@projects.md\n\n@memory.md')).toBe(true);
    expect(JSON.parse(await readFile(path.join(dir, '.claude/settings.json'), 'utf8'))).toEqual({ permissions: { allow: ['Read(//w/a/**)', 'Read(//w/b/**)', 'Edit(//w/a/*/.claude/specs/**)', 'Edit(//w/a/*/.claude/backlog.md)', 'Edit(//w/b/*/.claude/specs/**)', 'Edit(//w/b/*/.claude/backlog.md)'] } });
    await writeFile(path.join(dir, 'memory.md'), '# PM memory\n- AgentView: ship the sketch step first\n');
    await prepareAdvisor(ADVISORS[0], ['/w/a', '/w/b'], home);
    expect(await readFile(path.join(dir, 'memory.md'), 'utf8')).toContain('sketch step');
  });

  it('indexes each project with its first README sentence, newest first', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'projects-'));
    await mkdir(path.join(root, 'shop/.git'), { recursive: true });
    await writeFile(path.join(root, 'shop/.git/index'), '');
    await writeFile(path.join(root, 'shop/README.md'), '# Shop\n\n![badge](x)\nThe shop backend for orders and payments. More text here.\n');
    await mkdir(path.join(root, 'notes'));
    const text = await projectIndex([root]);
    expect(text).toContain(`### ${root}\n- shop (active `);
    expect(text).toContain('): The shop backend for orders and payments.\n');
    expect(text.trimEnd().endsWith('- notes')).toBe(true);
  });

  it('reads the backlog and marks items with a spec', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'backlog-'));
    await mkdir(path.join(root, '.claude/specs'), { recursive: true });
    await writeFile(path.join(root, '.claude/specs/cards.md'), '# Cards\n');
    await writeFile(path.join(root, '.claude/backlog.md'), '# Backlog\n1. cards | Sketch cards | one tap | specced\n2. audit | Usability audit | nobody checks | a or b | proposed\nnot a line\n3. ../x | Bad | slug | proposed\n');
    expect(await readBacklog(root)).toEqual([
      { rank: 1, slug: 'cards', title: 'Sketch cards', why: 'one tap', status: 'specced', spec: true },
      { rank: 2, slug: 'audit', title: 'Usability audit', why: 'nobody checks | a or b', status: 'proposed', spec: false },
    ]);
    expect(await readBacklog(path.join(root, 'none'))).toEqual([]);
  });

  it('matches advisor folders only', () => {
    expect(advisorOf('/Users/x/.agentview/advisors/architect')?.name).toBe('Architect');
    expect(advisorOf('/Users/x/.agentview/advisors/pm/')?.id).toBe('pm');
    expect(advisorOf('/Users/x/workspace/pm')).toBeUndefined();
  });
});
