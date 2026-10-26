import type { Database } from 'bun:sqlite';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { configDir } from '../../server/src/agent/claude/accounts.js';
import { applyChanges, type Change } from './sync.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const CALENDAR = 'mcp__claude_ai_Google_Calendar__';
const PROFILES = { work: 'alt', personal: 'main' } as const;
type Profile = keyof typeof PROFILES;

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
export function saveMeetings(db: Database, profile: Profile, events: CalendarEvent[], from: number, to: number, now = Date.now()) {
  const row = db.prepare('SELECT title, starts_at, ends_at, people, calendar_url, deleted FROM meetings WHERE profile = ? AND id = ?');
  const all: Change[] = events
    .filter((e) => !Number.isNaN(Date.parse(e.start)) && !Number.isNaN(Date.parse(e.end)))
    .map((e) => ({
      table: 'meetings', id: `cal:${e.id}`, profile, updated_at: now,
      fields: { title: e.title, starts_at: Date.parse(e.start), ends_at: Date.parse(e.end), people: JSON.stringify(e.people), calendar_url: e.url ?? null },
    }));
  const kept = new Set(all.map((c) => c.id));
  const changes = all.filter((c) => {
    const old = row.get(profile, c.id) as Record<string, unknown> | null;
    return !old || Object.entries(c.fields).some(([k, v]) => old[k] !== v);
  });
  const stale = db.prepare("SELECT id FROM meetings WHERE profile = ? AND deleted = 0 AND id LIKE 'cal:%' AND starts_at >= ? AND starts_at < ? AND (notes IS NULL OR notes = '')").all(profile, from, to) as { id: string }[];
  if (events.length) for (const { id } of stale) if (!kept.has(id)) changes.push({ table: 'meetings', id, profile, updated_at: now, deleted: true, fields: {} });
  return applyChanges(db, changes).applied;
}

export async function importCalendar(db: Database, profile: Profile, now = Date.now()) {
  const from = new Date(now - DAY).setHours(0, 0, 0, 0);
  const to = from + 9 * DAY;
  let events: CalendarEvent[] | null = null;
  const save = tool('save_meetings', 'Save the meetings you found.', { events: z.array(Event) }, async (a) => {
    events = a.events;
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  const dir = configDir(PROFILES[profile]);
  const prompt = [
    `List my Google Calendar events on my primary calendar from ${new Date(from).toISOString()} to ${new Date(to).toISOString()}.`,
    'Leave out all-day events, events I declined, and events with no other attendees.',
    'Then call save_meetings once with all of them. Do not do anything else.',
  ].join(' ');
  for await (const m of query({
    prompt,
    options: {
      model: 'sonnet',
      maxTurns: 12,
      settingSources: [],
      env: { ...process.env, ...(dir && { CLAUDE_CONFIG_DIR: dir }) },
      mcpServers: { assistant: createSdkMcpServer({ name: 'assistant', tools: [save] }) },
      allowedTools: [`${CALENDAR}list_events`, `${CALENDAR}get_event`, `${CALENDAR}list_calendars`, 'mcp__assistant__save_meetings'],
      permissionMode: 'dontAsk',
    },
  })) {
    if (m.type === 'result' && m.subtype !== 'success') throw new Error(`Calendar import ended with ${m.subtype}`);
  }
  if (!events) throw new Error('Claude did not save any meetings');
  return saveMeetings(db, profile, events, from, to, now);
}

export function startCalendar(db: () => Database, every = HOUR) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    for (const profile of Object.keys(PROFILES) as Profile[]) {
      try {
        console.log(`calendar ${profile}: ${await importCalendar(db(), profile)} meetings changed`);
      } catch (err) {
        console.error(`calendar ${profile}:`, err instanceof Error ? err.message : err);
      }
    }
    busy = false;
  };
  void run();
  setInterval(run, every).unref();
}
