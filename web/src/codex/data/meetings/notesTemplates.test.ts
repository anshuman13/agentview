import { describe, expect, it } from 'vitest';
import type { Meeting } from '../wiki/wiki';
import { NOTES_TEMPLATES, notesTemplateChips, notesTemplateText, type NotesTemplate } from './notesTemplates';
import { seriesKey } from './summaryTemplates';

const meeting = (id: string, title: string, profile = 'work') => ({ id, title, profile }) as unknown as Meeting;

describe('notes templates', () => {
  it('starts each template with its first heading', () => {
    for (const key of Object.keys(NOTES_TEMPLATES) as NotesTemplate[]) {
      expect(notesTemplateText(key).startsWith(`## ${NOTES_TEMPLATES[key].headings[0]}\n\n`)).toBe(true);
    }
  });

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
