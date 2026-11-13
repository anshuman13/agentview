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

// A project's .claude/backlog.md: one line per item, `<rank>. <slug> | <title> | <why> | <status>`, the PM's ranking of what to build next.
export type BacklogStatus = 'proposed' | 'specced' | 'building' | 'done';
export type BacklogItem = { rank: number; slug: string; title: string; why: string; status: BacklogStatus; spec: boolean };

const BACKLOG_LINE = /^(\d+)\.\s*([\w-]+)\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*(proposed|specced|building|done)\s*$/;

export const parseBacklog = (md: string): Omit<BacklogItem, 'spec'>[] =>
  md.split('\n').flatMap((l) => {
    const m = BACKLOG_LINE.exec(l.trim());
    return m ? [{ rank: Number(m[1]), slug: m[2], title: m[3], why: m[4], status: m[5] as BacklogStatus }] : [];
  });

// An item can be built until a build is running or merged.
export const canBuildItem = (i: Pick<BacklogItem, 'status'>) => i.status === 'proposed' || i.status === 'specced';

export const rankPrompt = (root: string) => `Read ${root}/.claude/backlog.md and the project's code and recent changes, then rank what to build next. Rewrite the backlog file (at most 10 lines) and reply with the top three.`;

export const moveUpPrompt = (root: string, item: Pick<BacklogItem, 'slug' | 'title'>) => `In ${root}/.claude/backlog.md, move "${item.title}" (${item.slug}) up one rank and renumber the lines. Reread the file before you edit it.`;
