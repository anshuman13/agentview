import { z } from 'zod';
import { goalCommand, parseEvery } from '../../../../shared/goalForm.js';
import { defineTool } from './tool.js';

export const GOAL_RULES = [
  'When the user asks you to keep working until something is true, to check on something regularly, or to set a goal, start it with mcp__agentview__start_goal instead of telling them to type /goal.',
  'A goal without every checks the condition each time you go idle, up to 20 rounds, and ends when you reply GOAL MET. With every (10m to 168h) it is a standing goal that wakes you once per interval.',
  'until ends it at a time of day, cap stops it at a weekly usage percent. Pass off to stop the running goal. The user sees and edits it on the loop card in the chat.',
  'To build a feature through spec, review, implementation and test, run the agentview:build skill with the brief when the Skill tool has it. The spec goes to .claude/specs/<slug>.md, a UI spec gets a sketch in .claude/sketches/<slug>.html, and the build waits until the user approves both in the build card in the chat. The user can ask for no sketch or no approval; pass that on to the skill.',
].join(' ');

const goalLine = ({ condition, every, until, cap, builds, off }: { condition?: string; every?: string; until?: string; cap?: number; builds?: number; off?: boolean }) =>
  off ? '/goal off' : goalCommand({ what: condition ?? '', every: every ? parseEvery(every) ?? 0 : 0, stopIn: null, stopAt: until ?? null, capPct: cap ?? null, builds: builds ?? null }, Date.now());

export const goalTool = defineTool({
  name: 'start_goal',
  description: 'Start a goal in this chat: you keep working, round after round, until the condition is met. Replaces a running goal or loop. Pass off to stop it.',
  schema: {
    condition: z.string().optional().describe('What must be true for the goal to be met, as the user said it.'),
    every: z.string().regex(/^\d+(m|h)$/).optional().describe('Standing goal interval such as 30m or 2h, 10m to 168h. Omit to check whenever you go idle.'),
    until: z.string().regex(/^\d{1,2}:\d{2}$/).optional().describe('Stop at this local time, HH:MM.'),
    cap: z.number().int().min(1).max(100).optional().describe('Stop when weekly usage reaches this percent.'),
    builds: z.number().int().min(1).max(50).optional().describe('Pause after this many builds this goal starts.'),
    off: z.boolean().optional().describe('Stop the running goal.'),
  },
  async handler(args, { host }) {
    if (args.every && parseEvery(args.every) === null) throw new Error('Give an every of 10m to 168h');
    const line = goalLine(args);
    if (!host.goal(line)) throw new Error('Give a condition, and an every of 10m to 168h');
    return args.off ? 'Goal off' : `Goal on: ${line}. Each round arrives as a new prompt once this turn ends.`;
  },
});
