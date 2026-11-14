import { editedPath } from '../steps.js';
import type { HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { AgentHost } from '../types.js';
import { STATUS_REMINDER } from './options.js';
import { denyTool, editDenied, toolDenied, type Unattended } from './unattended.js';
import { bigBroRequest, bigBroVerdict } from './approval.js';

const STATUS_EVERY = 8;

// The callbacks the CLI makes around tool calls and when a turn stops.
export class ToolHooks {
  private sinceStatus = 0;
  private injected: string[] = [];

  constructor(private host: AgentHost) {}

  async beforeAgent(input: HookInput, signal: AbortSignal): Promise<HookJSONOutput> {
    const req = bigBroRequest(input);
    if (!req) return {};
    const r = await this.host.ask(req.toolName, req.toolInput, { signal, title: req.title });
    return bigBroVerdict(r.behavior);
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
    const notes = this.injected.splice(0);
    if (input.tool_name.endsWith('__set_status')) this.sinceStatus = 0;
    else if (++this.sinceStatus >= STATUS_EVERY) {
      this.sinceStatus = 0;
      notes.push(STATUS_REMINDER);
    }
    return notes.length ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n\n') } } : {};
  }

  // Held until the next top-level tool call finishes, which hands it to Claude as context, or until the turn would end.
  inject(text: string) {
    this.injected.push(text);
  }

  clearInjected() {
    this.injected = [];
  }

  async onStop(input: HookInput): Promise<HookJSONOutput> {
    if (input.hook_event_name !== 'Stop' || input.agent_id) return {};
    this.host.crons = input.session_crons ?? [];
    const notes = this.injected.splice(0);
    return notes.length ? { decision: 'block', reason: notes.join('\n\n') } : {};
  }
}
