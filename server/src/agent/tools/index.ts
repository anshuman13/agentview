import { z } from 'zod';
import { chatSearchTool } from './chats.js';
import { DATA_RULES, dataFindTool, dataWriteTool } from './data.js';
import { findingsTool } from './findings.js';
import { GOAL_RULES, goalTool } from './goal.js';
import { STATUS_RULES, statusTool } from './status.js';
import type { Tool, ToolCtx } from './tool.js';
import { WIKI_RULES, wikiPageTool, wikiProposeTool, wikiSearchTool } from './wiki.js';

// The tools every provider's chats get, as mcp__agentview__<name>.
export const TOOLS: Tool[] = [statusTool, wikiSearchTool, wikiPageTool, wikiProposeTool, chatSearchTool, dataFindTool, dataWriteTool, findingsTool, goalTool];

export const TOOL_INSTRUCTIONS = [STATUS_RULES, WIKI_RULES, DATA_RULES, GOAL_RULES].join(' ');

export async function callTool(name: string, args: unknown, ctx: ToolCtx, tools = TOOLS): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`No tool ${name}`);
  return tool.handler(z.object(tool.schema).parse(args), ctx);
}
