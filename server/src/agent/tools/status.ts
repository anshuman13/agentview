import { z } from 'zod';
import { defineTool } from './tool.js';

export const STATUS_RULES = [
  'The user follows your work on a timeline instead of reading the whole chat, often from a phone.',
  'Use the mcp__agentview__set_status tool for this. Call it when you begin a task, whenever you move to a new step or your plan changes, and when you finish. Keep text to one short sentence about what you are doing right now.',
  'Report the work as tasks: when you finish one, pass done as one plain sentence saying what you changed, in the words the user would use, such as "Merged Build cycle and Build flow into one Build row" or "Removed Build from the Model picker". Name the change, not the process: never "Read the code", "Run the checks" or "Turn X off here". No code names. Under 100 characters. One call per finished task, not per tool call.',
  'Pass next as the remaining tasks, a few plain words each, in order. Send the full list every time, and an empty list when nothing is left.',
  'Pass important only for a risk, a blocker or something surprising the user must know without reading the chat. One or two sentences. Leave it out otherwise.',
  'The tasks carry the detail, so your final reply is at most 3 sentences and does not repeat them.',
].join(' ');

export const statusTool = defineTool({
  name: 'set_status',
  description: 'Update the one-line status shown to the user about what you are doing right now, and optionally flag something important for them.',
  schema: {
    text: z.string().max(200),
    done: z.string().max(160).optional().describe('The task you just finished, as one plain sentence saying what changed, such as "Merged Build cycle and Build flow into one Build row". Omit when nothing new is done.'),
    next: z.array(z.string().max(120)).max(12).optional().describe('Remaining tasks, in order. Empty when done.'),
    important: z.string().max(500).optional().describe('A risk, blocker or surprise the user must know about. Omit when there is none.'),
    agent: z.string().optional().describe('Set by AgentView for calls from a subagent. Never pass it yourself.'),
  },
  async handler({ text, done, next, agent }, { host }) {
    // A subagent's steps show in its own transcript; the chat's status line stays the main agent's.
    if (agent) return 'ok';
    host.setStatus(text, { done, next });
    return 'ok';
  },
});
