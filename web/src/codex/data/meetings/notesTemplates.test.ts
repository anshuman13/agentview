import { describe, expect, it } from 'bun:test';
import type { Meeting } from '../wiki/wiki';
import { notesTemplateChips } from './notesTemplates';
import { seriesKey } from './summaryTemplates';

const meeting = (id: string, title: string, profile = 'work') => ({ id, title, profile }) as unknown as Meeting;

describe('notes templates', () => {
  it('keys by series and profile', () => {
    expect(seriesKey(meeting('a', 'Weekly sync'))).toBe(seriesKey(meeting('b', 'Weekly sync')));
    expect(seriesKey(meeting('a', 'Weekly sync'))).not.toBe(seriesKey(meeting('a', 'Weekly sync', 'personal')));
  });

  it('puts the remembered pick first and selected, ignoring unknown values', () => {
    const a = meeting('a', 'Weekly sync');
    const b = meeting('b', 'Weekly sync');
    const chips = notesTemplateChips(b, { [seriesKey(a)]: 'decision' });
    expect(chips.map((c) => c.key)).toEqual(['decision', 'one_on_one', 'standup']);
    expect(chips.map((c) => c.selected)).toEqual([true, false, false]);
    const none = notesTemplateChips(b, { [seriesKey(a)]: 'bogus' });
    expect(none.map((c) => c.key)).toEqual(['one_on_one', 'standup', 'decision']);
    expect(none.some((c) => c.selected)).toBe(false);
  });
});
