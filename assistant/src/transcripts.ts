import type { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { configDir, isLimited, markLimited, overageUntil } from '../../server/src/agent/claude/accounts.js';
import { PROFILES, type Profile } from './calendar.js';
import { applyChanges, type Change } from './sync.js';

const MIN = 60_000;
const AFTER = 30 * MIN;
const CHUNK = 30_000;

const Notes = z.object({
  id: z.string().describe('The meeting id from the list'),
  summary: z.string().describe('3-6 plain sentences: what was decided and what happens next'),
  decisions: z.array(z.string()).describe('One short line per decision'),
  notes: z.string().describe('Plain-text notes grouped by topic with "- " bullets, ending with action items and their owners'),
});
export type MeetingNotes = z.infer<typeof Notes>;

type Pending = { id: string; title: string; starts_at: number; ends_at: number };

// Calendar meetings without a summary that ended in the last 30 minutes.
export function dueMeetings(db: Database, profile: Profile, now = Date.now()): Pending[] {
  return db.prepare(
    "SELECT id, title, starts_at, ends_at FROM meetings WHERE profile = ? AND deleted = 0 AND id LIKE 'cal:%' AND (summary IS NULL OR summary = '') AND ends_at <= ? AND ends_at >= ? ORDER BY ends_at",
  ).all(profile, now, now - AFTER) as Pending[];
}

// Writes summary and decisions; notes only when the meeting has none, so your own notes stay.
export function saveNotes(db: Database, profile: Profile, found: MeetingNotes[], now = Date.now()) {
  const row = db.prepare('SELECT notes FROM meetings WHERE profile = ? AND id = ? AND deleted = 0');
  const changes: Change[] = [];
  for (const n of found) {
    const old = row.get(profile, n.id) as { notes: string | null } | null;
    if (!old || !n.summary.trim()) continue;
    const fields: Change['fields'] = { summary: n.summary.trim(), decisions: JSON.stringify(n.decisions) };
    if (!old.notes?.trim() && n.notes.trim()) fields.notes = n.notes.trim();
    changes.push({ table: 'meetings', id: n.id, profile, updated_at: now, fields });
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
    'For each one, get the event and look for a Gemini notes attachment ("Notes by Gemini", "Notater fra Gemini" or similar). Read that Google Doc with the Google Drive read_file_content tool (the Google Docs read_doc tool also works); it holds the Gemini summary and the transcript.',
    'If the output is saved to a file because it is large, read that file with read_saved_output. The Gemini summary, decisions, next steps and details come first; read the transcript only when the details leave something unclear.',
    'When a meeting has such a doc, call save_meeting_notes once for it, written in English from my point of view (I am the calendar owner).',
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
