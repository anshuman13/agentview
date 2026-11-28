// The parts of the `codex app-server` protocol the driver uses, from `codex app-server generate-ts`.
export type ReasoningOption = { reasoningEffort: string; description: string };
export type CodexModel = { id: string; displayName: string; description: string; hidden: boolean; isDefault: boolean; supportedReasoningEfforts: ReasoningOption[]; defaultReasoningEffort?: string };

export type AskForApproval = 'untrusted' | 'on-request' | 'never';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type SandboxPolicy = { type: 'readOnly'; networkAccess: boolean } | { type: 'workspaceWrite'; writableRoots: string[]; networkAccess: boolean; excludeTmpdirEnvVar: boolean; excludeSlashTmp: boolean };

export type UserInput = { type: 'text'; text: string; text_elements: [] } | { type: 'localImage'; path: string };

export type FileUpdateChange = { path: string; kind: { type: 'add' } | { type: 'delete' } | { type: 'update'; move_path: string | null }; diff: string };

export type ThreadItem =
  | { type: 'userMessage'; id: string; content: Array<{ type: string; text?: string }> }
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'commandExecution'; id: string; command: string; cwd: string; status: string; aggregatedOutput: string | null; exitCode: number | null }
  | { type: 'fileChange'; id: string; changes: FileUpdateChange[]; status: string }
  | { type: 'mcpToolCall'; id: string; server: string; tool: string; status: string; arguments: unknown; result: { content: unknown[] } | null; error: { message: string } | null }
  | { type: 'webSearch'; id: string; query: string }
  | { type: 'contextCompaction'; id: string }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | { type: 'plan'; id: string; text: string }
  | { type: 'other'; id: string };

// `turn/plan/updated`: the whole update_plan checklist each time. Plans are not thread items; a reloaded thread reads the last one from its rollout file.
export type TurnPlanStepStatus = 'pending' | 'inProgress' | 'completed';
export type TurnPlanUpdatedNotification = { threadId: string; turnId: string; explanation: string | null; plan: Array<{ step: string; status: TurnPlanStepStatus }> };

// `item/reasoning/summaryTextDelta` and `item/reasoning/textDelta`; the completed `reasoning` item carries the joined text.
export type ReasoningDeltaNotification = { threadId: string; turnId: string; itemId: string; delta: string; summaryIndex?: number; contentIndex?: number };

export type TurnSteerParams = { threadId: string; input: UserInput[]; expectedTurnId: string };
export type TurnSteerResponse = { turnId: string };

export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';
export type Turn = { id: string; items: ThreadItem[]; status: TurnStatus; startedAt: number | null; error: { message: string } | null };
export type Thread = { id: string; cwd: string; path: string | null; preview: string; name: string | null; updatedAt: number; turns: Turn[]; gitInfo?: { branch: string | null } | null };
export type ThreadListResponse = { data: Thread[]; nextCursor: string | null };

export type RateLimitWindow = { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null };
export type RateLimits = { primary: RateLimitWindow | null; secondary: RateLimitWindow | null };

export type TokenUsage = { last: { totalTokens: number }; modelContextWindow: number | null };

export type McpServerStatus = {
  name: string;
  runtimeStatus: string | null;
  toolsError: string | null;
  tools: Record<string, { name: string; description?: string | null; annotations?: { readOnlyHint?: boolean | null; destructiveHint?: boolean | null } | null } | undefined>;
  serverInfo: { name: string; version: string } | null;
};

export type UserInputQuestion = { id: string; header: string; question: string; options: Array<{ label: string; description: string }> | null };
export type PermissionProfile = { network?: { enabled: boolean | null } | null; fileSystem?: { read?: string[] | null; write?: string[] | null; entries?: unknown[] } | null };
export type PermissionsResponse = { permissions: PermissionProfile; scope: 'turn' | 'session' };
export type ElicitationParams = { serverName: string; mode: string; message: string; url?: string; requestedSchema?: { properties?: Record<string, unknown> } | null };
export type ElicitationResponse = { action: 'accept' | 'decline' | 'cancel'; content: null; _meta: null };

export type ApprovalMethod = 'item/commandExecution/requestApproval' | 'item/fileChange/requestApproval';
export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';
