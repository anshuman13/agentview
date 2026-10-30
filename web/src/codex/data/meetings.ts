import { dayLabel, dayStart } from './dates';
import type { ItemRow, Profile } from './sync';
import { decisionLog, factTime, listOf, live, matcher, othersOf, queryWords, rowMatcher, type Decision, type Fact, type Meeting } from './wiki';

// Meetings that have started, newest day first and in time order within a day. The future lives in Today and Upcoming.
export function groupMeetings(meetings: Meeting[], now = Date.now()) {
  const day = new Map<Meeting, number>();
  for (const m of live(meetings)) if (m.starts_at != null && m.starts_at <= now) day.set(m, dayStart(m.starts_at));
  const today = dayStart(now);
  const groups: { label: string; rows: Meeting[] }[] = [];
  const sorted = [...day.keys()].sort((a, b) => day.get(b)! - day.get(a)! || a.starts_at! - b.starts_at!);
  let lastDay: number | null = null;
  let label = '';
  for (const m of sorted) {
    const d = day.get(m)!;
    if (d !== lastDay) label = d === today ? 'Today' : dayLabel(m.starts_at!, true);
    lastDay = d;
    const last = groups[groups.length - 1];
    if (last?.label === label) last.rows.push(m);
    else groups.push({ label, rows: [m] });
  }
  return groups;
}

// A meeting's actions are the tasks linked to it: open and done ones are mine, suggested ones wait for me to keep or
// dismiss them, unassigned ones nobody took, and dismissed ones were not mine.
export const actionsOf = (items: ItemRow[], m: { profile: Profile; id: string }) => items.filter((r) => !r.deleted && r.meeting_id === m.id && r.profile === m.profile);

// Open actions from meetings that started more than 7 days ago, newest meeting first, minus the dismissed ids.
export function followThrough(items: ItemRow[], meetings: Meeting[], dismissed: string[], now = Date.now()) {
  const skip = new Set(dismissed);
  const cutoff = now - 7 * 86400000;
  const old = new Map(live(meetings).filter((m) => m.starts_at != null && m.starts_at < cutoff).map((m) => [`${m.profile}:${m.id}`, m]));
  return items
    .flatMap((r) => {
      const m = !r.deleted && r.status === 'open' && r.meeting_id && !skip.has(r.profile + r.id) && old.get(`${r.profile}:${r.meeting_id}`);
      return m ? [{ r, m }] : [];
    })
    .sort((a, b) => b.m.starts_at! - a.m.starts_at!);
}

type ActionCount = { total: number; done: number; review: number; unassigned: number; dismissed: number };
const NO_ACTIONS: ActionCount = { total: 0, done: 0, review: 0, unassigned: 0, dismissed: 0 };
const counted = new WeakMap<ItemRow[], Map<string, ActionCount>>();

// Action counts for every meeting, built once per items array.
function actionCounts(items: ItemRow[]) {
  let out = counted.get(items);
  if (!out) {
    out = new Map();
    for (const r of items) {
      if (r.deleted || !r.meeting_id) continue;
      const k = `${r.profile}:${r.meeting_id}`;
      let c = out.get(k);
      if (!c) out.set(k, (c = { ...NO_ACTIONS }));
      if (r.status === 'open') c.total++;
      else if (r.status === 'done') {
        c.total++;
        c.done++;
      } else if (r.status === 'suggested') c.review++;
      else if (r.status === 'unassigned') c.unassigned++;
      else if (r.status === 'dismissed') c.dismissed++;
    }
    counted.set(items, out);
  }
  return out;
}

export const actionCount = (items: ItemRow[], m: { profile: Profile; id: string }) => actionCounts(items).get(`${m.profile}:${m.id}`) ?? NO_ACTIONS;

export const pinsOf = (items: ItemRow[], meetings: Meeting[]) => {
  const ids = new Set(meetings.map((m) => m.profile + m.id));
  return items.filter((r) => !r.deleted && r.status === 'note' && r.meeting_id && ids.has(r.profile + r.meeting_id)).sort((a, b) => b.updated_at - a.updated_at);
};

