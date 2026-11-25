import { readFile, stat } from 'node:fs/promises';
import type { ChatEvent } from '../../../../shared/protocol.js';
import { claudeTranscript } from './chatMentions.js';
import { sessionMessages, subagentMessages, workflowAgents } from './history.js';
import { historyFrom, toolResultText } from './transcript.js';

const COMMIT = /^\[[^\]\s]+(?: \([^)]*\))? ([0-9a-f]{7,40})\] (.+)$/m;

async function entries(id: string) {
  const file = claudeTranscript(id);
  if (!file) return null;
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text === null) return null;
  return text.split('\n').flatMap((l) => {
    try {
      return l ? [JSON.parse(l)] : [];
    } catch {
      return [];
    }
  });
}

// A saved chat's events, read from its transcript without starting the CLI.
export async function savedEvents(id: string): Promise<ChatEvent[] | null> {
  const raw = await entries(id);
  if (!raw) return null;
  const cwd = raw.find((e) => typeof e?.cwd === 'string')?.cwd ?? '';
  const [msgs, sub, wf] = await Promise.all([sessionMessages(id, cwd, raw), subagentMessages(cwd, id), workflowAgents(cwd, id)]);
  return historyFrom(msgs, sub.subs, wf.runs).events;
}

type Commit = { hash: string; subject: string };
const commits = new Map<string, { sig: string; commit: Commit | null }>();

// The first commit the chat made. Kept until the transcript changes.
export async function firstCommit(id: string) {
  const file = claudeTranscript(id);
  const sig = file ? await stat(file).then((s) => `${s.size}:${s.mtimeMs}`, () => '') : '';
  if (!sig) return null;
  const hit = commits.get(id);
  if (hit?.sig === sig) return hit.commit;
  const commit = commitIn((await entries(id)) ?? []);
  commits.set(id, { sig, commit });
  return commit;
}

// A Bash step that ran git commit: its result holds the `[branch abc1234] subject` line git prints, or with -q the
// `abc1234 subject` line of a git log --oneline after it.
const ONELINE = /^([0-9a-f]{7,40}) (.+)$/m;

export function commitIn(raw: any[]): Commit | null {
  const commits = new Set<string>();
  for (const e of raw) {
    if (!Array.isArray(e?.message?.content)) continue;
    for (const b of e.message.content) {
      if (e.type === 'assistant' && b?.type === 'tool_use' && /\bgit\b[^\n]*\bcommit\b/.test(String(b.input?.command ?? ''))) commits.add(b.id);
      if (e.type !== 'user' || b?.type !== 'tool_result' || !commits.has(b.tool_use_id) || b.is_error) continue;
      const text = toolResultText(b);
      const m = text.match(COMMIT) ?? text.match(ONELINE);
      if (m) return { hash: m[1].slice(0, 7), subject: m[2].trim() };
    }
  }
  return null;
}
