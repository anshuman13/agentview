import type { AgentHost } from '../types.js';
import type { SystemMessage } from './sdkTypes.js';
import type { TaskTracker } from './taskTracker.js';
import { hookLine } from './hooks.js';

type Init = Extract<SystemMessage, { subtype: 'init' }>;

// The CLI's system messages; the session init stays with the driver, which owns the process.
export class SystemMessages {
  constructor(private host: AgentHost, private tasks: TaskTracker, private onInit: (msg: Init) => void) {}

  handle(msg: SystemMessage) {
    switch (msg.subtype) {
      case 'init':
        return this.onInit(msg);
      case 'session_state_changed':
        if (msg.state === 'running' && !this.host.state.session.running) this.host.turnStarted();
        return;
      case 'status':
        return this.status(msg);
      case 'compact_boundary': {
        const { pre_tokens, post_tokens } = msg.compact_metadata;
        this.host.compacted(pre_tokens, post_tokens);
        return;
      }
      case 'permission_denied':
        if (msg.decision_reason_type !== 'rule') this.host.blocked(msg.tool_use_id, msg.tool_name, msg.decision_reason || msg.message);
        return;
      case 'task_started':
        return this.tasks.started(msg);
      case 'task_progress':
        return this.tasks.progress(msg);
      case 'task_updated':
        return this.tasks.updated(msg);
      case 'task_notification':
        return this.tasks.notified(msg);
      case 'hook_response': {
        const line = hookLine(msg);
        if (line) this.host.system(line, true);
        return;
      }
      case 'local_command_output':
        this.host.pushEvent({ id: msg.uuid, kind: 'assistant', text: msg.content, streaming: false, at: Date.now() });
        this.host.turnEnded();
        return;
    }
  }

  private status(msg: Extract<SystemMessage, { subtype: 'status' }>) {
    const host = this.host;
    if (msg.permissionMode) host.setSession({ permissionMode: msg.permissionMode });
    if (msg.status === 'compacting') host.startCompacting();
    if (msg.compact_result === 'failed') host.compactFailed(msg.compact_error || 'no reason given');
    else if (msg.compact_result) host.setSession({ compacting: false });
  }
}
