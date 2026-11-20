import { describe, expect, it } from 'bun:test';
import { addQueued, cancelQueued, flushQueue, MAX_OUTBOX, parseOutbox, queuedCommand, queuedFor, type Queued } from './outboxLogic';

const q = (id: string, chat = 'a', steer = false): Queued => ({ id, chat, text: `text ${id} [Image: /tmp/x.png]`, steer, at: 1 });

describe('outbox', () => {
  it('refuses the 51st message and keeps order', () => {
    let list: Queued[] = [];
    for (let i = 0; i < MAX_OUTBOX; i++) list = addQueued(list, q(String(i)))!;
    expect(addQueued(list, q('extra'))).toBeNull();
    expect(list[0].id).toBe('0');
    expect(list.at(-1)!.id).toBe(String(MAX_OUTBOX - 1));
  });

  it('cancels one message and filters by chat', () => {
    const list = [q('1', 'a'), q('2', 'b'), q('3', 'a')];
    expect(cancelQueued(list, '1').map((x) => x.id)).toEqual(['2', '3']);
    expect(queuedFor(list, 'a').map((x) => x.id)).toEqual(['1', '3']);
  });

  it('reads saved json and drops malformed rows', () => {
    expect(parseOutbox([q('1'), { id: 2 }, null, { id: '3', chat: 'a', text: 't' }]).map((x) => x.id)).toEqual(['1', '3']);
    expect(parseOutbox('nope')).toEqual([]);
  });

  it('sends a steer as a prompt when the chat is idle, a queue when running without steer', () => {
    expect(queuedCommand(q('1', 'a', true), true).type).toBe('steer');
    expect(queuedCommand(q('1', 'a', true), false).type).toBe('prompt');
    expect(queuedCommand(q('1'), true).type).toBe('queue');
    expect(queuedCommand(q('1'), false).type).toBe('prompt');
  });

  it('flushes oldest first and stops at the first failure, which stays queued', async () => {
    let list = [q('1'), q('2'), q('3')];
    const sent: string[] = [];
    const ok = await flushQueue(() => list, async (m) => { sent.push(m.id); return m.id !== '2'; }, (id) => { list = cancelQueued(list, id); });
    expect(ok).toBe(false);
    expect(sent).toEqual(['1', '2']);
    expect(list.map((x) => x.id)).toEqual(['2', '3']);
    expect(await flushQueue(() => list, async (m) => { sent.push(m.id); return true; }, (id) => { list = cancelQueued(list, id); })).toBe(true);
    expect(sent).toEqual(['1', '2', '2', '3']);
    expect(list).toEqual([]);
  });
});
