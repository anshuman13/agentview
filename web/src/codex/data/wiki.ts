import { decisionKey, keyWords, mayChange, titleWords } from '../../../../shared/claimMatch';
import { newId, rowKey, type Profile } from './sync';

type Common = { id: string; profile: Profile; version: number; updated_at: number; deleted: number; field_times: string; dirty: number };

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
export const othersOf = (m: Meeting) => {
  const v = json<unknown>(m.others, []);
  return (Array.isArray(v) ? v : []).filter((o): o is { who: string; what: string } => typeof o?.who === 'string' && typeof o?.what === 'string');
};

export const live = <T extends Common & { state?: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted && (r.state ?? 'live') === 'live');


// A claim is current unless a live claim supersedes it.
export function currentClaim(facts: Fact[]) {
  const alive = new Set(live(facts).map(rowKey));
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
  const byKey = new Map(all.map((f) => [rowKey(f), f]));
  const mine = all.filter((f) => (f.page_id ?? null) === pageId);
  const replaced = new Map<string, Fact[]>();
  for (const f of mine) {
    if (current(f)) continue;
    let top = f;
    const seen = new Set<string>();
    while (!current(top) && !seen.has(rowKey(top))) {
      seen.add(rowKey(top));
      top = byKey.get(`${top.profile}:${top.superseded_by}`)!;
    }
    if (current(top)) {
      const k = rowKey(top);
      const list = replaced.get(k);
      if (list) list.push(f);
      else replaced.set(k, [f]);
    }
  }
  const groups: { heading: string; claims: { fact: Fact; old: Fact[] }[] }[] = [];
  const add = (fact: Fact, old: Fact[]) => {
    const heading = fact.heading || 'Notes';
    let g = groups.find((x) => x.heading === heading);
    if (!g) groups.push((g = { heading, claims: [] }));
    g.claims.push({ fact, old });
  };
  for (const f of mine.filter((x) => current(x) && !isOld(x, now))) add(f, (replaced.get(rowKey(f)) ?? []).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)));
  // Proposed claims show in place, so a new page reads as a whole while it waits for review.
  for (const f of proposals(facts).filter((x) => (x.page_id ?? null) === pageId)) add(f, []);
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

// Current claims that a later decision (last `days` days) may change: the decision names the claim's page and shares at least two key words with the claim. Claims with a proposed replacement are left to Review. Newest decision first, one per claim.
export function driftFacts(facts: Fact[], pages: Page[], meetings: Meeting[], now = Date.now(), days = 90) {
  const cutoff = now - days * 86_400_000;
  const decisions = decisionLog(meetings).filter((d) => d.at > cutoff && d.at <= now).map((d) => ({ d, key: decisionKey(d.text, d.meeting.title) }));
  const pageWords = new Map(live(pages).map((p) => [`${p.profile}:${p.id}`, titleWords(p.title ?? '')]));
  const current = currentClaim(facts);
  const pending = new Set(proposals(facts).filter((f) => f.replaces).map((f) => `${f.profile}:${f.replaces}`));
  const out: { fact: Fact; decision: Decision }[] = [];
  for (const f of live(facts)) {
    if (!current(f) || !f.page_id || pending.has(`${f.profile}:${f.id}`)) continue;
    const title = pageWords.get(`${f.profile}:${f.page_id}`);
    if (!title?.length) continue;
    const words = keyWords(f.text ?? '');
    const hit = decisions.find(({ d, key }) => d.meeting.profile === f.profile && d.at > factTime(f) && mayChange(key, words, title));
    if (hit) out.push({ fact: f, decision: hit.d });
  }
  return out.sort((a, b) => b.decision.at - a.decision.at);
}

// Current claims on a page whose own time is older than days and which no recent meeting about the page's title touches; oldest first.
export function staleFacts(facts: Fact[], pages: Page[], meetings: Meeting[], now = Date.now(), days = 90) {
  const cutoff = now - days * 86_400_000;
  const current = currentClaim(facts);
  const title = new Map(live(pages).map((p) => [`${p.profile}:${p.id}`, p.title]));
  const recent = live(meetings).filter((m) => (m.starts_at ?? 0) > cutoff);
  const touched = new Map<string, boolean>();
  const mentioned = (key: string) => {
    let v = touched.get(key);
    if (v === undefined) {
      const hit = rowMatcher<Meeting>(queryWords(title.get(key) ?? ''), 'stale', (m) => [m.title, m.summary, m.decisions]);
      touched.set(key, (v = recent.some(hit)));
    }
    return v;
  };
  return live(facts)
    .filter((f) => f.page_id && title.has(`${f.profile}:${f.page_id}`) && current(f) && factTime(f) < cutoff && !mentioned(`${f.profile}:${f.page_id}`))
    .sort((a, b) => factTime(a) - factTime(b));
}

export const proposals = (facts: Fact[]) => facts.filter((f) => !f.deleted && f.state === 'proposed').sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

// What the review list shows: one card per page with proposals, and one per claim that has no page or replaces a claim on a live page.
export function reviewGroups(pages: Page[], facts: Fact[]) {
  const list = proposals(facts);
  const alive = new Map(pages.filter((p) => !p.deleted).map((p) => [`${p.profile}:${p.id}`, p]));
  const byPage = new Map<string, { page: Page; list: Fact[] }>();
  const loose: Fact[] = [];
  for (const f of list) {
    const page = f.page_id ? alive.get(`${f.profile}:${f.page_id}`) : undefined;
    if (!page || (f.replaces && page.state !== 'proposed')) {
      loose.push(f);
      continue;
    }
    const k = `${f.profile}:${page.id}`;
    const g = byPage.get(k);
    if (g) g.list.push(f);
    else byPage.set(k, { page, list: [f] });
  }
  return { byPage: [...byPage.values()], loose };
}

export function reviewCount(pages: Page[], facts: Fact[]) {
  const { byPage, loose } = reviewGroups(pages, facts);
  return byPage.length + loose.length;
}

export const chatOf = (f: Fact) => (f.added_by?.startsWith('claude:') ? f.added_by.slice(7) : null);
export const meetingOf = (f: Fact) => (f.added_by?.startsWith('meeting:') ? f.added_by.slice(8) : null);

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

// Current claims whose text names the person.
export const claimsMentioning = (facts: Fact[], person: string) => {
  const name = person.trim().toLowerCase();
  if (!name) return [];
  return live(facts).filter((f) => !f.superseded_by && f.text?.toLowerCase().includes(name)).sort((a, b) => factTime(b) - factTime(a));
};
