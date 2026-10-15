import { randomUUID } from 'node:crypto';
import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { PendingRequest, ServerMessage, ServerState } from '../../shared/protocol.js';

type Waiting = { resolve: (r: PermissionResult) => void; input: Record<string, unknown>; suggestions?: PermissionUpdate[] };

export type AskOptions = { suggestions?: PermissionUpdate[]; title?: string; displayName?: string; signal: AbortSignal };

export class Approvals {
  private waiting = new Map<string, Waiting>();

  constructor(private state: ServerState, private emit: (m: ServerMessage) => void) {}

  ask(toolName: string, input: Record<string, unknown>, opts: AskOptions): Promise<PermissionResult> {
    const id = randomUUID();
    const req: PendingRequest =
      toolName === 'AskUserQuestion'
        ? { id, kind: 'question', questions: (input as any).questions ?? [] }
        : {
            id,
            kind: 'permission',
            toolName,
            title: toolName === 'ExitPlanMode' ? 'Approve the plan to start building' : opts.title ?? opts.displayName ?? toolName,
            input,
            canAlwaysAllow: Boolean(opts.suggestions?.length),
          };

    this.state.pending.push(req);
    this.emit({ type: 'pending', request: req });

    return new Promise<PermissionResult>((resolve) => {
      this.waiting.set(id, { resolve, input, suggestions: opts.suggestions });
      opts.signal.addEventListener('abort', () => {
        this.finish(id);
        resolve({ behavior: 'deny', message: 'aborted' });
      });
    });
  }

  answerQuestion(id: string, answers: Record<string, string>) {
    const w = this.finish(id);
    w?.resolve({ behavior: 'allow', updatedInput: { ...w.input, answers } });
  }

  answerPermission(id: string, allow: boolean, always?: boolean) {
    const w = this.finish(id);
    if (!w) return;
    if (!allow) w.resolve({ behavior: 'deny', message: 'User denied this action in the AgentView UI.' });
    else w.resolve({ behavior: 'allow', updatedInput: w.input, updatedPermissions: always ? w.suggestions : undefined });
  }

  denyAll() {
    for (const w of this.waiting.values()) w.resolve({ behavior: 'deny', message: 'Session closed' });
    this.waiting.clear();
  }

  private finish(id: string) {
    const w = this.waiting.get(id);
    if (!w) return;
    this.waiting.delete(id);
    this.state.pending = this.state.pending.filter((p) => p.id !== id);
    this.emit({ type: 'resolved', id });
    return w;
  }
}
