import { editedPath } from '../steps.js';
import type { HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { AgentHost } from '../types.js';
import { STATUS_REMINDER } from './options.js';
import { denyTool, editDenied, toolDenied, type Unattended } from './unattended.js';
import { bigBroRequest, bigBroVerdict } from './approval.js';
import { BIG_BRO } from '../../../../shared/protocol.js';

const STATUS_EVERY = 8;
export const SUBAGENT_STEPS = 'After each finished task call mcp__agentview__set_status with done: one plain sentence saying what you changed or found, not the process. Unless your instructions give a return format, keep your final report to 3 sentences.';
// Fable answers one question, so it does not work in steps.
const NO_STEPS = new Set([BIG_BRO]);

// The callbacks the CLI makes around tool calls and when a turn stops.
export class ToolHooks {
  private sinceStatus = 0;

  constructor(private host: AgentHost) {}

  async beforeAgent(input: HookInput, signal: AbortSignal): Promise<HookJSONOutput> {
    const req = bigBroRequest(input);
    if (!req) return {};
    const r = await this.host.ask(req.toolName, req.toolInput, { signal, title: req.title });
    return bigBroVerdict(r.behavior);
  }

  // Marks a subagent's set_status call, so its steps stay out of the chat's status line.
  beforeStatus(input: HookInput): HookJSONOutput {
    if (input.hook_event_name !== 'PreToolUse' || !input.agent_id) return {};
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...(input.tool_input as Record<string, unknown>), agent: input.agent_id } } };
  }

  onSubagentStart(input: HookInput): HookJSONOutput {
    if (input.hook_event_name !== 'SubagentStart' || NO_STEPS.has(input.agent_type)) return {};
    return { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: SUBAGENT_STEPS } };
  }

  beforeEdit(input: HookInput, unattended?: Unattended): HookJSONOutput {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const file = editedPath(input.tool_input);
    const denied = file && unattended && editDenied(file, unattended);
    if (denied) return denyTool(denied);
    if (file) this.host.captureEdit(file);
    return {};
  }

  beforeTool(input: HookInput, unattended: Unattended): HookJSONOutput {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const denied = toolDenied(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, unattended);
    return denied ? denyTool(denied) : {};
  }

  afterTool(input: HookInput): HookJSONOutput {
    if (input.agent_id || input.hook_event_name !== 'PostToolUse') return {};
    if (input.tool_name.endsWith('__set_status')) this.sinceStatus = 0;
    else if (++this.sinceStatus >= STATUS_EVERY) {
      this.sinceStatus = 0;
      return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: STATUS_REMINDER } };
    }
    return {};
  }

  async onStop(input: HookInput): Promise<HookJSONOutput> {
    if (input.hook_event_name !== 'Stop' || input.agent_id) return {};
    this.host.crons = input.session_crons ?? [];
    return {};
  }
}
