import { newId, type ItemRow, type Profile } from './sync';

export type Common = { id: string; profile: Profile; version: number; updated_at: number; deleted: number; field_times: string; dirty: number };

// state is proposed, live, rejected or retired; null means live.
export type Page = Common & { title: string | null; section: string | null; summary: string | null; sort: number | null; state: string | null };

export type Fact = Common & {
  text: string | null;
  item_id: string | null;
  superseded_by: string | null;
  page_id: string | null;
  heading: string | null;
  sources: string | null;
  at: number | null;
  contested: string | null;
  state: string | null;
  replaces: string | null;
  added_by: string | null;
};

export type Meeting = Common & {
  title: string | null;
  starts_at: number | null;
  ends_at: number | null;
  people: string | null;
  calendar_url: string | null;
  recorded_ms: number | null;
  notes: string | null;
  summary: string | null;
  decisions: string | null;
  transcript: string | null;
  tries: number | null;
  room: string | null;
  room_me: number | null;
  others: string | null;
};

export type Action = Common & {
  meeting_id: string | null;
  kind: string | null;
  target: string | null;
  title: string | null;
  body: string | null;
  fields: string | null;
  status: string | null;
  result_url: string | null;
};

export type Job = Common & { name: string | null; schedule: string | null; prompt: string | null; enabled: number | null; next_run_at: number | null };
export type Run = Common & { job_id: string | null; started_at: number | null; finished_at: number | null; status: string | null; output: string | null };

export type Chat = Common & { name: string | null; kind: string | null; url: string | null; summary: string | null; last_at: number | null };
export type Brief = Common & { kind: string | null; text: string | null; from_at: number | null; to_at: number | null };

export type Tables = { pages: Page; facts: Fact; meetings: Meeting; actions: Action; jobs: Job; runs: Run; chats: Chat; briefs: Brief };
export type Table = keyof Tables;

export type Source = { kind: 'meeting' | 'slack' | 'linear' | 'pr' | 'doc'; label: string; url?: string };
export type Contest = { by: string; at: number; note: string };

const json = <T,>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) ?? fallback;
  } catch {
    return fallback;
  }
};

const parsedSources = new WeakMap<Fact, Source[]>();
export const sourcesOf = (f: Fact) => {
  let v = parsedSources.get(f);
  if (!v) parsedSources.set(f, (v = json<Source[]>(f.sources, [])));
  return v;
};
export const contestOf = (f: Fact) => json<Contest | null>(f.contested, null);
export const listOf = (s: string | null) => {
  const v = json<unknown>(s, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};
export const fieldsOf = (a: Action) => json<Record<string, string>>(a.fields, {});

export const live = <T extends Common & { state?: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted && (r.state ?? 'live') === 'live');

const factKey = (f: { profile: string; id: string }) => `${f.profile}:${f.id}`;

// A claim is current unless a live claim supersedes it.
export function currentClaim(facts: Fact[]) {
  const alive = new Set(live(facts).map(factKey));
  return (f: Fact) => !f.superseded_by || !alive.has(`${f.profile}:${f.superseded_by}`);
}

// A claim older than this, or one retired by hand, moves to the page's Older section and out of what Claude is given.
export const RETIRE_AFTER = 90 * 86_400_000;
export const isOld = (f: Fact, now = Date.now()) => f.state === 'retired' || (f.state !== 'proposed' && f.at != null && f.at > 0 && now - f.at > RETIRE_AFTER);

// The claims shown on a page: current claims newest first under each heading, headings with the newest claim first,
// each claim with the claims it superseded, directly or down the chain. Old claims are left to olderClaims.
export function pageClaims(facts: Fact[], pageId: string | null, now = Date.now()) {
  const all = live(facts);
  const current = currentClaim(facts);
  const byKey = new Map(all.map((f) => [factKey(f), f]));
  const mine = all.filter((f) => (f.page_id ?? null) === pageId);
  const replaced = new Map<string, Fact[]>();
  for (const f of mine) {
    if (current(f)) continue;
    let top = f;
    const seen = new Set<string>();
    while (!current(top) && !seen.has(factKey(top))) {
      seen.add(factKey(top));
      top = byKey.get(`${top.profile}:${top.superseded_by}`)!;
    }
    if (current(top)) {
      const k = factKey(top);
      const list = replaced.get(k);
      if (list) list.push(f);
      else replaced.set(k, [f]);
    }
  }
  const groups: { heading: string; claims: { fact: Fact; old: Fact[] }[] }[] = [];
  for (const f of mine.filter((x) => current(x) && !isOld(x, now))) {
    const heading = f.heading || 'Notes';
    let g = groups.find((x) => x.heading === heading);
    if (!g) groups.push((g = { heading, claims: [] }));
    g.claims.push({ fact: f, old: (replaced.get(factKey(f)) ?? []).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) });
  }
  // Proposed claims show in place, so a new page reads as a whole while it waits for review.
  for (const f of proposals(facts).filter((x) => (x.page_id ?? null) === pageId)) {
    const heading = f.heading || 'Notes';
    let g = groups.find((x) => x.heading === heading);
    if (!g) groups.push((g = { heading, claims: [] }));
    g.claims.push({ fact: f, old: [] });
  }
  const newest = (g: (typeof groups)[number]) => Math.max(...g.claims.map((c) => c.fact.at ?? 0));
  for (const g of groups) g.claims.sort((a, b) => (b.fact.at ?? 0) - (a.fact.at ?? 0));
  return groups.sort((a, b) => newest(b) - newest(a));
}