const attendees = new WeakMap<Meeting, string[]>();

// Cached per meeting row; callers must not mutate the result.
export const peopleOf = (m: Meeting) => {
  let people = attendees.get(m);
  if (!people) {
    const s = typeof m.people === 'string' ? m.people : '';
    people = [...new Set((s.startsWith('[') ? listOf(s) : s.split(',')).map((p) => p.trim()).filter(Boolean))];
    attendees.set(m, people);
  }
  return people;
};

const words = (s: string) => {
  const t = s.trim();
  return (t.includes('@') ? t.slice(0, t.indexOf('@')).replace(/[._+-]+/g, ' ') : t).split(/\s+/).filter(Boolean);
};

// A person's name, or "First Last" derived from an email like first.last@host.
export const displayName = (s: string) => (s.includes('@') ? words(s).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ') || s.trim() : s.trim());

// The same person by name or email, ignoring case.
export const sameName = (a: string, b: string) => words(a).join(' ').toLowerCase() === words(b).join(' ').toLowerCase();

// The best name for a person: a non-email form some meeting lists for them, else one derived from the email.
export const nameOf = (meetings: Meeting[], person: string) =>
  person.includes('@') ? live(meetings).flatMap(peopleOf).find((p) => !p.includes('@') && sameName(p, person)) ?? displayName(person) : person.trim();

// Meetings the person attended, newest first.
export const meetingsOf = (meetings: Meeting[], person: string) =>
  live(meetings).filter((m) => peopleOf(m).some((p) => sameName(p, person))).sort((a, b) => (b.starts_at ?? 0) - (a.starts_at ?? 0));

export const decisionsWith = (log: Decision[], person: string) => (person ? log.filter((d) => peopleOf(d.meeting).some((p) => sameName(p, person))) : log);

// What the person took on in meetings, newest meeting first.
export const commitmentsOf = (meetings: Meeting[], person: string) =>
  meetingsOf(meetings, person).flatMap((m) => othersOf(m).filter((o) => sameName(o.who, person)).map((o) => ({ meeting: m, what: o.what })));

// The last two earlier meetings that share an attendee or the title, newest first, with their decisions and open actions.
export function priorWith(meeting: Meeting, meetings: Meeting[], items: ItemRow[]) {
  const people = peopleOf(meeting);
  const title = meeting.title?.trim().toLowerCase();
  const start = meeting.starts_at;
  if (start == null) return [];
  return live(meetings)
    .filter((m) => m.starts_at != null && m.starts_at < start && !(m.id === meeting.id && m.profile === meeting.profile)
      && ((!!title && m.title?.trim().toLowerCase() === title) || peopleOf(m).some((p) => people.some((q) => sameName(p, q)))))
    .sort((a, b) => b.starts_at! - a.starts_at!)
    .slice(0, 2)
    .map((m) => ({ meeting: m, decisions: listOf(m.decisions), open: actionsOf(items, m).filter((r) => r.status === 'open') }));
}

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const SERIES_NOISE = new RegExp(`\\([^)]*\\d[^)]*\\)|\\d{4}-\\d{2}-\\d{2}|\\b${MONTH}\\s*\\d{1,2}\\b|\\b\\d{1,2}\\s*${MONTH}|#\\s*\\d+|\\b\\d+\\b`, 'g');
export const seriesTitle = (t: string | null) => (t ?? '').toLowerCase().replace(SERIES_NOISE, ' ').replace(/\s+/g, ' ').trim();

const seriesTitles = new WeakMap<Meeting, string>();
const seriesTitleOf = (m: Meeting) => {
  let title = seriesTitles.get(m);
  if (title === undefined) {
    title = seriesTitle(m.title);
    seriesTitles.set(m, title);
  }
  return title;
};

const sharesGuests = (people: string[], other: string[]) => {
  if (!people.length || !other.length) return people.length === other.length;
  return people.filter((p) => other.some((q) => sameName(p, q))).length * 2 >= Math.min(people.length, other.length);
};

// Earlier meetings of the same recurring series: equal title once dates and numbers are stripped, and at least half of the smaller guest list in common. Newest first.
export function seriesOf(meetings: Meeting[], m: Meeting) {
  const title = seriesTitleOf(m);
  const people = peopleOf(m);
  if (!title || m.starts_at == null) return [];
  return live(meetings)
    .filter((x) => {
      if (x.profile !== m.profile || x.id === m.id || x.starts_at == null || x.starts_at >= m.starts_at! || seriesTitleOf(x) !== title) return false;
      return sharesGuests(people, peopleOf(x));
    })
    .sort((a, b) => b.starts_at! - a.starts_at!);
}

const seriesMembers = new WeakMap<Meeting[], Set<string>>();
// Keys (profile + id) of meetings that belong to a series of 2 or more, computed once per meetings array.
export function inSeries(meetings: Meeting[]) {
  let out = seriesMembers.get(meetings);
  if (out) return out;
  out = new Set<string>();
  const buckets = new Map<string, Meeting[]>();
  for (const m of live(meetings)) {
    const title = seriesTitleOf(m);
    if (!title || m.starts_at == null) continue;
    const key = m.profile + '\n' + title;
    buckets.set(key, [...(buckets.get(key) ?? []), m]);
  }
  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    const guests = group.map(peopleOf);
    group.forEach((m, i) => {
      if (group.some((_, j) => j !== i && sharesGuests(guests[i], guests[j]))) out.add(m.profile + m.id);
    });
  }
  seriesMembers.set(meetings, out);
  return out;
}

