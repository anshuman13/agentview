import type { ItemRow, Profile } from './sync';

export type Common = { id: string; profile: Profile; version: number; updated_at: number; deleted: number; field_times: string; dirty: number };

// state is proposed, live or rejected; null means live.
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

export type Tables = { pages: Page; facts: Fact; meetings: Meeting; actions: Action };
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
export const listOf = (s: string | null) => json<string[]>(s, []);
export const fieldsOf = (a: Action) => json<Record<string, string>>(a.fields, {});

export const live = <T extends Common & { state?: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted && (r.state ?? 'live') === 'live');

const factKey = (f: { profile: string; id: string }) => `${f.profile}:${f.id}`;

// A claim is current unless a live claim supersedes it.
export function currentClaim(facts: Fact[]) {
  const alive = new Set(live(facts).map(factKey));
  return (f: Fact) => !f.superseded_by || !alive.has(`${f.profile}:${f.superseded_by}`);
}

// The claims shown on a page: current claims in heading order, each with the claims it superseded, directly or down the chain.
export function pageClaims(facts: Fact[], pageId: string | null) {
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
  for (const f of mine.filter(current)) {
    const heading = f.heading || 'Notes';
    let g = groups.find((x) => x.heading === heading);
    if (!g) groups.push((g = { heading, claims: [] }));
    g.claims.push({ fact: f, old: (replaced.get(factKey(f)) ?? []).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) });
  }
  return groups;
}

export const factTime = (f: Fact) => Math.max(f.at ?? 0, contestOf(f)?.at ?? 0, f.updated_at);

export function pageStats(facts: Fact[], pageId: string | null) {
  const current = currentClaim(facts);
  const mine = live(facts).filter((f) => (f.page_id ?? null) === pageId && current(f));
  return { claims: mine.length, contested: mine.filter((f) => f.contested).length, updated: Math.max(0, ...mine.map(factTime)) };
}

export function newPage(title: string, section: string, sort: number, profile: Profile = 'work', now = Date.now()): Page {
  return {
    id: crypto.randomUUID(), profile, version: 0, updated_at: now, deleted: 0, dirty: 1,
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

const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

// Today, then upcoming soonest first, then past days newest first.
export function groupMeetings(meetings: Meeting[], now = Date.now()) {
  const rows = live(meetings).filter((m) => m.starts_at != null);
  const today = dayStart(now);
  const groups: { label: string; rows: Meeting[] }[] = [];
  const add = (label: string, rs: Meeting[]) => rs.length && groups.push({ label, rows: rs });
  add('Today', rows.filter((m) => dayStart(m.starts_at!) === today).sort((a, b) => a.starts_at! - b.starts_at!));
  add('Upcoming', rows.filter((m) => dayStart(m.starts_at!) > today).sort((a, b) => a.starts_at! - b.starts_at!));
  const past = rows.filter((m) => dayStart(m.starts_at!) < today).sort((a, b) => dayStart(b.starts_at!) - dayStart(a.starts_at!) || a.starts_at! - b.starts_at!);
  for (const m of past) {
    const label = new Date(m.starts_at!).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    const last = groups[groups.length - 1];
    if (last?.label === label) last.rows.push(m);
    else groups.push({ label, rows: [m] });
  }
  return groups;
}

// A meeting's actions are the tasks linked to it: suggested ones wait for me to keep or dismiss them.
export const actionsOf = (items: ItemRow[], m: { profile: Profile; id: string }) => items.filter((r) => !r.deleted && r.meeting_id === m.id && r.profile === m.profile);

export function actionCount(items: ItemRow[], m: { profile: Profile; id: string }) {
  const mine = actionsOf(items, m);
  return { total: mine.filter((r) => r.status !== 'suggested').length, done: mine.filter((r) => r.status === 'done').length, review: mine.filter((r) => r.status === 'suggested').length };
}
