import type { Database } from 'bun:sqlite';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { keyWords } from '../../shared/claimMatch.js';
import { workGaps, type Span } from '../../shared/plan.js';
import { clock } from '../../shared/util.js';
import { currentVersion, textList } from './db.js';
import { DAY, addWorkdays, hm, localDate, ymd } from './time.js';

const PROFILE = 'work' as const;
const MAX = 3;
const RECENT = 30 * DAY;
const SLACK_RECENT = 14 * DAY;
const FAQ_PAGE = 'Support FAQ';

export type Claim = { id: string; line: string; url: string | null; at: number };

const firstUrl = (sources: string | null) => {
  try {
    const list = JSON.parse(sources ?? '[]') as { url?: string }[];
    return list.find((s) => s.url)?.url ?? null;
  } catch {
    return null;
  }
};

export const DRAFT_DESC = 'A reply I could send, in my voice and in the language of the ask, as short as the ask allows: a yes or no in a DM is one line, a channel answer gives the answer or the link first and then at most two sentences of context, never more than four sentences; leave it out when the ask needs my own decision and no detail is missing';
export const DRAFT_STEP = 'For each new ask, read its thread, call ask_context with the words of the ask and the asker\'s name, and write draft from the thread and what ask_context returns. If I promised this person something, say where it stands; if I already answered this before, point to that answer instead of repeating it. Do not promise dates or facts you do not know. Numbers, dates and names come verbatim from a claim, a decision or the thread; with none, the tier is hold and the draft asks one precise question back instead of guessing. When a wiki line says "as of <date>", say so in the draft. When a message asks several things, answer the parts a claim or the thread covers, say which part you will check, and the tier is answer only when every part is covered; a hold draft still gives the covered parts with their numbers, never only "will check". Set tier, confidence and why for each ask: confidence is high only when the draft rests on the thread or on what ask_context returned. Set answered_by_other when a reply from someone other than me already answers it in the thread. In claims list the ids of the wiki claims the draft rests on, as ask_context gave them, and name them in why; a tier answer with no claim and nothing in the thread is a hold. A draft never says only that I will check, look at it or get back to them. For a hold it is one of: (a) the concrete thing I will do and when, like "i\'ll add you to the org today"; (b) the one missing detail I need to act, asked as a question (which email, which team, which tool); (c) empty, when I must decide something myself, so the ask waits for me with no ready reply. Prefer (b) when a detail is missing, else (c) when I must decide. Never say an action is done or an invite is sent. For access, invite, seat and limit asks, first use the Support FAQ claims from ask_context for the concrete step (where to request it, what to do) and give it in the draft. An answer uses what the thread and the claims already say before it defers anything. Write short lowercase-ish Slack lines in my voice, no greeting in a DM. When the claim has a link, end the draft with "see <link>". When someone asks to meet, call or talk, call free_slots and offer one or two of its times with the day and hour, never a time it did not list. When the answer is someone else\'s to give, name that person as Slack shows them (slack_read_user_profile for a bare <@U...> id) and tag them as <@id>; never guess an owner, and never write a raw id as a name.';

// Current wiki claims, decisions of the last 30 days of meetings and 14 days of Slack, and my open tasks that share
// at least two key words with the ask (one when the ask has under four), best first; a Support FAQ claim wins a tie.
// Claims carry their id and first source link so the draft can cite them.
type ClaimWords = { id: string; hay: Set<string>; boost: number; line: string; url: string | null; at: number };
const claimCache = new WeakMap<Database, { version: number; list: ClaimWords[] }>();

function claimWords(db: Database) {
  const version = currentVersion(db);
  const hit = claimCache.get(db);
  if (hit && hit.version === version) return hit.list;
  const rows = db.prepare(
    "SELECT f.id, f.text, f.sources, COALESCE(f.at, f.updated_at) AS at, p.title FROM facts f JOIN pages p ON p.profile = f.profile AND p.id = f.page_id AND p.deleted = 0 AND COALESCE(p.state, 'live') = 'live' WHERE f.profile = ? AND f.deleted = 0 AND COALESCE(f.state, 'live') = 'live' AND (f.superseded_by IS NULL OR f.superseded_by = '') AND f.text IS NOT NULL",
  ).all(PROFILE) as { id: string; text: string; sources: string | null; at: number; title: string | null }[];
  const list = rows.map((c): ClaimWords => ({ id: c.id, hay: keyWords(`${c.title ?? ''} ${c.text}`), boost: c.title === FAQ_PAGE ? 0.5 : 0, line: `${c.title ? `${c.title}: ` : ''}${c.text}`, url: firstUrl(c.sources), at: c.at }));
  claimCache.set(db, { version, list });
  return list;
}

