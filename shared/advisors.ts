// Long-lived chats the user talks to about any project. Each lives in ~/.agentview/advisors/<id>, whose CLAUDE.md
// holds its role and imports projects.md (an index of the user's repos) and its memory.md, so a new conversation starts with what the earlier ones learned.
export type AdvisorId = 'pm' | 'architect' | 'designer';
export type Advisor = { id: AdvisorId; name: string; hint: string; model: string };

export const ADVISORS: Advisor[] = [
  { id: 'pm', name: 'PM', hint: 'What to build next and why', model: 'sonnet' },
  { id: 'architect', name: 'Architect', hint: 'How it fits the code, cost and risk', model: 'opus' },
  { id: 'designer', name: 'Designer', hint: 'Sketches screens before they are built', model: 'sonnet' },
];

// What the Advisors page shows of each: its memory and its latest conversations.
export type AdvisorInfo = { id: AdvisorId; memory: string; chats: { sessionId: string; title: string; lastModified: number }[] };

export const ADVISOR_DIR = '.agentview/advisors';

export const advisorOf = (cwd: string): Advisor | undefined => ADVISORS.find((a) => cwd.replace(/\/+$/, '').endsWith(`/${ADVISOR_DIR}/${a.id}`));

// The facts in a memory file: its list lines.
export const memoryFacts = (memory: string) => memory.split('\n').filter((l) => /^\s*[-*] /.test(l)).length;
