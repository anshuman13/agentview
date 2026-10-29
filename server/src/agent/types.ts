import type { Account, AgentEvent, CacheInfo, Capabilities, ChatEvent, Effort, McpServer, ServerMessage, ServerState, SessionInfo } from '../../../shared/protocol.js';

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

export type History = { events: ChatEvent[]; context: number | null; cache: CacheInfo | null };

export type TurnResult = { id: string; ok: boolean; text: string; costUsd: number; isError: boolean };

// What a session asks of the agent behind it.
export interface AgentDriver {
  readonly capabilities: Capabilities;
  readonly attached: boolean;
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
  // cancelQueued also drops messages sent with 'next' that Claude has not read yet.
  interrupt(cancelQueued?: boolean): Promise<void>;
  setModel(model: string): Promise<{ model: string; team: boolean }>;
  setEffort(level: Effort): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  allow(rule: string): Promise<boolean>;
  rewind(promptId: string): Promise<{ canRewind: boolean; error?: string; filesChanged?: string[] }>;
  stopTask(toolUseId: string): Promise<boolean>;
  mcpStatus(): Promise<McpServer[] | null>;
  reconnectMcp(name: string): Promise<void>;
  toggleMcp(name: string, enabled: boolean): Promise<void>;
  addMcp(name: string, def: unknown): Promise<{ error?: string }>;
  loginMcp(name: string): Promise<{ authUrl?: string; callbackPort?: number }>;
  loadHistory(): Promise<History | null>;
  watchHistory(on: boolean): void;
  settled(): void;
  close(): void;
}

// What the driver reports back to its session.
export interface AgentHost {
  readonly cwd: string;
  readonly state: ServerState;
  crons: Cron[];
  emit(m: ServerMessage): void;
  pushEvent(ev: ChatEvent): void;
  eventById(id: string): ChatEvent | undefined;
  agentOf(toolUseId: string): AgentEvent | undefined;
  system(text: string): void;
  setStatus(text: string): void;
  setSession(patch: Partial<SessionInfo>): void;
  noteFile(rel: string, source: 'tool' | 'watcher'): void;
  canUseTool(toolName: string, input: Record<string, unknown>, opts: AskOptions): Promise<Decision>;
  ask(toolName: string, input: Record<string, unknown>, opts: AskOptions): Promise<Decision>;
  takePlanChange(): string | null;
  turnStarted(why?: string): void;
  turnEnded(): void;
  turnResult(r: TurnResult): void;
  noteReply(text: string): void;
  overage(until: number): void;
  startCompacting(): void;
  compacted(pre: number, post: number | null | undefined): void;
  blocked(toolUseId: string, tool: string, reason: string): void;
  reportFindings(input: unknown): void;
  notePr(toolUseId: string, text: string): void;
  adopt(toolUseId: string): void;
  exited(): void;
  replaceHistory(h: History): void;
}

export type DriverFactory = (host: AgentHost) => AgentDriver;
