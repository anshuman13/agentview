import { chatSearchTool } from './chats.js';
import { DATA_RULES, dataFindTool, dataWriteTool } from './data.js';
import { findingsTool } from './findings.js';
import { STATUS_RULES, statusTool } from './status.js';
import type { Tool } from './tool.js';
import { WIKI_RULES, wikiPageTool, wikiProposeTool, wikiSearchTool } from './wiki.js';

// The tools every provider's chats get, as mcp__agentview__<name>.
export const TOOLS: Tool[] = [statusTool, wikiSearchTool, wikiPageTool, wikiProposeTool, chatSearchTool, dataFindTool, dataWriteTool, findingsTool];

export const TOOL_INSTRUCTIONS = [STATUS_RULES, WIKI_RULES, DATA_RULES].join(' ');
