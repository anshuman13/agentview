import { useSyncExternalStore } from 'react';
import { LocalStore, tauriInvoke } from './local';
import { RemoteStore } from './remote';
import type { AssistantStore } from './store';

let store: AssistantStore | undefined;

export function assistantStore(): AssistantStore {
  const invoke = tauriInvoke();
  return (store ??= invoke ? new LocalStore(invoke) : new RemoteStore());
}

export function useAssistant() {
  const s = assistantStore();
  return { store: s, snap: useSyncExternalStore(s.subscribe, s.snapshot) };
}
