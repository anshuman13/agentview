import { describe, expect, it } from 'bun:test';
import { openDb } from './db.js';
import { learnFromChat, type Chat } from './learn.js';
import { applyChanges } from './sync.js';

const chat = (events: Chat['events'], title = 'Setup'): Chat => ({ chat: 'c1', title, profile: 'work', events });
const user = (id: string, at: number, text = 'use bun, not npm') => ({ id, kind: 'user', text, at });
const tool = (id: string, at: number) => ({ id, kind: 'tool_use', text: 'ls', at });
const reply = { id: 'a1', kind: 'assistant', text: 'ok', at: 12 };

describe('learn from chats', () => {
  it('saves proposed memory claims with the chat as source and moves the cursor', async () => {
    const db = openDb(':memory:');
    const seen: string[][] = [];
    const run = async (_c: Chat, events: Chat['events']) => {
      seen.push(events.map((e) => e.id));
      return ['Use bun, not npm.', 'b', 'c', 'd'];
    };
    expect(await learnFromChat(db, chat([user('u1', 10), tool('t1', 11), reply]), 100, run)).toEqual({ proposed: 3 });
    expect(seen).toEqual([['u1', 'a1']]);
    expect(db.prepare("SELECT text, page_id, heading, state, replaces, added_by, sources FROM facts WHERE id LIKE 'learn:%' ORDER BY text").all()[2]).toEqual({
      text: 'c', page_id: null, heading: null, state: 'proposed', replaces: null, added_by: 'claude:c1', sources: '[{"kind":"chat","label":"Setup"}]',
    });
    expect(await learnFromChat(db, chat([user('u1', 10), reply]), 100, run)).toEqual({ proposed: 0 });
    expect(seen).toHaveLength(1);
    expect(await learnFromChat(db, chat([user('u1', 10), user('u2', 20)]), 100, run)).toEqual({ proposed: 1 });
    expect(seen).toEqual([['u1', 'a1'], ['u2']]);
  });

  it('keeps the cursor when the run fails and moves it when nothing is saved', async () => {
    const db = openDb(':memory:');
    const events = [user('u1', 10)];
    await expect(learnFromChat(db, chat(events), 100, async () => { throw new Error('refused'); })).rejects.toThrow('refused');
    let asked = 0;
    const none = async () => (asked++, []);
    expect(await learnFromChat(db, chat(events), 100, none)).toEqual({ proposed: 0 });
    await learnFromChat(db, chat(events), 100, none);
    expect(asked).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM facts').get()).toEqual({ n: 0 });
  });

  it('skips claims that exist in any state or look like secrets', async () => {
    const db = openDb(':memory:');
    const row = (id: string, state: string, text: string, page_id: string | null = null) => ({ table: 'facts', id, profile: 'work' as const, updated_at: 1, fields: { text, state, page_id } });
    applyChanges(db, [row('a', 'live', 'Use bun, not npm.'), row('b', 'rejected', 'No em dashes.'), row('c', 'proposed', 'Prefer  short   answers', 'p1')]);
    const claims = ['  use BUN, not npm. ', 'no em dashes.', 'prefer short answers', 'The password is hunter2', 'Token abcdefghijklmnopqrstuvwxyz1234', 'Run tests before commits.'];
    expect(await learnFromChat(db, chat([user('u1', 10)]), 100, async () => claims)).toEqual({ proposed: 1 });
    expect(db.prepare("SELECT text FROM facts WHERE id LIKE 'learn:%'").all()).toEqual([{ text: 'Run tests before commits.' }]);
  });
});
