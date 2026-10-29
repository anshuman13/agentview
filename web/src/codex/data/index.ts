import { useSyncExternalStore } from 'react';
import { bundled } from '../../app/api';
import { LocalStore, tauriInvoke } from './local';
import { RemoteStore } from './remote';
import type { AssistantStore } from './store';

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

export function useCodex() {
  const { store, snap } = useAssistant();
  return { store, pages: snap.pages, facts: snap.facts, meetings: snap.meetings, actions: snap.actions };
}
