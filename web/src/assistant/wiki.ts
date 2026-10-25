import type { Profile } from './sync';

export type Common = { id: string; profile: Profile; version: number; updated_at: number; deleted: number; field_times: string; dirty: number };

export type Page = Common & { title: string | null; section: string | null; summary: string | null; sort: number | null };

export type Fact = Common & {
  text: string | null;
  item_id: string | null;
  superseded_by: string | null;
  page_id: string | null;
  heading: string | null;
  sources: string | null;
  at: number | null;
  contested: string | null;
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

export const live = <T extends Common>(rows: T[]) => rows.filter((r) => !r.deleted);

// The claims shown on a page: current claims in heading order, each with the claims it superseded.
export function pageClaims(facts: Fact[], pageId: string) {
  const mine = live(facts).filter((f) => f.page_id === pageId);
  const replaced = new Map<string, Fact[]>();
  for (const f of mine) if (f.superseded_by) replaced.set(f.superseded_by, [...(replaced.get(f.superseded_by) ?? []), f]);
  const groups: { heading: string; claims: { fact: Fact; old: Fact[] }[] }[] = [];
  for (const f of mine.filter((x) => !x.superseded_by)) {
    const heading = f.heading || 'Notes';
    let g = groups.find((x) => x.heading === heading);
    if (!g) groups.push((g = { heading, claims: [] }));
    g.claims.push({ fact: f, old: (replaced.get(f.id) ?? []).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) });
  }
  return groups;
}

export const factTime = (f: Fact) => Math.max(f.at ?? 0, contestOf(f)?.at ?? 0, f.updated_at);

export function pageStats(facts: Fact[], pageId: string) {
  const mine = live(facts).filter((f) => f.page_id === pageId && !f.superseded_by);
  return { claims: mine.length, contested: mine.filter((f) => f.contested).length, updated: Math.max(0, ...mine.map(factTime)) };
}
