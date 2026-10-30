import { randomUUID } from 'node:crypto';
import type { PendingRequest, ServerMessage, ServerState } from '../../../shared/protocol.js';
import type { AskOptions, Decision } from '../agent/types.js';

type Waiting = { resolve: (r: Decision) => void; input: Record<string, unknown>; suggestions?: unknown[] };

export function permissionTitle(toolName: string, input: Record<string, unknown>) {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '');
  const file = (s('file_path') || s('notebook_path')).split('/').pop();
  switch (toolName) {
    case 'ExitPlanMode': return 'Approve the plan to start building';
    case 'Bash': return s('description') || 'Run a shell command';
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return file ? `Edit ${file}` : 'Edit a file';
    case 'Write': return file ? `Write ${file}` : 'Write a file';
    case 'Read': return file ? `Read ${file}` : 'Read a file';
    case 'WebSearch': return s('query') ? `Search the web for "${s('query')}"` : 'Search the web';
    case 'WebFetch': try { return `Fetch a page from ${new URL(s('url')).hostname}`; } catch { return 'Fetch a web page'; }
  }
  if (toolName.startsWith('mcp__')) {
    const [, server, tool = ''] = toolName.split('__');
    return `Use ${tool.replace(/_/g, ' ')} from ${server}`;
  }
  return `Use ${toolName}`;
}

export class Approvals {
  private waiting = new Map<string, Waiting>();

  constructor(private state: ServerState, private emit: (m: ServerMessage) => void) {}

  ask(toolName: string, input: Record<string, unknown>, opts: AskOptions): Promise<Decision> {
    // A turn stopped just before this call never fires 'abort' again, so the card would stay up.
    if (opts.signal.aborted) return Promise.resolve({ behavior: 'deny', message: 'aborted' });
    const id = randomUUID();
    const req: PendingRequest =
      toolName === 'AskUserQuestion'
        ? { id, kind: 'question', questions: (input as any).questions ?? [] }
        : {
            id,
            kind: 'permission',
            toolName,
            title: (toolName !== 'ExitPlanMode' && opts.title) || permissionTitle(toolName, input),
            detail: opts.description || opts.decisionReason || undefined,
            input,
            canAlwaysAllow: Boolean(opts.suggestions?.length) && !opts.suppressAlwaysAllowRule,
            confirmFirst: opts.defaultToNo || undefined,
          };

    this.state.pending.push(req);
    this.emit({ type: 'pending', request: req });

    return new Promise<Decision>((resolve) => {
      this.waiting.set(id, { resolve, input, suggestions: opts.suggestions });
      opts.signal.addEventListener('abort', () => {
        this.finish(id);
        resolve({ behavior: 'deny', message: 'aborted' });
      }, { once: true });
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

  denyAll(message = 'Session closed') {
    for (const id of [...this.waiting.keys()]) this.finish(id)?.resolve({ behavior: 'deny', message });
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
