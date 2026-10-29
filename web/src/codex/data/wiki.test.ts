import { describe, expect, it } from 'vitest';
import type { ItemRow } from './sync';
import { actionCount, briefFor, decisionLog, decisionsWith, approveChanges, claimsMentioning, commitmentsOf, meetingsOf, priorWith, seriesOf, contestOf, olderClaims, RETIRE_AFTER, groupMeetings, meetingState, pageClaims, pageStats, reviewCount, searchMeetings, searchWiki, trackedTopics, type Fact, type Meeting, type Page } from './wiki';

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

  it('shows proposed claims on their page, and leaves rejected ones and search out', () => {
    expect(pageClaims(facts, 'p1').flatMap((g) => g.claims.map((c) => c.fact.id)).sort()).toEqual(['a', 'b', 'c', 'e']);
    expect(pageStats(facts, 'p1').claims).toBe(3);
    expect(searchWiki(pages, facts, 'epsilon').claims).toEqual([]);
    expect(searchWiki(pages, facts, 'zeta').claims).toEqual([]);
  });

  it('counts one review per page and one per claim without a page', () => {
    const more = [...facts, fact('g', 'p1', 'Two', 'Eta proposal', { state: 'proposed' }), fact('h', null as unknown as string, 'One', 'Memory proposal', { state: 'proposed' })];
    expect(reviewCount(pages, more)).toBe(2);
  });

  it('sorts claims newest first and moves retired and aged ones to Older', () => {
    const now = 10 * RETIRE_AFTER;
    const dated = [
      fact('x1', 'p1', 'One', 'Early', { at: now - 1000 }),
      fact('x2', 'p1', 'One', 'Late', { at: now - 10 }),
      fact('x3', 'p1', 'Two', 'Latest', { at: now - 1 }),
      fact('x4', 'p1', 'One', 'Ancient', { at: now - RETIRE_AFTER - 1 }),
      fact('x5', 'p1', 'One', 'Retired by hand', { at: now - 5, state: 'retired' }),
    ];
    const groups = pageClaims(dated, 'p1', now);
    expect(groups.map((g) => g.claims.map((c) => c.fact.id))).toEqual([['x3'], ['x2', 'x1']]);
    expect(olderClaims(dated, 'p1', now).map((f) => f.id)).toEqual(['x5', 'x4']);
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

  it('searches decisions and transcripts as well as titles', () => {
    const a = { ...meeting('Planning', at(0, 9)), decisions: 'Ship the Pricing page' };
    const b = { ...meeting('Sync', at(0, 10)), transcript: 'we talked about pricing and budget' };
    const c = meeting('Other', at(0, 11));
    expect(searchMeetings([a, b, c], 'pricing').map((m) => m.id)).toEqual(['Planning', 'Sync']);
    expect(searchMeetings([a, b, c], 'pricing budget').map((m) => m.id)).toEqual(['Sync']);
    expect(searchMeetings([a, b, c], '  ')).toHaveLength(3);
  });

  it('lists the tracked topics a meeting mentions', () => {
    const m = { ...meeting('Sync', at(0, 10)), summary: 'Agreed the Q4 Budget', transcript: 'hiring plan' };
    expect(trackedTopics(m, ['budget', 'hiring', 'launch', 'q4 budget', ' '])).toEqual(['budget', 'hiring', 'q4 budget']);
    expect(trackedTopics(m, [])).toEqual([]);
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

describe('people', () => {
  const meeting = (id: string, startsAt: number, people: string, others: unknown[] = []): Meeting => ({
    ...common(id), title: id, starts_at: startsAt, ends_at: null, people, calendar_url: null, recorded_ms: null, notes: null, summary: null,
    decisions: null, transcript: null, tries: null, room: null, room_me: null, others: JSON.stringify(others),
  });
  const ms = [
    meeting('old', 1, 'Ada Lovelace, Bob Ray', [{ who: 'Ada Lovelace', what: 'Send the draft' }, { who: 'Bob Ray', what: 'Book a room' }]),
    meeting('new', 5, JSON.stringify(['ada lovelace']), [{ who: 'ada lovelace', what: 'Review the plan' }]),
    meeting('none', 9, 'Bob Ray'),
  ];

  it('lists only that person commitments', () => {
    expect(commitmentsOf(ms, 'Ada Lovelace').map((c) => [c.meeting.id, c.what])).toEqual([['new', 'Review the plan'], ['old', 'Send the draft']]);
  });

  it('logs decision lines newest first and filters by person', () => {
    const withDecisions = [
      { ...ms[0], decisions: JSON.stringify(['Ship on Friday', ' ']) },
      { ...ms[1], decisions: JSON.stringify(['Drop the beta']) },
      { ...ms[2], decisions: JSON.stringify(['Hire one more']), deleted: 1 },
      ms[2],
    ];
    const log = decisionLog(withDecisions);
    expect(log.map((d) => d.text)).toEqual(['Drop the beta', 'Ship on Friday']);
    expect(decisionsWith(log, 'Bob Ray').map((d) => d.text)).toEqual(['Ship on Friday']);
    expect(decisionsWith(log, '')).toHaveLength(2);
    expect(decisionLog([])).toEqual([]);
  });

  it('finds live claims that name the person', () => {
    const fs = [fact('x', 'p1', 'H', 'Ada Lovelace owns it'), fact('y', 'p1', 'H', 'Nobody'), fact('z', 'p1', 'H', 'ada lovelace old', { superseded_by: 'x' })];
    expect(claimsMentioning(fs, 'Ada Lovelace').map((f) => f.id)).toEqual(['x']);
  });
});

describe('priorWith', () => {
  const mtg = (id: string, title: string, startsAt: number, extra: Partial<Meeting> = {}): Meeting => ({
    ...common(id), title, starts_at: startsAt, ends_at: null, people: null, calendar_url: null, recorded_ms: null, notes: null, summary: null, decisions: null, transcript: null, tries: null, room: null, room_me: null, others: null, ...extra,
  });
  const task = (id: string, meetingId: string, status: string): ItemRow => ({
    ...common(id), title: id, text: null, source: 'meeting', source_url: null, people: null, at: null, status, meeting_id: meetingId, rolls: null, rolled_from: null, rank: null,
  });
  const next = mtg('next', 'Planning', 1000, { people: JSON.stringify(['Ola', 'Kari']) });

  it('returns the last two earlier meetings sharing an attendee or title, newest first', () => {
    const meetings = [
      mtg('m1', 'Other', 100, { people: 'ola' }), mtg('m2', 'Planning', 200), mtg('m3', 'Sync', 300, { people: 'Kari, Per' }),
      mtg('m4', 'Unrelated', 400, { people: 'Per' }), mtg('later', 'Planning', 2000), next,
    ];
    expect(priorWith(next, meetings, []).map((p) => p.meeting.id)).toEqual(['m3', 'm2']);
  });

  it('skips deleted meetings and the meeting itself', () => {
    const meetings = [mtg('gone', 'Planning', 500, { deleted: 1 }), mtg('m1', 'Planning', 100), next];
    expect(priorWith(next, meetings, []).map((p) => p.meeting.id)).toEqual(['m1']);
  });

  it('carries decisions and only open actions', () => {
    const m = mtg('m1', 'Planning', 100, { decisions: JSON.stringify(['Ship it', 'Cut scope']) });
    const items = [task('a', 'm1', 'open'), task('b', 'm1', 'done'), task('c', 'm1', 'suggested'), task('d', 'm1', 'open'), task('e', 'other', 'open')];
    const [p] = priorWith(next, [m, next], items);
    expect(p.decisions).toEqual(['Ship it', 'Cut scope']);
    expect(p.open.map((r) => r.id)).toEqual(['a', 'd']);
  });

});

describe('seriesOf', () => {
  const mtg = (id: string, title: string, startsAt: number, extra: Partial<Meeting> = {}): Meeting => ({
    ...common(id), title, starts_at: startsAt, ends_at: null, people: null, calendar_url: null, recorded_ms: null, notes: null, summary: null, decisions: null, transcript: null, tries: null, room: null, room_me: null, others: null, ...extra,
  });
  const ids = (m: Meeting, all: Meeting[]) => seriesOf([...all, m], m).map((x) => x.id);
  const four = 'Ola, Kari, Per, Eva';
  const cur = mtg('cur', 'Team stand-up #12', 1000, { people: four });

  it('matches titles with dates and numbers stripped, newest first, prior only', () => {
    const all = [
      mtg('a', 'Team Stand-up (Oct 22)', 100, { people: four }), mtg('b', 'team stand-up 2026-10-15', 300, { people: four }),
      mtg('c', 'Team stand-up Oct 8', 200, { people: four }), mtg('x', 'Retro', 400, { people: four }),
      mtg('later', 'Team stand-up #13', 2000, { people: four }), mtg('gone', 'Team stand-up', 500, { people: four, deleted: 1 }),
    ];
    expect(ids(cur, all)).toEqual(['b', 'c', 'a']);
  });

  it('needs half of the smaller guest list in common', () => {
    const all = [mtg('half', 'Team stand-up', 100, { people: 'ola, Kari' }), mtg('few', 'Team stand-up', 200, { people: 'Ola, Zed, Max' }), mtg('none', 'Team stand-up', 300)];
    expect(ids(cur, all)).toEqual(['half']);
    expect(ids(mtg('bare', 'Weekly', 1000), [mtg('p', 'Weekly #3', 100), mtg('q', 'Weekly', 200, { people: 'Ola' })])).toEqual(['p']);
  });

  it('excludes the other profile', () => {
    expect(ids(cur, [mtg('w', 'Team stand-up', 100, { people: four, profile: 'personal' })])).toEqual([]);
  });
});

describe('briefFor', () => {
  const mtg = (people: string | null, title = 'Planning'): Meeting => ({
    ...common('next'), title, starts_at: 1000, ends_at: null, people, calendar_url: null, recorded_ms: null, notes: null, summary: null, decisions: null, transcript: null, tries: null, room: null, room_me: null, others: null,
  });
  const task = (id: string, title: string, extra: Partial<ItemRow> = {}): ItemRow => ({
    ...common(id), title, text: null, source: 'manual', source_url: null, people: null, at: null, status: 'open', meeting_id: null, rolls: null, rolled_from: null, rank: null, ...extra,
  });

  it('lists open tasks that mention an attendee', () => {
    const items = [task('a', 'Send Ola the budget'), task('b', 'Other', { people: 'Kari' }), task('c', 'Ask Ola', { status: 'done' }), task('d', 'Ola call', { deleted: 1 }), task('e', 'Nothing')];
    const { tasks } = briefFor(mtg('Ola, Kari'), items, []);
    expect(tasks.map((t) => [t.person, t.items.map((r) => r.id)])).toEqual([['Ola', ['a']], ['Kari', ['b']]]);
  });

  it('returns up to three current claims naming an attendee or matching the title', () => {
    const fs = [
      fact('1', 'p1', 'H', 'Ola owns billing', { at: 1 }), fact('2', 'p1', 'H', 'Planning happens monthly', { at: 2 }), fact('3', 'p1', 'H', 'Ola likes tea', { at: 3 }),
      fact('4', 'p1', 'H', 'Ola old', { at: 4, superseded_by: '3' }), fact('5', 'p1', 'H', 'Ola proposed', { state: 'proposed' }), fact('6', 'p1', 'H', 'Ola again', { at: 5 }), fact('7', 'p1', 'H', 'Unrelated'),
    ];
    expect(briefFor(mtg('Ola'), [], fs).claims.map((f) => f.id)).toEqual(['6', '3', '2']);
  });

});
