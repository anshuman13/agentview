import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { listAll, otherChats, searchAll } from './allChats.js';
import { searchRollouts } from './codex/transcripts.js';
import type { MessageHit, Transcripts } from './types.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'agentview-allchats-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const store = (hits: MessageHit[], list: { sessionId: string; cwd: string; title: string }[] = []) =>
  ({ search: async () => hits, list: async () => list.map((s) => ({ ...s, gitBranch: null, lastModified: 0 })) }) as unknown as Transcripts;
const hit = (sessionId: string, at: string, text = 'x'): MessageHit => ({ sessionId, role: 'user', text, at });

describe('searchAll', () => {
  it('merges the stores newest first with at most 3 hits per chat', async () => {
    const claude = store([hit('a', '2026-01-01'), hit('a', '2026-01-02'), hit('a', '2026-01-03'), hit('a', '2026-01-04')]);
    const codex = store([hit('t', '2026-01-05')]);
    expect((await searchAll(['x'], 50, [claude, codex])).map((h) => `${h.sessionId}${h.at.slice(-1)}`)).toEqual(['t5', 'a4', 'a3', 'a2']);
    expect(await searchAll([], 50, [claude])).toEqual([]);
  });

  it('lists each session once', async () => {
    const s = { sessionId: 'a', cwd: '/r', title: 'A' };
    expect((await listAll([store([], [s]), store([], [s, { ...s, sessionId: 'b' }])])).map((x) => x.sessionId)).toEqual(['a', 'b']);
  });
});

describe('otherChats', () => {
  it('finds a word that only a Codex rollout holds, tagged with its thread id, folder and title', async () => {
    const dir = path.join(root, 'sessions', '2026', '11', '28');
    mkdirSync(dir, { recursive: true });
    const id = '019a0000-0000-7000-8000-000000000001';
    writeFileSync(path.join(dir, `rollout-2026-11-28T10-00-00-${id}.jsonl`), [
      JSON.stringify({ type: 'session_meta', payload: { id, cwd: '/srv/repo' } }),
      JSON.stringify({ type: 'response_item', timestamp: '2026-11-28T10:00:01Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The zanzibar importer is fixed.' }] } }),
    ].join('\n'));
    const codex = { ...store([]), search: (words: string[], max: number) => searchRollouts(words, max, path.join(root, 'sessions')), list: async () => [{ sessionId: id, cwd: '/srv/repo', title: 'Fix importer', gitBranch: null, lastModified: 0 }] } as unknown as Transcripts;
    const chats = await otherChats(['zanzibar'], [codex]);
    expect(chats).toEqual([{ sessionId: id, cwd: '/srv/repo', title: 'Fix importer', hits: [hit(id, '2026-11-28T10:00:01Z', 'The zanzibar importer is fixed.')].map((h) => ({ ...h, role: 'assistant' as const })) }]);
    expect(await otherChats(['nowhere'], [codex])).toEqual([]);
  });
});
