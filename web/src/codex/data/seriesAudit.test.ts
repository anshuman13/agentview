process.env.TZ = 'Europe/Oslo';

import { expect, it } from 'vitest';
import { seriesAudit } from './seriesAudit';
import type { ItemRow } from './sync';
import type { Meeting } from './wiki';

const now = new Date(2026, 9, 29, 12).getTime();
const day = (n: number) => new Date(2026, 9, 29 - n, 9).getTime();
const meeting = (id: string, title: string, ago: number, hours: number, extra: Partial<Meeting> = {}) =>
  ({ id, profile: 'work', deleted: 0, title, starts_at: day(ago), ends_at: day(ago) + hours * 3600_000, people: 'Ann, Bo', decisions: null, ...extra }) as Meeting;
const item = (id: string, meeting_id: string, status = 'open') => ({ id, profile: 'work', deleted: 0, meeting_id, status }) as ItemRow;

it('flags series with nothing for me in four weeks first, by recent hours', () => {
  const meetings = [
    meeting('s1', 'Sync #3', 2, 1),
    meeting('s2', 'Sync #2', 9, 1),
    meeting('s3', 'Sync #1', 40, 1, { decisions: '["Old call"]' }),
    meeting('p1', 'Planning', 3, 2),
    meeting('p2', 'Planning', 10, 2),
    meeting('r1', 'Retro', 5, 1, { decisions: '["Ship it"]' }),
    meeting('r2', 'Retro', 19, 1),
    meeting('d1', 'Demo', 6, 0.5),
    meeting('d2', 'Demo', 13, 0.5),
    meeting('o1', 'Old review', 70, 1),
    meeting('o2', 'Old review', 80, 1),
    meeting('once', 'One off', 1, 1),
  ];
  const items = [item('a1', 'd1', 'done'), item('a2', 's3'), item('x', 'p1', 'suggested')];
  const rows = seriesAudit(meetings, items, now);
  expect(rows.map((r) => [r.title, r.quiet, r.count, r.hours, r.recentHours, r.decisions, r.actions])).toEqual([
    ['Planning', true, 2, 4, 4, 0, 0],
    ['Sync #3', true, 3, 3, 2, 1, 1],
    ['Retro', false, 2, 2, 2, 1, 0],
    ['Demo', false, 2, 1, 1, 0, 1],
  ]);
  expect(rows[1].latest.id).toBe('s1');
});
