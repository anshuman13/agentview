import { createSdkMcpServer, tool, type CanUseTool, type HookCallback, type McpServerConfig, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIG_BRO, type Effort } from '../../../../shared/protocol.js';
import { TOOLS, TOOL_INSTRUCTIONS } from '../tools/index.js';
import type { ToolCtx } from '../tools/tool.js';
import { ownProfile, PROFILE_PORT } from '../../chrome/launch.js';
import { sandboxOf, type Unattended } from '../../session/unattended.js';
import { openRouterEnv, type OpenRouterSettings } from './openrouter.js';

const BUILD_KIT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../build-kit');

export const STATUS_REMINDER = 'You have not called mcp__agentview__set_status for a while, so the user sees no progress. Call it now with what you are doing, what is done and the next steps.';

const CHROME = "For anything in a web browser, use the Claude in Chrome tools. They drive the user's own Chrome, where the user is logged in to work sites, and the user watches that tab in AgentView.";

// A Mac with its own AgentView Chrome lets chats drive it too: the Browser tab shows it and it holds its own logins.
const OWN_CHROME = "This Mac also runs AgentView's own Chrome, driven with the mcp__browser tools. Use it when the user asks for the AgentView browser, or when a site in Claude in Chrome is signed in to the wrong account.";
const ownChrome = (unattended?: Unattended): Record<string, McpServerConfig> =>
  !unattended && ownProfile() ? { browser: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest', '--cdp-endpoint', `http://127.0.0.1:${PROFILE_PORT}`] } } : {};

function agentviewServer(o: { cwd: string; chat: () => string | null; host: ToolCtx['host']; openrouter?: OpenRouterSettings | null; unattended?: Unattended }) {
  return createSdkMcpServer({
    name: 'agentview',
    alwaysLoad: true,
    tools: TOOLS.map((t) => tool(t.name, t.description, t.schema, async (args) => ({ content: [{ type: 'text' as const, text: await t.handler(args, { cwd: o.cwd, chatId: o.chat(), provider: o.openrouter ? 'openrouter' : 'claude', host: o.host, unattended: Boolean(o.unattended) }) }] }))),
  });
}

export function agentOptions(o: {
  cwd: string;
  resume?: string;
  host: ToolCtx['host'];
  chat: () => string | null;
  canUseTool: CanUseTool;
  beforeAgent: HookCallback;
  beforeEdit: HookCallback;
  beforeTool: HookCallback;
  afterTool: HookCallback;
  onStop: HookCallback;
  mcp?: Record<string, McpServerConfig>;
  effort?: Effort;
  fork?: boolean;
  configDir?: string;
  openrouter?: OpenRouterSettings | null;
  unattended?: Unattended;
}): Options {
  return {
    cwd: o.cwd,
    resume: o.resume,
    forkSession: o.fork,
    effort: o.effort,
    env: { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1', ...(o.configDir && { CLAUDE_CONFIG_DIR: o.configDir }), ...(o.openrouter && openRouterEnv(o.openrouter)) },
    systemPrompt: { type: 'preset', preset: 'claude_code', append: o.unattended ? TOOL_INSTRUCTIONS : [TOOL_INSTRUCTIONS, CHROME, ...(ownProfile() ? [OWN_CHROME] : [])].join(' ') },
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    includeHookEvents: true,
    enableFileCheckpointing: true,
    allowedTools: TOOLS.map((t) => `mcp__agentview__${t.name}`),
    disallowedTools: ['mcp__playwright', ...(o.unattended ? ['Bash(git push:*)', 'Bash(gh:*)', ...o.unattended.denyRead.map((d) => `Read(/${d}/**)`)] : []), ...(o.openrouter && Object.values(o.openrouter.models).some((m) => !m.startsWith('anthropic/')) ? ['WebSearch'] : [])],
    extraArgs: o.unattended ? {} : { chrome: null },
    ...(o.unattended && { sandbox: sandboxOf(o.unattended) }),
    permissionMode: 'auto',
    mcpServers: { agentview: agentviewServer(o), ...ownChrome(o.unattended), ...o.mcp },
    toolConfig: { askUserQuestion: { previewFormat: 'markdown' } },
    canUseTool: o.canUseTool,
    perTaskStopAffordance: true,
    ...(!o.openrouter && { agentProgressSummaries: true }),
    ...(!o.openrouter && { plugins: [{ type: 'local' as const, path: BUILD_KIT, skipMcpDiscovery: true }] }),
    agents: o.openrouter ? {} : {
      [BIG_BRO]: {
        description:
          'Fable, the most capable model. Only for a really hard problem you could not resolve yourself: a bug that survived several attempts, a risky design decision, or subtle correctness reasoning. The user approves every call, so put the full question and context in the prompt. If the call is declined, continue without it.',
        prompt: 'You are Fable, consulted as a senior engineer on one hard problem. Investigate what you need, then answer with a clear recommendation and the reasoning behind it. Be concise.',
        model: 'claude-fable-5-1',
        tools: ['Read', 'Bash', 'WebSearch', 'WebFetch'],
      },
    },
    hooks: {
      PreToolUse: [{ matcher: 'Agent|Task', hooks: [o.beforeAgent] }, { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [o.beforeEdit] }, ...(o.unattended ? [{ matcher: 'WebFetch|ListMcpResourcesTool|ReadMcpResourceTool|mcp__.*', hooks: [o.beforeTool] }] : [])],
      PostToolUse: [{ hooks: [o.afterTool] }],
      Stop: [{ hooks: [o.onStop] }],
    },
    stderr: (d) => process.stderr.write(d),
  };
}

export function userMessage(text: string): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
}
