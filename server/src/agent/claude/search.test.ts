import { appendFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'bun:test';
import { lineHit, searchChats, searchMessages } from './search.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'agentview-search-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const line = (o: object) => JSON.stringify(o);

describe('searchMessages', () => {
  it('finds prompts and replies holding every word, newest first, skipping tool output and meta lines', async () => {
    const dir = path.join(root, 'projects', '-repo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'a.jsonl'), [
      line({ type: 'user', sessionId: 'a', timestamp: '2026-11-01T10:00:00Z', message: { content: 'Fix the Retry logic in the importer' } }),
      line({ type: 'assistant', sessionId: 'a', timestamp: '2026-11-02T10:00:00Z', message: { content: [{ type: 'text', text: 'The importer retry now waits 2 s.' }, { type: 'tool_use', name: 'Bash' }] } }),
      line({ type: 'user', sessionId: 'a', timestamp: '2026-11-03T10:00:00Z', message: { content: [{ type: 'tool_result', content: 'importer retry output' }] } }),
      line({ type: 'user', sessionId: 'a', isMeta: true, timestamp: '2026-11-04T10:00:00Z', message: { content: 'importer retry meta' } }),
      line({ type: 'user', sessionId: 'a', timestamp: '2026-11-05T10:00:00Z', message: { content: 'only the importer' } }),
    ].join('\n'));
    const hits = await searchMessages('retry importer', root);
    expect(hits.map((h) => [h.role, h.text])).toEqual([
      ['assistant', 'The importer retry now waits 2 s.'],
      ['user', 'Fix the Retry logic in the importer'],
    ]);
    expect(await searchMessages('nothing here', root)).toEqual([]);
  });

  it('cuts long text at word boundaries around the first word', () => {
    const text = `${'alpha '.repeat(20)}needle ${'omega '.repeat(40)}`;
    const hit = lineHit(line({ type: 'user', sessionId: 'a', message: { content: text } }), ['needle']);
    expect(hit?.text).toMatch(/^…alpha alpha .* needle omega .* omega…$/);
    expect(hit?.text).not.toMatch(/…lpha|omeg…/);
  });
});

describe('searchChats', () => {
  const work = '/srv/repo';
  const personal = path.join(os.homedir(), 'workspace_personal', 'notes');
  const msg = (sessionId: string, cwd: string, at: string, text: string, type = 'user') =>
    line({ type, sessionId, cwd, timestamp: at, message: { content: text } });
  const chat = (dir: string, id: string, lines: string[]) => {
    mkdirSync(path.join(dir, 'projects', '-p'), { recursive: true });
    writeFileSync(path.join(dir, 'projects', '-p', `${id}.jsonl`), lines.join('\n'));
  };
  const base = (name: string) => path.join(root, name);

  it('ranks by distinct words, keeps profiles apart, skips own and binned chats and tool output', async () => {
    const dir = base('rank');
    chat(dir, 'two', [msg('two', work, '2026-01-01T00:00:00Z', 'the importer retry plan')]);
    chat(dir, 'one', [msg('one', work, '2026-03-01T00:00:00Z', 'importer only')]);
    chat(dir, 'mine', [msg('mine', work, '2026-03-02T00:00:00Z', 'importer retry')]);
    chat(dir, 'bin', [msg('bin', work, '2026-03-02T00:00:00Z', 'importer retry')]);
    chat(dir, 'priv', [msg('priv', personal, '2026-03-02T00:00:00Z', 'importer retry')]);
    chat(dir, 'tool', [line({ type: 'user', sessionId: 'tool', cwd: work, message: { content: [{ type: 'tool_result', content: 'importer retry' }] } })]);
    const out = await searchChats('Importer retry x', work, 'mine', { dirs: () => [dir], binned: async () => ['bin'], titles: async () => new Map() });
    expect(out.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.split(' | ')[3])).toEqual(['two', 'one']);
    const own = await searchChats('importer', personal, null, { dirs: () => [dir], binned: async () => [], titles: async () => new Map() });
    expect(own).toContain('priv');
    expect(own).not.toContain('two');
  });

  it('returns 8 hits with title, folder, date and snippet, cutting the first prompt to 80 characters', async () => {
    const dir = base('many');
    for (let i = 0; i < 10; i++) chat(dir, `c${i}`, [msg(`c${i}`, work, `2026-02-0${i % 9 + 1}T00:00:00Z`, `${'long '.repeat(30)}needle`)]);
    chat(dir, 'titled', [msg('titled', work, '2026-02-10T00:00:00Z', 'needle here')]);
    const out = await searchChats('needle', work, null, { dirs: () => [dir], binned: async () => [], titles: async () => new Map([['titled', 'A title']]) });
    const hits = out.split('\n').filter((l) => l.startsWith('- '));
    expect(hits).toHaveLength(8);
    expect(hits[0]).toBe('- A title | /srv/repo | 2026-02-10 | titled');
    expect(hits[1].split(' | ')[0]).toBe(`- ${'long '.repeat(30).slice(0, 80)}`);
    expect(out).toContain('needle');
  });

  it('reads a chat once through two config dirs and again only after it changes', async () => {
    const dir = base('dup');
    chat(dir, 'x', [msg('x', work, '2026-04-01T00:00:00Z', 'zebra crossing')]);
    const alt = base('dup-alt');
    mkdirSync(alt, { recursive: true });
    symlinkSync(path.join(dir, 'projects'), path.join(alt, 'projects'));
    const read = vi.fn(readFile) as unknown as typeof readFile;
    const deps = { dirs: () => [dir, alt, base('missing')], binned: async () => [], titles: async () => new Map<string, string>(), read };
    const out = await searchChats('zebra', work, null, deps);
    expect(out.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(1);
    await searchChats('zebra', work, null, deps);
    expect(read).toHaveBeenCalledTimes(1);
    appendFileSync(path.join(dir, 'projects', '-p', 'x.jsonl'), '\n' + msg('x', work, '2026-04-02T00:00:00Z', 'giraffe'));
    expect(await searchChats('giraffe', work, null, deps)).toContain('giraffe');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('answers empty queries and misses with fixed text', async () => {
    const deps = { dirs: () => [base('empty')], binned: async () => [], titles: async () => new Map<string, string>() };
    expect(await searchChats('  a ', work, null, deps)).toBe('Give at least one word to search for.');
    expect(await searchChats('nothing', work, null, deps)).toBe('No past chats match.');
  });
});
