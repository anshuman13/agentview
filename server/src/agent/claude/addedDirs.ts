import os from 'node:os';
import path from 'node:path';
import { jsonFile, readJsonSync } from '../../json.js';

// The folders added to each Claude session or Codex thread besides its own, by session id.
const FILE = path.join(os.homedir(), '.agentview', 'added-dirs.json');
const store = jsonFile<Record<string, string[]>>(FILE, {});

export const addedDirs = (sessionId: string | null | undefined): string[] => (sessionId ? readJsonSync<Record<string, string[]>>(FILE, {})[sessionId] ?? [] : []);

export const saveAddedDirs = (sessionId: string, dirs: string[]) =>
  store.update((map) => {
    const { [sessionId]: _, ...rest } = map;
    return dirs.length ? { ...rest, [sessionId]: dirs } : rest;
  });
