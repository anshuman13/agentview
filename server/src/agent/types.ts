import type { Account, AgentEvent, CacheInfo, Capabilities, ChatEvent, Effort, LoopRole, McpServer, Provider, ServerMessage, ServerState, SessionInfo } from '../../../shared/protocol.js';

export type Decision = { behavior: 'allow'; updatedInput: Record<string, unknown>; updatedPermissions?: unknown[] } | { behavior: 'deny'; message: string };

export type AskOptions = {
  suggestions?: unknown[];
  title?: string;
  description?: string;
  decisionReason?: string;
  defaultToNo?: boolean;
  suppressAlwaysAllowRule?: boolean;
  signal: AbortSignal;
};

export type Cron = { schedule: string; prompt: string; recurring: boolean };

export type RunningTask = { toolUseId: string; tool: string; description: string };

// unshown: agent events kept out of the transcript (a workflow run whose call is before a compaction), still used for build records.
export type History = { events: ChatEvent[]; context: number | null; cache: CacheInfo | null; unshown?: ChatEvent[] };

export type TurnResult = { id: string; ok: boolean; text: string; costUsd: number; isError: boolean };

// What a session asks of the agent behind it.
export interface AgentDriver {
  readonly provider: Provider;
  readonly capabilities: Capabilities;
  readonly attached: boolean;
  // The files the agent reads as instructions, the first being the repo's.
  readonly instructionFiles: string[];
  readonly account: Account;
  accounts(): Account[];
  // Moves the chat to another account; it resumes there with its next prompt.
  setAccount(a: Account): void;
  // The account is out of usage until then; returns the account the chat moved to, if any has usage left.
  limitHit(until: number): Account | null;
  start(): void;
  // 'next' hands the message to Claude at its next step without stopping the turn.
  send(text: string, id?: string, priority?: 'next'): void;
  dropInput(): number;
  // Compacts the conversation; the driver reports the end through host.compacted or host.compactFailed.
  compact(instructions?: string): void;
  // True when the driver's compaction ends with a turn result, which sends the held messages; otherwise the session sends them when it ends.
  readonly compactEndsTurn: boolean;
  // A /x the session does not own. False means the session sends the text as a prompt; true means the driver handled or refused it.
  command(name: string, args: string): boolean;
  // Adds context to the running turn without a user event; false when no turn is running to take it.
  inject(text: string): Promise<boolean>;
  // Drops what inject held for a step that never came; a stopped turn must not carry it into the next one.
  clearInjected(): void;
  // Starts a code review of the working tree or a PR; the findings reach host.reportFindings.
  review(target: 'local' | number, id?: string): void;
  // The model a build cycle step runs on; null keeps the chat's own.
  roleModel(role: LoopRole): { model: string; effort?: Effort } | null;
  // cancelQueued also drops messages sent with 'next' that Claude has not read yet.
  interrupt(cancelQueued?: boolean): Promise<void>;
  setModel(model: string): Promise<{ model: string }>;
  setEffort(level: Effort): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  allow(rule: string): Promise<boolean>;
  rewind(promptId: string): Promise<{ canRewind: boolean; error?: string; filesChanged?: string[] }>;
  stopTask(toolUseId: string): Promise<boolean>;
  mcpStatus(): Promise<McpServer[] | null>;
  refreshUsage?(): Promise<void>;
  // Background tasks (workflow runs, background agents and shell commands) that die with the CLI process.
  runningTasks?(): RunningTask[];
  reconnectMcp(name: string): Promise<void>;
  toggleMcp(name: string, enabled: boolean): Promise<void>;
  addMcp(name: string, def: unknown): Promise<{ error?: string }>;
  loginMcp(name: string): Promise<{ authUrl?: string; callbackPort?: number }>;
  loadHistory(): Promise<History | null>;
  watchHistory(on: boolean): void;
  settled(): void;
  // Ends a CLI that stopped answering; the session hears exited().
  kill(): void;
  close(): void;
}

// What the driver reports back to its session.
export interface AgentHost {
  readonly cwd: string;
  readonly state: ServerState;
  crons: Cron[];
  emit(m: ServerMessage): void;
  pushEvent(ev: ChatEvent, opts?: { release?: boolean }): void;
  eventById(id: string): ChatEvent | undefined;
  agentOf(toolUseId: string): AgentEvent | undefined;
  system(text: string, error?: boolean): void;
  setStatus(text: string, detail?: { done?: string; next?: string[] }): void;
  // Runs a /goal line from a tool call; false when the line is not a valid goal.
  goal(line: string): boolean;
  // Starts a chat in another folder with a first prompt, for a tool call; returns the new chat's id.
  startChat?: (cwd: string, text: string) => Promise<string>;
  setSession(patch: Partial<SessionInfo>): void;
  noteFile(rel: string, source: 'tool' | 'watcher'): void;
  captureEdit(file: string): void;
  canUseTool(toolName: string, input: Record<string, unknown>, opts: AskOptions): Promise<Decision>;
  ask(toolName: string, input: Record<string, unknown>, opts: AskOptions): Promise<Decision>;
  turnStarted(why?: string): void;
  turnEnded(): void;
  turnResult(r: TurnResult): void;
  // The account is out of usage until then; a driver parses its own limit notice.
  limit(until: number): boolean;
  startCompacting(): void;
  compacted(pre: number, post: number | null | undefined): void;
  compactFailed(error: string): void;
  blocked(toolUseId: string, tool: string, reason: string): void;
  adopt(toolUseId: string): void;
  exited(): void;
  // The driver replaced its agent process; what lived only in the old one (scheduled jobs) has to be set up again.
  restarted(why: string): void;
  replaceHistory(h: History): void;
}

export type DriverFactory = (host: AgentHost) => AgentDriver;
