import os from 'node:os';
import path from 'node:path';
import { sectionName, type Sections } from '../../../shared/sections.js';
import { jsonFile } from '../json.js';

const store = jsonFile<Sections>(path.join(os.homedir(), '.agentview', 'sections.json'), {});

export const listSections = () => store.read();

// Moves chat id to the named section, or out of its section when name is empty.
export const setSection = (id: string, name: string) =>
  store.update((s) => {
    const n = sectionName(name);
    if (n) return s[id] === n ? s : { ...s, [id]: n };
    if (!s[id]) return s;
    const { [id]: _, ...rest } = s;
    return rest;
  });
