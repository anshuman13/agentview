import type { Decision } from '../types.js';
import type { ApprovalDecision, ApprovalMethod, AskForApproval, FileUpdateChange, SandboxMode, SandboxPolicy } from './protocol.js';

export type Policy = { approvalPolicy: AskForApproval; sandbox: SandboxMode; sandboxPolicy: SandboxPolicy };

const WORKSPACE: Policy = { approvalPolicy: 'on-request', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } };

// Default asks before what leaves the workspace sandbox, Auto never asks, Plan and Don't ask can only read.
export function policyFor(mode: string | null): Policy {
  switch (mode) {
    case 'auto': return { ...WORKSPACE, approvalPolicy: 'never' };
    case 'plan': case 'dontAsk': return { approvalPolicy: 'never', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly', networkAccess: false } };
    default: return WORKSPACE;
  }
}

export type Ask = { tool: string; input: Record<string, unknown>; title?: string; detail?: string };

type CommandParams = { command?: string | null; reason?: string | null };
type FileParams = { itemId: string; reason?: string | null };

// The approval card for a request from the app-server; a file change names its files from the item it announced earlier.
export function askFor(method: ApprovalMethod, params: CommandParams & FileParams, files: Map<string, FileUpdateChange[]>): Ask {
  const detail = params.reason ?? undefined;
  if (method === 'item/commandExecution/requestApproval') return { tool: 'Bash', input: { command: params.command ?? '', ...(detail && { description: detail }) }, detail };
  const paths = (files.get(params.itemId) ?? []).map((c) => c.path);
  return { tool: 'Edit', input: { file_path: paths[0] ?? '' }, title: paths.length > 1 ? `Edit ${paths.length} files` : undefined, detail };
}

// Allow is accept, Always allow is accept for the session, and a cancelled card cancels the request.
export function decisionFor(d: Decision, cancelled: boolean): ApprovalDecision {
  if (cancelled) return 'cancel';
  if (d.behavior === 'deny') return 'decline';
  return d.updatedPermissions?.length ? 'acceptForSession' : 'accept';
}
