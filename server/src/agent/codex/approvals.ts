import type { Decision } from '../types.js';
import { changeText } from './events.js';
import type { ApprovalDecision, ApprovalMethod, AskForApproval, ElicitationParams, ElicitationResponse, FileUpdateChange, PermissionProfile, PermissionsResponse, SandboxMode, SandboxPolicy, UserInputQuestion } from './protocol.js';

export type Policy = { approvalPolicy: AskForApproval; sandbox: SandboxMode; sandboxPolicy: SandboxPolicy };

const workspace = (networkAccess: boolean): Policy => ({ approvalPolicy: 'on-request', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess, excludeTmpdirEnvVar: false, excludeSlashTmp: false } });

// Default asks before what leaves the workspace sandbox, Auto never asks and has network, Read only, Plan and Don't ask can only read.
export function policyFor(mode: string | null): Policy {
  switch (mode) {
    case 'auto': return { ...workspace(true), approvalPolicy: 'never' };
    case 'readOnly': case 'plan': case 'dontAsk': return { approvalPolicy: 'never', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly', networkAccess: false } };
    default: return workspace(false);
  }
}

export type Ask = { tool: string; input: Record<string, unknown>; title?: string; detail?: string };

type CommandParams = { command?: string | null; reason?: string | null };
type FileParams = { itemId: string; reason?: string | null };

// The approval card for a request from the app-server; a file change names its files from the item it announced earlier.
export function askFor(method: ApprovalMethod, params: CommandParams & FileParams, files: Map<string, FileUpdateChange[]>): Ask {
  const detail = params.reason ?? undefined;
  if (method === 'item/commandExecution/requestApproval') return { tool: 'Bash', input: { command: params.command ?? '', ...(detail && { description: detail }) }, detail };
  const changes = files.get(params.itemId) ?? [];
  const edits = changes.map((c) => {
    const { before, after } = changeText(c);
    return { old_string: before, new_string: after };
  });
  const input = changes.length > 1 ? { file_path: changes[0].path, edits } : { file_path: changes[0]?.path ?? '', ...edits[0] };
  return { tool: changes.length > 1 ? 'MultiEdit' : 'Edit', input, title: changes.length > 1 ? `Edit ${changes.length} files` : undefined, detail };
}

// Questions as an AskUserQuestion card; the answers come back by the card's question text.
export function questionsAsk(questions: UserInputQuestion[]): Ask {
  return { tool: 'AskUserQuestion', input: { questions: questions.map((q) => ({ header: q.header, question: q.question, options: q.options ?? [], multiSelect: false })) } };
}

export function answersFor(questions: UserInputQuestion[], d: Decision) {
  const given = d.behavior === 'allow' ? ((d.updatedInput.answers ?? {}) as Record<string, string>) : {};
  return { answers: Object.fromEntries(questions.flatMap((q) => (given[q.question] === undefined ? [] : [[q.id, { answers: [given[q.question]] }]]))) };
}

const granted = (p: PermissionProfile): PermissionProfile => ({ ...(p.network && { network: p.network }), ...(p.fileSystem && { fileSystem: p.fileSystem }) });

export function permissionsAsk(params: { reason?: string | null; permissions: PermissionProfile }): Ask {
  const { network, fileSystem } = params.permissions;
  const input = { ...(network?.enabled && { network: 'on' }), ...(fileSystem?.read?.length && { read: fileSystem.read.join('\n') }), ...(fileSystem?.write?.length && { write: fileSystem.write.join('\n') }) };
  return { tool: 'Permissions', input, title: 'Codex asks for more permissions', detail: params.reason ?? undefined };
}

// There is no decline in the protocol: Deny grants nothing, Allow grants for the turn and Always for the session.
export function permissionsFor(requested: PermissionProfile, d: Decision, cancelled: boolean): PermissionsResponse {
  if (cancelled || d.behavior === 'deny') return { permissions: {}, scope: 'turn' };
  return { permissions: granted(requested), scope: d.updatedPermissions?.length ? 'session' : 'turn' };
}

// A form with fields cannot be shown yet, so only a link or a bare confirmation is asked.
export const hasFields = (p: ElicitationParams) => p.mode !== 'url' && Object.keys(p.requestedSchema?.properties ?? {}).length > 0;

export function elicitationAsk(p: ElicitationParams): Ask {
  return { tool: `mcp__${p.serverName}__elicitation`, input: p.mode === 'url' ? { url: p.url ?? '' } : {}, title: `${p.serverName} asks you to ${p.mode === 'url' ? 'open a link' : 'confirm'}`, detail: p.message };
}

export function elicitationFor(d: Decision | null, cancelled: boolean): ElicitationResponse {
  const action = cancelled ? 'cancel' : d?.behavior === 'allow' ? 'accept' : 'decline';
  return { action, content: null, _meta: null };
}

// Allow is accept, Always allow is accept for the session, and a cancelled card cancels the request.
export function decisionFor(d: Decision, cancelled: boolean): ApprovalDecision {
  if (cancelled) return 'cancel';
  if (d.behavior === 'deny') return 'decline';
  return d.updatedPermissions?.length ? 'acceptForSession' : 'accept';
}
