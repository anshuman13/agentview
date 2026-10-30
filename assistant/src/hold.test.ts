import { describe, expect, test } from 'bun:test';
import { openDb } from './db.js';
import { pushQueued } from './hold.js';
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
