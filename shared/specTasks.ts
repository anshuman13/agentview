export type SpecTask = { n: number; text: string; done: boolean; doing: boolean };

const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+?)\s*$/;
const DOING = / \(in progress\)$/;
const SPEC_PATH = /(^|\/)\.(claude|kiro)\/specs\/.+\.(md|markdown|mdx)$/i;

export const isSpecPath = (path: string) => SPEC_PATH.test(path);

// The checkbox lines of a spec in file order, nested ones included, fenced code skipped.
export function specTasks(markdown: string): SpecTask[] {
  const tasks: SpecTask[] = [];
  let fence = '';
  for (const line of markdown.split(/\r?\n/)) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark) fence = !fence ? mark : mark[0] === fence[0] && mark.length >= fence.length ? '' : fence;
    const m = !fence && !mark ? TASK.exec(line) : null;
    if (m) {
      const done = m[1] !== ' ';
      const doing = !done && DOING.test(m[2]);
      tasks.push({ n: tasks.length + 1, text: m[2].replace(DOING, ''), done, doing });
    }
  }
  return tasks;
}

export function specProgress(tasks: SpecTask[]) {
  const doing = tasks.filter((t) => t.doing).length;
  return `${tasks.filter((t) => t.done).length} of ${tasks.length} done${doing ? ` · ${doing} in progress` : ''}`;
}

export const startTaskPrompt = (t: SpecTask, path: string) => `Do task ${t.n} in ${path}: ${t.text}. While you work, append " (in progress)" to its line. When done, tick its box and remove that suffix in one edit before moving on.`;

export const specPrompt = (request: string) => `Write a spec for the request below in .claude/specs/<slug>.md with three sections: Requirements (numbered, each with testable acceptance criteria), Design, and Tasks (\`- [ ]\` lines, each one small step). Do not change any code; stop for review when the spec is written. When the tasks are done later, tick each box right after finishing it (one edit per task) and mark the one you are on with " (in progress)".\n\nRequest: ${request}`;

export const runAllPrompt = (path: string) => `/goal every task in ${path} is ticked: do them in order. While you work on one, append " (in progress)" to its line; when done, tick its box and remove that suffix in one edit before the next.`;