// What this meeting repeats from the previous one in its series: decisions made again and questions still being asked.
export function seriesRepeats(m: Meeting, prev: Meeting) {
  const norm = (t: string) => t.trim().toLowerCase();
  const before = new Set(listOf(prev.decisions).map(norm));
  const asked = openQuestions([prev]).map((q) => q.text.toLowerCase());
  return {
    decisions: listOf(m.decisions).filter((t) => t.trim() && before.has(norm(t))),
    questions: openQuestions([m]).map((q) => q.text).filter((t) => asked.some((a) => t.toLowerCase().includes(a) || a.includes(t.toLowerCase()))),
  };
}

type MeetingBrief = { tasks: { person: string; items: ItemRow[] }[]; claims: Fact[] };

// Open tasks that mention each attendee and up to three current claims that name an attendee or match the title.
export function briefFor(meeting: Meeting, items: ItemRow[], facts: Fact[]): MeetingBrief {
  const people = peopleOf(meeting);
  const open = items.filter((r) => !r.deleted && r.status === 'open' && r.source !== 'calendar' && !(r.meeting_id === meeting.id && r.profile === meeting.profile));
  const tasks = people
    .map((person) => ({ person, items: open.filter(rowMatcher<ItemRow>([person.toLowerCase()], 'brief-item', (r) => [r.title, r.text, r.people])) }))
    .filter((t) => t.items.length > 0);
  const hits = [...people.map((p) => queryWords(p)), queryWords(meeting.title ?? '')].map((words) =>
    rowMatcher<Fact>(words, 'brief', (f) => [f.text]));
  const claims = live(facts).filter((f) => !f.superseded_by && hits.some((hit) => hit(f))).sort((a, b) => factTime(b) - factTime(a)).slice(0, 3);
  return { tasks, claims };
}

// The hub tries this many times, 15 minutes apart, before it gives up on a transcript (TRIES in transcripts.ts).
export const TRANSCRIPT_TRIES = 8;

type MeetingState = 'upcoming' | 'live' | 'waiting' | 'done' | 'missing' | 'manual';

// Where a meeting is between the calendar and its transcript.
export function meetingState(m: Meeting, now = Date.now()): MeetingState {
  if (!m.id.startsWith('cal:')) return 'manual';
  if (m.starts_at != null && m.starts_at > now) return 'upcoming';
  if ((m.ends_at ?? m.starts_at ?? 0) > now) return 'live';
  if (m.transcript === 'missing') return 'missing';
  if (m.transcript === 'done' || (!m.transcript && m.summary)) return 'done';
  return 'waiting';
}

