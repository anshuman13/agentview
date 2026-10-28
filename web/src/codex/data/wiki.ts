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

export const sourcesOf = (f: Fact) => json<Source[]>(f.sources, []);
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
    if (current(top)) replaced.set(factKey(top), [...(replaced.get(factKey(top)) ?? []), f]);
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

// Pages whose title or summary match every word, then current claims that do.
export function searchWiki(pages: Page[], facts: Fact[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (...texts: (string | null)[]) => {
    const hay = texts.join(' ').toLowerCase();
    return words.length > 0 && words.every((w) => hay.includes(w));
  };
  const current = currentClaim(facts);
  return {
    pages: live(pages).filter((p) => hit(p.title, p.summary)),
    claims: live(facts).filter((f) => current(f) && hit(f.text, ...sourcesOf(f).map((s) => s.label))).slice(0, 30),
  };
}

export const proposals = (facts: Fact[]) => facts.filter((f) => !f.deleted && f.state === 'proposed').sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

// What the review list shows: one card per page with proposals, and one per claim without a page.
export function reviewCount(pages: Page[], facts: Fact[]) {
  const list = proposals(facts);
  const hasPage = (f: Fact) => !!f.page_id && pages.some((p) => p.id === f.page_id && p.profile === f.profile && !p.deleted);
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

const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

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

export type ActionCount = ReturnType<typeof actionCount>;
const counted = new WeakMap<ItemRow[], Map<string, ActionCount>>();

// Action counts for every meeting, built once per items array.
export function actionCounts(items: ItemRow[]) {
  let out = counted.get(items);
  if (!out) {
    const byMeeting = new Map<string, ItemRow[]>();
    for (const r of items) {
      if (r.deleted || !r.meeting_id) continue;
      const k = `${r.profile}:${r.meeting_id}`;
      byMeeting.set(k, [...(byMeeting.get(k) ?? []), r]);
    }
    out = new Map([...byMeeting].map(([k, rows]) => [k, actionCount(rows, { profile: rows[0].profile, id: rows[0].meeting_id! })]));
    counted.set(items, out);
  }
  return out;
}

export function actionCount(items: ItemRow[], m: { profile: Profile; id: string }) {
  const mine = actionsOf(items, m);
  const n = (...s: string[]) => mine.filter((r) => s.includes(r.status ?? '')).length;
  return { total: n('open', 'done'), done: n('done'), review: n('suggested'), unassigned: n('unassigned'), dismissed: n('dismissed') };
}

export const othersOf = (m: Meeting) => {
  const v = json<unknown>(m.others, []);
  return (Array.isArray(v) ? v : []).filter((o): o is { who: string; what: string } => typeof o?.who === 'string' && typeof o?.what === 'string');
};

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
