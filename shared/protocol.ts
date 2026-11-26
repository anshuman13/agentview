
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
  group?: string;
};

export type ReviewState = 'kept' | 'undone';
// A run of changed lines of a file against its text before the turn, from line `line` of the new text.
export type ReviewHunk = { line: number; del: string[]; add: string[]; state?: ReviewState };
// A created, binary or large file has no hunks and is decided as a whole; binary and large files can only be kept.
export type ReviewFile = { path: string; hunks: ReviewHunk[]; created?: boolean; binary?: boolean; large?: boolean; state?: ReviewState };

export type ChatEvent =
  | { id: string; kind: 'user'; text: string; at: number; stopping?: boolean; queued?: boolean; voice?: boolean }
  | { id: string; kind: 'assistant'; text: string; streaming: boolean; at: number; parent?: string }
  | { id: string; kind: 'tool_use'; name: string; input: Record<string, unknown>; summary: string; at: number; parent?: string; agent?: string }
  | { id: string; kind: 'tool_result'; toolUseId: string; text: string; isError: boolean; at: number; parent?: string; stopped?: boolean }
  | { id: string; kind: 'result'; text: string; costUsd: number; isError: boolean; at: number; model?: string | null }
  | { id: string; kind: 'system'; text: string; at: number; error?: boolean; reset?: number }
  | { id: string; kind: 'status'; text: string; at: number; done?: string; next?: string[] }
  | { id: string; kind: 'plan'; next: string[]; at: number }
  | { id: string; kind: 'review'; files: ReviewFile[]; result?: string; at: number }
  | { id: string; kind: 'blocked'; rule: string; reason: string; allowed: boolean; at: number }
  | AgentEvent;

// The event with an append applied, or null when the event is not one it fits (a gap waits for the full event).
export function appendTo(ev: ChatEvent, offset: number, text: string): ChatEvent | null {
  if (ev.kind !== 'assistant' || offset > ev.text.length) return null;
  const add = text.slice(ev.text.length - offset);
  return add ? { ...ev, text: ev.text + add } : null;
}

// The Claude login a chat runs on: the main one, or a second one to fall back to.
export type Account = 'main' | 'alt' | 'alt2';
// The labels are replaced at startup by the ones in ~/.agentview/settings.json.
export const ACCOUNT_LABEL: Record<Account, string> = { main: 'Account 1', alt: 'Account 2', alt2: 'Account 3' };
// Display names on the Usage page.
export const ACCOUNT_NAME: Record<Account, string> = { main: 'Personal', alt: 'Work', alt2: 'Enterprise' };
// What GET /api/usage returns: per account, the latest limits, 7 days of window percents and tokens per local day.
export type UsageExtra = { enabled: boolean; limit: number | null; used: number | null; pct: number | null; currency: string | null };
export type UsageLatest = { at: number; fiveHour?: UsageWindow; week?: UsageWindow; models: (UsageWindow & { name: string })[]; extra?: UsageExtra };
export type UsageDay = { day: string; input: number; output: number; cacheWrite: number; cacheRead: number };
export type UsageAccount = { account: Account; name: string; latest: UsageLatest | null; series: { at: number; fiveHour?: number; week?: number }[]; days: UsageDay[] };
export type UsageReport = { accounts: UsageAccount[] };
// The account each hub profile runs on.
export const PROFILE_ACCOUNT = { work: 'alt', personal: 'main' } as const;
// Accounts only picked by hand, never for new chats or after a usage limit.
export const ACCOUNT_NOTE: Partial<Record<Account, string>> = { alt2: 'Only picked by hand' };
// What the clients read from /api/settings: the features that are on and the account labels.
export type PublicSettings = { deploy: boolean; accountLabels: Record<Account, string>; providers?: ProviderOption[]; personalRoot?: string; roots?: string[]; defaultProvider?: Provider; featureUse?: boolean; hiddenFeatures?: string[] };

// What runs a chat: the Claude login, Claude Code on OpenRouter models, or the Codex CLI on a ChatGPT plan.
export type Provider = 'claude' | 'openrouter' | 'codex';
// A provider a new chat can pick; a disabled one says what is missing.
// modelSet: providers with the same model ids share it (Claude and OpenRouter), so clients keep model lists per set without knowing names.
export type ProviderOption = { id: Provider; label: string; modelSet: string; enabled: boolean; note?: string };

// Share of the Claude plan's 5-hour and weekly limits used, from the CLI's usage API.
export type UsageWindow = { pct: number; resetsAt: number | null };
export type PlanUsage = { fiveHour: UsageWindow | null; week: UsageWindow | null };

