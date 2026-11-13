export type SpecTask = { n: number; text: string; done: boolean; doing: boolean };

const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+?)\s*$/;
const DOING = / \(in progress\)$/;
const SPEC_PATH = /(^|\/)\.(claude|kiro)\/specs\/.+\.(md|markdown|mdx)$/i;

export const isSpecPath = (path: string) => SPEC_PATH.test(path);

// The build slug of a spec file: its name, or for a Kiro spec folder the folder's.
export const specSlug = (path: string) => /(?:^|\/)\.kiro\/specs\/([^/]+)\//.exec(path)?.[1] ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.\w+$/, '');

// Each line of a spec with its checkbox match, fenced code never matching.
function taskLines(markdown: string) {
  const lines: { line: string; m: RegExpExecArray | null }[] = [];
  let fence = '';
  for (const line of markdown.split(/\r?\n/)) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark) fence = !fence ? mark : mark[0] === fence[0] && mark.length >= fence.length ? '' : fence;
    lines.push({ line, m: !fence && !mark ? TASK.exec(line) : null });
  }
  return lines;
}

// The checkbox lines of a spec in file order, nested ones included, fenced code skipped.
export function specTasks(markdown: string): SpecTask[] {
  const tasks: SpecTask[] = [];
  for (const { m } of taskLines(markdown)) {
    if (m) {
      const done = m[1] !== ' ';
      const doing = !done && DOING.test(m[2]);
      tasks.push({ n: tasks.length + 1, text: m[2].replace(DOING, ''), done, doing });
    }
  }
  return tasks;
}

// The spec without its unticked task lines, for a page that lists them as rows.
export const withoutOpenTasks = (markdown: string) => taskLines(markdown).filter(({ m }) => !m || m[1] !== ' ').map(({ line }) => line).join('\n');

export function specProgress(tasks: SpecTask[]) {
  const doing = tasks.filter((t) => t.doing).length;
  return `${tasks.filter((t) => t.done).length} of ${tasks.length} done${doing ? ` · ${doing} in progress` : ''}`;
}

export const startTaskPrompt = (t: SpecTask, path: string) => `Do task ${t.n} in ${path}: ${t.text}. While you work, append " (in progress)" to its line. When done, tick its box and remove that suffix in one edit before moving on.`;

export const specPrompt = (request: string) => `Write a spec for the request below in .claude/specs/<slug>.md with three sections: Requirements (numbered, each with testable acceptance criteria), Design, and Tasks (\`- [ ]\` lines, each one small step). Do not change any code; stop for review when the spec is written. When the tasks are done later, tick each box right after finishing it (one edit per task) and mark the one you are on with " (in progress)".\n\nRequest: ${request}`;

export const SPEC_REVIEW_COMMAND = 'spec-review';

export const specReviewPrompt = (path: string) => `Review the spec at ${path} with two subagents started in parallel. Give each only the spec path and its brief below, and pass nothing from this chat.\n\n(a) Cold reader: open no file but the spec. Read it as someone who has never seen this repo or chat, and list each place you had to guess: a term, file, behaviour or number the spec does not pin down.\n\n(b) Readiness: check every file path, function or type name, route and test command the spec names against the repo, and list what is missing or different.\n\nThen call mcp__agentview__report_findings once with all findings from both, each with file = the repo-relative path of the spec, line = the spec line it concerns, summary, failure_scenario = what the spec should say, and category "guess" or "readiness". Pass an empty list when both are clean. Do not edit the spec.`;

export const planGoalPrompt = (path: string) => `/goal every step of the plan in ${path} is done: work through it in order and note in the file which steps are finished.`;

export const runAllPrompt = (path: string) => `/goal every task in ${path} is ticked: do them in order. While you work on one, append " (in progress)" to its line; when done, tick its box and remove that suffix in one edit before the next.`;

export const buildPrompt = (brief: string) => `Run the agentview:build skill on the brief below (call the Skill tool with skill "agentview:build"). Pick the slug yourself: 2-5 lowercase words joined by hyphens. Pass the brief exactly as written between the brief tags.\n\n<brief>\n${brief}\n</brief>`;

export const sketchSpecPrompt = (path: string) => `Start the agentview:designer subagent on the spec at ${path}. Give it only that path; it writes the sketch to .claude/sketches/<slug>.html. Reply with the sketch path.`;

export const buildSpecPrompt = (path: string) => `Run the agentview:build skill on the existing spec at ${path} (call the Skill tool with skill "agentview:build"). Use the file name as the slug and the spec's title as the brief; the pm starts from that file and changes it only where review finds a problem.`;

export const planCondition = (path: string, markdown: string) => (specTasks(markdown).some((t) => !t.done) ? runAllPrompt(path) : planGoalPrompt(path));
