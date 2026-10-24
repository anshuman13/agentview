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

export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped';

export type AgentUsage = { tokens: number; toolUses: number; durationMs: number };

export type AgentEvent = {
  id: string;
  kind: 'agent';
  toolUseId: string;
  description: string;
  subagentType: string;
  model: string | null;
  background: boolean;
  prompt: string;
  status: AgentStatus;
  startedAt: number;
  endedAt: number | null;
  progress: string | null;
  usage: AgentUsage | null;
  at: number;
  parent?: string;
};

export type ChatEvent =
  | { id: string; kind: 'user'; text: string; at: number; stopping?: boolean; queued?: boolean; phase?: LoopPhase }
  | { id: string; kind: 'assistant'; text: string; streaming: boolean; at: number; parent?: string }
  | { id: string; kind: 'tool_use'; name: string; input: Record<string, unknown>; summary: string; at: number; parent?: string; agent?: string }
  | { id: string; kind: 'tool_result'; toolUseId: string; text: string; isError: boolean; at: number; parent?: string; stopped?: boolean }
  | { id: string; kind: 'result'; text: string; costUsd: number; isError: boolean; at: number }
  | { id: string; kind: 'system'; text: string; at: number }
  | { id: string; kind: 'status'; text: string; at: number }
  | { id: string; kind: 'plan'; next: string[]; at: number }
  | { id: string; kind: 'blocked'; rule: string; reason: string; allowed: boolean; at: number }
  | AgentEvent;

export type SessionInfo = {
  id: string;
  sessionId: string | null;
  model: string | null;
  effort: Effort | null;
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
  loop: LoopState;
  repeat: Repeat | null;
};

// A prompt sent again on an interval (every > 0) or as soon as the last round ends (every = 0), until a clock time.
export type Repeat = { prompt: string; every: number; until: number | null; round: number; nextAt: number | null };

export type LoopPhase = 'plan' | 'build' | 'test' | 'passed' | 'failed';

export type LoopState = { on: boolean; max: number; round: number; phase: LoopPhase | null };

export type McpProp = { type?: string | string[]; description?: string; enum?: unknown[]; default?: unknown; title?: string; maxLength?: number };
export type McpSchema = { type?: string; properties?: Record<string, McpProp>; required?: string[] };
export type McpTool = { name: string; description?: string; readOnly?: boolean; destructive?: boolean; inputSchema?: McpSchema };

export type McpServer = {
  name: string;
  status: string;
  scope?: string;
  type?: string;
  command?: string;
  env?: string[];
  version?: string;
  error?: string;
  tools?: McpTool[];
};

export type McpConfigEntry = { name: string; scope: 'user' | 'local' | 'project'; type: string; command?: string; env?: string[] };

export const MCP_BAD = ['failed', 'needs-auth'];

export type CacheInfo = { at: number; ttlMs: number; readTokens: number; writeTokens: number };

export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'] as const;

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type Effort = (typeof EFFORT_LEVELS)[number];

export const EFFORT_LABEL: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

export type ServerState = {
  session: SessionInfo;
  status: string;
  events: ChatEvent[];
  pending: PendingRequest[];
  recentFiles: string[];
};

export type Finding = { file: string; line: number; summary: string; failure?: string; category?: string; verdict?: string };
// What /code-review reported for a PR number or the working tree ("local") of one repo.
export type ReviewFindings = { repo: string; target: string; at: number; findings: Finding[] };

export type ServerMessage =
  | { type: 'init'; state: ServerState; boot?: number }
  | { type: 'findings'; review: ReviewFindings }
  | { type: 'event'; event: ChatEvent }
  | { type: 'status'; text: string }
  | { type: 'pending'; request: PendingRequest }
  | { type: 'resolved'; id: string }
  | { type: 'file_changed'; path: string; source: 'tool' | 'watcher' }
  | { type: 'session'; session: SessionInfo }
  | { type: 'live'; chats: LiveChat[] }
  | { type: 'attention'; items: AttentionItem[] }
  | { type: 'restarting' }
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
  stalled?: boolean;
  last?: string;
  edits?: { add: number; del: number };
  cost?: number;
};

export type AttentionKind = 'ci' | 'changes' | 'review' | 'ready' | 'issue' | 'stale' | 'commit' | 'sentry' | 'deploy';

export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  repo: string;
  cwd: string;
  number: number;
  title: string;
  url: string;
  since: number;
  prompt: string;
  chatId?: string;
  sha?: string;
  fixing?: string;
};

export const ATTENTION_LABEL: Record<AttentionKind, string> = {
  ci: 'CI failing',
  changes: 'Changes requested',
  review: 'Review requested',
  ready: 'Ready to merge',
  issue: 'Assigned to you',
  stale: 'No review for days',
  commit: 'Uncommitted changes',
  sentry: 'Sentry',
  deploy: 'Deploy failed',
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

export const BIN_MS = 24 * 60 * 60 * 1000;

export type BinnedSession = { sessionId: string; title: string; cwd: string; lastModified: number; deletedAt: number };

export type RepoKind = 'new' | 'web' | 'service' | 'infra' | 'data' | 'app' | 'docs' | 'other';

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
  | { type: 'prompt'; text: string; id?: string }
  | { type: 'steer'; text: string; id?: string }
  | { type: 'plan'; next: string[] }
  | { type: 'answer'; id: string; answers: Record<string, string> }
  | { type: 'permission'; id: string; allow: boolean; always?: boolean }
  | { type: 'allow_blocked'; id: string }
  | { type: 'set_model'; model: string }
  | { type: 'set_effort'; effort: string }
  | { type: 'set_permission_mode'; mode: string }
  | { type: 'set_loop'; on: boolean; max?: number }
  | { type: 'interrupt' }
  | { type: 'stop_task'; toolUseId: string }
  | { type: 'view'; id: string }
  | { type: 'close'; id: string }
  | { type: 'open_session'; sessionId: string }
  | { type: 'new_session'; cwd?: string }
  | { type: 'mcp_status' }
  | { type: 'mcp_reconnect'; name: string }
  | { type: 'mcp_toggle'; name: string; enabled: boolean }
  | { type: 'restart'; now?: boolean };

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
  sha: string;
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
