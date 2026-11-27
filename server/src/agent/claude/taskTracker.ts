import { randomUUID } from 'node:crypto';
import type { BackgroundShell } from '../../../../shared/protocol.js';
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
  // Shell commands the CLI reported ended, until their notification says how.
  private endedShells = new Map<string, RunningTask>();

  constructor(private host: AgentHost) {}

  get count() {
    return this.running.size;
  }

  list() {
    return [...this.running.values()];
  }

  clear() {
    this.running.clear();
    this.endedShells.clear();
    this.syncShells();
  }

  // Background shell commands go to the clients with their start time, so they can show elapsed time and a Stop.
  private syncShells() {
    const shells: BackgroundShell[] = [...this.running.values()].filter((t) => t.shell && t.toolUseId).map((t) => ({ toolUseId: t.toolUseId, label: t.description, startedAt: t.startedAt ?? Date.now() }));
    const old = this.host.state.session.shells ?? [];
    if (shells.length || old.length) this.host.setSession({ shells });
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
    const shell = msg.task_type === 'local_bash' && Boolean(msg.is_backgrounded);
    this.running.set(msg.task_id, { toolUseId: toolUseId || '', tool: use?.name ?? msg.task_type ?? 'task', description: msg.description || use?.summary || '', startedAt: Date.now(), ...(msg.task_type === 'local_bash' && { shell }) });
    if (shell) this.syncShells();
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
    const task = this.running.get(msg.task_id);
    if (task?.shell === false && msg.patch.is_backgrounded) task.shell = true;
    if (msg.patch.status && !['pending', 'running', 'paused'].includes(msg.patch.status)) {
      this.running.delete(msg.task_id);
      if (task?.shell !== undefined) this.endedShells.set(msg.task_id, task);
    }
    if (task?.shell !== undefined) this.syncShells();
    const toolUseId = taskToolUse(this.taskIds, this.agents, msg.task_id);
    const { status, end_time, is_backgrounded } = msg.patch;
    if (toolUseId) patchAgent(this.host, toolUseId, () => ({
      ...(status && ENDED[status] && { status: ENDED[status], endedAt: end_time ?? Date.now() }),
      ...(is_backgrounded !== undefined && { background: is_backgrounded }),
    }));
  }

  notified(msg: Extract<SystemMessage, { subtype: 'task_notification' }>) {
    const task = this.running.get(msg.task_id) ?? this.endedShells.get(msg.task_id);
    this.running.delete(msg.task_id);
    this.endedShells.delete(msg.task_id);
    const toolUseId = msg.tool_use_id ? agentToolUse(this.host, msg.tool_use_id) : taskToolUse(this.taskIds, this.agents, msg.task_id);
    if (task?.shell !== undefined) this.syncShells();
    if (!toolUseId) return;
    // A stopped shell command gets no turn of its own: mark its step stopped and say so in the transcript.
    if (task?.shell !== undefined && msg.status === 'stopped') return this.shellStopped(toolUseId, msg.summary || task.description);
    // The CLI writes the report to the transcript before it streams; without this the watcher takes it for another process and restarts the CLI.
    continuedTurn(this.host);
    const usage = msg.usage && usageOf(msg.usage);
    patchAgent(this.host, toolUseId, (a) => ({ status: ENDED[msg.status], endedAt: a.status === 'running' ? Date.now() : a.endedAt ?? Date.now(), usage: usage || a.usage }));
    taskDone(this.host, this.agents, toolUseId, msg.task_id, msg.status, msg.summary);
  }

  private shellStopped(toolUseId: string, label: string) {
    this.host.pushEvent({ id: randomUUID(), kind: 'tool_result', toolUseId, text: 'Stopped', isError: false, at: Date.now(), stopped: true });
    this.host.system(`Background task stopped · ${label}`);
  }
}
