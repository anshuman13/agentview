import type { Database } from 'bun:sqlite';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { configDir, isLimited, markLimited, overageUntil } from '../../server/src/agent/claude/accounts.js';
import { type Profile } from './db.js';
import { applyChanges, type Change } from './sync.js';
import { DAY, inWeekHours } from './time.js';

const CALENDAR = 'mcp__claude_ai_Google_Calendar__';
export const ACCOUNT_OF = { work: 'alt', personal: 'main' } as const;

const Event = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string().describe('ISO time with offset'),
  end: z.string().describe('ISO time with offset'),
  people: z.array(z.string()).describe('Other attendees by name, or email when there is no name'),
  url: z.string().optional().describe('The event link in Google Calendar'),
});
export type CalendarEvent = z.infer<typeof Event>;

// Upserts the events as meetings and removes calendar meetings in the window that are gone, unless they have notes.
// A meeting removed here comes back when its event reappears; one you deleted stays deleted.
export function saveMeetings(db: Database, profile: Profile, events: CalendarEvent[], from: number, to: number, now = Date.now()) {
  const row = db.prepare('SELECT title, starts_at, ends_at, people, calendar_url, deleted, field_times FROM meetings WHERE profile = ? AND id = ?');
  const swept = db.prepare('SELECT value FROM meta WHERE key = ?');
  const sweptKey = (id: string) => `swept:${profile}:${id}`;
  const all: Change[] = events
    .filter((e) => !Number.isNaN(Date.parse(e.start)) && !Number.isNaN(Date.parse(e.end)))
    .map((e) => ({
      table: 'meetings', id: `cal:${e.id}`, profile, updated_at: now,
      fields: { title: e.title, starts_at: Date.parse(e.start), ends_at: Date.parse(e.end), people: JSON.stringify(e.people), calendar_url: e.url ?? null },
    }));
  const kept = new Set(all.map((c) => c.id));
  const back: string[] = [];
  const changes = all.filter((c) => {
    const old = row.get(profile, c.id) as Record<string, unknown> | null;
    if (old?.deleted) {
      const at = (swept.get(sweptKey(c.id)) as { value: string } | null)?.value;
      if (at && JSON.parse(String(old.field_times)).deleted === Number(at)) {
        c.deleted = false;
        back.push(c.id);
        return true;
      }
    }
    return !old || Object.entries(c.fields).some(([k, v]) => old[k] !== v);
  });
  const stale = db.prepare("SELECT id FROM meetings WHERE profile = ? AND deleted = 0 AND id LIKE 'cal:%' AND starts_at >= ? AND starts_at < ? AND (notes IS NULL OR notes = '') AND (summary IS NULL OR summary = '')").all(profile, from, to) as { id: string }[];
  const gone = events.length ? stale.filter(({ id }) => !kept.has(id)).map(({ id }) => id) : [];
  for (const id of gone) changes.push({ table: 'meetings', id, profile, updated_at: now, deleted: true, fields: {} });
  const applied = applyChanges(db, changes).applied;
  for (const id of back) db.prepare('DELETE FROM meta WHERE key = ?').run(sweptKey(id));
  for (const id of gone) db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(sweptKey(id), String(now));
  return applied;
}

export async function importCalendar(db: Database, profile: Profile, now = Date.now()) {
  const from = new Date(now - DAY).setHours(0, 0, 0, 0);
  const start = new Date(from);
  const to = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 9).getTime();
  let events: CalendarEvent[] | null = null;
  const save = tool('save_meetings', 'Save the meetings you found.', { events: z.array(Event) }, async (a) => {
    events = a.events;
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  if (isLimited(ACCOUNT_OF[profile])) throw new Error('The Claude account is at its usage limit');
  const dir = configDir(ACCOUNT_OF[profile]);
  const prompt = [
    `List my Google Calendar events on my primary calendar from ${new Date(from).toISOString()} to ${new Date(to).toISOString()}.`,
    'Leave out all-day events, events I declined, and events with no other attendees.',
    'Then call save_meetings once with all of them. Do not do anything else.',
  ].join(' ');
  for await (const m of query({
    prompt,
    options: {
      persistSession: false,
      model: 'sonnet',
      maxTurns: 12,
      settingSources: [],
      env: { ...process.env, ...(dir && { CLAUDE_CONFIG_DIR: dir }) },
      mcpServers: { assistant: createSdkMcpServer({ name: 'assistant', tools: [save] }) },
      allowedTools: [`${CALENDAR}list_events`, `${CALENDAR}get_event`, `${CALENDAR}list_calendars`, 'mcp__assistant__save_meetings'],
      permissionMode: 'dontAsk',
    },
  })) {
    const until = overageUntil(m);
    if (until) {
      markLimited(ACCOUNT_OF[profile], until);
      throw new Error('Stopped before using extra usage');
    }
    if (m.type === 'result' && m.subtype !== 'success') throw new Error(`Calendar import ended with ${m.subtype}`);
  }
  if (!events) throw new Error('Claude did not save any meetings');
  return saveMeetings(db, profile, events, from, to, now);
}

const FIRST = 7;
const LAST = 19;
const EVERY = 30 * 60_000;

// True once per half hour from 07:00 to 19:00 on weekdays.
export function importDue(last: number, now = Date.now()) {
  const slot = Math.floor(now / EVERY) * EVERY;
  return inWeekHours(now, FIRST, LAST) && last < slot;
}

const lastKey = (p: Profile) => `calendar:last:${p}`;
const triedKey = (p: Profile) => `calendar:tried:${p}`;

export function lastImport(db: Database, profile: Profile) {
  const get = db.prepare('SELECT value FROM meta WHERE key = ?');
  const row = (get.get(lastKey(profile)) ?? get.get('calendar:last')) as { value: string } | null;
  return Number(row?.value ?? 0);
}

// The last import attempt, failed or not, so a failing profile waits for the next slot.
export function lastAttempt(db: Database, profile: Profile) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(triedKey(profile)) as { value: string } | null;
  return Math.max(Number(row?.value ?? 0), lastImport(db, profile));
}

const running = new Map<Profile, Promise<{ changed: number; error?: string }>>();

function importOne(db: () => Database, profile: Profile, run: typeof importCalendar) {
  let job = running.get(profile);
  if (!job) {
    job = (async () => {
      const set = db().prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
      set.run(triedKey(profile), String(Date.now()));
      try {
        const n = await run(db(), profile);
        console.log(`calendar ${profile}: ${n} meetings changed`);
        set.run(lastKey(profile), String(Date.now()));
        return { changed: n };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`calendar ${profile}:`, message);
        return { changed: 0, error: `${profile}: ${message}` };
      }
    })().finally(() => running.delete(profile));
    running.set(profile, job);
  }
  return job;
}

// Imports the profiles and returns how many meetings changed and which profiles failed; a profile already importing is joined.
export async function syncCalendar(db: () => Database, profiles = Object.keys(ACCOUNT_OF) as Profile[], run = importCalendar) {
  let changed = 0;
  const errors: string[] = [];
  for (const profile of profiles) {
    const r = await importOne(db, profile, run);
    changed += r.changed;
    if (r.error) errors.push(r.error);
  }
  return { changed, errors };
}

export function startCalendar(db: () => Database, every = 5 * 60_000) {
  const run = () => {
    try {
      const due = (Object.keys(ACCOUNT_OF) as Profile[]).filter((p) => importDue(lastAttempt(db(), p)));
      if (due.length) void syncCalendar(db, due);
    } catch (err) {
      console.error('calendar:', err instanceof Error ? err.message : err);
    }
  };
  run();
  setInterval(run, every).unref();
}
