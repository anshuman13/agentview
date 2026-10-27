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
const DAY = 24 * 60 * MIN;
const WITHIN = 3 * DAY;
export const TRIES = 8;
const RETRY = 15 * MIN;
const EXPIRE = 7 * DAY;
const CHUNK = 30_000;

const Notes = z.object({
  id: z.string().describe('The meeting id from the list'),
  summary: z.string().describe('3-6 plain sentences: what was decided and what happens next'),
  doc_url: z.string().describe('Link to the doc that holds the transcript'),
  room: z.string().nullable().describe('The speaker named after a meeting room (the room microphone), or null when there is none'),
  actions: z
    .array(z.object({
      title: z.string().describe('Short imperative task, e.g. "Send the rollout slides to Kim"'),
      context: z.string().describe('One sentence on why, with who asked'),
      due: z.string().nullable().describe('ISO date (YYYY-MM-DD) when a deadline day was said, a date-time only when a clock time was said, else null'),
      owner: z.enum(['me', 'maybe', 'nobody']).describe('me: certainly mine; maybe: probably mine; nobody: a follow-up no one took'),
    }))
    .describe('Follow-ups that are mine, probably mine, or that nobody took; empty when there are none'),
  others: z.array(z.object({ who: z.string(), what: z.string() })).describe('What other people by name said they would do'),
});
export type MeetingNotes = z.infer<typeof Notes>;

type Pending = { id: string; title: string; starts_at: number; ends_at: number; room_me: number | null };

const tried = (profile: Profile, id: string) => `transcript:${profile}:${id}`;
const triesOf = (db: Database, profile: Profile, id: string) => ((db.prepare('SELECT value FROM meta WHERE key = ?').get(tried(profile, id)) as { value: string } | null)?.value ?? '0,0').split(',').map(Number);

// Calendar meetings that ended in the last days and are not processed yet, tried at most TRIES times, RETRY apart.
// A meeting summarized by hand before it ended is still waiting; one summarized before this state existed is done.
// A deadline said as a day lands on that day's morning in local time; Date.parse reads a bare date as UTC midnight.
export function dueAt(due: string | null) {
  if (!due) return NaN;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due.trim());
  return day ? new Date(+day[1], +day[2] - 1, +day[3], 9).getTime() : Date.parse(due);
}

export function dueMeetings(db: Database, profile: Profile, now = Date.now()): Pending[] {
  const rows = db.prepare(
    "SELECT id, title, starts_at, ends_at, room_me FROM meetings WHERE profile = ? AND deleted = 0 AND id LIKE 'cal:%' AND (transcript = 'waiting' OR (transcript IS NULL AND (summary IS NULL OR summary = ''))) AND ends_at <= ? AND ends_at >= ? ORDER BY ends_at",
  ).all(profile, now, now - WITHIN) as Pending[];
  return rows.filter((m) => {
    const [count, last] = triesOf(db, profile, m.id);
    return count < TRIES && now - last >= RETRY;
  });
}

// Counts a try for each meeting with no transcript yet and shows it on the meeting; after the last try it is missing.
// An import that failed (usage limit, crash) only delays the next try and does not count.
export function markTried(db: Database, profile: Profile, meetings: Pending[], now = Date.now(), failed = false) {
  const set = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  const changes: Change[] = [];
  for (const m of meetings) {
    const count = triesOf(db, profile, m.id)[0] + (failed ? 0 : 1);
    set.run(tried(profile, m.id), `${count},${now}`);
    if (!failed) changes.push({ table: 'meetings', id: m.id, profile, updated_at: now, fields: { transcript: count >= TRIES ? 'missing' : 'waiting', tries: count } });
  }
  applyChanges(db, changes);
}

export const actionId = (meeting: string, title: string) => `meet:${createHash('sha1').update(`${meeting}\n${title.trim().toLowerCase()}`).digest('hex').slice(0, 16)}`;

const STATUS = { me: 'open', maybe: 'suggested', nobody: 'unassigned' } as const;

// Writes the summary and adds the actions as tasks linked to the meeting: mine go to Today, probable ones wait for me
// to keep or dismiss them, and ones nobody took stay on the meeting. A task that exists is left alone, so one I finished
// or dismissed does not come back; a suggested or unassigned one becomes mine when a later read is sure.
export function saveNotes(db: Database, profile: Profile, found: MeetingNotes[], now = Date.now()) {
  const row = db.prepare('SELECT title, ends_at FROM meetings WHERE profile = ? AND id = ? AND deleted = 0');
  const has = db.prepare('SELECT status FROM items WHERE profile = ? AND id = ? AND deleted = 0');
  const changes: Change[] = [];
  for (const n of found) {
    const m = row.get(profile, n.id) as { title: string | null; ends_at: number | null } | null;
    if (!m || !n.summary.trim()) continue;
    changes.push({
      table: 'meetings', id: n.id, profile, updated_at: now,
      fields: { summary: n.summary.trim(), room: n.room?.trim() || null, others: JSON.stringify(n.others ?? []), transcript: (m.ends_at ?? 0) <= now ? 'done' : 'waiting' },
    });
    for (const a of n.actions) {
      if (!a.title.trim()) continue;
      const id = actionId(n.id, a.title);
      const old = has.get(profile, id) as { status: string | null } | null;
      if (old) {
        if (a.owner === 'me' && (old.status === 'suggested' || old.status === 'unassigned')) changes.push({ table: 'items', id, profile, updated_at: now, fields: { status: 'open' } });
        continue;
      }
      const due = dueAt(a.due);
      changes.push({
        table: 'items', id, profile, updated_at: now,
        fields: { title: a.title.trim(), text: a.context.trim() || null, source: 'action', source_url: n.doc_url || null, people: m.title, at: Number.isFinite(due) ? due : null, status: STATUS[a.owner] ?? 'suggested', meeting_id: n.id },
      });
    }
  }
  return applyChanges(db, changes).applied;
}