// Retired claims and current ones past RETIRE_AFTER, newest first.
export function olderClaims(facts: Fact[], pageId: string | null, now = Date.now()) {
  const current = currentClaim(facts);
  return facts
    .filter((f) => !f.deleted && (f.page_id ?? null) === pageId && (f.state === 'retired' || ((f.state ?? 'live') === 'live' && current(f))) && isOld(f, now))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

export const factTime = (f: Fact) => Math.max(f.at ?? 0, contestOf(f)?.at ?? 0, f.updated_at);

export type PageStats = { claims: number; contested: number; updated: number };
export const NO_STATS: PageStats = { claims: 0, contested: 0, updated: 0 };

// Current claims per page in one pass; memory claims are under null.
export function statsByPage(facts: Fact[]) {
  const current = currentClaim(facts);
  const out = new Map<string | null, PageStats>();
  for (const f of live(facts)) {
    if (!current(f)) continue;
    const s = out.get(f.page_id ?? null) ?? { ...NO_STATS };
    s.claims++;
    if (f.contested) s.contested++;
    s.updated = Math.max(s.updated, factTime(f));
    out.set(f.page_id ?? null, s);
  }
  return out;
}

export const pageStats = (facts: Fact[], pageId: string | null) => statsByPage(facts).get(pageId) ?? NO_STATS;

export function newPage(title: string, section: string, sort: number, profile: Profile = 'work', now = Date.now()): Page {
  return {
    id: newId(), profile, version: 0, updated_at: now, deleted: 0, dirty: 1,
    field_times: JSON.stringify({ title: now, section: now, summary: now, sort: now }),
    title, section, summary: null, sort, state: null,
  };
}

export const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);
export const matcher = (words: string[]) => (...texts: (string | null | undefined)[]) => {
  const hay = texts.join(' ').toLowerCase();
  return words.length > 0 && words.every((w) => hay.includes(w));
};

const haystacks = new WeakMap<object, Map<string, string>>();

// Like matcher, but lowercases each row's text once per row object and field set.
export const rowMatcher = <R extends object>(words: string[], fields: string, texts: (r: R) => (string | null | undefined)[]) => (r: R) => {
  if (!words.length) return false;
  let byFields = haystacks.get(r);
  if (!byFields) haystacks.set(r, (byFields = new Map()));
  let hay = byFields.get(fields);
  if (hay === undefined) byFields.set(fields, (hay = texts(r).join(' ').toLowerCase()));
  return words.every((w) => hay.includes(w));
};

