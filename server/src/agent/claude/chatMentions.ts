import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loggedInAccounts, configDir } from './accounts.js';
import { CLAUDE_DIR } from './history.js';

const roots = () => [CLAUDE_DIR, ...loggedInAccounts().map(configDir).filter((d): d is string => !!d)].map((d) => path.join(d, 'projects'));

// A chat's transcript in any account's projects folder.
export function claudeTranscript(id: string, dirs = roots()) {
  for (const root of dirs.filter((d) => existsSync(d))) {
    for (const d of readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, d.name, `${id}.jsonl`);
      if (d.isDirectory() && existsSync(file)) return file;
    }
  }
  return null;
}
