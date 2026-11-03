import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { textList } from './db.js';
import { run } from './slack.js';
import { PROFILE, webUrl } from './slackSave.js';
import { applyChanges, type Change } from './sync.js';
import { DAY, localDate } from './time.js';

export const PEOPLE_PAGE = 'Who does what';
const MAX = 30;
const WITHIN = 30 * DAY;

export type Owner = { person: string; thing: string; url: string; at: string; heading: string };

function peoplePage(db: Database, now: number) {
  const row = db.prepare("SELECT id FROM pages WHERE profile = ? AND deleted = 0 AND lower(title) = lower(?) AND COALESCE(state, 'live') != 'rejected'").get(PROFILE, PEOPLE_PAGE) as { id: string } | null;
  if (row) return row.id;
  const id = crypto.randomUUID();
  applyChanges(db, [{ table: 'pages', id, profile: PROFILE, updated_at: now, fields: { title: PEOPLE_PAGE, section: 'Team', summary: null, sort: now, state: 'proposed' } }]);
  return id;
}

// Proposes one "<person> owns <thing>" claim per owner found, keyed by person and thing so a rerun adds nothing twice.
export function saveOwners(db: Database, owners: Owner[], now = Date.now()) {
  const page = peoplePage(db, now);
  const changes: Change[] = [];
  for (const o of owners.slice(0, MAX)) {
    const person = o.person.trim(), thing = o.thing.trim();
    if (!person || !thing) continue;
    const id = `owner:${createHash('sha1').update(`${person} ${thing}`.toLowerCase()).digest('hex').slice(0, 16)}`;
    if (db.prepare('SELECT 1 FROM facts WHERE profile = ? AND id = ?').get(PROFILE, id)) continue;
    const url = webUrl(o.url);
    const text = `As of ${o.at.trim()}, ${person} owns ${thing}.`.slice(0, 400);
    changes.push({
      table: 'facts', id, profile: PROFILE, updated_at: now,
      fields: { text, page_id: page, heading: o.heading.trim() || 'Owners', sources: JSON.stringify([{ kind: 'slack', label: o.at.trim(), ...(url ? { url } : {}) }]), at: now, state: 'proposed', replaces: null, added_by: 'people' },
    });
  }
  return applyChanges(db, changes).applied;
}

// What the hub already knows from the last 30 days, for the model to read instead of Slack: chat summaries, Slack decisions and meeting decisions.
export function peopleInput(db: Database, now = Date.now()) {
  const since = now - WITHIN;
  const chats = db.prepare("SELECT name, url, summary, last_at FROM chats WHERE profile = ? AND deleted = 0 AND COALESCE(last_at, updated_at) > ? AND summary IS NOT NULL AND summary != ''").all(PROFILE, since) as { name: string; url: string | null; summary: string; last_at: number | null }[];
  const decisions = db.prepare('SELECT text, channel, url, at FROM slack_decisions WHERE profile = ? AND at > ? ORDER BY at DESC').all(PROFILE, since) as { text: string; channel: string; url: string; at: number }[];
  const meetings = db.prepare("SELECT title, calendar_url, decisions, starts_at FROM meetings WHERE profile = ? AND deleted = 0 AND starts_at BETWEEN ? AND ? AND decisions IS NOT NULL AND decisions NOT IN ('', '[]')").all(PROFILE, since, now) as { title: string | null; calendar_url: string | null; decisions: string; starts_at: number }[];
  return [
    'Chat summaries:',
    ...chats.map((c) => `- ${localDate(c.last_at ?? now)} ${c.name} ${c.url ?? ''}: ${c.summary}`),
    '',
    'Decisions in channels:',
    ...decisions.map((d) => `- ${localDate(d.at)} #${d.channel} ${d.url}: ${d.text}`),
    '',
    'Decisions in meetings:',
    ...meetings.flatMap((m) => textList(m.decisions).map((d) => `- ${localDate(m.starts_at)} ${m.title ?? 'meeting'} ${m.calendar_url ?? ''}: ${d}`)),
  ].join('\n');
}

// One Sonnet pass over the hub's own notes of the last 30 days, proposing who owns what for me to approve. Reads nothing in Slack.
export async function learnPeople(db: Database, now = Date.now()) {
  const owners: Owner[] = [];
  const save = tool('save_owner', 'Save one person and the thing they own.', {
    person: z.string().max(80).describe('The person, as named in the notes'),
    thing: z.string().max(160).describe('What they own, run or are the contact for: a system, a process, a project, a decision area'),
    url: z.string().describe('Link of the note that shows it, or empty'),
    at: z.string().describe('Date of that note, like 28 Oct 2026'),
    heading: z.string().max(40).describe('Group, such as Systems, Projects, Process, Support'),
  }, async (a) => {
    owners.push(a);
    return { content: [{ type: 'text' as const, text: 'saved' }] };
  });
  const prompt = [
    `Below are my notes from the last 30 days: Slack chat summaries, decisions in channels and decisions in meetings. Today is ${localDate(now)}.`,
    `Find every case where they show that a named person owns, runs, decides on or is the contact for something. Call save_owner once per person and thing, up to ${MAX}, with the link and date of the note that shows it. Only what the notes state or clearly imply; skip guesses, one-off tasks and anything about me. Do not use the em dash character. End with one line: how many owners you saved.`,
    '',
    peopleInput(db, now),
  ].join('\n');
  const result = await run(prompt, 'sonnet', [save], 20, () => false, []);
  return { result, found: owners.length, saved: saveOwners(db, owners, now) };
}
