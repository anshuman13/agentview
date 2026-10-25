import { useSyncExternalStore } from 'react';
import { bundled } from '../api';
import { LocalStore, tauriInvoke } from './local';
import { RemoteStore } from './remote';
import type { AssistantStore } from './store';

let store: AssistantStore | undefined;

export function assistantStore(): AssistantStore {
  // Only the app's own bundled page may call its commands; a Mac's page shown in the app goes through that Mac.
  const invoke = bundled ? tauriInvoke() : undefined;
  return (store ??= invoke ? new LocalStore(invoke) : new RemoteStore());
}

export function useAssistant() {
  const s = assistantStore();
  return { store: s, snap: useSyncExternalStore(s.subscribe, s.snapshot) };
}
