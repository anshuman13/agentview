// Long-lived chats the user talks to about any project. Each lives in ~/.agentview/advisors/<id>, whose CLAUDE.md
// holds its role and imports its memory.md, so a new conversation starts with what the earlier ones learned.
export type AdvisorId = 'pm' | 'architect';
export type Advisor = { id: AdvisorId; name: string; hint: string; model: string };

export const ADVISORS: Advisor[] = [
  { id: 'pm', name: 'PM', hint: 'What to build next and why', model: 'sonnet' },
  { id: 'architect', name: 'Architect', hint: 'How it fits the code, cost and risk', model: 'opus' },
];

export const ADVISOR_DIR = '.agentview/advisors';

export const advisorOf = (cwd: string): Advisor | undefined => ADVISORS.find((a) => cwd.replace(/\/+$/, '').endsWith(`/${ADVISOR_DIR}/${a.id}`));
