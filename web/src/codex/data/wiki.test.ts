import { describe, expect, it } from 'vitest';
import type { ItemRow } from './sync';
import { actionCount, approveChanges, contestOf, groupMeetings, meetingState, pageClaims, pageStats, searchWiki, type Fact, type Meeting, type Page } from './wiki';

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

  it('collects a whole superseded chain and keeps claims whose replacement is not live', () => {
    const chain = [
      fact('n', 'p1', 'One', 'Newest'),
      fact('m', 'p1', 'One', 'Middle', { superseded_by: 'n', at: 2 }),
      fact('o', 'p1', 'One', 'Oldest', { superseded_by: 'm', at: 1 }),
      fact('k', 'p1', 'One', 'Kept', { superseded_by: 'r' }),
      fact('r', 'p1', 'One', 'Rejected', { state: 'rejected' }),
    ];
    const claims = pageClaims(chain, 'p1')[0].claims;
    expect(claims.map((c) => [c.fact.id, c.old.map((f) => f.id)])).toEqual([['n', ['m', 'o']], ['k', []]]);
    expect(pageStats(chain, 'p1').claims).toBe(2);
    const proposed = fact('x', 'p1', 'One', 'New', { state: 'proposed', replaces: 'k' });
    expect(approveChanges(proposed, [], chain).map((c) => c.row.id)).toEqual(['x', 'k']);
  });

  it('counts claims and contested claims per page', () => {
    expect(pageStats(facts, 'p1')).toMatchObject({ claims: 3, contested: 1 });
    expect(contestOf(facts[3])?.by).toBe('you');
  });

  it('shows proposed claims on their page, and leaves rejected ones and search out', () => {
    expect(pageClaims(facts, 'p1').flatMap((g) => g.claims.map((c) => c.fact.id))).toEqual(['a', 'c', 'e', 'b']);
    expect(pageStats(facts, 'p1').claims).toBe(3);
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
    ...common(id), title: id, starts_at, ends_at: null, people: null, calendar_url: null, recorded_ms: null, notes: null, summary: null, decisions: null, transcript: null, tries: null, room: null, room_me: null, others: null,
  });
  const action = (id: string, meeting_id: string, status: string): ItemRow => ({
    ...common(id), meeting_id, title: id, text: null, source: 'action', source_url: null, people: null, at: null, status, rolls: null, rolled_from: null, rank: null,
  });

  it('groups meetings that have started by day, newest day first', () => {
    const g = groupMeetings([meeting('later', at(2, 9)), meeting('soon', at(0, 14)), meeting('today', at(0, 10)), meeting('past2', at(-1, 14)), meeting('past1', at(-1, 9)), meeting('old', at(-3, 9))], now);
    expect(g[0].label).toBe('Today');
    expect(g.map((x) => x.rows.map((m) => m.id))).toEqual([['today'], ['past1', 'past2'], ['old']]);
  });

  it('tells where a meeting is between the calendar and its transcript', () => {
    const cal = (patch: Partial<Meeting>) => ({ ...meeting('cal:x', at(0, 9)), ends_at: at(0, 10), ...patch });
    expect(meetingState(cal({ starts_at: at(0, 13), ends_at: at(0, 14) }), now)).toBe('upcoming');
    expect(meetingState(cal({ ends_at: at(0, 13) }), now)).toBe('live');
    expect(meetingState(cal({}), now)).toBe('waiting');
    expect(meetingState(cal({ summary: 'x' }), now)).toBe('done');
    expect(meetingState(cal({ summary: 'x', transcript: 'waiting' }), now)).toBe('waiting');
    expect(meetingState(cal({ transcript: 'missing' }), now)).toBe('missing');
    expect(meetingState(meeting('notes', at(0, 9)), now)).toBe('manual');
  });

  it('counts my actions per meeting', () => {
    const actions = [action('a1', 'm', 'open'), action('a2', 'm', 'done'), action('a3', 'm', 'suggested'), action('a7', 'm', 'unassigned'), action('a8', 'm', 'dismissed'), action('a4', 'n', 'open'), { ...action('a5', 'm', 'done'), profile: 'personal' as const }, { ...action('a6', 'm', 'open'), deleted: 1 }];
    expect(actionCount(actions, { profile: 'work', id: 'm' })).toEqual({ total: 2, done: 1, review: 1, unassigned: 1, dismissed: 1 });
    expect(actionCount(actions, { profile: 'personal', id: 'm' })).toEqual({ total: 1, done: 1, review: 0, unassigned: 0, dismissed: 0 });
  });
});
