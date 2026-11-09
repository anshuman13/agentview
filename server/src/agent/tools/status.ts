import { z } from 'zod';
import { defineTool } from './tool.js';

export const STATUS_RULES = [
  'The user follows your work on a timeline instead of reading the whole chat, often from a phone.',
  'Use the mcp__agentview__set_status tool for this. Call it when you begin a task, whenever you move to a new step or your plan changes, and when you finish. Keep text to one short sentence about what you are doing right now.',
  'Pass done whenever you finish a meaningful part of the task: what was achieved, a few words, such as "Bearer prefix now required" or "3 invalid-token tests pass". Not for every tool call.',
  'Pass next as the remaining steps after the current one, a few words each, in order. Send the full list every time, and an empty list when nothing is left.',
  'Pass important only for something the user must know without reading the chat: a decision you made on their behalf, a risk, a blocker, or something surprising you found. One or two sentences. Leave it out otherwise.',
].join(' ');

export const statusTool = defineTool({
  name: 'set_status',
  description: 'Update the one-line status shown to the user about what you are doing right now, and optionally flag something important for them.',
  schema: {
    text: z.string().max(200),
    done: z.string().max(160).optional().describe('A part of the task you just finished, a few words. Omit when nothing new is done.'),
    next: z.array(z.string().max(120)).max(12).optional().describe('Remaining steps after the current one, in order. Empty when done.'),
    important: z.string().max(500).optional().describe('A decision, risk, blocker or surprise the user must know about. Omit when there is none.'),
  },
  async handler({ text }, { host }) {
    host.setStatus(text);
    return 'ok';
  },
});
