import os from 'node:os';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { configDir, isLimited, markLimited, overageUntil } from '../../server/src/agent/claude/accounts.js';
import { PROFILES, type Profile } from './calendar.js';
import { dueAt } from './transcripts.js';

const Found = z.object({
  title: z.string().describe('Short imperative task in the language it was written in, e.g. "Call the bank about the card"'),
  details: z.string().nullable().describe('Names, numbers, links or context from the text that do not fit the title, else null'),
  due: z.string().nullable().describe('YYYY-MM-DD when a day was said, YYYY-MM-DDTHH:MM in local time when a time or part of day was said (morning 09:00, afternoon 14:00, evening 19:00), else null'),
});
type Found = z.infer<typeof Found>;
export type Parsed = { title: string; details: string | null; at: number | null };

// The model's due string as a time; a due time already past counts as none.
export function toParsed(text: string, f: Found | undefined, now = Date.now()): Parsed {
  const due = dueAt(f?.due ?? null);
  return {
    title: f?.title.trim().slice(0, 120) || text.slice(0, 120),
    details: f?.details?.trim() || null,
    at: Number.isFinite(due) && due > now ? due : null,
  };
}

// One Haiku call while I add a task: a clear title, the leftover detail, and when it is due if I said so.
export async function parseTask(profile: Profile, text: string, now = Date.now()): Promise<Parsed> {
  if (isLimited(PROFILES[profile])) throw new Error('The Claude account is at its usage limit');
  let found: Found | undefined;
  const save = tool('save_task', 'Save the task.', Found.shape, async (a) => {
    found = a;
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  const dir = configDir(PROFILES[profile]);
  const d = new Date(now);
  const prompt = [
    `Now is ${d.toLocaleString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}, time zone ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`,
    'I typed or dictated this task quickly. Call save_task once with a clear title, any leftover details, and when it is due if the text says so.',
    'A weekday, with or without "next", means the first one after today.',
    'Fix dictation errors, keep every fact, and do not invent anything. Do not use the em dash character.',
    `Text: ${JSON.stringify(text)}`,
  ].join('\n');
  for await (const m of query({
    prompt,
    options: {
      persistSession: false,
      model: 'haiku',
      systemPrompt: 'You turn quick notes into clear tasks.',
      maxTurns: 3,
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
    if (m.type === 'result' && m.subtype !== 'success') throw new Error(`Parse ended with ${m.subtype}`);
  }
  return toParsed(text, found, now);
}
