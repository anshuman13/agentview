import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Finding, ReviewFindings } from '../../shared/protocol.js';

const FILE = path.join(process.env.AGENTVIEW_FINDINGS_DIR ?? path.join(os.homedir(), '.agentview'), 'findings.json');

type Stored = Record<string, Record<string, { at: number; findings: Finding[]; dismissed: string[] }>>;

let cache: Stored | null = null;

async function load(): Promise<Stored> {
  if (cache) return cache;
  cache = await readFile(FILE, 'utf8').then(JSON.parse).catch(() => ({}));
  return cache!;
}

async function save() {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(cache ?? {}, null, 2));
}

export const findingKey = (f: Finding) => `${f.file}:${f.line}:${f.summary.slice(0, 60)}`;

// The target is a PR number or "local" for the working tree.
export const reviewTarget = (prompt: string) => {
  const m = /^\/code-review\b\s*(\d+)?/.exec(prompt.trim());
  return m ? m[1] ?? 'local' : null;
};

export function parseFindings(input: unknown): Finding[] {
  const list = (input as { findings?: unknown })?.findings;
  if (!Array.isArray(list)) return [];
  return list
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
    .map((f) => ({
      file: String(f.file ?? ''),
      line: Number(f.line) || 1,
      summary: String(f.summary ?? f.short_summary ?? ''),
      ...(typeof f.failure_scenario === 'string' && { failure: f.failure_scenario }),
      ...(typeof f.category === 'string' && { category: f.category }),
      ...(typeof f.verdict === 'string' && { verdict: f.verdict }),
    }))
    .filter((f) => f.file && f.summary);
}

export async function saveFindings(repo: string, target: string, findings: Finding[]): Promise<ReviewFindings> {
  const all = await load();
  const dismissed = all[repo]?.[target]?.dismissed ?? [];
  (all[repo] ??= {})[target] = { at: Date.now(), findings, dismissed };
  await save();
  return view(repo, target, all[repo][target]);
}

export async function getFindings(repo: string, target: string): Promise<ReviewFindings | null> {
  const r = (await load())[repo]?.[target];
  return r ? view(repo, target, r) : null;
}

export async function dismissFinding(repo: string, target: string, key: string): Promise<ReviewFindings | null> {
  const r = (await load())[repo]?.[target];
  if (!r) return null;
  if (!r.dismissed.includes(key)) r.dismissed.push(key);
  await save();
  return view(repo, target, r);
}

const view = (repo: string, target: string, r: Stored[string][string]): ReviewFindings => ({ repo, target, at: r.at, findings: r.findings.filter((f) => !r.dismissed.includes(findingKey(f))) });

export const resetFindingsForTest = () => (cache = {});
