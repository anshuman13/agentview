import { describe, expect, it } from 'bun:test';
import { excerptOf, pickChats, summaryPrompt } from './summaries.js';
import { mergeSummaries } from './summaryStore.js';

const H = 3600_000;
const NOW = 100 * H;

describe('pickChats', () => {
  const chat = (sessionId: string, ago: number) => ({ sessionId, lastModified: NOW - ago });

  it('takes idle chats newer than their summary, newest first, at most 5, skipping running and binned ones', () => {
    const chats = [chat('fresh', H), chat('old', 10 * H), chat('done', 5 * H), chat('stale', 4 * H), chat('skip', 3 * H), ...['a', 'b', 'c', 'd', 'e'].map((id, i) => chat(id, (20 + i) * H))];
    const summaries = { done: { text: 'x', at: NOW - H }, stale: { text: 'x', at: NOW - 6 * H } };
    const got = pickChats(chats, summaries, new Set(['skip']), NOW).map((c) => c.sessionId);
    expect(got).toEqual(['stale', 'old', 'a', 'b', 'c']);
  });

  it('does not retry a chat whose empty summary is newer than its last message', () => {
    const chats = [chat('a', 5 * H)];
    expect(pickChats(chats, { a: { text: '', at: NOW - H } }, new Set(), NOW)).toEqual([]);
    expect(pickChats(chats, { a: { text: '', at: NOW - 6 * H } }, new Set(), NOW)).toHaveLength(1);
  });
});

describe('excerptOf', () => {
  const line = (o: object) => JSON.stringify(o);

  it('keeps prompts and replies, drops tool output, and cuts to the last 4000 characters', () => {
    const tail = [
      line({ type: 'user', sessionId: 's', message: { content: 'x'.repeat(5000) } }),
      line({ type: 'user', sessionId: 's', message: { content: [{ type: 'tool_result', content: 'noise' }] } }),
      line({ type: 'assistant', sessionId: 's', message: { content: [{ type: 'text', text: 'Done, merged.' }, { type: 'tool_use', name: 'Bash' }] } }),
    ].join('\n');
    const out = excerptOf(tail);
    expect(out.length).toBe(4000);
    expect(out.endsWith('\nClaude: Done, merged.')).toBe(true);
    expect(out).not.toContain('noise');
  });
});

describe('summaryPrompt', () => {
  it('holds the first prompt on one line and the excerpt', () => {
    const p = summaryPrompt('Fix the\n  importer', 'User: hi');
    expect(p).toContain('First prompt: Fix the importer');
    expect(p.endsWith('User: hi')).toBe(true);
    expect(p).toContain('under 120 characters');
  });
});

describe('mergeSummaries', () => {
  it('overwrites a chat and keeps the rest; nothing found keeps the same object', () => {
    const cur = { a: { text: 'old', at: 1 }, b: { text: 'keep', at: 1 } };
    expect(mergeSummaries(cur, { a: { text: 'new', at: 2 } })).toEqual({ a: { text: 'new', at: 2 }, b: { text: 'keep', at: 1 } });
    expect(mergeSummaries(cur, {})).toBe(cur);
  });
});
