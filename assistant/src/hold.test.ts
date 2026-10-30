import { afterEach, describe, expect, test } from 'bun:test';
import { openDb } from './db.js';
import { flushHeld, heldPushes, pushOrHold, pushQueued } from './hold.js';
import { pushHours } from './slack.js';
import { askId, saveScan } from './slackSave.js';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

describe('pushQueued', () => {
  test('pushes an urgent ask found outside push hours at the next in-hours scan, and retries a failed push', async () => {
    const db = openDb(':memory:');
    const { urgent } = saveScan(db, { chats: [], asks: [{ url: 'u1', from: 'Kim', chat: '#ai', title: 'Answer Kim', quote: 'Now?', urgent: true }], answered: [] }, at(27, 18));
    const sent: string[] = [];
    let ok = false;
    const send = async (a: { id: string }) => (sent.push(a.id), ok);
    const scan = (t: number, found: typeof urgent) => pushQueued(db, 'k', found, pushHours({}, t), send);

    await scan(at(27, 18), urgent);
    expect(sent).toEqual([]);
    await scan(at(28, 8, 15), []);
    expect(sent).toEqual([askId('u1')]);
    await scan(at(28, 8, 30), []);
    expect(sent).toEqual([askId('u1'), askId('u1')]);
    ok = true;
    await scan(at(28, 8, 45), []);
    await scan(at(28, 9), []);
    expect(sent.length).toBe(3);
  });
});

describe('reviewed asks', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.AGENTVIEW_NTFY;
  });

  test('drops a queued ask I accepted without pushing it', async () => {
    const db = openDb(':memory:');
    const { urgent } = saveScan(db, { chats: [], asks: [{ url: 'u1', from: 'Kim', chat: '#ai', title: 'Answer Kim', quote: 'Now?', urgent: true }], answered: [] }, at(27, 18));
    await pushQueued(db, 'k', urgent, false, async () => true);
    db.prepare("UPDATE items SET status = 'open' WHERE id = ?").run(askId('u1'));
    const sent: string[] = [];
    await pushQueued(db, 'k', [] as { id: string }[], true, async (a) => (sent.push(a.id), true));
    expect(sent).toEqual([]);
    expect(db.prepare("SELECT 1 FROM meta WHERE key = 'k'").get()).toBeNull();
  });

  test('the post-meeting push leaves out an ask I handled during the meeting', async () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO meetings (id, profile, version, updated_at, title, starts_at, ends_at, people) VALUES ('m', 'work', 1, 0, 'Sync', ?, ?, '[\"a\"]')").run(at(28, 10), at(28, 11));
    const item = db.prepare("INSERT INTO items (id, profile, version, updated_at, title, status) VALUES (?, 'work', 1, 0, ?, 'suggested')");
    item.run('a', 'Ask A');
    item.run('b', 'Ask B');
    await pushOrHold(db, 'Ask A', '#ai', 'q', '', '', at(28, 10, 10), 'a');
    await pushOrHold(db, 'Ask B', '#ai', 'q', '', '', at(28, 10, 20), 'b');
    db.prepare("UPDATE items SET status = 'done' WHERE id = 'b'").run();
    const pushes: { title: string; body: string }[] = [];
    process.env.AGENTVIEW_NTFY = 'https://ntfy.test/t';
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => (pushes.push({ title: (init.headers as Record<string, string>).Title, body: String(init.body) }), new Response('ok'))) as unknown as typeof fetch;
    await flushHeld(db, at(28, 11, 1));
    expect(pushes).toEqual([{ title: '1 urgent while you were in Sync', body: '- Ask A (#ai)' }]);
    expect(heldPushes(db)).toEqual([]);
  });
});
