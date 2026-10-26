import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { configDir, isLimited, markLimited, overageUntil } from '../../server/src/agent/claude/accounts.js';
import { PROFILES, type Profile } from './calendar.js';
import { applyChanges, type Change } from './sync.js';

const MIN = 60_000;
const WITHIN = 24 * 60 * MIN;
const TRIES = 4;
const RETRY = 20 * MIN;
const CHUNK = 30_000;

const Notes = z.object({
  id: z.string().describe('The meeting id from the list'),
  summary: z.string().describe('3-6 plain sentences: what was decided and what happens next'),
  doc_url: z.string().describe('Link to the doc that holds the transcript'),
  my_actions: z
    .array(z.object({
      title: z.string().describe('Short imperative task, e.g. "Send the rollout slides to Kim"'),
      context: z.string().describe('One sentence from the meeting on why, with who asked'),
      due: z.string().nullable().describe('ISO date or date-time when a deadline was said, else null'),
    }))
    .describe('Only things I (the calendar owner) agreed or was asked to do; empty when there are none'),
});
export type MeetingNotes = z.infer<typeof Notes>;

type Pending = { id: string; title: string; starts_at: number; ends_at: number };

const tried = (profile: Profile, id: string) => `transcript:${profile}:${id}`;

// Calendar meetings without a summary that ended in the last day, tried at most TRIES times, RETRY apart.
export function dueMeetings(db: Database, profile: Profile, now = Date.now()): Pending[] {
  const get = db.prepare('SELECT value FROM meta WHERE key = ?');
  const rows = db.prepare(
    "SELECT id, title, starts_at, ends_at FROM meetings WHERE profile = ? AND deleted = 0 AND id LIKE 'cal:%' AND (summary IS NULL OR summary = '') AND ends_at <= ? AND ends_at >= ? ORDER BY ends_at",
  ).all(profile, now, now - WITHIN) as Pending[];
  return rows.filter((m) => {
    const [count, last] = ((get.get(tried(profile, m.id)) as { value: string } | null)?.value ?? '0,0').split(',').map(Number);
    return count < TRIES && now - last >= RETRY;
  });
}

export function markTried(db: Database, profile: Profile, meetings: Pending[], now = Date.now()) {
  const get = db.prepare('SELECT value FROM meta WHERE key = ?');
  const set = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  for (const m of meetings) {
    const count = Number((get.get(tried(profile, m.id)) as { value: string } | null)?.value.split(',')[0] ?? 0);
    set.run(tried(profile, m.id), `${count + 1},${now}`);
  }
}

export const actionId = (meeting: string, title: string) => `meet:${createHash('sha1').update(`${meeting}\n${title.trim().toLowerCase()}`).digest('hex').slice(0, 16)}`;

// Writes the summary, and adds my action items as open tasks. Meeting notes are only ever what I type.
// A task that already exists is left alone, so one I finished or deleted does not come back.
export function saveNotes(db: Database, profile: Profile, found: MeetingNotes[], now = Date.now()) {
  const row = db.prepare('SELECT title FROM meetings WHERE profile = ? AND id = ? AND deleted = 0');
  const has = db.prepare('SELECT 1 FROM items WHERE profile = ? AND id = ?');
  const changes: Change[] = [];
  for (const n of found) {
    const m = row.get(profile, n.id) as { title: string | null } | null;
    if (!m || !n.summary.trim()) continue;
    changes.push({ table: 'meetings', id: n.id, profile, updated_at: now, fields: { summary: n.summary.trim() } });
    for (const a of n.my_actions) {
      const id = actionId(n.id, a.title);
      if (!a.title.trim() || has.get(profile, id)) continue;
      const due = a.due ? Date.parse(a.due) : NaN;
      changes.push({
        table: 'items', id, profile, updated_at: now,
        fields: { title: a.title.trim(), text: a.context.trim() || null, source: 'meeting', source_url: n.doc_url || null, people: m.title, at: Number.isFinite(due) ? due : null, status: 'open' },
      });
    }
  }
  return applyChanges(db, changes).applied;
}

// Large tool outputs are saved under the config dir's tool-results folders; this reads the text back in chunks.
export function readSaved(root: string, file: string, offset = 0) {
  const real = fs.realpathSync(path.resolve(file));
  const projects = fs.realpathSync(path.join(root, 'projects'));
  if (!real.startsWith(projects + path.sep) || !real.split(path.sep).includes('tool-results')) throw new Error('Only saved tool outputs can be read');
  const raw = fs.readFileSync(real, 'utf8');
  let text = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.fileContent === 'string') text = parsed.fileContent;
  } catch {}
  const end = Math.min(text.length, offset + CHUNK);
  return `${text.slice(offset, end)}\n[characters ${offset}-${end} of ${text.length}]`;
}

