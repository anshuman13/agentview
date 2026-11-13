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

// A project's newest .claude/audits/<date>.md: one line per finding, `<rank>. <screen> | <problem> | <severity> | <fix>`, the Designer's usability audit.
export type AuditSeverity = 'high' | 'med' | 'low';
export type AuditFinding = { rank: number; screen: string; problem: string; severity: AuditSeverity; fix: string };
export type Audit = { date: string; path: string; findings: AuditFinding[] };

const AUDIT_LINE = /^(\d+)\.\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(high|med|low)\s*\|\s*(.+?)\s*$/;

export const parseAudit = (md: string): AuditFinding[] =>
  md.split('\n').flatMap((l) => {
    const m = AUDIT_LINE.exec(l.trim());
    return m ? [{ rank: Number(m[1]), screen: m[2], problem: m[3], severity: m[4] as AuditSeverity, fix: m[5] }] : [];
  });

export const auditPrompt = (root: string) => `Audit the usability of the app in ${root}. If it has no running app, say so and write no file. Otherwise start it with the project's own start command, then walk each screen in headless Chrome on port 9334 (never 9333) at 390px wide, then at 1280px, and clean up the browser and the app when done. Write ${root}/.claude/audits/<YYYY-MM-DD>.md with today's date: at most 15 findings, ranked, one per line as \`<rank>. <screen> | <problem in one line> | <severity high|med|low> | <fix in one line>\`. Reply with the top three.`;

export const specsFromAuditPrompt = (root: string) => `Read the newest file in ${root}/.claude/audits and add its top findings to ${root}/.claude/backlog.md as \`proposed\` lines, with the audit line as the why. Keep the existing lines, reread the file before you edit it and renumber the ranks. Reply with the lines you added.`;

export const ADVISOR_LOOP_EVERY = 4 * 3_600_000;
export const ADVISOR_LOOP_CAP = 70;

export const advisorLoopGoal = (root: string) => `Advisor loop for ${root}, never met on its own. Each round, as PM: reread ${root}/.claude/backlog.md. If fewer than 2 items are specced, write the spec for the top proposed item to ${root}/.claude/specs/<slug>.md and mark it specced; for a UI change ask the Designer advisor for a sketch, and say in the ROUND line if you cannot reach it. If a spec awaits my approval, end with ROUND: question <what needs approval>. Once I approve, start the build (/agentview:build <slug>, the build card's Build action) and mark the item building; one build in flight per project; mark it done when merged. If the backlog is empty, ask the Designer for an audit when the newest ${root}/.claude/audits/*.md is over 7 days old, else end with ROUND: nothing.`;
