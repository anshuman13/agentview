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

type JournalAgent = { key: string; agentId: string; label: string; phase: string; status: 'running' | 'done' | 'failed' | 'stopped'; result: string };
export type WorkflowRun = { runId: string; agents: (JournalAgent & { msgs: SessionMessage[] })[] };
export type WorkflowFile = { sig: string; agents?: JournalAgent[]; msgs?: SessionMessage[]; ended?: boolean };

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
      if (a) Object.assign(a, { status: o.type === 'failed' || o.error ? 'failed' : 'done', result: typeof o.result === 'string' ? o.result : o.result && typeof o.result === 'object' ? JSON.stringify(o.result) : '' });
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
  const fresh = new Set<string>();
  const load = async (runId: string, file: string, read: (f: WorkflowFile) => Promise<void>) => {
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
    fresh.add(runId);
    return next;
  };
  const runs = await Promise.all(ids.map(async (runId) => {
    const dir = path.join(root, runId);
    const journal = await load(runId, path.join(dir, 'journal.jsonl'), async (f) => void (f.agents = parseJournal(await readFile(path.join(dir, 'journal.jsonl'), 'utf8'))));
    // The run's record appears beside the session once it ends; an agent a stopped run never closed in its journal ended with it.
    const record = path.join(projectDir(cwd), sessionId, 'workflows', `${runId}.json`);
    const run = await load(runId, record, async (f) => void (f.ended = JSON.parse(await readFile(record, 'utf8'))?.status !== 'running'));
    const agents = await Promise.all((journal?.agents ?? []).map(async (a) => {
      const file = path.join(dir, `agent-${a.agentId}.jsonl`);
      const t = await load(runId, file, async (f) => void (f.msgs = await readTranscriptFile(file, sessionId)));
      return { ...a, status: a.status === 'running' && run?.ended ? ('stopped' as const) : a.status, msgs: t?.msgs ?? [] };
    }));
    return { runId, agents };
  }));
  for (const f of cache.keys()) if (!seen.has(f)) (cache.delete(f), (changed = true));
  return { runs: runs.filter((r) => r.agents.length), changed, fresh };
}

export const workflowSize = (runs: WorkflowRun[]) => runs.reduce((n, r) => n + r.agents.reduce((m, a) => m + a.msgs.length + (a.status === 'running' ? 1 : 2), 0), 0);

// The SDK builds the conversation chain from the raw entries we already hold, so nothing is re-read from disk.
// The SDK drops everything before a parent the CLI never saved (a retry) or before a compaction boundary.
export async function sessionMessages(sessionId: string, cwd: string, entries: any[]) {
  const msgs = await getSessionMessages(sessionId, { dir: cwd, sessionStore: { load: async () => entries, append: async () => {} } });
  const first = msgs[0];
  const raw = entries.filter((e) => e?.uuid && !e.isSidechain);
  if (!first) return withNotices(msgs, raw, sessionId);
  const byId = new Map(raw.map((e) => [e.uuid, e]));
  let root = byId.get(first.uuid);
  while (root?.parentUuid && byId.has(root.parentUuid)) root = byId.get(root.parentUuid);
  if (!root?.parentUuid && root?.subtype !== 'compact_boundary') return withNotices(msgs, raw, sessionId);
  const before = raw.slice(0, raw.indexOf(root)).filter((e) => e.type === 'user' || e.type === 'assistant');
  // A compaction keeps its last messages, and the SDK lists them again after the boundary.
  const kept = new Set(before.map((e) => e.uuid));
  return withNotices([...before.map((e) => asMessage(e, sessionId, e.message)), ...msgs.filter((m) => !kept.has(m.uuid))], raw, sessionId);
}

const asMessage = (e: any, sessionId: string, message: unknown) =>
  ({ type: e.type === 'attachment' ? 'user' : e.type, uuid: e.uuid, session_id: sessionId, message, parent_tool_use_id: null, parent_agent_id: null, timestamp: e.timestamp }) as SessionMessage;

// The CLI saves a background agent's task notification as an attachment, which the SDK mostly leaves out; each goes back in after the nearest message it follows.
function withNotices(msgs: SessionMessage[], raw: any[], sessionId: string) {
  const listed = new Set(msgs.map((m) => m.uuid));
  const notices = raw.filter((e) => e.type === 'attachment' && !listed.has(e.uuid) && e.attachment?.type === 'queued_command' && String(e.attachment.prompt).startsWith('<task-notification>'));
  if (!notices.length) return msgs;
  const byId = new Map(raw.map((e) => [e.uuid, e]));
  const after = new Map<string, SessionMessage[]>();
  for (const e of notices) {
    let parent = byId.get(e.parentUuid);
    while (parent && !listed.has(parent.uuid)) parent = byId.get(parent.parentUuid);
    if (parent) after.set(parent.uuid, [...(after.get(parent.uuid) ?? []), asMessage(e, sessionId, { role: 'user', content: e.attachment.prompt })]);
  }
  return msgs.flatMap((m) => [m, ...(after.get(m.uuid) ?? [])]);
}

export const countAll = (subs: Record<string, SessionMessage[]>) => Object.values(subs).reduce((n, m) => n + m.length, 0);

export function lastUuid(msgs: SessionMessage[]) {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].type !== 'system') return msgs[i].uuid;
}