const wholeWord = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');

function personContext(db: Database, from: string) {
  const first = from.trim().split(/\s+/)[0] ?? '';
  const re = wholeWord(first);
  const role = (db.prepare("SELECT f.text FROM facts f JOIN pages p ON p.profile = f.profile AND p.id = f.page_id AND p.deleted = 0 AND COALESCE(p.state, 'live') = 'live' WHERE f.profile = ? AND p.title = 'Who does what' AND f.deleted = 0 AND COALESCE(f.state, 'live') = 'live' AND (f.superseded_by IS NULL OR f.superseded_by = '') AND f.text IS NOT NULL ORDER BY f.updated_at DESC").all(PROFILE) as { text: string }[])
    .map((r) => r.text).filter((t) => re.test(t)).slice(0, 2);
  const replies = (db.prepare("SELECT text, COALESCE(sent_at, at) AS at FROM replies WHERE profile = ? AND who = ? AND status IN ('sent', 'dry') AND text IS NOT NULL ORDER BY COALESCE(sent_at, at) DESC LIMIT 3").all(PROFILE, from) as { text: string; at: number }[])
    .map((r) => `${ymd(r.at)}: ${r.text.length > 140 ? r.text.slice(0, 140) : r.text}`);
  const promises = (db.prepare("SELECT title, people, at FROM items WHERE profile = ? AND deleted = 0 AND id LIKE 'said:%' AND status IN ('open', 'suggested') AND title IS NOT NULL ORDER BY updated_at DESC").all(PROFILE) as { title: string; people: string | null; at: number | null }[])
    .filter((r) => re.test(r.people ?? '') || re.test(r.title)).slice(0, 3)
    .map((r) => `${r.title}${r.at ? `, due ${ymd(r.at)}` : ''}`);
  return { role, replies, promises };
}

export function askContext(db: Database, ask: string, now = Date.now(), from = '') {
  const words = keyWords(ask);
  const need = words.size < 4 ? 1 : 2;
  const best = <T extends { hay: Set<string>; boost?: number }>(list: T[]) => list
    .map((x) => ({ x, n: [...x.hay].filter((w) => words.has(w)).length }))
    .filter((r) => r.n >= need)
    .sort((a, b) => b.n + (b.x.boost ?? 0) - a.n - (a.x.boost ?? 0))
    .slice(0, MAX)
    .map((r) => r.x);
  const meetings = db.prepare("SELECT title, decisions FROM meetings WHERE profile = ? AND deleted = 0 AND starts_at BETWEEN ? AND ? AND decisions IS NOT NULL AND decisions NOT IN ('', '[]')").all(PROFILE, now - RECENT, now) as { title: string | null; decisions: string }[];
  const slack = db.prepare('SELECT text, channel, url, at FROM slack_decisions WHERE profile = ? AND at BETWEEN ? AND ? ORDER BY at DESC').all(PROFILE, now - SLACK_RECENT, now) as { text: string; channel: string; url: string; at: number }[];
  const tasks = db.prepare("SELECT title, at, status FROM items WHERE profile = ? AND deleted = 0 AND status IN ('open', 'suggested') AND COALESCE(source, '') NOT IN ('slack', 'calendar') AND title IS NOT NULL ORDER BY updated_at DESC LIMIT 200").all(PROFILE) as { title: string; at: number | null; status: string }[];
  const decided = [
    ...meetings.flatMap((m) => textList(m.decisions).map((d) => ({ hay: keyWords(d), line: `${d} (${m.title ?? 'meeting'})` }))),
    ...slack.map((d) => ({ hay: keyWords(d.text), line: `${d.text} (#${d.channel}, ${ymd(d.at)}, see ${d.url})` })),
  ];
  return {
    claims: best(claimWords(db)).map(({ id, line, url, at }): Claim => ({ id, line, url, at })),
    decisions: best(decided).map((d) => d.line),
    tasks: best(tasks.map((t) => ({ hay: keyWords(t.title), line: `${t.title}${t.at ? `, due ${ymd(t.at)}` : ''}${t.status === 'suggested' ? ', not accepted yet' : ''}` }))).map((t) => t.line),
    person: from.trim() ? personContext(db, from) : undefined,
  };
}