export type SessionInfo = {
  id: string;
  sessionId: string | null;
  model: string | null;
  effort: Effort | null;
  cwd: string;
  running: boolean;
  permissionMode: string | null;
  // Changed files are reviewed after each turn.
  review?: boolean;
  apiKeySource: string | null;
  models: Array<{ value: string; displayName: string; description?: string; efforts?: string[] }>;
  commands: Array<{ name: string; description: string }>;
  cache: CacheInfo | null;
  context: number | null;
  // The model's context window in tokens, when the agent reports it.
  contextWindow?: number | null;
  compacting: boolean;
  stopping: boolean;
  mcp: McpServer[];
  pr: number | null;
  account: Account;
  accounts: Account[];
  usage?: PlanUsage | null;
  provider?: Provider;
  capabilities?: Capabilities;
  // The files the agent reads as instructions, the first being the repo's.
  instructionFiles?: string[];
  // The shell line that continues the chat in the provider's own CLI; null when it has none.
  resumeCommand?: string | null;
  // Names of the manual prompt hooks for this chat's repo.
  hooks?: string[];
};

export type SessionUpdate = Omit<SessionInfo, 'commands' | 'mcp'> & Partial<Pick<SessionInfo, 'commands' | 'mcp'>>;

// What the agent behind a chat supports.
export type Capabilities = { rewind: boolean; mcp: boolean; mcpEdit: boolean; connectors: boolean; effort: boolean; stopTask: boolean; subagents: boolean };

export const BIG_BRO = 'big-bro';

export type RoundOutcome = 'done' | 'progress' | 'blocked' | 'question' | 'quiet' | 'failed';
export type RunOp = 'stop' | 'pause' | 'resume';
export type Round = { n: number; at: number; outcome: RoundOutcome; line: string; costUsd: number; sessionId?: string };

// One chat of a /tries run: its Claude session, and the worktree branch it works on. A kept try archives the others.
export type Try = { n: number; chatId: string; sessionId: string; branch: string; dropped?: boolean };

// One /tries or scheduled coding job: sessionId is the Claude session (stable across restarts), chatId the live chat now running it.
export type ChatRun = {
  id: string;
  kind: 'tries' | 'job' | 'build';
  sessionId: string;
  chatId: string;
  title: string;
  what: string;
  startedAt: number;
  endedAt: number | null;
  state: 'running' | 'paused' | 'done';
  why: string;
  round: number;
  max: number;
  nextAt: number | null;
  provider?: Provider;
  costUsd: number;
  rounds: Round[];
  asked?: boolean;
  tries?: Try[];
  needsYou: boolean;
  cwd?: string;
  jobId?: string;
  branch?: string;
  repo?: string;
  worktree?: string;
  paseo?: boolean;
  review?: 'pending';
  pr?: string;
  // A build run: its spec, the stop time of Keep going, auto (no approval), the step it is on and "3 of 7" tasks done.
  spec?: string;
  until?: number | null;
  auto?: boolean;
  phase?: 'spec' | 'task' | 'more' | 'recap';
  clearing?: boolean;
  pausing?: boolean;
  idle?: number;
  progress?: string;
};

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
  ms?: number;
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

export const ROW_WINDOW = 150;

export type ServerState = {
  session: SessionInfo;
  status: string;
  events: ChatEvent[];
  pending: PendingRequest[];
  recentFiles: string[];
  // Events left out of a tail init; absent when the state is full.
  earlier?: number;
};

export type Finding = { file: string; line: number; summary: string; failure?: string; category?: string; verdict?: string };
// What /code-review reported for a PR number or the working tree ("local") of one repo.
export type ReviewFindings = { repo: string; target: string; at: number; findings: Finding[] };

export type ServerMessage =
  | { type: 'init'; state: ServerState; boot?: number; protocol?: string }
  | { type: 'findings'; review: ReviewFindings }
  | { type: 'event'; event: ChatEvent }
  // Text added to a streaming assistant event that starts at `offset` of its text; the finished event follows in full.
  | { type: 'append'; id: string; offset: number; text: string }
  | { type: 'status'; text: string }
  | { type: 'pending'; request: PendingRequest }
  | { type: 'resolved'; id: string }
  | { type: 'file_changed'; path: string; source: 'tool' | 'watcher' }
  // A merge into the SessionInfo the client holds: `commands` and `mcp` are left out while unchanged since the last update. `init` carries them whole.
  | { type: 'session'; session: SessionUpdate }
  | { type: 'live'; chats: LiveChat[] }
  | { type: 'runs'; runs: ChatRun[] }
  | { type: 'attention'; items: AttentionItem[] }
  | { type: 'restarting' }
  // To one phone app: set this alarm. The phone answers with phone_alarm_result.
  | { type: 'phone_alarm'; id: string; time: string; day?: string; label?: string }
  | { type: 'error'; text: string };

export type LiveAgent = { id: string; description: string; type: string; group?: string; startedAt: number };

export type LiveNow = { text: string; at: number; done?: string; next?: string[] };

