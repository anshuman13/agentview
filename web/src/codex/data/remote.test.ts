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
    put: (value: unknown, key: string) => request(() => void stored.set(key, value), delays.shift() ?? 0),
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
    expect(listeners.window.size + listeners.document.size).toBe(2);
    const running = vi.getTimerCount();
    store.dispose();
    expect(listeners.window.size + listeners.document.size).toBe(0);
    expect(vi.getTimerCount()).toBe(running - 1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('RemoteStore save', () => {
  it('keeps the latest snapshot when an earlier write is slower', async () => {
    const stored = fakeIndexedDb([30, 0]);
    fakeDom();
    const store = await freshStore();
    const internal = store as unknown as { since: number; save(): void; saving: Promise<void> };
    internal.since = 1;
    internal.save();
    await new Promise((r) => setTimeout(r, 5));
    internal.since = 2;
    internal.save();
    await internal.saving;
    expect((stored.get('snapshot') as { since: number }).since).toBe(2);
    store.dispose();
  });
});