// Asks Claude to read the Gemini notes attached to each meeting's event and saves what it finds.
async function readTranscripts(db: Database, profile: Profile, meetings: Pending[], now: number) {
  const found: MeetingNotes[] = [];
  const save = tool('save_meeting_notes', 'Save the summary, decisions and notes for one meeting.', Notes.shape, async (a) => {
    found.push(a);
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  if (isLimited(PROFILES[profile])) throw new Error('The Claude account is at its usage limit');
  const dir = configDir(PROFILES[profile]);
  const saved = tool('read_saved_output', 'Read a tool output that was too large and was saved to a file, 30000 characters at a time.', { path: z.string(), offset: z.number().int().min(0).optional() }, async (a) => {
    try {
      return { content: [{ type: 'text', text: readSaved(dir ?? path.join(os.homedir(), '.claude'), a.path, a.offset) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true };
    }
  });
  const prompt = [
    'These meetings on my primary Google Calendar have ended:',
    ...meetings.map((m) => `- id ${m.id}, Google Calendar event id ${m.id.slice(4)}: "${m.title}" ${new Date(m.starts_at).toISOString()} to ${new Date(m.ends_at).toISOString()}`),
    '',
    'For each one, get the event and find the attached Google Doc with the meeting transcript (Gemini attaches it as "Notes by Gemini", "Notater fra Gemini" or similar). Read it with the Google Drive read_file_content tool (the Google Docs read_doc tool also works).',
    'If the output is saved to a file because it is large, read that file with read_saved_output, all of it.',
    'Work from the transcript only. Ignore the summary, notes, details and next steps Gemini wrote at the top of the doc; do not copy or rely on them.',
    'I am the calendar owner: the attendee marked as self on the event. Find my name in the transcript.',
    'Call save_meeting_notes once per meeting that has a transcript, in English: a short summary for me, and only the action items that are mine (I said I would do it, or someone asked me and I agreed). Things owned by others or by the whole group do not go in my_actions.',
    'A speaker named after a meeting room is the room microphone; attribute what was said there to a person only when the transcript makes it clear.',
    'Say things directly and briefly. Do not use the em dash character.',
    'Skip meetings without a Gemini notes doc. Do not do anything else.',
  ].join('\n');
  for await (const m of query({
    prompt,
    options: {
      model: 'sonnet',
      maxTurns: 10 + meetings.length * 4,
      settingSources: [],
      env: { ...process.env, MAX_MCP_OUTPUT_TOKENS: '100000', ...(dir && { CLAUDE_CONFIG_DIR: dir }) },
      mcpServers: { assistant: createSdkMcpServer({ name: 'assistant', tools: [save, saved] }) },
      allowedTools: [
        'mcp__claude_ai_Google_Calendar__get_event',
        'mcp__claude_ai_Google_Drive__read_file_content',
        'mcp__claude_ai_Google_Drive__search_files',
        'mcp__claude_ai_Google_Docs__read_doc',
        'mcp__assistant__save_meeting_notes',
        'mcp__assistant__read_saved_output',
      ],
      permissionMode: 'dontAsk',
    },
  })) {
    const until = overageUntil(m);
    if (until) {
      markLimited(PROFILES[profile], until);
      throw new Error('Stopped before using extra usage');
    }
    if (m.type === 'result' && m.subtype !== 'success') throw new Error(`Transcript import ended with ${m.subtype}`);
  }
  const ids = new Set(meetings.map((m) => m.id));
  return saveNotes(db, profile, found.filter((n) => ids.has(n.id)), now);
}

// The manual sync for one meeting, at any time after it started, replacing an earlier summary.
export async function syncTranscript(db: Database, profile: Profile, id: string, now = Date.now()) {
  const m = db.prepare("SELECT id, title, starts_at, ends_at FROM meetings WHERE profile = ? AND id = ? AND deleted = 0 AND id LIKE 'cal:%'").get(profile, id) as Pending | null;
  if (!m) throw new Error('No calendar meeting with that id');
  return readTranscripts(db, profile, [m], now);
}

export function startTranscripts(db: () => Database, every = 5 * MIN) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    for (const profile of Object.keys(PROFILES) as Profile[]) {
      try {
        const due = dueMeetings(db(), profile);
        markTried(db(), profile, due);
        const n = due.length ? await readTranscripts(db(), profile, due, Date.now()) : 0;
        if (n) console.log(`transcripts ${profile}: ${n} meetings summarized`);
      } catch (err) {
        console.error(`transcripts ${profile}:`, err instanceof Error ? err.message : err);
      }
    }
    busy = false;
  };
  void run();
  setInterval(run, every).unref();
}
