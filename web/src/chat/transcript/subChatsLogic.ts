import type { Round } from '../../../../shared/protocol';

// One earlier session of a chat, as /api/chat/subchats returns it.
export type SubChat = {
  sessionId: string;
  title: string;
  startedAt: number;
  round?: Round;
  commit?: { hash: string; subject: string };
};

export const FOLD_AT = 5;

const BRIEF = /^Build run, task (\d+) of (\d+)\. Read (\S+)/;

// The task number, count and spec path of a build task brief, else null.
export function parseBrief(prompt: string) {
  const m = BRIEF.exec(prompt.trim());
  return m ? { n: Number(m[1]), of: Number(m[2]), spec: m[3] } : null;
}

// The task lines of a spec's Tasks section, in order, checked or not.
export function specTasks(md: string) {
  const section = md.split(/^## Tasks\s*$/m)[1]?.split(/^## /m)[0] ?? md;
  return [...section.matchAll(/^\s*- \[[ x~]\] (.+)$/gim)].map((m) => m[1].trim());
}

const oneLine = (text: string) => text.replace(/(^|\s)@\S+/g, '$1').replace(/\s+/g, ' ').trim();

// "Task 3 of 12: <task line>" for a build task (the task line when the spec is known), else the first prompt on one line.
export function subChatTitle(prompt: string, tasks?: string[]) {
  const brief = parseBrief(prompt);
  if (!brief) return oneLine(prompt) || 'Untitled';
  const task = tasks?.[brief.n - 1];
  return `Task ${brief.n} of ${brief.of}${task ? `: ${task}` : ''}`;
}

export const roundText = (r?: Round) => (r ? `${r.outcome}: ${r.line}` : '');

export const commitText = (c?: SubChat['commit']) => (c ? `${c.hash.slice(0, 7)} ${c.subject}` : '');

// The row's parts: title, round line and commit, empty ones left out.
export const subChatRow = (s: SubChat, tasks?: string[]) =>
  [subChatTitle(s.title, tasks), roundText(s.round), commitText(s.commit)].filter(Boolean);

// The rows to show: all when at most FOLD_AT, else the last FOLD_AT and how many are hidden, unless unfolded.
export function foldRows<T>(rows: T[], unfolded: boolean) {
  if (unfolded || rows.length <= FOLD_AT) return { shown: rows, hidden: 0 };
  return { shown: rows.slice(-FOLD_AT), hidden: rows.length - FOLD_AT };
}

// The spec path of the first build brief in the chain, to read its task lines.
export const chainSpec = (subs: SubChat[]) => subs.map((s) => parseBrief(s.title)?.spec).find(Boolean) ?? null;
