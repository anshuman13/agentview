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
