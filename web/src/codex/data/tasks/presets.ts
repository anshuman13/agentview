import { DIGEST_TITLE } from './engine';

export type JobPreset = { name: string; schedule: string; prompt: string };

const DIGEST_SECTIONS = ['Meetings this week', 'Decisions', 'Tasks opened', 'Tasks closed', 'Stale tasks (open over 14 days)'];

const DIGEST_PROMPT = `Use mcp__agentview__data_find to read this past week: meetings (with their summary and decisions) and items (tasks opened, tasks done, and tasks still open). Write a digest with these sections: ${DIGEST_SECTIONS.join(', ')}. Keep each section to a few short lines and skip a section that has nothing. Save it with mcp__agentview__data_write as a new item with status note and the title "${DIGEST_TITLE}".`;

export const WEEKLY_DIGEST: JobPreset = { name: DIGEST_TITLE, schedule: 'weekly fri 16:00', prompt: DIGEST_PROMPT };

export const MORNING_BRIEFING: JobPreset = {
  name: 'Morning briefing',
  schedule: 'weekdays 07:30',
  prompt: 'Use mcp__agentview__data_find to read today\'s meetings and my open tasks that are due today or overdue. Write a short briefing with these sections: Meetings today (time and title), Due today, Overdue. Skip a section that has nothing. Send it to me with notify.',
};

export const PR_REVIEW_DIGEST: JobPreset = {
  name: 'PR review digest',
  schedule: 'weekdays 08:00',
  prompt: 'List the open pull requests that wait on my review and the ones I opened that have new review comments, using the GitHub tools this job allows. For each one give the repo, the title, the author and how long it has waited, oldest first. Add a task for each pull request that waited over 2 days. Send me the list with notify, or reply NOTHING NEW when there is none.',
};

export const DEPENDENCY_CHECK: JobPreset = {
  name: 'Dependency check',
  schedule: 'weekly mon 09:00',
  prompt: 'Check the repo for outdated and vulnerable dependencies with its package manager\'s own commands (for example bun outdated, npm audit or pip list --outdated). List the security fixes first, then major version updates, each with the current and latest version. Do not change any files. Reply NOTHING NEW when everything is up to date.',
};

export const JOB_PRESETS = { 'weekly-digest': WEEKLY_DIGEST, 'morning-briefing': MORNING_BRIEFING, 'pr-review-digest': PR_REVIEW_DIGEST, 'dependency-check': DEPENDENCY_CHECK };
