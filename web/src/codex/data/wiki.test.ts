import { describe, expect, it } from 'vitest';
import { actionCount, contestOf, groupMeetings, pageClaims, pageStats, searchWiki, type Action, type Fact, type Meeting, type Page } from './wiki';

const common = (id: string) => ({ id, profile: 'work' as const, version: 0, updated_at: 0, deleted: 0, field_times: '{}', dirty: 0 });
const page = (id: string, title: string): Page => ({ ...common(id), title, section: 'Pages', summary: null, sort: 0, state: null });
const fact = (id: string, pageId: string, heading: string, text: string, extra: Partial<Fact> = {}): Fact => ({
  ...common(id), text, item_id: null, superseded_by: null, page_id: pageId, heading, sources: null, at: 0, contested: null, state: null, replaces: null, added_by: null, ...extra,
});

const pages = [page('p1', 'First'), page('p2', 'Second')];
const facts = [
  fact('a', 'p1', 'One', 'Alpha claim'),
  fact('b', 'p1', 'Two', 'Beta claim', { sources: JSON.stringify([{ kind: 'linear', label: 'X-1' }]) }),
  fact('b0', 'p1', 'Two', 'Old beta claim', { superseded_by: 'b' }),
  fact('c', 'p1', 'One', 'Gamma claim', { contested: JSON.stringify({ by: 'you', at: 1, note: 'wrong' }) }),
  fact('d', 'p2', 'One', 'Delta claim', { sources: JSON.stringify([{ kind: 'linear', label: 'X-1' }]) }),
  fact('e', 'p1', 'One', 'Epsilon proposal', { state: 'proposed' }),
  fact('f', 'p1', 'One', 'Zeta rejected', { state: 'rejected' }),
];

describe('wiki', () => {
  it('groups current claims by heading and keeps the ones they replaced', () => {
    const groups = pageClaims(facts, 'p1');
    expect(groups.map((g) => g.heading)).toEqual(['One', 'Two']);
    expect(groups[1].claims[0].old.map((f) => f.id)).toEqual(['b0']);
    expect(groups.flatMap((g) => g.claims).some((c) => c.fact.superseded_by)).toBe(false);
  });

  it('counts claims and contested claims per page', () => {
    expect(pageStats(facts, 'p1')).toMatchObject({ claims: 3, contested: 1 });
    expect(contestOf(facts[3])?.by).toBe('you');
  });

  it('leaves proposed and rejected claims out of pages and search', () => {
    expect(pageClaims(facts, 'p1').flatMap((g) => g.claims.map((c) => c.fact.id))).toEqual(['a', 'c', 'b']);
    expect(searchWiki(pages, facts, 'epsilon').claims).toEqual([]);
    expect(searchWiki(pages, facts, 'zeta').claims).toEqual([]);
  });

  it('matches every word in pages and current claims', () => {
    expect(searchWiki(pages, facts, 'beta claim').claims.map((f) => f.id)).toEqual(['b']);
    expect(searchWiki(pages, facts, 'second').pages.map((p) => p.id)).toEqual(['p2']);
    expect(searchWiki(pages, facts, 'x-1').claims).toHaveLength(2);
    expect(searchWiki(pages, facts, '  ')).toEqual({ pages: [], claims: [] });
  });
});

describe('meetings', () => {
  const now = new Date(2026, 9, 25, 12).getTime();
  const at = (days: number, hour: number) => new Date(2026, 9, 25 + days, hour).getTime();
  const meeting = (id: string, starts_at: number): Meeting => ({
    ...common(id), title: id, starts_at, ends_at: null, people: null, calendar_url: null, recorded_ms: null, notes: null, summary: null, decisions: null,
  });
  const action = (id: string, meeting_id: string, status: string): Action => ({
    ...common(id), meeting_id, kind: 'task', target: null, title: id, body: null, fields: null, status, result_url: null,
  });

  it('groups today, upcoming and past days', () => {
    const g = groupMeetings([meeting('later', at(2, 9)), meeting('today', at(0, 10)), meeting('past2', at(-1, 14)), meeting('past1', at(-1, 9)), meeting('old', at(-3, 9))], now);
    expect(g.map((x) => x.label).slice(0, 2)).toEqual(['Today', 'Upcoming']);
    expect(g.map((x) => x.rows.map((m) => m.id))).toEqual([['today'], ['later'], ['past1', 'past2'], ['old']]);
  });

  it('counts handled actions', () => {
    const actions = [action('a1', 'm', 'proposed'), action('a2', 'm', 'approved'), action('a3', 'n', 'rejected')];
    expect(actionCount(actions, 'm')).toEqual({ total: 2, handled: 1 });
  });
});