// Pages whose title or summary match every word, then current claims that do.
export function searchWiki(pages: Page[], facts: Fact[], query: string) {
  const words = queryWords(query);
  const hitPage = rowMatcher<Page>(words, 'page', (p) => [p.title, p.summary]);
  const hitFact = rowMatcher<Fact>(words, 'fact', (f) => [f.text, ...sourcesOf(f).map((s) => s.label)]);
  const current = currentClaim(facts);
  return {
    pages: live(pages).filter(hitPage),
    claims: live(facts).filter((f) => current(f) && hitFact(f)).slice(0, 30),
  };
}

export const proposals = (facts: Fact[]) => facts.filter((f) => !f.deleted && f.state === 'proposed').sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

// What the review list shows: one card per page with proposals, and one per claim without a page.
export function reviewCount(pages: Page[], facts: Fact[]) {
  const list = proposals(facts);
  const alive = new Set(pages.filter((p) => !p.deleted).map((p) => `${p.profile}:${p.id}`));
  const hasPage = (f: Fact) => !!f.page_id && alive.has(`${f.profile}:${f.page_id}`);
  return new Set(list.filter(hasPage).map((f) => `${f.profile}:${f.page_id}`)).size + list.filter((f) => !hasPage(f)).length;
}

export const chatOf = (f: Fact) => (f.added_by?.startsWith('claude:') ? f.added_by.slice(7) : null);

// Approving sets the claim live, its proposed page live, and supersedes the claim it replaces.
export function approveChanges(fact: Fact, pages: Page[], facts: Fact[]) {
  const page = pages.find((p) => p.id === fact.page_id && p.profile === fact.profile && p.state === 'proposed');
  const current = currentClaim(facts);
  const old = facts.find((f) => f.id === fact.replaces && f.profile === fact.profile && current(f));
  return [
    { table: 'facts' as const, row: fact, patch: { state: 'live' }, undo: { state: 'proposed' } },
    ...(page ? [{ table: 'pages' as const, row: page, patch: { state: 'live' }, undo: { state: 'proposed' } }] : []),
    ...(old ? [{ table: 'facts' as const, row: old, patch: { superseded_by: fact.id }, undo: { superseded_by: null } }] : []),
  ];
}

