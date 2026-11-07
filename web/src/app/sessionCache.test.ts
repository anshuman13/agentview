import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROW_WINDOW, type ChatEvent, type LiveChat, type ServerMessage } from '../../../shared/protocol';

const es = vi.hoisted(() => {
  type Source = { onmessage?: (e: { data: string; lastEventId: string }) => void };
  const h = { last: null as Source | null };
  vi.stubGlobal('window', { addEventListener() {}, location: {} });
  vi.stubGlobal('document', { hidden: false, title: '', visibilityState: 'visible', addEventListener() {} });
  vi.stubGlobal('EventSource', class implements Source { static CLOSED = 2; readyState = 1; onmessage?: Source['onmessage']; constructor() { h.last = this; } addEventListener() {} close() {} });
  return h;
});

import { connect, getState, loadEarlier, send, switchedMac } from './store';

const fetchMock = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
vi.stubGlobal('fetch', fetchMock);

const ev = (id: string, text = ''): ChatEvent => ({ id, kind: 'user', text, at: 1 });
const rows = (chat: string, n: number) => Array.from({ length: n }, (_, i) => ev(`${chat}${i}`, chat));
const emit = (m: ServerMessage) => es.last!.onmessage!({ data: JSON.stringify(m), lastEventId: '' });
const init = (chat: string, events: ChatEvent[], earlier?: number) => emit({ type: 'init', state: { ...getState(), session: { ...getState().session, id: chat }, events, pending: [], earlier } });
const chat = (id: string, running = false) => ({ id, sessionId: `s-${id}`, running }) as LiveChat;
const live = (...ids: string[]) => emit({ type: 'live', chats: ids.map((id) => chat(id)) });
const view = (id: string) => send({ type: 'view', id });
const ids = () => getState().events.map((e) => e.id);
const seenPosts = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/sessions/seen'));

// Views c0..c(n-1) in turn, each settled with two rows.
function walk(n: number) {
  const all = Array.from({ length: n }, (_, i) => `c${i}`);
  live(...all);
  init('c0', rows('c0', 2));
  for (const c of all.slice(1)) {
    view(c);
    init(c, rows(c, 2));
  }
}

beforeEach(() => {
  switchedMac();
  connect();
  fetchMock.mockClear();
});

describe('session cache', () => {
  it('shows a chat cached rows on switching back, before its init', () => {
    live('a', 'b');
    init('a', rows('a', 3));
    view('b');
    expect(ids()).toEqual(['a0', 'a1', 'a2']);
    init('b', rows('b', 2));
    view('a');
    expect(ids()).toEqual(['a0', 'a1', 'a2']);
  });

  it('keeps identity of equal rows and takes the init events whole', () => {
    live('a', 'b');
    init('a', rows('a', 3));
    view('b');
    init('b', rows('b', 1));
    view('a');
    const cached = getState().events;
    init('a', [...rows('a', 3), ev('a3')]);
    expect(ids()).toEqual(['a0', 'a1', 'a2', 'a3']);
    expect(getState().events.slice(0, 3).every((e, i) => e === cached[i])).toBe(true);
  });

  it('loads no earlier page for cached rows before their init', async () => {
    live('a', 'b');
    init('a', rows('a', 3), 40);
    view('b');
    init('b', rows('b', 2));
    view('a');
    fetchMock.mockClear();
    expect(await loadEarlier()).toBe(false);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/chat/events'))).toBe(false);
    expect(ids()).toEqual(['a0', 'a1', 'a2']);
  });

  it('keeps 8 chats: the ninth stored evicts the first', () => {
    walk(10);
    view('c0');
    expect(ids()).toEqual(['c90', 'c91']);
    walk(10);
    view('c1');
    expect(ids()).toEqual(['c10', 'c11']);
  });

  it('stores the last 150 events with the rest counted as earlier', () => {
    live('a', 'b');
    init('a', rows('a', 400), 50);
    view('b');
    init('b', rows('b', 1));
    view('a');
    expect(getState().events).toHaveLength(ROW_WINDOW);
    expect(getState().earlier).toBe(300);
  });

  it('drops a chat that leaves live, and all of them on switchedMac', () => {
    walk(3);
    live('c0', 'c2');
    view('c1');
    expect(ids()).toEqual(['c20', 'c21']);
    init('c1', rows('c1', 1));
    view('c0');
    expect(ids()).toEqual(['c00', 'c01']);
    switchedMac();
    connect();
    live('c0', 'c1');
    init('c2', rows('c2', 1));
    view('c0');
    expect(ids()).toEqual(['c20']);
  });

  it('never stores one chat rows under another before init', () => {
    live('a', 'b', 'c');
    init('a', rows('a', 2));
    view('b');
    init('b', rows('b', 3));
    view('a');
    view('c');
    init('c', rows('c', 1));
    view('b');
    expect(ids()).toEqual(['b0', 'b1', 'b2']);
  });

  it('shows a live event before init without changing the cache', () => {
    live('a', 'b');
    init('a', rows('a', 2));
    view('b');
    init('b', rows('b', 1));
    view('a');
    emit({ type: 'event', event: ev('late') });
    expect(ids()).toEqual(['a0', 'a1', 'late']);
    view('b');
    expect(ids()).toEqual(['b0']);
    init('b', rows('b', 1));
    view('a');
    expect(ids()).toEqual(['a0', 'a1']);
  });

  it('stores a stale init under its own chat', () => {
    live('a', 'b', 'c');
    init('a', rows('a', 2));
    view('b');
    init('b', rows('b', 1));
    view('a');
    init('b', rows('b', 2));
    view('c');
    view('b');
    expect(ids()).toEqual(['b0', 'b1']);
  });
});

describe('markSeen', () => {
  it('clears at once with one POST and no GET', () => {
    live('a');
    view('a');
    expect(getState().seen['s-a']).toBeGreaterThan(0);
    expect(seenPosts()).toHaveLength(1);
    expect(seenPosts()[0][1]).toMatchObject({ method: 'POST' });
  });

  it('keeps the local time after a failed POST, also when a chat finishes', async () => {
    emit({ type: 'live', chats: [chat('a', true)] });
    init('a', rows('a', 1));
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('down')));
    emit({ type: 'live', chats: [chat('a')] });
    await Promise.resolve();
    expect(getState().seen['s-a']).toBeGreaterThan(0);
    expect(seenPosts()).toHaveLength(1);
  });

  it('sends a command to the chat it names, not the one on screen', () => {
    live('a', 'b');
    init('a', rows('a', 1));
    view('b');
    send({ type: 'retry' }, 'b');
    const cmds = fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/api/cmd'));
    expect(cmds[0]).toContain('chat=a');
    expect(cmds[1]).toContain('chat=b');
  });
});