// One line naming the page and text of the first live claim among the given, for the push body; empty with none.
export function claimCite(db: Database, ids: string[] = []) {
  const live = liveClaims(db, ids);
  if (!live.length) return '';
  const row = db.prepare('SELECT f.text, p.title FROM facts f JOIN pages p ON p.profile = f.profile AND p.id = f.page_id WHERE f.profile = ? AND f.id = ?').get(PROFILE, live[0]) as { text: string; title: string | null } | null;
  if (!row) return '';
  const text = row.text.replace(/\s+/g, ' ').trim();
  return `From ${row.title ?? 'the wiki'}: ${text.length > 140 ? `${text.slice(0, 139).trimEnd()}…` : text}`;
}

// Ids among the given that are live claims now, for the check before an answer goes out.
export function liveClaims(db: Database, ids: string[]) {
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT f.id FROM facts f JOIN pages p ON p.profile = f.profile AND p.id = f.page_id AND p.deleted = 0 AND COALESCE(p.state, 'live') = 'live' WHERE f.profile = ? AND f.deleted = 0 AND COALESCE(f.state, 'live') = 'live' AND (f.superseded_by IS NULL OR f.superseded_by = '') AND f.id IN (${ids.map(() => '?').join(',')})`).all(PROFILE, ...ids) as { id: string }[];
  return rows.map((r) => r.id);
}

export const contextTool = (db: Database, now = Date.now()) =>
  tool('ask_context', 'Wiki claims, decisions from meetings and Slack, and my open tasks that match an ask, for its reply draft. Each wiki line starts with the claim id to cite; a task line is the real state of something I am doing.', { ask: z.string().describe('The ask in its own words'), from: z.string().optional().describe('The name of the person asking, as Slack shows it') }, async ({ ask, from }) => {
    return { content: [{ type: 'text' as const, text: contextText(askContext(db, ask, now, from), now) || 'Nothing matches.' }] };
  });

// The tool's answer, one line per fact; a claim older than 30 days carries its date so the draft can say "as of".
export function contextText({ claims, decisions, tasks, person }: ReturnType<typeof askContext>, now: number) {
  return [
    ...claims.map((c) => `Wiki [${c.id}]: ${c.line}${now - c.at > RECENT ? ` (as of ${ymd(c.at)})` : ''}${c.url ? ` (see ${c.url})` : ''}`),
    ...decisions.map((d) => `Decided: ${d}`),
    ...tasks.map((t) => `My task: ${t}`),
    ...(person?.role.map((r) => `Asker: ${r}`) ?? []),
    ...(person?.replies.map((r) => { const i = r.indexOf(': '); return `I told them on ${r.slice(0, i)}: ${r.slice(i + 2)}`; }) ?? []),
    ...(person?.promises.map((p) => `I promised them: ${p}`) ?? []),
  ].join('\n');
}

const HALF = 30 * 60_000;
const WORK_START = 8;
const WORK_END = 17;

// Up to three free half hours over the next two working days, one per gap so they spread, as "Weekday YYYY-MM-DD HH:MM-HH:MM".
export function slotLines(busy: Span[], now: number, max = 3) {
  const d = new Date(now);
  const weekday = d.getDay() >= 1 && d.getDay() <= 5;
  const inHours = weekday && d.getHours() < WORK_END;
  const first = inHours ? now : new Date(addWorkdays(now, 1)).setHours(WORK_START, 0, 0, 0);
  const days = [first, new Date(addWorkdays(first, 1)).setHours(WORK_START, 0, 0, 0)];
  const out: string[] = [];
  for (const day of days) {
    for (const [a, b] of workGaps(busy, day, WORK_START, WORK_END)) {
      const start = Math.ceil(a / HALF) * HALF;
      if (start + HALF > b) continue;
      out.push(`${localDate(start)} ${clock(start)}-${clock(start + HALF)}`);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export function freeSlots(db: Database, now = Date.now()) {
  const busy = db.prepare('SELECT starts_at, ends_at FROM meetings WHERE profile = ? AND deleted = 0 AND ends_at > ? AND starts_at < ? AND ends_at - starts_at < ?').all(PROFILE, now, addWorkdays(now, 3), 20 * 3600_000) as { starts_at: number; ends_at: number }[];
  return slotLines(busy.map((m) => [m.starts_at, m.ends_at] as Span), now);
}

export const slotsTool = (db: Database, now = Date.now()) =>
  tool('free_slots', 'Free half hours in my calendar over the next two working days, for an ask to meet or talk.', {}, async () => {
    const slots = freeSlots(db, now);
    const text = [`Now it is ${localDate(now)} ${hm(now)} my time.`, ...(slots.length ? slots.map((s) => `Free: ${s}`) : ['No free half hour in the next two working days.'])].join('\n');
    return { content: [{ type: 'text' as const, text }] };
  });
