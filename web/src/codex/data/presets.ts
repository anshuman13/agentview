import { DIGEST_TITLE } from './engine';

export type JobPreset = { name: string; schedule: string; prompt: string };

const DIGEST_SECTIONS = ['Meetings this week', 'Decisions', 'Tasks opened', 'Tasks closed', 'Stale tasks (open over 14 days)'];

const DIGEST_PROMPT = `Use mcp__agentview__data_find to read this past week: meetings (with their summary and decisions) and items (tasks opened, tasks done, and tasks still open). Write a digest with these sections: ${DIGEST_SECTIONS.join(', ')}. Keep each section to a few short lines and skip a section that has nothing. Save it with mcp__agentview__data_write as a new item with status note and the title "${DIGEST_TITLE}".`;

export const WEEKLY_DIGEST: JobPreset = { name: DIGEST_TITLE, schedule: 'weekly fri 16:00', prompt: DIGEST_PROMPT };
