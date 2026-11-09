// The parts of the `codex app-server` protocol the driver uses, from `codex app-server generate-ts`.
export type ReasoningOption = { reasoningEffort: string; description: string };
export type CodexModel = { id: string; displayName: string; description: string; hidden: boolean; isDefault: boolean; supportedReasoningEfforts: ReasoningOption[] };

export type AskForApproval = 'untrusted' | 'on-request' | 'never';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type SandboxPolicy = { type: 'readOnly'; networkAccess: boolean } | { type: 'workspaceWrite'; writableRoots: string[]; networkAccess: boolean; excludeTmpdirEnvVar: boolean; excludeSlashTmp: boolean };

export type UserInput = { type: 'text'; text: string; text_elements: [] };

export type FileUpdateChange = { path: string; kind: { type: 'add' } | { type: 'delete' } | { type: 'update'; move_path: string | null }; diff: string };

export type ThreadItem =
  | { type: 'userMessage'; id: string; content: Array<{ type: string; text?: string }> }
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'commandExecution'; id: string; command: string; cwd: string; status: string; aggregatedOutput: string | null; exitCode: number | null }
  | { type: 'fileChange'; id: string; changes: FileUpdateChange[]; status: string }
  | { type: 'mcpToolCall'; id: string; server: string; tool: string; status: string; arguments: unknown; result: { content: unknown[] } | null; error: { message: string } | null }
  | { type: 'webSearch'; id: string; query: string }
  | { type: 'contextCompaction'; id: string }
  | { type: 'reasoning' | 'plan' | 'other'; id: string };

export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';
export type Turn = { id: string; items: ThreadItem[]; status: TurnStatus; startedAt: number | null; error: { message: string } | null };
export type Thread = { id: string; cwd: string; preview: string; name: string | null; updatedAt: number; turns: Turn[] };

export type RateLimitWindow = { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null };
export type RateLimits = { primary: RateLimitWindow | null; secondary: RateLimitWindow | null };

export type TokenUsage = { last: { totalTokens: number } };

export type McpServerStatus = {
  name: string;
  runtimeStatus: string | null;
  toolsError: string | null;
  tools: Record<string, { name: string; description?: string | null; annotations?: { readOnlyHint?: boolean | null; destructiveHint?: boolean | null } | null } | undefined>;
  serverInfo: { name: string; version: string } | null;
};

export type ApprovalMethod = 'item/commandExecution/requestApproval' | 'item/fileChange/requestApproval';
export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';
