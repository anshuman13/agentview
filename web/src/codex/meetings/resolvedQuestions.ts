import { useEffect } from 'react';
import { apiUrl, fetchJson } from '../../app/api';
import { useStore } from '../../app/store';
import { createStore } from '../../ui/createStore';
import { save, storedStrings } from '../../ui/util';
import { showSnack } from '../view';

const RESOLVED = 'agentview.questionsResolved';
const RESOLVED_URL = '/api/questions/resolved';

const store = createStore<string[]>(storedStrings(RESOLVED));

const hold = (keys: string[]) => {
  save(RESOLVED, keys);
  store.set(keys);
};

const post = (key: string) => fetchJson(apiUrl(`${RESOLVED_URL}?key=${encodeURIComponent(key)}`), { method: 'POST' });

// The Mac holds the resolved keys so every device hides the same questions; localStorage is the offline copy.
// A load posts the keys held here that the Mac lacks, then holds both lists.
async function load() {
  const server = await fetchJson<string[]>(apiUrl(RESOLVED_URL)).catch(() => null);
  if (!server) return;
  await Promise.all(store.get().filter((k) => !server.includes(k)).map((k) => post(k).catch(() => null)));
  hold([...new Set([...server, ...store.get()])]);
}

// The resolved question keys; reloads from the Mac whenever the stream connects.
export function useResolvedQuestions() {
  const connected = useStore((s) => s.ui.connected);
  useEffect(() => void load(), [connected]);
  return store.use();
}

export function resolveQuestion(key: string) {
  hold([...new Set([...store.get(), key])]);
  post(key).catch(() => showSnack('Could not save. It may show again on other devices.'));
}
