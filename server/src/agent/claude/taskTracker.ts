import type { AgentHost, RunningTask } from '../types.js';
import type { SystemMessage } from './sdkTypes.js';
import { ENDED, usageOf } from './tasks.js';
import { agentToolUse, continuedTurn, patchAgent, taskDone, taskToolUse } from './subagents.js';
import type { AgentIds } from './transcript.js';

// The CLI's background tasks and subagents, and the tool calls they belong to.
export class TaskTracker {
  agents: AgentIds = new Map();
  private running = new Map<string, RunningTask>();
  private taskIds = new Map<string, string>();

  constructor(private host: AgentHost) {}

  get count() {
    return this.running.size;
  }

  list() {
    return [...this.running.values()];
  }

  clear() {
    this.running.clear();
  }

  isRunning(taskId: string) {
    return this.running.has(taskId);
  }

  taskIdOf(toolUseId: string) {
    return this.taskIds.get(toolUseId) ?? [...this.agents].find(([, t]) => t === toolUseId)?.[0];
  }

  progress(msg: Extract<SystemMessage, { subtype: 'task_progress' }>) {
    if (msg.tool_use_id) patchAgent(this.host, agentToolUse(this.host, msg.tool_use_id), (a) => ({ usage: usageOf(msg.usage), progress: msg.summary || a.progress }));
  }

  started(msg: Extract<SystemMessage, { subtype: 'task_started' }>) {
    const toolUseId = msg.tool_use_id && agentToolUse(this.host, msg.tool_use_id);
    const call = toolUseId ? this.host.eventById(toolUseId) : undefined;
    const use = call?.kind === 'tool_use' ? call : undefined;
    this.running.set(msg.task_id, { toolUseId: toolUseId || '', tool: use?.name ?? msg.task_type ?? 'task', description: msg.description || use?.summary || '' });
    if (!toolUseId) return;
    this.taskIds.set(toolUseId, msg.task_id);
    this.host.adopt(toolUseId);
    patchAgent(this.host, toolUseId, (a) => ({
      status: 'running',
      background: msg.is_backgrounded ?? a.background,
      prompt: msg.prompt || a.prompt,
      subagentType: msg.subagent_type || a.subagentType,
      ...(a.status !== 'running' && { startedAt: Date.now(), endedAt: null }),
    }));
  }

  updated(msg: Extract<SystemMessage, { subtype: 'task_updated' }>) {
    if (msg.patch.status && !['pending', 'running', 'paused'].includes(msg.patch.status)) this.running.delete(msg.task_id);
    const toolUseId = taskToolUse(this.taskIds, this.agents, msg.task_id);
    const { status, end_time, is_backgrounded } = msg.patch;
    if (toolUseId) patchAgent(this.host, toolUseId, () => ({
      ...(status && ENDED[status] && { status: ENDED[status], endedAt: end_time ?? Date.now() }),
      ...(is_backgrounded !== undefined && { background: is_backgrounded }),
    }));
  }

  notified(msg: Extract<SystemMessage, { subtype: 'task_notification' }>) {
    this.running.delete(msg.task_id);
    const toolUseId = msg.tool_use_id ? agentToolUse(this.host, msg.tool_use_id) : taskToolUse(this.taskIds, this.agents, msg.task_id);
    if (!toolUseId) return;
    // The CLI writes the report to the transcript before it streams; without this the watcher takes it for another process and restarts the CLI.
    continuedTurn(this.host);
    const usage = msg.usage && usageOf(msg.usage);
    patchAgent(this.host, toolUseId, (a) => ({ status: ENDED[msg.status], endedAt: a.status === 'running' ? Date.now() : a.endedAt ?? Date.now(), usage: usage || a.usage }));
    taskDone(this.host, this.agents, toolUseId, msg.task_id, msg.status, msg.summary);
  }
}