// Meetings whose title, people, notes, summary or decisions hold every word, and those the hub found in the
// transcript text (said, by profile:id).
export function searchMeetings<M extends Meeting>(meetings: M[], query: string, said?: ReadonlyMap<string, string>) {
  const words = queryWords(query);
  if (!words.length) return meetings;
  const hit = rowMatcher<Meeting>(words, 'meeting', (m) => [m.title, m.people, m.notes, m.summary, m.decisions]);
  return meetings.filter((m) => hit(m) || !!said?.has(`${m.profile}:${m.id}`));
}

export const trackedTopics = (m: Meeting, topics: string[]) =>
  topics.filter((t) => rowMatcher<Meeting>(queryWords(t), 'topic', (r) => [r.title, r.notes, r.summary, r.decisions])(m));

export type Question = { text: string; meeting: Meeting; at: number; profile: Profile };

export const questionKey = (q: Question) => `${q.profile}:${q.text.toLowerCase()}`;

// Unanswered questions from summaries and notes: sentences ending in "?" and bullets under a "Questions" heading. Identical text keeps the newest meeting.
const questionCache = new WeakMap<Meeting[], { from: number; until: number; list: Question[] }>();

// Cached per meetings array until the next meeting starts, since only that changes the answer.
export function openQuestions(meetings: Meeting[], now = Date.now()): Question[] {
  const hit = questionCache.get(meetings);
  if (hit && now >= hit.from && now < hit.until) return hit.list;
  const found = new Map<string, Question>();
  let until = Infinity;
  for (const meeting of live(meetings)) {
    const at = meeting.starts_at ?? meeting.updated_at;
    if (at > now) {
      until = Math.min(until, at);
      continue;
    }
    for (const text of [meeting.summary, meeting.notes]) {
      let under = false;
      for (const raw of (text ?? '').split('\n')) {
        const line = raw.trim();
        const bullet = /^([-*\u2022]|\d+[.)])\s+/.test(line);
        const plain = line.replace(/^([-*\u2022]|\d+[.)]|#+)\s+/, '').replace(/\*+/g, '').replace(/\S+:\/\/\S+/g, '').trim();
        if (!line) continue;
        if (!bullet) under = /^(open )?questions:?$/i.test(plain);
        const texts = under && bullet ? [plain] : plain.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((x) => x.endsWith('?'));
        for (const t of texts.map((x) => x.trim()).filter((x) => x.length > 1)) {
          const q = { text: t, meeting, at, profile: meeting.profile };
          const key = questionKey(q);
          if (!found.has(key) || found.get(key)!.at < at) found.set(key, q);
        }
      }
    }
  }
  const list = [...found.values()].sort((a, b) => b.at - a.at);
  questionCache.set(meetings, { from: now, until, list });
  return list;
}

type TopicEntry = { kind: 'meeting' | 'decision' | 'claim'; text: string; at: number; meeting?: Meeting; fact?: Fact };

// Past meetings, decisions and current claims matching the topic, newest first, plus how many are newer than `since`.
export function topicTimeline(topic: string, meetings: Meeting[], facts: Fact[], since = 0, max = 20, now = Date.now()) {
  const words = queryWords(topic);
  const hitMeeting = rowMatcher<Meeting>(words, 'topic-line', (m) => [m.title, m.summary]);
  const hit = matcher(words);
  const hitFact = rowMatcher<Fact>(words, 'text', (f) => [f.text]);
  const entries: TopicEntry[] = [
    ...live(meetings).filter(hitMeeting).map((meeting) => ({ kind: 'meeting' as const, text: meeting.title || 'Meeting', at: meeting.starts_at ?? meeting.updated_at, meeting })),
    ...decisionLog(meetings).filter((d) => hit(d.text)).map((d) => ({ kind: 'decision' as const, text: d.text, at: d.at, meeting: d.meeting })),
    ...live(facts).filter((f) => !f.superseded_by && hitFact(f)).map((fact) => ({ kind: 'claim' as const, text: fact.text ?? '', at: factTime(fact), fact })),
  ].filter((e) => e.at <= now).sort((a, b) => b.at - a.at);
  return { entries: entries.slice(0, max), fresh: entries.filter((e) => e.at > since).length };
}
