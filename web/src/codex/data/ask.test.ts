import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { askText } from './ask';
import type { ItemRow } from './sync';
import type { Meeting } from './wiki';

const PARAGRAPH = '\nRead these events in Calendar for location and notes. Then use Calendar, Gmail and web search to suggest concrete alternatives near where I am, each with opening hours and travel time. Change the calendar only after I confirm.';
const at = (days: number, h: number, m = 0) => new Date(2026, 10, 10 + days, h, m).getTime();
const meeting = (id: string, startsAt: number | null, extra: Partial<Meeting> = {}) =>
  ({ id, profile: 'personal', deleted: 0, state: 'live', title: id, starts_at: startsAt, others: null, ...extra }) as Meeting;
const item = { id: 'i1', profile: 'work', deleted: 0, status: 'open', title: 'Ship it', at: null, source: null, source_url: null, text: null } as unknown as ItemRow;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 10, 12));
});
afterEach(() => vi.useRealTimers());

it('keeps the work text free of plan context', () => {
  const others = meeting('sync', at(-1, 10), { profile: 'work', others: JSON.stringify([{ who: 'Kim', what: 'send the deck' }]) });
  const out = askText('what next', 'work', [item], undefined, [others]);
  expect(out).toContain('My open items in Codex:');
  expect(out).toContain('What others took on in recent meetings:');
  expect(out).toContain('Kim: send the deck');
  expect(out).toContain('Use my Slack, Calendar, Gmail and Linear connectors when the question needs them.');
  for (const word of ['web search', 'opening hours', 'travel time', 'confirm', 'personal meetings']) expect(out).not.toContain(word);
});

it('lists personal meetings from today to the end of today+3 in start order', () => {
  const meetings = [
    meeting('late', at(3, 23)),
    meeting('earlier-today', at(0, 8)),
    meeting('tomorrow', at(1, 9, 30)),
    meeting('too-far', at(4, 0)),
    meeting('work', at(1, 10), { profile: 'work' }),
    meeting('deleted', at(1, 11), { deleted: 1 }),
    meeting('no-start', null),
  ];
  const out = askText('plans?', 'personal', [item], undefined, meetings);
  const plans = out.split('\n').filter((l) => l.startsWith('- ') && / \d\d:\d\d /.test(l));
  expect(plans.map((l) => l.split(' ').pop())).toEqual(['earlier-today', 'tomorrow', 'late']);
  expect(plans[0]).toMatch(/ 08:00 earlier-today$/);
  expect(plans[2]).toMatch(/ 23:00 late$/);
  expect(out).toContain('My personal meetings, today and the next 3 days:');
  expect(out).toContain('My open items in Codex:');
  expect(out).not.toContain('others took on');
  expect(out).not.toContain('Linear');
  expect(out.endsWith(PARAGRAPH)).toBe(true);
  for (const word of ['Calendar', 'Gmail', 'web search', 'opening hours', 'travel time', 'confirm']) expect(out).toContain(word);
});

it('says so when no personal meeting is in the window', () => {
  const out = askText('plans?', 'personal', [], undefined, [meeting('too-far', at(4, 9))]);
  expect(out).toContain('No personal meetings in the next 3 days.\n' + PARAGRAPH);
});