// Suggested actions I left for a week leave Today and wait on their meeting as unassigned.
export function expireSuggested(db: Database, now = Date.now()) {
  const rows = db.prepare("SELECT id, profile FROM items WHERE deleted = 0 AND status = 'suggested' AND CAST(COALESCE(json_extract(field_times, '$.status'), updated_at) AS INTEGER) < ?").all(now - EXPIRE) as { id: string; profile: Profile }[];
  return applyChanges(db, rows.map((r) => ({ table: 'items', id: r.id, profile: r.profile, updated_at: now, fields: { status: 'unassigned' } }))).applied;
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

// Asks Claude to read the transcript in the Gemini doc attached to each meeting's event and saves what it finds.
async function readTranscripts(db: Database, profile: Profile, meetings: Pending[], now: number) {
  const found: MeetingNotes[] = [];
  const save = tool('save_meeting_notes', 'Save the summary and my actions for one meeting.', Notes.shape, async (a) => {
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
  const known = db.prepare("SELECT title, status FROM items WHERE profile = ? AND meeting_id = ? AND deleted = 0");
  const prompt = [
    'These meetings on my primary Google Calendar have ended:',
    ...meetings.flatMap((m) => {
      const old = known.all(profile, m.id) as { title: string; status: string }[];
      return [
        `- id ${m.id}, Google Calendar event id ${m.id.slice(4)}: "${m.title}" ${new Date(m.starts_at).toISOString()} to ${new Date(m.ends_at).toISOString()}`,
        ...(m.room_me === 1 ? ['  I was on the room microphone in this meeting: the speaker named after the room is me.'] : []),
        ...(m.room_me === 0 ? ['  I was not on the room microphone in this meeting.'] : []),
        ...(old.length ? ['  Actions already recorded for it; when you find the same action again, use exactly this title:', ...old.map((a) => `  - ${a.title}`)] : []),
      ];
    }),
    '',
    'For each one, get the event and find the attached Google Doc with the meeting transcript (Gemini attaches it as "Notes by Gemini", "Notater fra Gemini" or similar). Read it with the Google Drive read_file_content tool (the Google Docs read_doc tool also works).',
    'If the output is saved to a file because it is large, read that file with read_saved_output, all of it.',
    'Work from the transcript only. Ignore the summary, notes, details and next steps Gemini wrote at the top of the doc; do not copy or rely on them.',
    'I am the calendar owner: the attendee marked as self on the event. Find my name in the transcript.',
    'Call save_meeting_notes once per meeting that has a transcript, in English: a short summary for me, my follow-ups as actions, and what others took on.',
    'Set room to the speaker named after a meeting room, if there is one.',
    'An action is owner "me" when I said I would do it, someone asked me by name and I agreed, I was named as the owner, or the room microphone said it and I was on it.',
    'An action is owner "maybe" when it is probably mine: the room microphone took it on and I do not speak under my own name, so I was likely in that room.',
    'An action is owner "nobody" when it is a follow-up the group agreed on that no one took.',
    'What another person by name took on goes in others, with their name, not in actions. Write each action as a task for me.',
    'Say things directly and briefly. Do not use the em dash character.',
    'Skip meetings without a Gemini notes doc. Do not do anything else.',
  ].join('\n');
  for await (const m of query({
    prompt,
    options: {
      persistSession: false,
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
  const mine = found.filter((n) => ids.has(n.id) && n.summary.trim());
  return { saved: saveNotes(db, profile, mine, now), found: new Set(mine.map((n) => n.id)) };
}

// The manual sync for one meeting, at any time after it started, replacing an earlier summary.
export async function syncTranscript(db: Database, profile: Profile, id: string, now = Date.now()) {
  const m = db.prepare("SELECT id, title, starts_at, ends_at, room_me FROM meetings WHERE profile = ? AND id = ? AND deleted = 0 AND id LIKE 'cal:%'").get(profile, id) as Pending | null;
  if (!m) throw new Error('No calendar meeting with that id');
  return (await readTranscripts(db, profile, [m], now)).saved;
}

export function startTranscripts(db: () => Database, every = 5 * MIN) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const profile of Object.keys(PROFILES) as Profile[]) {
        const due = dueMeetings(db(), profile);
        if (!due.length) continue;
        try {
          const { found } = await readTranscripts(db(), profile, due, Date.now());
          markTried(db(), profile, due.filter((m) => !found.has(m.id)));
          if (found.size) console.log(`transcripts ${profile}: ${found.size} meetings summarized`);
        } catch (err) {
          markTried(db(), profile, due, Date.now(), true);
          console.error(`transcripts ${profile}:`, err instanceof Error ? err.message : err);
        }
      }
      expireSuggested(db());
    } catch (err) {
      console.error('transcripts:', err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  };
  void run();
  setInterval(run, every).unref();
}
