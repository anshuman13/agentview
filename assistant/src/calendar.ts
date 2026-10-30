import type { Database } from 'bun:sqlite';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { ask, scanPaused } from './claude.js';
import { deleteMeta, getMeta, setMeta, type Profile } from './db.js';
import { applyChanges, type Change } from './sync.js';
import { MIN, workSlotDue } from './time.js';
import { loop, once } from './once.js';
import { backoff, recordScan } from './scan.js';
import { errText } from '../../shared/util.js';

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
type CalendarEvent = z.infer<typeof Event>;

// Upserts the events as meetings and removes calendar meetings in the window that are gone, unless they have notes.
// A meeting removed here comes back when its event reappears; one you deleted stays deleted.
export function saveMeetings(db: Database, profile: Profile, events: CalendarEvent[], from: number, to: number, now = Date.now()) {
  const row = db.prepare('SELECT title, starts_at, ends_at, people, calendar_url, deleted, field_times FROM meetings WHERE profile = ? AND id = ?');
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
      const at = getMeta(db, sweptKey(c.id));
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
  return db.transaction(() => {
    const applied = applyChanges(db, changes).applied;
    for (const id of back) deleteMeta(db, sweptKey(id));
    for (const id of gone) setMeta(db, sweptKey(id), String(now));
    return applied;
  })();
}

async function importCalendar(db: Database, profile: Profile, now = Date.now()) {
  // Calendar days, so a 23 or 25 hour day at a DST change does not shift the window.
  const today = new Date(now);
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime();
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 8).getTime();
  let events: CalendarEvent[] | null = null;
  // A second call adds to the first, so meetings saved earlier are not swept as gone.
  const save = tool('save_meetings', 'Save the meetings you found.', { events: z.array(Event) }, async (a) => {
    events = [...(events ?? []).filter((e) => !a.events.some((n) => n.id === e.id)), ...a.events];
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  const prompt = [
    `List my Google Calendar events on my primary calendar from ${new Date(from).toISOString()} to ${new Date(to).toISOString()}.`,
    'Leave out all-day events, events I declined, and events with no other attendees.',
    'Then call save_meetings once with all of them. Do not do anything else.',
  ].join(' ');
  for await (const m of ask(ACCOUNT_OF[profile], prompt, {
    model: 'sonnet',
    maxTurns: 12,
    mcpServers: { assistant: createSdkMcpServer({ name: 'assistant', tools: [save] }) },
    allowedTools: [`${CALENDAR}list_events`, `${CALENDAR}get_event`, `${CALENDAR}list_calendars`, 'mcp__assistant__save_meetings'],
    permissionMode: 'dontAsk',
  })) {
    // Meetings saved before the run hit its turn limit still count.
    if (m.type === 'result' && m.subtype !== 'success' && !events) throw new Error(`Calendar import ended with ${m.subtype}`);
  }
  if (!events) throw new Error('Claude did not save any meetings');
  return saveMeetings(db, profile, events, from, to, now);
}

const EVERY = 30 * MIN;

// True once per half hour from 07:00 to 19:00 on weekdays.
export function importDue(last: number, now = Date.now()) {
  return workSlotDue(last, EVERY, now);
}

const lastKey = (p: Profile) => `calendar:last:${p}`;
const triedKey = (p: Profile) => `calendar:tried:${p}`;

export function lastImport(db: Database, profile: Profile) {
  return Number(getMeta(db, lastKey(profile)) ?? getMeta(db, 'calendar:last') ?? 0);
}

// The last import attempt, failed or not, so a failing profile waits for the next slot.
export function lastAttempt(db: Database, profile: Profile) {
  return Math.max(Number(getMeta(db, triedKey(profile)) ?? 0), lastImport(db, profile));
}

// A failed import, even one that could not record its attempt, comes back as an error and never rejects.
function importOne(db: () => Database, profile: Profile, run: typeof importCalendar) {
  return once<{ changed: number; error?: string }>(`calendar:${profile}`, async () => {
    try {
      setMeta(db(), triedKey(profile), String(Date.now()));
      const { meetings: n } = await recordScan(db(), 'calendar', async () => {
        try {
          return { meetings: await run(db(), profile) };
        } catch (err) {
          throw new Error(`${profile}: ${errText(err)}`);
        }
      });
      console.log(`calendar ${profile}: ${n} meetings changed`);
      setMeta(db(), lastKey(profile), String(Date.now()));
      return { changed: n };
    } catch (err) {
      const message = errText(err);
      console.error('calendar', message);
      return { changed: 0, error: message };
    }
  });
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

// Imports each profile once per slot, sooner after a failed import.
export function startCalendar(db: () => Database, every = MIN) {
  const retries = new Map<Profile, ReturnType<typeof backoff>>();
  loop('calendar', every, async () => {
    for (const p of Object.keys(ACCOUNT_OF) as Profile[]) {
      const retry = retries.get(p) ?? retries.set(p, backoff()).get(p)!;
      if (!(importDue(lastAttempt(db(), p)) || retry.due(Date.now())) || (await scanPaused(db(), ACCOUNT_OF[p], 'calendar'))) continue;
      const { error } = await importOne(db, p, importCalendar);
      retry.done(!error, Date.now());
    }
  }, true);
}
