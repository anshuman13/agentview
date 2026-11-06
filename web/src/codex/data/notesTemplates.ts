import { type Meeting } from './wiki';
import { seriesKey } from './summaryTemplates';
import { save, stored } from '../../ui/util';

export const NOTES_TEMPLATES = {
  one_on_one: { label: '1:1', headings: ['Check-in', 'Discussion', 'Feedback', 'Next steps'] },
  standup: { label: 'Standup', headings: ['Done', 'Planned', 'Blockers'] },
  decision: { label: 'Decision', headings: ['Context', 'Options', 'Decision', 'Owner and date'] },
} as const;

export type NotesTemplate = keyof typeof NOTES_TEMPLATES;

const PICKS_KEY = 'codex.notesTemplatePicks';
const readPicks = () => stored<Record<string, string>>(PICKS_KEY, {});

export const notesTemplateText = (key: NotesTemplate) => NOTES_TEMPLATES[key].headings.map((h) => `## ${h}\n\n`).join('');

// The caret goes on the blank line under the first heading.
export const notesTemplateCaret = (key: NotesTemplate) => `## ${NOTES_TEMPLATES[key].headings[0]}\n`.length;

export const rememberNotesTemplate = (m: Meeting, key: NotesTemplate) => save(PICKS_KEY, { ...readPicks(), [seriesKey(m)]: key });

// The series' remembered template first and selected, then the rest in default order.
export function notesTemplateChips(m: Meeting, picks = readPicks()): { key: NotesTemplate; selected: boolean }[] {
  const keys = Object.keys(NOTES_TEMPLATES) as NotesTemplate[];
  const picked = keys.find((k) => k === picks[seriesKey(m)]);
  const order = picked ? [picked, ...keys.filter((k) => k !== picked)] : keys;
  return order.map((key) => ({ key, selected: key === picked }));
}
