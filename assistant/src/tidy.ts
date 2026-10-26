import type { Database } from 'bun:sqlite';
import os from 'node:os';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { configDir, isLimited, markLimited, overageUntil } from '../../server/src/agent/claude/accounts.js';
import { PROFILES, type Profile } from './calendar.js';
import { applyChanges, type Change } from './sync.js';
import { dueAt } from './transcripts.js';

const DAY = 24 * 60 * 60_000;

const Tidied = z.object({
  id: z.string(),
  title: z.string().describe('Short imperative task in the language it was written in, e.g. "Call the bank about the card"'),
  details: z.string().nullable().describe('Names, numbers, links or context from the text that do not fit the title, else null'),
  due: z.string().nullable().describe('YYYY-MM-DD when a day was said, YYYY-MM-DDTHH:MM in local time when a time or part of day was said (morning 09:00, afternoon 14:00, evening 19:00), else null'),
});
type Tidy = z.infer<typeof Tidied>;
type Capture = { id: string; profile: Profile; title: string | null; text: string | null; at: number | null };

const key = (c: { profile: string; id: string }) => `tidy:${c.profile}:${c.id}`;

// Tasks typed or spoken in the last day that are not tidied yet and that I have not edited since.
export function pendingCaptures(db: Database, profile: Profile, now = Date.now()): Capture[] {
  const rows = db.prepare(
    `SELECT id, profile, title, text, at FROM items WHERE profile = ? AND deleted = 0 AND source = 'capture' AND status = 'open'
     AND CAST(json_extract(field_times, '$.source') AS INTEGER) > ? AND json_extract(field_times, '$.title') = json_extract(field_times, '$.source')`,
  ).all(profile, now - DAY) as Capture[];
  const done = db.prepare('SELECT 1 FROM meta WHERE key = ?');
  return rows.filter((c) => !done.get(key(c)));
}

// A clearer title, the leftover detail, and a due time only when the app found none; a later edit of mine wins.
export function saveTidied(db: Database, profile: Profile, captures: Capture[], found: Tidy[], now = Date.now()) {
  const changes: Change[] = [];
  for (const c of captures) {
    const t = found.find((f) => f.id === c.id);
    if (!t) continue;
    const fields: Record<string, string | number> = {};
    if (t.title.trim() && t.title.trim() !== c.title) fields.title = t.title.trim().slice(0, 120);
    if (t.details?.trim() && !c.text) fields.text = t.details.trim();
    const due = dueAt(t.due);
    if (c.at == null && Number.isFinite(due) && due > now) fields.at = due;
    if (Object.keys(fields).length) changes.push({ table: 'items', id: c.id, profile, updated_at: now, fields });
  }
  const mark = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  for (const c of captures) mark.run(key(c), String(now));
  return applyChanges(db, changes).applied;
}

async function tidy(profile: Profile, captures: Capture[], now: number) {
  const found: Tidy[] = [];
  const save = tool('save_task', 'Save the tidied task.', Tidied.shape, async (a) => {
    found.push(a);
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  const dir = configDir(PROFILES[profile]);
  const d = new Date(now);
  const prompt = [
    `Now is ${d.toLocaleString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}, time zone ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`,
    'I typed or dictated these tasks quickly. For each one call save_task once with a clear title, any leftover details, and when it is due if the text says so.',
    'A weekday, with or without "next", means the first one after today.',
    'Fix dictation errors, keep every fact, and do not invent anything. Do not use the em dash character.',
    ...captures.map((c) => `- id ${c.id}: ${JSON.stringify([c.title, c.text].filter(Boolean).join('\n'))}`),
  ].join('\n');
  for await (const m of query({
    prompt,
    options: {
      model: 'sonnet',
      effort: 'low',
      maxTurns: 2 + captures.length,
      cwd: os.tmpdir(),
      settingSources: [],
      tools: [],
      env: { ...process.env, ...(dir && { CLAUDE_CONFIG_DIR: dir }) },
      mcpServers: { codex: createSdkMcpServer({ name: 'codex', tools: [save] }) },
      allowedTools: ['mcp__codex__save_task'],
      permissionMode: 'dontAsk',
    },
  })) {
    const until = overageUntil(m);
    if (until) {
      markLimited(PROFILES[profile], until);
      throw new Error('Stopped before using extra usage');
    }
    if (m.type === 'result' && m.subtype !== 'success') throw new Error(`Tidy ended with ${m.subtype}`);
  }
  return found;
}

export function startTidy(db: () => Database, every = 15_000) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    for (const profile of Object.keys(PROFILES) as Profile[]) {
      const captures = pendingCaptures(db(), profile);
      if (!captures.length || isLimited(PROFILES[profile])) continue;
      try {
        const now = Date.now();
        saveTidied(db(), profile, captures, await tidy(profile, captures, now), Date.now());
      } catch (err) {
        saveTidied(db(), profile, captures, []);
        console.error(`tidy ${profile}:`, err instanceof Error ? err.message : err);
      }
    }
    busy = false;
  };
  setInterval(run, every).unref();
}
