import os from 'node:os';
import path from 'node:path';
import { nestLoops, type Nests } from '../../../shared/nest.js';
import { jsonFile } from '../json.js';

const store = jsonFile<Nests>(path.join(os.homedir(), '.agentview', 'nested.json'), {});

export const listNests = () => store.read();

// Nests child under parent, or un-nests it when parent is empty. Refuses a nest that would loop.
export async function setNest(child: string, parent: string) {
  let ok = true;
  await store.update((n) => {
    if (!parent) {
      if (!n[child]) return n;
      const { [child]: _, ...rest } = n;
      return rest;
    }
    if (nestLoops(n, child, parent)) return (ok = false), n;
    return { ...n, [child]: parent };
  });
  return ok;
}
