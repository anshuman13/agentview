import { createSdkMcpServer, tool, type CanUseTool, type HookCallback, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { BIG_BRO } from './transcript.js';

export const TEAM = { model: 'opusplan', advisor: 'claude-opus-5-5' };

const INSTRUCTIONS = [
  'The user follows your work on a timeline instead of reading the whole chat.',
  'Call set_status when you begin a task, whenever you move to a new step or your plan changes, and when you finish. Keep text to one short sentence about what you are doing right now.',
  'Pass done whenever you finish a meaningful part of the task: what was achieved, a few words, such as "Bearer prefix now required" or "3 invalid-token tests pass". Not for every tool call.',
  'Pass next as the remaining steps after the current one, a few words each, in order. Send the full list every time, and an empty list when nothing is left.',
  'Pass important only for something the user must know without reading the chat: a decision you made on their behalf, a risk, a blocker, or something surprising you found. One or two sentences. Leave it out otherwise.',
  "For anything in a web browser, use the Claude in Chrome tools. They drive the user's own Chrome, where the user is logged in to work sites, and the user watches that tab in AgentView.",
].join(' ');

function statusServer(onStatus: (text: string) => void) {
  return createSdkMcpServer({
    name: 'agentview',
    alwaysLoad: true,
    instructions: INSTRUCTIONS,
    tools: [
      tool(
        'set_status',
        'Update the one-line status shown to the user about what you are doing right now, and optionally flag something important for them.',
        {
          text: z.string().max(200),
          done: z.string().max(160).optional().describe('A part of the task you just finished, a few words. Omit when nothing new is done.'),
          next: z.array(z.string().max(120)).max(12).optional().describe('Remaining steps after the current one, in order. Empty when done.'),
          important: z.string().max(500).optional().describe('A decision, risk, blocker or surprise the user must know about. Omit when there is none.'),
        },
        async ({ text }) => {
          onStatus(text);
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      ),
    ],
  });
}

export function agentOptions(o: {
  cwd: string;
  resume?: string;
  onStatus: (text: string) => void;
  canUseTool: CanUseTool;
  beforeAgent: HookCallback;
  afterTool: HookCallback;
}): Options {
  return {
    cwd: o.cwd,
    resume: o.resume,
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    allowedTools: ['mcp__agentview__set_status'],
    disallowedTools: ['mcp__playwright'],
    extraArgs: { chrome: null },
    permissionMode: 'auto',
    mcpServers: { agentview: statusServer(o.onStatus) },
    toolConfig: { askUserQuestion: { previewFormat: 'markdown' } },
    canUseTool: o.canUseTool,
    agents: {
      [BIG_BRO]: {
        description:
          'Fable, the most capable model. Only for a really hard problem you could not resolve yourself: a bug that survived several attempts, a risky design decision, or subtle correctness reasoning. The user approves every call, so put the full question and context in the prompt. If the call is declined, continue without it.',
        prompt: 'You are Fable, consulted as a senior engineer on one hard problem. Investigate what you need, then answer with a clear recommendation and the reasoning behind it. Be concise.',
        model: 'claude-fable-5-1',
        tools: ['Read', 'Bash', 'WebSearch', 'WebFetch'],
      },
    },
    hooks: {
      PreToolUse: [{ matcher: 'Agent|Task', hooks: [o.beforeAgent] }],
      PostToolUse: [{ hooks: [o.afterTool] }],
    },
    stderr: (d) => process.stderr.write(d),
  };
}

export function userMessage(text: string): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
}
