import os from 'node:os';
import path from 'node:path';
import { jsonFile } from '../../json.js';

export type Summaries = Record<string, { text: string; at: number }>;

const store = jsonFile<Summaries>(path.join(os.homedir(), '.agentview', 'summaries.json'), {});

export const readSummaries = () => store.read();

export const mergeSummaries = (cur: Summaries, found: Summaries): Summaries => (Object.keys(found).length ? { ...cur, ...found } : cur);

export const saveSummaries = (found: Summaries) => store.update((cur) => mergeSummaries(cur, found));
