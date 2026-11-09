import os from 'node:os';
import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { readJson } from '../../json.js';
import { getSessionMessages, getSubagentMessages, type SessionMessage } from '@anthropic-ai/claude-agent-sdk';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

export const projectDir = (cwd: string) => path.join(CLAUDE_DIR, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));

export type SubFile = { sig: string; toolUseId: string; msgs: SessionMessage[] };

// Re-reads only the subagent transcripts whose file changed since the last call.
export async function subagentMessages(cwd: string, sessionId: string, cache = new Map<string, SubFile>()) {
  const dir = path.join(projectDir(cwd), sessionId, 'subagents');
  const metas = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.meta.json'));
  let changed = false;
  await Promise.all(metas.map(async (f) => {
    const agentId = f.slice('agent-'.length, -'.meta.json'.length);
    const st = await stat(path.join(dir, `agent-${agentId}.jsonl`)).catch(() => null);
    const sig = st ? `${st.ino}:${st.size}:${st.mtimeMs}` : 'missing';
    const prev = cache.get(f);
    if (prev && prev.sig === sig) return;
    const toolUseId = prev?.toolUseId ?? (await readJson<any>(path.join(dir, f), null))?.toolUseId;
    if (!toolUseId) return;
    let ok = true;
    const msgs = await getSubagentMessages(sessionId, agentId, { dir: cwd }).catch(() => ((ok = false), []));
    cache.set(f, { sig: ok ? sig : '', toolUseId, msgs });
    changed = true;
  }));
  for (const f of cache.keys()) if (!metas.includes(f)) (cache.delete(f), (changed = true));
  const subs: Record<string, SessionMessage[]> = {};
  for (const { toolUseId, msgs } of cache.values()) subs[toolUseId] = msgs;
  return { subs, changed };
}

type JournalAgent = { key: string; agentId: string; label: string; phase: string; status: 'running' | 'done' | 'failed'; result: string };
export type WorkflowRun = { runId: string; agents: (JournalAgent & { msgs: SessionMessage[] })[] };
export type WorkflowFile = { sig: string; agents?: JournalAgent[]; msgs?: SessionMessage[] };

export function parseJournal(text: string): JournalAgent[] {
  const agents = new Map<string, JournalAgent>();
  for (const line of text.split('\n')) {
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o?.type === 'started' && o.key && o.agentId) agents.set(o.key, { key: o.key, agentId: o.agentId, label: String(o.label ?? ''), phase: String(o.phase ?? ''), status: 'running', result: '' });
    else if (o?.type === 'result' || o?.type === 'failed') {
      const a = agents.get(o.key);
      if (a) Object.assign(a, { status: o.type === 'failed' || o.error ? 'failed' : 'done', result: typeof o.result === 'string' ? o.result : '' });
    }
  }
  return [...agents.values()];
}

const fileSig = async (file: string) => {
  const st = await stat(file).catch(() => null);
  return st ? `${st.ino}:${st.size}:${st.mtimeMs}` : null;
};

async function readTranscriptFile(file: string, sessionId: string) {
  const text = await readFile(file, 'utf8');
  const msgs: SessionMessage[] = [];
  for (const line of text.split('\n')) {
    try {
      const e = JSON.parse(line);
      if (e?.type === 'user' || e?.type === 'assistant') msgs.push({ type: e.type, uuid: e.uuid, session_id: sessionId, message: e.message, parent_tool_use_id: null, parent_agent_id: null, timestamp: e.timestamp } as SessionMessage);
    } catch {}
  }
  return msgs;
}

// Workflow agents write a journal and one transcript each; the SDK does not read these, so they are parsed here.
export async function workflowAgents(cwd: string, sessionId: string, cache = new Map<string, WorkflowFile>()) {
  const root = path.join(projectDir(cwd), sessionId, 'subagents', 'workflows');
  const ids = (await readdir(root).catch(() => [] as string[])).filter((d) => d.startsWith('wf_'));
  const seen = new Set<string>();
  let changed = false;
  const load = async (file: string, read: (f: WorkflowFile) => Promise<void>) => {
    seen.add(file);
    const sig = await fileSig(file);
    const prev = cache.get(file);
    if (sig === null || prev?.sig === sig) return prev;
    const next: WorkflowFile = { sig };
    try {
      await read(next);
    } catch {
      next.sig = '';
    }
    cache.set(file, next);
    changed = true;
    return next;
  };
  const runs = await Promise.all(ids.map(async (runId) => {
    const dir = path.join(root, runId);
    const journal = await load(path.join(dir, 'journal.jsonl'), async (f) => void (f.agents = parseJournal(await readFile(path.join(dir, 'journal.jsonl'), 'utf8'))));
    const agents = await Promise.all((journal?.agents ?? []).map(async (a) => {
      const file = path.join(dir, `agent-${a.agentId}.jsonl`);
      const t = await load(file, async (f) => void (f.msgs = await readTranscriptFile(file, sessionId)));
      return { ...a, msgs: t?.msgs ?? [] };
    }));
    return { runId, agents };
  }));
  for (const f of cache.keys()) if (!seen.has(f)) (cache.delete(f), (changed = true));
  return { runs: runs.filter((r) => r.agents.length), changed };
}

export const workflowSize = (runs: WorkflowRun[]) => runs.reduce((n, r) => n + r.agents.reduce((m, a) => m + a.msgs.length + (a.status === 'running' ? 1 : 2), 0), 0);

// The SDK builds the conversation chain from the raw entries we already hold, so nothing is re-read from disk.
// A retry message can point at a parent the CLI never saved; the SDK then drops everything before it.
export async function sessionMessages(sessionId: string, cwd: string, entries: any[]) {
  const msgs = await getSessionMessages(sessionId, { dir: cwd, sessionStore: { load: async () => entries, append: async () => {} } });
  const first = msgs[0];
  if (!first) return msgs;
  const raw = entries.filter((e) => e?.uuid && !e.isSidechain);
  const byId = new Map(raw.map((e) => [e.uuid, e]));
  let root = byId.get(first.uuid);
  while (root?.parentUuid && byId.has(root.parentUuid)) root = byId.get(root.parentUuid);
  if (!root?.parentUuid) return msgs;
  const before = raw.slice(0, raw.indexOf(root)).filter((e) => e.type === 'user' || e.type === 'assistant');
  return [...before.map((e) => ({ type: e.type, uuid: e.uuid, session_id: sessionId, message: e.message, parent_tool_use_id: null, parent_agent_id: null, timestamp: e.timestamp }) as SessionMessage), ...msgs];
}

export const countAll = (subs: Record<string, SessionMessage[]>) => Object.values(subs).reduce((n, m) => n + m.length, 0);

export function lastUuid(msgs: SessionMessage[]) {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].type !== 'system') return msgs[i].uuid;
}
