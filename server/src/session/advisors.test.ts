import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, open, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ADVISORS, HOUR, advisorOf } from '../../../shared/advisors.js';
import { prepareAdvisor, projectIndex, moveBacklogFile, readAudit, readBacklog } from './advisors.js';

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
    const stamps = path.join(root, 'stamps.json');
    expect(await readBacklog(root, { stamps })).toEqual([
      { rank: 1, slug: 'cards', title: 'Sketch cards', why: 'one tap', status: 'specced', spec: true },
      { rank: 2, slug: 'audit', title: 'Usability audit', why: 'nobody checks | a or b', status: 'proposed', spec: false },
    ]);
    expect(await readBacklog(path.join(root, 'none'), { stamps })).toEqual([]);
  });

  describe('done lines', () => {
    const NOW = 1_000 * HOUR;
    const setup = async (md: string) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'expire-'));
      await mkdir(path.join(root, '.claude'), { recursive: true });
      const file = path.join(root, '.claude/backlog.md');
      await writeFile(file, md);
      return { root, file, stamps: path.join(root, 'stamps.json') };
    };
    const MD = '1. a | A | w | proposed\n2. b | B | w | done\n3. c | C | w | done\n4. d | D | w | specced\n';

    it('removes the expired done line, renumbers, and writes nothing on a second read', async () => {
      const { root, file, stamps } = await setup(MD);
      await writeFile(stamps, JSON.stringify({ [root]: { b: NOW - 5 * HOUR, c: NOW - HOUR } }));
      expect((await readBacklog(root, { stamps, now: NOW })).map((i) => [i.rank, i.slug])).toEqual([[1, 'a'], [2, 'c'], [3, 'd']]);
      expect(await readFile(file, 'utf8')).toBe('1. a | A | w | proposed\n2. c | C | w | done\n3. d | D | w | specced\n');
      expect(JSON.parse(await readFile(stamps, 'utf8'))).toEqual({ [root]: { c: NOW - HOUR } });
      const times = [(await stat(file)).mtimeMs, (await stat(stamps)).mtimeMs];
      await readBacklog(root, { stamps, now: NOW });
      expect([(await stat(file)).mtimeMs, (await stat(stamps)).mtimeMs]).toEqual(times);
    });

    it('leaves stamps alone for a missing backlog', async () => {
      const { root, stamps } = await setup(MD);
      await writeFile(stamps, JSON.stringify({ '/other': { x: 1 }, [path.join(root, 'none')]: { y: 2 } }));
      expect(await readBacklog(path.join(root, 'none'), { stamps, now: NOW })).toEqual([]);
      expect(JSON.parse(await readFile(stamps, 'utf8'))).toEqual({ '/other': { x: 1 }, [path.join(root, 'none')]: { y: 2 } });
    });

    it('keeps a file that changed during the read and expires the row on the next read', async () => {
      const { root, file, stamps } = await setup(MD);
      await Bun.spawn(['mkfifo', stamps]).exited;
      const read = readBacklog(root, { stamps, now: NOW });
      const w = await open(stamps, 'w');
      const changed = `${MD}5. e | E | w | proposed\n`;
      await writeFile(file, changed);
      await w.writeFile(JSON.stringify({ [root]: { b: NOW - 5 * HOUR, c: NOW - HOUR } }));
      await w.close();
      await read;
      expect(await readFile(file, 'utf8')).toBe(changed);
      expect(JSON.parse(await readFile(stamps, 'utf8'))[root]).toEqual({ b: NOW - 5 * HOUR, c: NOW - HOUR });
      expect((await readBacklog(root, { stamps, now: NOW })).map((i) => i.slug)).toEqual(['a', 'c', 'd', 'e']);
    });

    it('lets a move and a read started together both take effect', async () => {
      const { root, file, stamps } = await setup(MD);
      await writeFile(stamps, JSON.stringify({ [root]: { b: NOW - 5 * HOUR, c: NOW - HOUR } }));
      const [moved, items] = await Promise.all([moveBacklogFile(root, 'd', 'up'), readBacklog(root, { stamps, now: NOW })]);
      expect(moved).toBe(true);
      expect(items.map((i) => i.slug)).toEqual(['d', 'c', 'a']);
      expect(await readFile(file, 'utf8')).toBe('1. d | D | w | specced\n2. c | C | w | done\n3. a | A | w | proposed\n');
    });
  });

  it('lets the designer edit sketches and audits only', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'advisors-'));
    const dir = await prepareAdvisor(ADVISORS[2], ['/w/a'], home);
    expect(JSON.parse(await readFile(path.join(dir, '.claude/settings.json'), 'utf8'))).toEqual({ permissions: { allow: ['Read(//w/a/**)', 'Edit(//w/a/*/.claude/sketches/**)', 'Edit(//w/a/*/.claude/audits/**)'] } });
  });

  it('reads the newest audit with its findings', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'audit-'));
    await mkdir(path.join(root, '.claude/audits'), { recursive: true });
    await writeFile(path.join(root, '.claude/audits/2026-11-01.md'), '1. Old | gone | low | x\n');
    await writeFile(path.join(root, '.claude/audits/2026-11-12.md'), '# Audit\n1. Goal sheet | Cap field under keyboard | high | Scroll it into view\nnot a line\n2. Home | A | b | med | c\n3. Menu | Target is 28px | low | Make it 44px\n');
    const audit = await readAudit(root);
    expect(audit?.date).toBe('2026-11-12');
    expect(audit?.findings).toEqual([
      { rank: 1, screen: 'Goal sheet', problem: 'Cap field under keyboard', severity: 'high', fix: 'Scroll it into view', status: 'open', by: '' },
      { rank: 3, screen: 'Menu', problem: 'Target is 28px', severity: 'low', fix: 'Make it 44px', status: 'open', by: '' },
    ]);
    expect(await readAudit(path.join(root, 'none'))).toBeNull();
  });

  it('matches advisor folders only', () => {
    expect(advisorOf('/Users/x/.agentview/advisors/architect')?.name).toBe('Architect');
    expect(advisorOf('/Users/x/.agentview/advisors/pm/')?.id).toBe('pm');
    expect(advisorOf('/Users/x/workspace/pm')).toBeUndefined();
  });
});
