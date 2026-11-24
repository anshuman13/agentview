import type { Finding } from './protocol';

// The prompt for a code review on an agent without a /code-review command; the findings come back through report_findings.
export const reviewPrompt = (target: 'local' | number) =>
  [
    target === 'local' ? 'Review the uncommitted changes in this working tree: read git diff HEAD and any untracked files.' : `Review pull request #${target}: read gh pr diff ${target} and the files it changes.`,
    'Look for bugs, security problems, missed edge cases and changes that break existing behaviour. Skip style and naming.',
    'Check each problem against the code before you report it, and drop what you cannot confirm.',
    'When done, call mcp__agentview__report_findings once with one entry per problem: the file, the line, a one-sentence summary, and how it fails. Pass an empty list when there is nothing to report.',
  ].join(' ');

const failureOf = (f: Finding) => (f.failure ? ` (${f.failure})` : '');

export const findingFixPrompt = (f: Finding) => `Fix this review finding in ${f.file}:${f.line}: ${f.summary}${failureOf(f)}`;

export const findingsFixPrompt = (findings: Finding[]) =>
  [
    `Fix these ${findings.length} review findings:`,
    ...findings.map((f, i) => `${i + 1}. ${f.file}:${f.line}: ${f.summary}${failureOf(f)}`),
    'Fix each one, and skip any you find is not a real problem.',
  ].join('\n');
