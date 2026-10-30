import { describe, expect, it } from 'vitest';
import { endedPoints, pointMeeting, pointsFor } from './points';
import type { ItemRow } from './sync';
import type { Meeting } from './wiki';

const H = 3600_000;
const meeting = (id: string, start: number, people: string[], profile = 'work') =>
  ({ id, profile, title: id, starts_at: start, ends_at: start + H, people: JSON.stringify(people), deleted: 0 }) as unknown as Meeting;
const point = (person: string, raised: number, status = 'point') =>
  ({ id: `${person}${raised}`, profile: 'work', title: 'Talk budget', people: person, status, deleted: 0, updated_at: raised, field_times: JSON.stringify({ source: raised }) }) as unknown as ItemRow;

describe('points', () => {
  const past = meeting('past', 0, ['Kim Berg']);
  const later = meeting('later', 20 * H, ['Kim Berg', 'Ola Dahl']);
  const next = meeting('next', 10 * H, ['kim berg']);
  const other = meeting('other', 5 * H, ['Ola Dahl']);
  const personal = meeting('personal', 3 * H, ['Kim Berg'], 'personal');
  const all = [past, later, next, other, personal];

  it('wait for the first meeting with the person after they were raised', () => {
    expect(pointMeeting(point('Kim Berg', 2 * H), all)).toBe(next);
    expect(pointMeeting(point('Ola Dahl', 6 * H), all)).toBe(later);
    expect(pointMeeting(point('Kim Berg', 30 * H), all)).toBeUndefined();
  });

  it('group open points under the meeting they wait for', () => {
    const items = [point('Kim Berg', 2 * H), point('Ola Dahl', 1 * H), point('Kim Berg', 3 * H, 'raised')];
    expect(pointsFor(next, items, all).map((p) => p.people)).toEqual(['Kim Berg']);
    expect(pointsFor(other, items, all).map((p) => p.people)).toEqual(['Ola Dahl']);
  });

  it('end once their meeting has ended', () => {
    const items = [point('Kim Berg', 2 * H), point('Ola Dahl', 6 * H)];
    expect(endedPoints(items, all, 11 * H).map((p) => p.people)).toEqual(['Kim Berg']);
    expect(endedPoints(items, all, 10.5 * H)).toEqual([]);
  });
});
