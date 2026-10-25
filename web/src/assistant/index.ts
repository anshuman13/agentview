import { useMemo, useSyncExternalStore } from 'react';
import { bundled } from '../api';
import { LocalStore, tauriInvoke } from './local';
import { RemoteStore } from './remote';
import { sampleWiki } from './sample';
import type { AssistantStore, Snapshot } from './store';
import type { Common, Table, Tables } from './wiki';

let store: AssistantStore | undefined;

export function assistantStore(): AssistantStore {
  // Only the app's own bundled page may call its commands; a Mac's page shown in the app goes through that Mac.
  const invoke = bundled ? tauriInvoke() : undefined;
  return (store ??= invoke ? new LocalStore(invoke) : new RemoteStore());
}

// The preview page swaps in an in-memory store before the first render.
export const setAssistantStore = (s: AssistantStore) => void (store = s);

export function useAssistant() {
  const s = assistantStore();
  return { store: s, snap: useSyncExternalStore(s.subscribe, s.snapshot) };
}

const overlay = <T extends Common>(base: T[], mine: T[]) => {
  const key = (r: T) => `${r.profile}:${r.id}`;
  const edits = new Map(mine.map((r) => [key(r), r]));
  return [...base.map((r) => edits.get(key(r)) ?? r), ...mine.filter((r) => !base.some((b) => key(b) === key(r)))];
};

// Wiki and meeting rows; until the hub has any pages, sample data shows with edits kept on top.
export function withSample(snap: Snapshot): { [K in Table]: Tables[K][] } & { sample: boolean } {
  if (snap.pages.length) return { pages: snap.pages, facts: snap.facts, meetings: snap.meetings, actions: snap.actions, sample: false };
  const s = sampleWiki();
  return { pages: overlay(s.pages, snap.pages), facts: overlay(s.facts, snap.facts), meetings: overlay(s.meetings, snap.meetings), actions: overlay(s.actions, snap.actions), sample: true };
}

export function useCodex() {
  const { store, snap } = useAssistant();
  const data = useMemo(() => withSample(snap), [snap.pages, snap.facts, snap.meetings, snap.actions]);
  return { store, ...data };
}
