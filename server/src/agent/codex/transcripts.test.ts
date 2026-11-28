import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SavedSession } from '../../../../shared/protocol.js';
import type { Thread, ThreadItem } from './protocol.js';
import { codexFirstCommit, listThreads, mergeThreads, readThread, rolloutCommit, searchRollouts } from './transcripts.js';

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);
const list = JSON.parse(readFileSync(fixture('thread-list.json'), 'utf8'));
const items = readFileSync(fixture('turn.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  .filter((l) => l.method === 'item/completed' || (l.method === 'item/started' && l.params.item.type === 'userMessage'))
  .map((l) => l.params.item as ThreadItem);

const stub = (replies: Record<string, unknown>) => {
  const sent: Array<[string, unknown]> = [];
  const rpc = {
    request: async <T,>(method: string, params: unknown) => {
      sent.push([method, params]);
      if (!(method in replies)) throw new Error('no thread');
      return replies[method] as T;
    },
  };
  return { rpc, sent };
};

describe('codex transcripts', () => {
  it('lists threads from thread/list and keeps AgentView titles and unlisted chats', async () => {
    const { rpc, sent } = stub({ 'thread/list': list });
    const threads = await listThreads(rpc);
    expect(sent[0]).toEqual(['thread/list', { limit: 200, sortKey: 'updated_at' }]);
    const saved: SavedSession[] = [
      { sessionId: 'thread1', title: 'Greeting', cwd: '/tmp/proj', gitBranch: null, lastModified: 1, provider: 'codex' },
      { sessionId: 'gone', title: 'Old', cwd: '/tmp', gitBranch: null, lastModified: 2, provider: 'codex' },
    ];
    expect(mergeThreads(threads, saved)).toEqual([
      { sessionId: 'thread1', title: 'Greeting', cwd: '/tmp/proj', gitBranch: 'main', lastModified: 1794249460000, createdAt: 1794249400000, provider: 'codex' },
      { sessionId: 'thread2', title: 'Build fix', cwd: '/tmp/other', gitBranch: null, lastModified: 1794240100000, createdAt: 1794240000000, provider: 'codex' },
      saved[1],
    ]);
    expect(mergeThreads([{ ...threads[0], name: null }], [])[0].title).toBe('add a greeting');
  });

  it('reads a thread into the events the live chat showed, with the rollout checklist', async () => {
    const thread: Thread = { id: 'thread1', cwd: '/tmp/proj', path: fileURLToPath(fixture('rollout.jsonl')), preview: '', name: null, updatedAt: 1794249460, turns: [{ id: 'turn2', items, status: 'completed', startedAt: 1794249400, error: null }] };
    const { rpc, sent } = stub({ 'thread/read': { thread } });
    const events = await readThread(rpc, 'thread1');
    expect(sent[0]).toEqual(['thread/read', { threadId: 'thread1', includeTurns: true }]);
    expect(events?.[0]).toMatchObject({ kind: 'user', text: 'add a greeting' });
    expect(events?.some((e) => e.id === 'turn2:plan:saved')).toBe(true);
    expect(events?.at(-1)).toMatchObject({ kind: 'result', text: 'Added the greeting.' });
  });

  it('returns null for a thread the app-server cannot read', async () => {
    expect(await readThread(stub({}).rpc, 'missing')).toBeNull();
  });
});

describe('codex rollout search and first commit', () => {
  const dir = fileURLToPath(fixture('sessions'));
  const id = '01a22194-a972-74d1-af1a-f70debb05035';

  it('finds a word that only a Codex message holds, newest first, tagged with the thread id', async () => {
    const hits = await searchRollouts(['ZANZIBAR', 'helper'], 10, dir);
    expect(hits.map((h) => [h.sessionId, h.role, h.at])).toEqual([
      [id, 'assistant', '2026-11-28T10:00:05.000Z'],
      [id, 'user', '2026-11-28T10:00:02.000Z'],
    ]);
    expect(hits[1].text).toBe('Rename the zanzibar helper and commit it');
    expect(await searchRollouts(['proj'], 10, dir)).toEqual([]);
  });

  it('returns the first git commit the thread ran, or null', async () => {
    expect(await codexFirstCommit(id, dir)).toEqual({ hash: '1a2b3c4', subject: 'Rename the helper' });
    expect(await codexFirstCommit('missing', dir)).toBeNull();
    expect(rolloutCommit('{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"CommandExecution","command":["git commit"],"aggregated_output":"nothing to commit","exit_code":1}}}')).toBeNull();
  });
});
