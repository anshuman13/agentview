import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { snippet } from '../../shared/snippet.js';
import { configDir, guardLimit, isLimited, stopOnOverage } from '../../server/src/agent/claude/accounts.js';
import { ACCOUNT_OF } from './calendar.js';
import type { Profile } from './db.js';
import { once } from './once.js';
import { applyChanges, type Change } from './sync.js';
import { DAY, MIN } from './time.js';

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

// A deadline said as a day lands on that day's morning in local time; Date.parse reads a bare date as UTC midnight.
export function dueAt(due: string | null) {
  if (!due) return NaN;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due.trim());
  return day ? new Date(+day[1], +day[2] - 1, +day[3], 9).getTime() : Date.parse(due);
}

// Calendar meetings that ended in the last days and are not processed yet, tried at most TRIES times, RETRY apart.
// A meeting summarized by hand before it ended is still waiting; one summarized before this state existed is done.
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
// An import stopped by the usage limit only delays the next try and does not count.
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

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('') : '';

// A Drive read returns the doc as JSON with fileContent, sometimes inside a list of text blocks.
export function docText(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.fileContent === 'string') return parsed.fileContent;
    if (Array.isArray(parsed)) return docText(textOf(parsed));
  } catch {}
  return raw;
}

// Large tool outputs are saved under the config dir's tool-results folders.
export function savedText(root: string, file: string) {
  const real = fs.realpathSync(path.resolve(file));
  const projects = fs.realpathSync(path.join(root, 'projects'));
  if (!real.startsWith(projects + path.sep) || !real.split(path.sep).includes('tool-results')) throw new Error('Only saved tool outputs can be read');
  return docText(fs.readFileSync(real, 'utf8'));
}

export function readSaved(root: string, file: string, offset = 0) {
  const text = savedText(root, file);
  const end = Math.min(text.length, offset + CHUNK);
  return `${text.slice(offset, end)}\n[characters ${offset}-${end} of ${text.length}]`;
}

export const docIdOf = (s: string) => /\/d\/([\w-]{20,})/.exec(s)?.[1] ?? (/^[\w-]{20,}$/.test(s.trim()) ? s.trim() : null);

type Block = { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };

// The docs read during an import, by doc id, taken from the tool calls and their results in the query stream. An output
// too large to return names the file it was saved to, which is read whole.
export function docReader(root: string) {
  const calls = new Map<string, string>();
  const texts = new Map<string, string>();
  const see = (m: { type: string; message?: unknown }) => {
    const content = m.type === 'assistant' || m.type === 'user' ? (m.message as { content?: unknown } | undefined)?.content : null;
    if (!Array.isArray(content)) return;
    for (const b of content as Block[]) {
      if (b.type === 'tool_use' && b.id && /(read_file_content|read_doc)$/.test(b.name ?? '')) {
        const doc = Object.values(b.input ?? {}).map((v) => (typeof v === 'string' ? docIdOf(v) : null)).find(Boolean);
        if (doc) calls.set(b.id, doc);
      }
      const doc = b.type === 'tool_result' && !b.is_error ? calls.get(b.tool_use_id ?? '') : undefined;
      if (!doc) continue;
      const raw = textOf(b.content);
      const file = /(\/\S*\/tool-results\/[\w.-]*\w)/.exec(raw)?.[1];
      let text: string;
      try {
        text = (file ? savedText(root, file) : docText(raw)).trim();
      } catch {
        continue;
      }
      if (text.length > (texts.get(doc)?.length ?? 0)) texts.set(doc, text);
    }
  };
  // The doc the notes name; when they name none that was read, the only doc read, if it is alone.
  const textFor = (url: string, alone: boolean) => {
    const id = docIdOf(url);
    if (id && texts.has(id)) return { doc: id, text: texts.get(id)! };
    if (!alone || texts.size !== 1) return null;
    const [doc, text] = [...texts][0];
    return { doc, text };
  };
  return { see, textFor };
}

