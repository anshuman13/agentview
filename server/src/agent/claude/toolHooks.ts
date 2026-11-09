import type { HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { AgentHost } from '../types.js';
import { STATUS_REMINDER } from './options.js';
import { bigBroRequest, bigBroVerdict } from './approval.js';

const STATUS_EVERY = 8;

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

  beforeEdit(input: HookInput): HookJSONOutput {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const { file_path, notebook_path } = (input.tool_input ?? {}) as { file_path?: unknown; notebook_path?: unknown };
    const file = file_path ?? notebook_path;
    if (typeof file === 'string') this.host.captureEdit(file);
    return {};
  }

  afterTool(input: HookInput): HookJSONOutput {
    if (input.agent_id || input.hook_event_name !== 'PostToolUse') return {};
    const notes: string[] = [];
    const plan = this.host.takePlanChange();
    if (plan) notes.push(plan);
    if (input.tool_name.endsWith('__set_status')) this.sinceStatus = 0;
    else if (++this.sinceStatus >= STATUS_EVERY) {
      this.sinceStatus = 0;
      notes.push(STATUS_REMINDER);
    }
    return notes.length ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n\n') } } : {};
  }

  async onStop(input: HookInput): Promise<HookJSONOutput> {
    if (input.hook_event_name === 'Stop' && !input.agent_id) this.host.crons = input.session_crons ?? [];
    return {};
  }
}