// Approving several claims at once sets their proposed pages live once.
export function approveAllChanges(list: Fact[], pages: Page[], facts: Fact[]) {
  const seen = new Set<string>();
  return list.flatMap((f) => approveChanges(f, pages, facts)).filter((c) => {
    const k = `${c.table}:${c.row.profile}:${c.row.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

// Meetings that have started, newest day first and in time order within a day. The future lives in Today and Upcoming.
export function groupMeetings(meetings: Meeting[], now = Date.now()) {
  const rows = live(meetings).filter((m) => m.starts_at != null && m.starts_at <= now);
  const today = dayStart(now);
  const groups: { label: string; rows: Meeting[] }[] = [];
  const sorted = rows.sort((a, b) => dayStart(b.starts_at!) - dayStart(a.starts_at!) || a.starts_at! - b.starts_at!);
  for (const m of sorted) {
    const label = dayStart(m.starts_at!) === today ? 'Today' : new Date(m.starts_at!).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
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

export type ActionCount = ReturnType<typeof actionCount>;
const counted = new WeakMap<ItemRow[], Map<string, ActionCount>>();

// Action counts for every meeting, built once per items array.
export function actionCounts(items: ItemRow[]) {
  let out = counted.get(items);
  if (!out) {
    out = new Map();
    for (const r of items) {
      if (r.deleted || !r.meeting_id) continue;
      const k = `${r.profile}:${r.meeting_id}`;
      let c = out.get(k);
      if (!c) out.set(k, (c = { total: 0, done: 0, review: 0, unassigned: 0, dismissed: 0 }));
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

export function actionCount(items: ItemRow[], m: { profile: Profile; id: string }) {
  const mine = actionsOf(items, m);
  const n = (...s: string[]) => mine.filter((r) => s.includes(r.status ?? '')).length;
  return { total: n('open', 'done'), done: n('done'), review: n('suggested'), unassigned: n('unassigned'), dismissed: n('dismissed') };
}

export const pinsOf = (items: ItemRow[], meetings: Meeting[]) => {
  const ids = new Set(meetings.map((m) => m.profile + m.id));
  return items.filter((r) => !r.deleted && r.status === 'note' && r.meeting_id && ids.has(r.profile + r.meeting_id)).sort((a, b) => b.updated_at - a.updated_at);
};

export const othersOf = (m: Meeting) => {
  const v = json<unknown>(m.others, []);
  return (Array.isArray(v) ? v : []).filter((o): o is { who: string; what: string } => typeof o?.who === 'string' && typeof o?.what === 'string');
};

export const peopleOf = (m: Meeting) => {
  const s = typeof m.people === 'string' ? m.people : '';
  return (s.startsWith('[') ? listOf(s) : s.split(',')).map((p) => p.trim()).filter(Boolean);
};

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Meetings the person attended, newest first.
export const meetingsOf = (meetings: Meeting[], person: string) =>
  live(meetings).filter((m) => peopleOf(m).some((p) => sameName(p, person))).sort((a, b) => (b.starts_at ?? 0) - (a.starts_at ?? 0));

export type Decision = { meeting: Meeting; text: string; at: number };

const decisionLogs = new WeakMap<Meeting[], Decision[]>();

// Every decision line from the meetings, newest meeting first, computed once per meetings array.
export const decisionLog = (meetings: Meeting[]): Decision[] => {
  let log = decisionLogs.get(meetings);
  if (!log) {
    log = live(meetings)
      .flatMap((meeting) => listOf(meeting.decisions).map((t) => t.trim()).filter(Boolean).map((text) => ({ meeting, text, at: meeting.starts_at ?? meeting.updated_at })))
      .sort((a, b) => b.at - a.at);
    decisionLogs.set(meetings, log);
  }
  return log;
};

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

// Earlier meetings of the same recurring series: equal title once dates and numbers are stripped, and at least half of the smaller guest list in common. Newest first.
export function seriesOf(meetings: Meeting[], m: Meeting) {
  const title = seriesTitle(m.title);
  const people = peopleOf(m);
  if (!title || m.starts_at == null) return [];
  return live(meetings)
    .filter((x) => {
      if (x.profile !== m.profile || x.id === m.id || x.starts_at == null || x.starts_at >= m.starts_at! || seriesTitle(x.title) !== title) return false;
      const other = peopleOf(x);
      if (!people.length || !other.length) return people.length === other.length;
      return people.filter((p) => other.some((q) => sameName(p, q))).length * 2 >= Math.min(people.length, other.length);
    })
    .sort((a, b) => b.starts_at! - a.starts_at!);
}

// Current claims whose text names the person.
export const claimsMentioning = (facts: Fact[], person: string) => {
  const name = person.trim().toLowerCase();
  if (!name) return [];
  return live(facts).filter((f) => !f.superseded_by && f.text?.toLowerCase().includes(name)).sort((a, b) => factTime(b) - factTime(a));
};

export type MeetingBrief = { tasks: { person: string; items: ItemRow[] }[]; claims: Fact[] };

// Open tasks that mention each attendee and up to three current claims that name an attendee or match the title.
export function briefFor(meeting: Meeting, items: ItemRow[], facts: Fact[]): MeetingBrief {
  const people = peopleOf(meeting);
  const open = items.filter((r) => !r.deleted && r.status === 'open' && r.source !== 'calendar' && !(r.meeting_id === meeting.id && r.profile === meeting.profile));
  const tasks = people
    .map((person) => {
      const name = person.toLowerCase();
      return { person, items: open.filter((r) => [r.title, r.text, r.people].join(' ').toLowerCase().includes(name)) };
    })
    .filter((t) => t.items.length > 0);
  const hits = [...people.map((p) => queryWords(p)), queryWords(meeting.title ?? '')].map((words) =>
    rowMatcher<Fact>(words, 'brief', (f) => [f.text]));
  const claims = live(facts).filter((f) => !f.superseded_by && hits.some((hit) => hit(f))).sort((a, b) => factTime(b) - factTime(a)).slice(0, 3);
  return { tasks, claims };
}

// The hub tries this many times, 15 minutes apart, before it gives up on a transcript (TRIES in transcripts.ts).
export const TRANSCRIPT_TRIES = 8;

export type MeetingState = 'upcoming' | 'live' | 'waiting' | 'done' | 'missing' | 'manual';

// Where a meeting is between the calendar and its transcript.
export function meetingState(m: Meeting, now = Date.now()): MeetingState {
  if (!m.id.startsWith('cal:')) return 'manual';
  if (m.starts_at != null && m.starts_at > now) return 'upcoming';
  if ((m.ends_at ?? m.starts_at ?? 0) > now) return 'live';
  if (m.transcript === 'missing') return 'missing';
  if (m.transcript === 'done' || (!m.transcript && m.summary)) return 'done';
  return 'waiting';
}

// Meetings whose title, people, notes, summary, decisions or transcript hold every word.
export function searchMeetings<M extends Meeting>(meetings: M[], query: string) {
  const words = queryWords(query);
  if (!words.length) return meetings;
  return meetings.filter(rowMatcher<Meeting>(words, 'meeting', (m) => [m.title, m.people, m.notes, m.summary, m.decisions, m.transcript]));
}

export const trackedTopics = (m: Meeting, topics: string[]) =>
  topics.filter((t) => rowMatcher<Meeting>(queryWords(t), 'topic', (r) => [r.title, r.notes, r.summary, r.decisions, r.transcript])(m));

export type Question = { text: string; meeting: Meeting; at: number; profile: Profile };

export const questionKey = (q: Question) => `${q.profile}:${q.text.toLowerCase()}`;

// Unanswered questions from summaries and notes: sentences ending in "?" and bullets under a "Questions" heading. Identical text keeps the newest meeting.
export function openQuestions(meetings: Meeting[], now = Date.now()): Question[] {
  const found = new Map<string, Question>();
  for (const meeting of live(meetings)) {
    const at = meeting.starts_at ?? meeting.updated_at;
    if (at > now) continue;
    let under = false;
    for (const raw of [meeting.summary, meeting.notes].flatMap((t) => (t ?? '').split('\n'))) {
      const line = raw.trim();
      const bullet = /^([-*\u2022]|\d+[.)])\s+/.test(line);
      const plain = line.replace(/^([-*\u2022]|\d+[.)]|#+)\s+/, '').replace(/\*+/g, '').replace(/\S+:\/\/\S+/g, '').trim();
      if (!line) continue;
      if (!bullet) under = /^(open )?questions:?$/i.test(plain);
      const texts = under && bullet ? [plain] : plain.match(/[^.!?]+\?/g) ?? [];
      for (const t of texts.map((x) => x.trim()).filter((x) => x.length > 1)) {
        const q = { text: t, meeting, at, profile: meeting.profile };
        const key = questionKey(q);
        if (!found.has(key) || found.get(key)!.at < at) found.set(key, q);
      }
    }
  }
  return [...found.values()].sort((a, b) => b.at - a.at);
}

export type TopicEntry = { kind: 'meeting' | 'decision' | 'claim'; text: string; at: number; meeting?: Meeting; fact?: Fact };

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