export type LiveChat = {
  id: string;
  sessionId: string | null;
  cwd: string;
  title: string;
  running: boolean;
  agents?: number;
  agentList?: LiveAgent[];
  now?: LiveNow;
  pending: number;
  // What the first pending request asks: "Question", "Plan approval" or "Permission: Bash".
  ask?: string;
  status: string;
  lastActive: number;
  mcpFailed?: number;
  stalled?: boolean;
  failed?: boolean;
  model?: string;
  provider?: Provider;
  last?: string;
  edits?: { add: number; del: number };
  cost?: number;
  spend?: { today: Record<string, number>; week: Record<string, number> };
  pr?: number;
  prChecks?: CheckState;
  todos?: { done: number; total: number };
  run?: { id: string; kind: ChatRun['kind']; state: ChatRun['state']; why?: string; nextAt: number | null; round: number; needsYou: boolean; outcome?: RoundOutcome; line?: string };
};

export type AttentionKind = 'ci' | 'changes' | 'review' | 'ready' | 'issue' | 'stale' | 'commit' | 'deploy';

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
  deploy: 'Deploy failed',
};

export type SavedSession = {
  sessionId: string;
  title: string;
  cwd: string;
  gitBranch: string | null;
  lastModified: number;
  firstPrompt?: string;
  summary?: string;
  provider?: Provider;
  parentId?: string;
  via?: SubVia;
  startedAt?: number;
  spawnedBy?: string;
};

// How a sub-chat started: a /clear typed in the chat, or one sent by the chat's build run.
export type SubVia = 'clear' | 'build';

// A chat started by another chat (a build from the start_build tool), keyed by the child's Claude session id.
export type SpawnLink = { parent: string; kind: 'build'; at: number };

export type BuildCardState = 'spec' | 'approval' | 'running' | 'paused' | 'needs' | 'done' | 'stopped';

// One build a chat started, as GET /api/chat/spawned returns it for the transcript's build card.
export type SpawnedBuild = {
  chatId?: string;
  sessionId: string;
  title: string;
  state: BuildCardState;
  done: number;
  total: number;
  round?: string;
};

export const COMPACT_AT = 200_000;

// Where the context meter fills and auto-compact runs: 80% of the model's window, or COMPACT_AT when it is not known.
export const compactAt = (contextWindow?: number | null) => (contextWindow ? Math.round(contextWindow * 0.8) : COMPACT_AT);

export const STALE_MS = 12 * 60 * 60 * 1000;

export const BIN_MS = 7 * 24 * 60 * 60 * 1000;

// An unpinned chat idle this long moves to the bin on its own.
export const ARCHIVE_MS = 2 * 24 * 60 * 60 * 1000;

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
  // The number of the merged pull request from this worktree's branch, if any.
  merged?: number;
  removable: boolean;
};

export type ClientMessage =
  | { type: 'prompt'; text: string; id?: string; voice?: boolean }
  | { type: 'queue'; text: string; id?: string; voice?: boolean }
  | { type: 'send_now'; id: string }
  | { type: 'steer'; text: string; id?: string }
  | { type: 'plan'; next: string[] }
  | { type: 'answer'; id: string; answers: Record<string, string> }
  | { type: 'permission'; id: string; allow: boolean; always?: boolean }
  | { type: 'allow_blocked'; id: string }
  | { type: 'set_model'; model: string }
  | { type: 'set_effort'; effort: string }
  | { type: 'set_account'; account: string }
  | { type: 'set_permission_mode'; mode: string }
  | { type: 'set_review'; on: boolean }
  | { type: 'review'; id: string; action: 'keep' | 'undo'; file?: string; hunk?: number }
  | { type: 'run'; run: string; op: RunOp }
  | { type: 'tries_send'; run: string; text: string }
  | { type: 'tries_keep'; run: string; n: number }
  | { type: 'interrupt' }
  | { type: 'rewind'; id: string }
  | { type: 'stop_task'; toolUseId: string }
  | { type: 'view'; id: string }
  | { type: 'retry' }
  | { type: 'run_hook'; name: string }
  | { type: 'close'; id: string }
  | { type: 'open_session'; sessionId: string }
  | { type: 'new_session'; cwd?: string; fork?: string; profile?: 'work' | 'personal'; model?: string; provider?: Provider; text?: string }
  | { type: 'mcp_status' }
  | { type: 'phone_alarm_result'; id: string; ok: boolean; notified?: boolean; weekday?: string; error?: string }
  | { type: 'usage' }
  | { type: 'mcp_reconnect'; name: string }
  | { type: 'mcp_toggle'; name: string; enabled: boolean }
  | { type: 'restart'; now?: boolean };

export type GitFile = { path: string; status: 'M' | 'A' | 'D' | 'R' | '?'; staged: boolean };

export type GitStatus = { branch: string; ahead: number; behind: number; files: GitFile[] };

export type GitCommit = { hash: string; subject: string; at: number };

export type CheckState ='success' | 'failure' | 'pending' | 'none';

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
  autoMerge?: { note: string; error?: string };
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
  serviceUrl: string;
  head: { sha: string; branch: string };
  envs: DeployEnv[];
};

export type DeployJob = { id: string; lines: string[]; done: boolean; ok: boolean; url: string };
