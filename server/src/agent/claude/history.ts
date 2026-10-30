import os from 'node:os';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
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

export const lastUuid = (msgs: SessionMessage[]) => msgs.filter((m) => m.type !== 'system').at(-1)?.uuid;
