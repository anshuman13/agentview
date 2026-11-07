import { useSyncExternalStore } from 'react';

export function createStore<T>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  const get = () => state;
  const set = (next: T) => {
    if (Object.is(next, state)) return;
    state = next;
    subs.forEach((l) => l());
  };
  const patch = (partial: Partial<T>) => {
    const keys = Object.keys(partial) as (keyof T)[];
    if (keys.every((k) => Object.is(state[k], partial[k]))) return;
    set({ ...state, ...partial });
  };
  const subscribe = (l: () => void) => (subs.add(l), () => void subs.delete(l));
  function use(): T;
  function use<S>(select: (s: T) => S): S;
  function use(select?: (s: T) => unknown) {
    return useSyncExternalStore(subscribe, select ? () => select(state) : get);
  }
  return { get, set, patch, use, subscribe };
}
