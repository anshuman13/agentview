export type PendingQuestion = {
  id: string;
  kind: 'question';
  questions: Array<{
    question: string;
    header: string;
    multiSelect?: boolean;
    options: Array<{ label: string; description: string; preview?: string }>;
  }>;
};

export type PendingPermission = {
  id: string;
  kind: 'permission';
  toolName: string;
  title: string;
  detail?: string;
  input: Record<string, unknown>;
  canAlwaysAllow: boolean;
  confirmFirst?: boolean;
};

export type PendingRequest = PendingQuestion | PendingPermission;

export type ChatEvent =
  | { id: string; kind: 'user'; text: string; at: number; stopping?: boolean }
  | { id: string; kind: 'assistant'; text: string; streaming: boolean; at: number }
  | { id: string; kind: 'tool_use'; name: string; input: Record<string, unknown>; summary: string; at: number }
  | { id: string; kind: 'tool_result'; toolUseId: string; text: string; isError: boolean; at: number }
  | { id: string; kind: 'result'; text: string; costUsd: number; isError: boolean; at: number }
  | { id: string; kind: 'system'; text: string; at: number }
  | { id: string; kind: 'status'; text: string; at: number }
  | { id: string; kind: 'plan'; next: string[]; at: number };

export type SessionInfo = {
  id: string;
  sessionId: string | null;
  model: string | null;
  team: boolean;
  cwd: string;
  running: boolean;
  permissionMode: string | null;
  apiKeySource: string | null;
  models: Array<{ value: string; displayName: string; description?: string }>;
  commands: Array<{ name: string; description: string }>;
  cache: CacheInfo | null;
  context: number | null;
  compacting: boolean;
  stopping: boolean;
  mcp: McpServer[];
};

export type McpServer = { name: string; status: string; tools?: number; error?: string };

export type McpConfigEntry = { name: string; scope: 'user' | 'local' | 'project'; type: string };

export const MCP_BAD = ['failed', 'needs-auth'];

export type CacheInfo = { at: number; ttlMs: number; readTokens: number; writeTokens: number };

export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'] as const;

export type ServerState = {
  session: SessionInfo;
  status: string;
  events: ChatEvent[];
  pending: PendingRequest[];
  recentFiles: string[];
};

export type ServerMessage =
  | { type: 'init'; state: ServerState }
  | { type: 'event'; event: ChatEvent }
  | { type: 'status'; text: string }
  | { type: 'pending'; request: PendingRequest }
  | { type: 'resolved'; id: string }
  | { type: 'file_changed'; path: string; source: 'tool' | 'watcher' }
  | { type: 'session'; session: SessionInfo }
  | { type: 'live'; chats: LiveChat[] }
  | { type: 'error'; text: string };

export type LiveChat = {
  id: string;
  sessionId: string | null;
  cwd: string;
  title: string;
  running: boolean;
  pending: number;
  status: string;
  lastActive: number;
  mcpFailed?: number;
};

export type SavedSession = {
  sessionId: string;
  title: string;
  cwd: string;
  gitBranch: string | null;
  lastModified: number;
};

export const COMPACT_AT = 200_000;

export const STALE_MS = 12 * 60 * 60 * 1000;

export type RepoKind = 'web' | 'service' | 'infra' | 'data' | 'app' | 'docs' | 'other';

export type Repo = {
  name: string;
  root: string;
  kind: RepoKind;
  cwd: string;
  branch: string;
  dirty: number;
  lastCommit: number;
  paseo: boolean;
};

export type Worktree = {
  id: string;
  project: string;
  repo: string;
  name: string;
  cwd: string;
  dirty: number;
  lastActive: number;
  removable: boolean;
};

export type ClientMessage =
  | { type: 'prompt'; text: string }
  | { type: 'steer'; text: string; id?: string }
  | { type: 'plan'; next: string[] }
  | { type: 'answer'; id: string; answers: Record<string, string> }
  | { type: 'permission'; id: string; allow: boolean; always?: boolean }
  | { type: 'set_model'; model: string }
  | { type: 'set_permission_mode'; mode: string }
  | { type: 'interrupt' }
  | { type: 'view'; id: string }
  | { type: 'close'; id: string }
  | { type: 'open_session'; sessionId: string }
  | { type: 'new_session'; cwd?: string }
  | { type: 'mcp_status' }
  | { type: 'mcp_reconnect'; name: string };

export type GitFile = { path: string; status: 'M' | 'A' | 'D' | 'R' | '?'; staged: boolean };

export type GitStatus = { branch: string; ahead: number; behind: number; files: GitFile[] };

export type CheckState = 'success' | 'failure' | 'pending' | 'none';

export type PullRequest = {
  number: number;
  title: string;
  author: string;
  branch: string;
  draft: boolean;
  review: string;
  checks: CheckState;
  updatedAt: string;
  url: string;
  additions: number;
  deletions: number;
  mine: boolean;
  reviewRequested: boolean;
};

export type PullRequestDetail = {
  body: string;
  checks: Array<{ name: string; state: CheckState; url: string }>;
  reviews: Array<{ author: string; state: string; body: string; at: string }>;
  files: Array<{ path: string; additions: number; deletions: number }>;
  commits: Array<{ oid: string; message: string; author: string }>;
  diff: string;
};

export type DeployRecord = { id: number; sha: string; ref: string; state: string; description: string; at: string; by: string; url: string };

export type DeployEnv = { name: string; label: string; defaultBranchOnly: boolean; deployed: DeployRecord | null; latest: DeployRecord | null; rollbackTo: DeployRecord | null; history: DeployRecord[] };

export type DeployStatus = {
  apps: string[];
  app: string;
  repo: string;
  velodrome: string;
  head: { sha: string; branch: string };
  envs: DeployEnv[];
};

export type DeployJob = { id: string; lines: string[]; done: boolean; ok: boolean; url: string };
