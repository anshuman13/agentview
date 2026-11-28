import type { Decision } from '../types.js';
import { changeText } from './events.js';
import type { ApprovalDecision, ApprovalMethod, AskForApproval, ElicitationParams, ElicitationResponse, FileUpdateChange, PermissionProfile, PermissionsResponse, SandboxMode, SandboxPolicy, UserInputQuestion } from './protocol.js';

export type Policy = { approvalPolicy: AskForApproval; sandbox: SandboxMode; sandboxPolicy: SandboxPolicy };

const workspace = (approvalPolicy: AskForApproval, networkAccess: boolean, writableRoots: string[]): Policy => ({ approvalPolicy, sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite', writableRoots, networkAccess, excludeTmpdirEnvVar: false, excludeSlashTmp: false } });

// Default asks before every file edit and every command Codex does not trust (read-only commands are accepted in the driver), Auto never asks and has network, Read only, Plan and Don't ask can only read.
// The sandbox keeps .git read-only inside the workspace, so the repo's git folders come in as writable roots and commits work.
export function policyFor(mode: string | null, gitDirs: string[] = []): Policy {
  switch (mode) {
    case 'auto': return workspace('never', true, gitDirs);
    case 'readOnly': case 'plan': case 'dontAsk': return { approvalPolicy: 'never', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly', networkAccess: false } };
    default: return workspace('untrusted', false, gitDirs);
  }
}

export type Ask = { tool: string; input: Record<string, unknown>; title?: string; detail?: string };

type CommandParams = { command?: string | null; reason?: string | null };
type FileParams = { itemId: string; reason?: string | null };

// Codex runs every command through the login shell, as `/bin/zsh -lc 'git status'`; this gives back the inner command.
export function unwrapShell(command: string) {
  const m = /^(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh -lc (.+)$/s.exec(command.trim());
  if (!m) return command;
  const words = shellWords(m[1]);
  return words?.length === 1 && typeof words[0] === 'string' ? words[0] : command;
}

// Splits a command into words and `|`, `&&` or `||` separators; null when it uses anything else the shell would interpret.
function shellWords(s: string): (string | { pipe: true })[] | null {
  const out: (string | { pipe: true })[] = [];
  let word: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) return null;
      word = (word ?? '') + s.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      const end = s.indexOf('"', i + 1);
      if (end < 0) return null;
      const inner = s.slice(i + 1, end);
      if (/[$`\\]/.test(inner)) return null;
      word = (word ?? '') + inner;
      i = end;
    } else if (c === ' ' || c === '\t') {
      if (word !== null) out.push(word);
      word = null;
    } else if (c === '|' || (c === '&' && s[i + 1] === '&')) {
      if (word !== null) out.push(word);
      word = null;
      out.push({ pipe: true });
      if (s[i + 1] === c) i++;
    } else if (/[;&<>$`\\\n(){}!~]/.test(c)) {
      return null;
    } else word = (word ?? '') + c;
  }
  if (word !== null) out.push(word);
  return out;
}

const GIT_READ = new Set(['status', 'diff', 'log', 'show']);

function readOnlyStep([cmd, ...args]: string[]) {
  switch (cmd) {
    case 'ls': case 'cat': case 'grep': case 'head': case 'tail': case 'wc': case 'nl': case 'pwd': return true;
    case 'find': return !args.some((a) => /^-(exec|ok|delete|fprint|fls)/.test(a));
    case 'rg': return !args.some((a) => a.startsWith('--pre'));
    case 'sed': return args[0] === '-n' && args.length >= 2 && /^\d*(,\d*)?p$/.test(args[1]) && !args.slice(2).some((a) => a.startsWith('-'));
    case 'git': return GIT_READ.has(args[0]) && !args.some((a) => a.startsWith('--output') || a.startsWith('--ext-diff') || a === '-o');
    default: return false;
  }
}

// A command Codex Default runs without a card: every step of the pipe or `&&`/`||` chain is on the read-only list, with no redirects or substitutions.
export function readOnlyCommand(command: string) {
  const words = shellWords(unwrapShell(command));
  if (!words?.length) return false;
  const steps: string[][] = [[]];
  for (const w of words) {
    if (typeof w === 'string') steps[steps.length - 1].push(w);
    else steps.push([]);
  }
  return steps.every((s) => s.length > 0 && readOnlyStep(s));
}

// The approval card for a request from the app-server; a file change names its files from the item it announced earlier.
export function askFor(method: ApprovalMethod, params: CommandParams & FileParams, files: Map<string, FileUpdateChange[]>): Ask {
  const detail = params.reason ?? undefined;
  if (method === 'item/commandExecution/requestApproval') return { tool: 'Bash', input: { command: unwrapShell(params.command ?? ''), ...(detail && { description: detail }) }, detail };
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
