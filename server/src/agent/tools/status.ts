import { z } from 'zod';
import { defineTool } from './tool.js';

export const STATUS_RULES = [
  'The user follows your work on a timeline instead of reading the whole chat, often from a phone.',
  'Use the mcp__agentview__set_status tool for this. Call it when you begin a task, whenever you move to a new step or your plan changes, and when you finish. Keep text to one short sentence about what you are doing right now.',
  'Report the work as steps: after each finished step pass done as a short imperative title of the step, such as "Build the navbar" or "Require the Bearer prefix", decision as the key choice you made in it, and why as one line on the reason. One call per finished step, not per tool call.',
  'Pass next as the remaining steps after the current one, a few words each, in order. Send the full list every time, and an empty list when nothing is left.',
  'Pass important only for a risk, a blocker or something surprising the user must know without reading the chat. One or two sentences. Leave it out otherwise.',
  'The steps carry the detail, so your final reply is at most 3 sentences and does not repeat them.',
].join(' ');

export const statusTool = defineTool({
  name: 'set_status',
  description: 'Update the one-line status shown to the user about what you are doing right now, and optionally flag something important for them.',
  schema: {
    text: z.string().max(200),
    done: z.string().max(160).optional().describe('The step you just finished, as a short imperative title such as "Build the navbar". Omit when nothing new is done.'),
    next: z.array(z.string().max(120)).max(12).optional().describe('Remaining steps after the current one, in order. Empty when done.'),
    decision: z.string().max(200).optional().describe('The key choice made in the finished step. Only with done.'),
    why: z.string().max(200).optional().describe('One line on why that choice was made. Only with done.'),
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
