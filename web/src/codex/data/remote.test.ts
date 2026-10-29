import { afterEach, describe, expect, it, vi } from 'vitest';

async function freshStore() {
  vi.resetModules();
  const { RemoteStore } = await import('./remote');
  return new RemoteStore();
}

function request(run: () => unknown, delay: number) {
  const req: Record<string, any> = {};
  setTimeout(() => {
    req.result = run();
    req.onsuccess?.();
  }, delay);
  return req;
}

function fakeIndexedDb(delays: number[]) {
  const stored = new Map<string, unknown>();
  const objectStore = {
    get: (key: string) => request(() => stored.get(key), 0),
    put: (value: unknown, key: string) => request(() => void stored.set(key, structuredClone(value)), delays.shift() ?? 0),
    delete: (key: string) => request(() => void stored.delete(key), 0),
  };
  const db = { transaction: () => ({ objectStore: () => objectStore }) };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const req: Record<string, any> = { result: db };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
  });
  return stored;
}

function fakeDom() {
  const listeners = { window: new Set(), document: new Set() };
  const target = (set: Set<unknown>) => ({ addEventListener: (_: string, fn: unknown) => set.add(fn), removeEventListener: (_: string, fn: unknown) => set.delete(fn) });
  vi.stubGlobal('window', target(listeners.window));
  vi.stubGlobal('document', { ...target(listeners.document), visibilityState: 'visible' });
  return listeners;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RemoteStore.dispose', () => {
  it('clears the sync interval and removes the global listeners', async () => {
    vi.useFakeTimers();
    fakeIndexedDb([]);
    const listeners = fakeDom();
    const store = await freshStore();
    expect(listeners.window.size + listeners.document.size).toBe(4);
    const running = vi.getTimerCount();
    store.dispose();
    expect(listeners.window.size + listeners.document.size).toBe(0);
    expect(vi.getTimerCount()).toBe(running - 1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

type Internal = { since: number; save(tables: string[]): void; flush(): void; saving: Promise<void>; tables: Record<string, Map<string, any>> };

const taskRow = (id: string) => ({ profile: 'work', id, version: 1, dirty: 0, updated_at: 1, field_times: '{}', title: id, status: 'open', deleted: 0 });

describe('RemoteStore save', () => {
  it('keeps the latest since when an earlier write is slower', async () => {
    const stored = fakeIndexedDb([30, 0]);
    fakeDom();
    const store = await freshStore();
    const internal = store as unknown as Internal;
    internal.since = 1;
    internal.save([]);
    internal.flush();
    await new Promise((r) => setTimeout(r, 5));
    internal.since = 2;
    internal.save([]);
    internal.flush();
    await internal.saving;
    expect((stored.get('meta') as { since: number }).since).toBe(2);
    store.dispose();
  });

  it('writes only the changed table', async () => {
    const stored = fakeIndexedDb([]);
    fakeDom();
    const store = await freshStore();
    const internal = store as unknown as Internal;
    await internal.saving;
    stored.clear();
    await store.capture('one', 'task', 'work');
    internal.flush();
    await internal.saving;
    expect([...stored.keys()].sort()).toEqual(['meta', 'table:items']);
    store.dispose();
  });

  it('writes a table once for rapid edits and flushes when the page hides', async () => {
    const stored = fakeIndexedDb([]);
    const puts: string[] = [];
    const set = stored.set.bind(stored);
    stored.set = (k, v) => (puts.push(k), set(k, v));
    fakeDom();
    const store = await freshStore();
    const internal = store as unknown as Internal & { loaded: Promise<void> };
    await internal.loaded;
    await internal.saving;
    puts.length = 0;
    const row = await store.capture('one', 'task', 'work');
    for (let i = 0; i < 9; i++) await store.update(row, { title: `t${i}` });
    expect(puts).toEqual([]);
    await new Promise((r) => setTimeout(r, 600));
    await internal.saving;
    expect(puts.filter((k) => k === 'table:items')).toHaveLength(1);
    expect((stored.get('table:items') as { title: string }[])[0].title).toBe('t8');
    await store.update(row, { title: 'last' });
    vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {}, visibilityState: 'hidden' });
    (internal as unknown as { onHide(): void }).onHide();
    await internal.saving;
    expect((stored.get('table:items') as { title: string }[])[0].title).toBe('last');
    store.dispose();
  });

  it('reads the old single-key layout once and migrates it', async () => {
    const stored = fakeIndexedDb([]);
    stored.set('snapshot', { since: 7, tables: { items: [taskRow('a')], meetings: [{ ...taskRow('m'), title: 'x' }] } });
    fakeDom();
    const store = await freshStore();
    const internal = store as unknown as Internal & { loaded: Promise<void> };
    await internal.loaded;
    await internal.saving;
    expect(store.snapshot().items.map((r) => r.id)).toEqual(['a']);
    expect(store.snapshot().meetings).toHaveLength(1);
    expect(stored.has('snapshot')).toBe(false);
    expect((stored.get('meta') as { since: number }).since).toBe(7);
    expect(stored.get('table:items')).toHaveLength(1);
    store.dispose();
  });
});

describe('RemoteStore refresh', () => {
  it('keeps the identity of unchanged tables after a task edit', async () => {
    fakeIndexedDb([]);
    fakeDom();
    const store = await freshStore();
    const internal = store as unknown as Internal & { loaded: Promise<void> };
    await internal.loaded;
    internal.tables.meetings.set('work:m', { ...taskRow('m'), transcript: 'x' });
    internal.tables.facts.set('work:f', taskRow('f'));
    await (store as any).refresh(['meetings', 'facts']);
    const before = store.snapshot();
    const row = await store.capture('one', 'task', 'work');
    await store.update(row, { title: 'two' });
    const after = store.snapshot();
    expect(after.items).not.toBe(before.items);
    expect(after.items[0].title).toBe('two');
    expect(after.meetings).toBe(before.meetings);
    expect(after.facts).toBe(before.facts);
    store.dispose();
  });
});