export function saveTranscripts(db: Database, profile: Profile, found: { id: string; doc: string; text: string }[], now = Date.now()) {
  const put = db.prepare('INSERT OR REPLACE INTO transcripts (profile, id, doc, text, folded, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  db.transaction(() => found.forEach((t) => put.run(profile, t.id, t.doc, t.text, t.text.toLowerCase(), now)))();
}

export function transcriptText(db: Database, profile: Profile, id: string) {
  return (db.prepare('SELECT text FROM transcripts WHERE profile = ? AND id = ?').get(profile, id) as { text: string } | null)?.text ?? null;
}

// Meetings whose transcript holds every word, newest first, with a stretch around the first hit.
export function searchTranscripts(db: Database, query: string, limit = 50) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10);
  if (!words.length) return [];
  const rows = db.prepare(
    `SELECT t.profile, t.id, t.text FROM transcripts t JOIN meetings m ON m.profile = t.profile AND m.id = t.id AND m.deleted = 0 WHERE ${words.map(() => 'instr(t.folded, ?) > 0').join(' AND ')} ORDER BY m.starts_at DESC LIMIT ?`,
  ).all(...words, limit) as { profile: Profile; id: string; text: string }[];
  return rows.map((r) => ({ profile: r.profile, id: r.id, snippet: snippet(words, r.text) }));
}

// Asks Claude to read the transcript in the Gemini doc attached to each meeting's event and saves what it finds.
export const formatLines = (instructions: string) => (instructions.trim() ? [`Write the summary to this brief: ${instructions.trim().slice(0, 1000)}`] : []);

async function readTranscripts(db: Database, profile: Profile, meetings: Pending[], now: number, instructions = '') {
  const found: MeetingNotes[] = [];
  const save = tool('save_meeting_notes', 'Save the summary and my actions for one meeting.', Notes.shape, async (a) => {
    found.push(a);
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  guardLimit(ACCOUNT_OF[profile]);
  const dir = configDir(ACCOUNT_OF[profile]);
  const root = dir ?? path.join(os.homedir(), '.claude');
  const docs = docReader(root);
  const saved = tool('read_saved_output', 'Read a tool output that was too large and was saved to a file, 30000 characters at a time.', { path: z.string(), offset: z.number().int().min(0).optional() }, async (a) => {
    try {
      return { content: [{ type: 'text', text: readSaved(root, a.path, a.offset) }] };
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
    ...formatLines(instructions),
    'Set room to the speaker named after a meeting room, if there is one.',
    'An action is owner "me" when I said I would do it, someone asked me by name and I agreed, I was named as the owner, or the room microphone said it and I was on it.',
    'An action is owner "maybe" when it is probably mine: the room microphone took it on and I do not speak under my own name, so I was likely in that room.',
    'An action is owner "nobody" when it is a follow-up the group agreed on that no one took.',
    'What another person by name took on goes in others, with their name, not in actions. Write each action as a task for me.',
    'Say things directly and briefly. Do not use the em dash character.',
    'Skip meetings without a Gemini notes doc. Do not do anything else.',
  ].join('\n');
  let failure: string | null = null;
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
    stopOnOverage(ACCOUNT_OF[profile], m);
    docs.see(m);
    if (m.type === 'result' && m.subtype !== 'success') failure = m.subtype;
  }
  const ids = new Set(meetings.map((m) => m.id));
  const mine = found.filter((n) => ids.has(n.id) && n.summary.trim());
  // A run that hit the turn limit keeps the notes it saved before it stopped.
  if (failure && !mine.length) throw new Error(`Transcript import ended with ${failure}`);
  saveTranscripts(db, profile, mine.flatMap((n) => {
    const t = docs.textFor(n.doc_url, mine.length === 1);
    return t ? [{ id: n.id, ...t }] : [];
  }), now);
  return { saved: saveNotes(db, profile, mine, now), found: new Set(mine.map((n) => n.id)) };
}

// The manual sync for one meeting, at any time after it started, replacing an earlier summary.
export async function syncTranscript(db: Database, profile: Profile, id: string, now = Date.now(), instructions = '') {
  const m = db.prepare("SELECT id, title, starts_at, ends_at, room_me FROM meetings WHERE profile = ? AND id = ? AND deleted = 0 AND id LIKE 'cal:%'").get(profile, id) as Pending | null;
  if (!m) throw new Error('No calendar meeting with that id');
  return once(`${profile}:${id}`, async () => (await readTranscripts(db, profile, [m], now, instructions)).saved);
}

export function startTranscripts(db: () => Database, every = 5 * MIN) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const profile of Object.keys(ACCOUNT_OF) as Profile[]) {
        // A few at a time, so a backlog after a weekend never runs past the turn limit on every try.
        const due = dueMeetings(db(), profile).slice(0, 5);
        if (!due.length) continue;
        try {
          const { found } = await readTranscripts(db(), profile, due, Date.now());
          markTried(db(), profile, due.filter((m) => !found.has(m.id)));
          if (found.size) console.log(`transcripts ${profile}: ${found.size} meetings summarized`);
        } catch (err) {
          markTried(db(), profile, due, Date.now(), isLimited(ACCOUNT_OF[profile]));
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
