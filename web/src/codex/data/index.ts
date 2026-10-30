import { useCallback, useRef, useSyncExternalStore } from 'react';
import { isBlock } from '../../../../shared/util';
import { bundled } from '../../app/api';
import { LocalStore, tauriInvoke } from './local';
import { RemoteStore } from './remote';
import type { AssistantStore, Snapshot } from './store';

let store: AssistantStore | undefined;

export function assistantStore(): AssistantStore {
  // Only the app's own bundled page may call its commands; a Mac's page shown in the app goes through that Mac.
  const invoke = bundled ? tauriInvoke() : undefined;
  return (store ??= invoke ? new LocalStore(invoke) : new RemoteStore());
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (store instanceof RemoteStore) store.dispose();
    store = undefined;
  });
}

export function useAssistant() {
  const s = assistantStore();
  return { store: s, snap: useSyncExternalStore(s.subscribe, s.snapshot) };
}

export function useAssistantStore() {
  return assistantStore();
}

export function useAssistantSelect<T>(select: (snap: Snapshot) => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const s = assistantStore();
  const last = useRef<{ snap: Snapshot; value: T } | undefined>(undefined);
  const get = useCallback(() => {
    const snap = s.snapshot();
    if (last.current?.snap === snap) return last.current.value;
    const value = select(snap);
    const keep = last.current && eq(last.current.value, value);
    last.current = { snap, value: keep ? last.current!.value : value };
    return last.current.value;
  }, [s, select, eq]);
  return useSyncExternalStore(s.subscribe, get);
}

const shallowEqual = <T extends object>(a: T, b: T) => {
  const ka = Object.keys(a) as (keyof T)[];
  return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k], b[k]));
};

const selectData = ({ sync: _sync, ...data }: Snapshot) => data;

// The snapshot without sync status, so a sync tick that changes no data re-renders nobody.
export function useAssistantData() {
  return useAssistantSelect(selectData, shallowEqual);
}

const selectSync = (snap: Snapshot) => snap.sync;

export function useSyncStatus() {
  return useAssistantSelect(selectSync);
}

// Meetings without time blocks, filtered once per meetings array for every caller.
const withoutBlocks = new WeakMap<Snapshot['meetings'], Snapshot['meetings']>();
const codexMeetings = (all: Snapshot['meetings']) => {
  let out = withoutBlocks.get(all);
  if (!out) withoutBlocks.set(all, (out = all.filter((m) => !isBlock(m.id))));
  return out;
};

export function useCodex() {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const meetings = codexMeetings(snap.meetings);
  return { store, pages: snap.pages, facts: snap.facts, meetings, actions: snap.actions };
}
