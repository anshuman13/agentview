import { type Meeting } from './wiki';
import { peopleOf, seriesTitle } from './meetings';
import { save, stored } from '../../ui/util';

export const SUMMARY_TEMPLATES = {
  default: { label: 'Default', instructions: '' },
  one_on_one: {
    label: '1:1',
    instructions: 'This was a 1:1. Summarize what we discussed about work, feedback, career and wellbeing, then the commitments each of us made and anything to raise next time.',
  },
  standup: {
    label: 'Standup',
    instructions: 'This was a standup. Summarize per person what was done, what is planned and what blocks them, and name the blockers that need follow-up.',
  },
  interview: {
    label: 'Interview',
    instructions: 'This was a job interview. Summarize the candidate background, strengths, concerns and notable answers, then the signals for and against hiring and the agreed next step.',
  },
  planning: {
    label: 'Planning',
    instructions: 'This was a planning meeting. Summarize the goals, the scope and priorities chosen, owners and dates, open risks and what was deferred.',
  },
} as const;

export type SummaryTemplate = keyof typeof SUMMARY_TEMPLATES;

export const summaryInstructions = (key: SummaryTemplate) => SUMMARY_TEMPLATES[key].instructions;

const PICKS_KEY = 'codex.summaryPicks';
const seriesKey = (m: Meeting) => `${m.profile}:${seriesTitle(m.title) || m.id}`;
const readPicks = () => stored<Record<string, SummaryTemplate>>(PICKS_KEY, {});

export const rememberTemplate = (m: Meeting, key: SummaryTemplate) => save(PICKS_KEY, { ...readPicks(), [seriesKey(m)]: key });

// The template picked before for this series, else a guess from the title and guest count. Series is newest first.
export function templateFor(m: Meeting, series: Meeting[], picks = readPicks()): SummaryTemplate {
  const picked = picks[seriesKey(m)];
  if (picked && picked in SUMMARY_TEMPLATES) return picked;
  const title = (m.title ?? '').toLowerCase();
  const people = peopleOf(m).length || (series[0] ? peopleOf(series[0]).length : 0);
  if (/\b1[:-]1\b|\b1on1\b|\bone[- ]on[- ]one\b/.test(title) || /\S\s*\/\s*\S/.test(title) && people === 2) return 'one_on_one';
  if (/stand-?up|\bdaily\b/.test(title)) return 'standup';
  if (/interview/.test(title)) return 'interview';
  if (/planning|\bplan\b/.test(title)) return 'planning';
  return people === 2 ? 'one_on_one' : 'default';
}
