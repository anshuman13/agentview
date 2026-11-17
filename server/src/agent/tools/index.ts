import { z } from 'zod';
import { buildTool } from './build.js';
import { chatSearchTool } from './chats.js';
import { DATA_RULES, dataFindTool, dataWriteTool } from './data.js';
import { findingsTool } from './findings.js';
import { GOAL_RULES, goalTool } from './goal.js';
import { STATUS_RULES, statusTool } from './status.js';
import type { Tool, ToolCtx } from './tool.js';
import { WIKI_RULES, wikiPageTool, wikiProposeTool, wikiSearchTool } from './wiki.js';

// The tools every provider's chats get, as mcp__agentview__<name>.
export const TOOLS: Tool[] = [statusTool, wikiSearchTool, wikiPageTool, wikiProposeTool, chatSearchTool, dataFindTool, dataWriteTool, findingsTool, goalTool, buildTool];

// The chat runs in AgentView, so advice for the claude terminal does not apply.
const HOST_RULES = [
  'This chat runs inside AgentView, not in a terminal: never tell the user to run claude --continue, start a new terminal session or restart Claude Code.',
  'An MCP server or connector that connects after this chat started is not loaded here; it loads when AgentView restarts the server (Developer: Restart Server When Agents Are Idle). Say that in one line and carry on with the rest of the work.',
].join(' ');

export const TOOL_INSTRUCTIONS = [HOST_RULES, STATUS_RULES, WIKI_RULES, DATA_RULES, GOAL_RULES].join(' ');

export async function callTool(name: string, args: unknown, ctx: ToolCtx, tools = TOOLS): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`No tool ${name}`);
  return tool.handler(z.object(tool.schema).parse(args), ctx);
}
