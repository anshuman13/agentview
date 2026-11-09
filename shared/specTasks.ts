export type SpecTask = { n: number; text: string; done: boolean };

const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+?)\s*$/;
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
    if (m) tasks.push({ n: tasks.length + 1, text: m[2], done: m[1] !== ' ' });
  }
  return tasks;
}

export const specProgress = (tasks: SpecTask[]) => `${tasks.filter((t) => t.done).length} of ${tasks.length} done`;

export const startTaskPrompt = (t: SpecTask, path: string) => `Do task ${t.n} in ${path}: ${t.text}. Tick its box in the file when it is done.`;

export const specPrompt = (request: string) => `Write a spec for the request below in .claude/specs/<slug>.md with three sections: Requirements (numbered, each with testable acceptance criteria), Design, and Tasks (\`- [ ]\` lines, each one small step). Do not change any code; stop for review when the spec is written.\n\nRequest: ${request}`;

export const runAllPrompt = (path: string) => `/goal every task in ${path} is ticked: do them in order, tick each when done`;
