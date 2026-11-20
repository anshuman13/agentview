import { describe, expect, it } from 'bun:test';
import { openDb } from '../core/db.js';
import { alreadyKnown, learnFromChat, type Chat } from './learn.js';
import { applyChanges } from '../core/sync.js';

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
      return { claims: ['Use bun, not npm.', 'b', 'c', 'd'], decisions: [] };
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

  it('records the chat folder in the source', async () => {
    const db = openDb(':memory:');
    await learnFromChat(db, { ...chat([user('u1', 10)]), folder: '/repo' }, 100, async () => ({ claims: ['Use bun.'], decisions: [] }));
    expect(db.prepare("SELECT sources FROM facts WHERE id LIKE 'learn:%'").get()).toEqual({ sources: '[{"kind":"chat","label":"Setup","folder":"/repo"}]' });
  });

  it('keeps the cursor when the run fails and moves it when nothing is saved', async () => {
    const db = openDb(':memory:');
    const events = [user('u1', 10)];
    await expect(learnFromChat(db, chat(events), 100, async () => { throw new Error('refused'); })).rejects.toThrow('refused');
    let asked = 0;
    const none = async () => (asked++, { claims: [], decisions: [] });
    expect(await learnFromChat(db, chat(events), 100, none)).toEqual({ proposed: 0 });
    await learnFromChat(db, chat(events), 100, none);
    expect(asked).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM facts').get()).toEqual({ n: 0 });
  });

  it('offers pages and saves decisions only when the chat names a ticket or PR', async () => {
    const db = openDb(':memory:');
    applyChanges(db, [
      { table: 'pages', id: 'p1', profile: 'work', updated_at: 1, fields: { title: 'Deploys', section: 'Ops', state: null } },
      { table: 'facts', id: 'f1', profile: 'work', updated_at: 1, fields: { text: 'As of 1 Nov 2026, deploys run on merge (OPS-1).', state: 'live', page_id: 'p1' } },
    ]);
    const offered: (string[] | null)[] = [];
    const decisions = [
      { text: 'As of 20 Nov 2026, deploys wait for a green check (OPS-2).', page: 'deploys' },
      { text: 'As of 20 Nov 2026, the importer uses bun (OPS-2).', page: 'Importer', section: 'Systems' },
      { text: 'As of 20 Nov 2026, the importer runs nightly (OPS-2).', page: 'importer', section: 'Other' },
      { text: 'As of 20 Nov 2026, a third decision (OPS-2).', page: 'p1' },
      { text: 'As of 20 Nov 2026, deploys run on merge (OPS-1).', page: 'p1' },
    ];
    const run = async (_c: Chat, _e: Chat['events'], _m: string[], pages: { id: string }[] | null) => {
      offered.push(pages && pages.map((p) => p.id));
      return { claims: [], decisions };
    };
    expect(await learnFromChat(db, chat([user('u1', 10, 'deploys are slow, see OPS-2')], 'Deploys'), 100, run)).toEqual({ proposed: 3 });
    expect(offered).toEqual([['p1']]);
    const page = db.prepare("SELECT id, title, section, state FROM pages WHERE id LIKE 'learn:page:%'").all() as Record<string, string>[];
    expect(page).toEqual([{ id: page[0]!.id, title: 'Importer', section: 'Systems', state: 'proposed' }]);
    expect(db.prepare("SELECT text, page_id, state FROM facts WHERE id LIKE 'learn:%' ORDER BY text").all()).toEqual([
      { text: 'As of 20 Nov 2026, deploys wait for a green check (OPS-2).', page_id: 'p1', state: 'proposed' },
      { text: 'As of 20 Nov 2026, the importer uses bun (OPS-2).', page_id: page[0]!.id, state: 'proposed' },
    ]);
    await learnFromChat(db, chat([user('u2', 20, 'merged #123 and https://github.com/a/b/pull/9')]), 100, run);
    await learnFromChat(db, chat([user('u3', 30, 'use bun, see ABC-x and #')]), 100, run);
    expect(offered).toEqual([['p1'], [], null]);
  });

  it('does not take encodings, versions or colours for tickets, and ignores assistant text', async () => {
    const db = openDb(':memory:');
    const offered: (unknown[] | null)[] = [];
    const run = async (_c: Chat, _e: Chat['events'], _m: string[], pages: unknown[] | null) => {
      offered.push(pages);
      return { claims: [], decisions: [] };
    };
    const ask = (text: string, i: number, assistant = 'see OPS-2') => learnFromChat(db, chat([user(`u${i}`, 10 * i, text), { id: `a${i}`, kind: 'assistant', text: assistant, at: 10 * i + 1 }]), 100, run);
    for (const [i, text] of ['save as UTF-8', 'use SHA-1 and ISO-8601', 'GPT-4 is slow', 'color: #3a3a3a', 'mix &#123; in'].entries()) await ask(text, i + 1);
    expect(offered).toEqual([null, null, null, null, null]);
    offered.length = 0;
    for (const [i, text] of ['fix ABC-123', 'see #42', 'https://github.com/a/b/pull/9'].entries()) await ask(text, i + 10, 'ok');
    expect(offered.map((p) => p !== null)).toEqual([true, true, true]);
  });

  it('skips claims that exist in any state or look like secrets', async () => {
    const db = openDb(':memory:');
    const row = (id: string, state: string, text: string, page_id: string | null = null) => ({ table: 'facts', id, profile: 'work' as const, updated_at: 1, fields: { text, state, page_id } });
    applyChanges(db, [row('a', 'live', 'Use bun, not npm.'), row('b', 'rejected', 'No em dashes.'), row('c', 'proposed', 'Prefer  short   answers', 'p1')]);
    const claims = ['  use BUN, not npm. ', 'no em dashes.', 'prefer short answers', 'The password is hunter2', 'Token abcdefghijklmnopqrstuvwxyz1234', 'Run tests before commits.'];
    expect(await learnFromChat(db, chat([user('u1', 10)]), 100, async () => ({ claims, decisions: [] }))).toEqual({ proposed: 1 });
    expect(db.prepare("SELECT text FROM facts WHERE id LIKE 'learn:%'").all()).toEqual([{ text: 'Run tests before commits.' }]);
  });

  it('tells the run about live and proposed claims, page or not', async () => {
    const db = openDb(':memory:');
    const row = (id: string, state: string, text: string, page_id: string | null = null) => ({ table: 'facts', id, profile: 'work' as const, updated_at: 1, fields: { text, state, page_id } });
    applyChanges(db, [row('a', 'live', 'Use bun.'), row('b', 'live', 'Gateway limits 60 a minute.', 'p1'), row('c', 'proposed', 'Short answers.'), row('d', 'rejected', 'No em dashes.')]);
    let memory: string[] = [];
    await learnFromChat(db, chat([user('u1', 10)]), 100, async (_c, _e, m) => ((memory = m), { claims: [], decisions: [] }));
    expect(memory.sort()).toEqual(['Gateway limits 60 a minute.', 'Short answers.', 'Use bun.']);
    expect(alreadyKnown([{ text: 'x', state: null }, { text: 'y', state: 'retired' }])).toEqual(['x']);
  });
});
