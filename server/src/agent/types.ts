import type { McpServerDef } from '../integrations/mcpClient.js';
import type { MemoryFile } from './memory.js';
import type { UnattendedLimits } from '../settings.js';
import type { TurnTokens } from '../../../shared/prices.js';
import type { Account, AgentEvent, SavedSession, CacheInfo, Capabilities, ChatEvent, ConnectorGroup, Effort, McpServer, Provider, ServerMessage, ServerState, SessionInfo } from '../../../shared/protocol.js';

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

export type RunningTask = { toolUseId: string; tool: string; description: string; shell?: boolean; startedAt?: number };

export type History = { events: ChatEvent[]; context: number | null; cache: CacheInfo | null };

export type TurnResult = { id: string; ok: boolean; text: string; tokens?: TurnTokens; isError: boolean };

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
  // True once Claude has read a message sent with that id.
  read?(id: string): boolean;
  // True when a message sent with 'next' joins the running turn, so a steer need not stop it.
  readonly joinsTurn?: boolean;
  // Compacts the conversation; the driver reports the end through host.compacted or host.compactFailed.
  compact(instructions?: string): void;
  // True when the driver's compaction ends with a turn result, which sends the held messages; otherwise the session sends them when it ends.
  readonly compactEndsTurn: boolean;
  // Starts a fresh conversation for /clear and ends with a turn result; without it /clear goes to the agent as a prompt.
  clear?(): void;
  // A /x the session does not own. False means the session sends the text as a prompt; true means the driver handled or refused it.
  command(name: string, args: string): boolean;
  // Starts a code review of the working tree or a PR; the findings reach host.reportFindings.
  review(target: 'local' | number, id?: string): void;
  // cancelQueued also drops messages sent with 'next' that Claude has not read yet.
  interrupt(cancelQueued?: boolean): Promise<void>;
  setModel(model: string): Promise<{ model: string }>;
  setEffort(level: Effort): Promise<void>;
  setOutputStyle?(style: string): Promise<void>;
  // Folders the agent may use besides the chat folder; only drivers with the addDir capability have them.
  readonly dirs?: string[];
  setDirs?(dirs: string[]): void;
  setPermissionMode(mode: string): Promise<void>;
  allow(rule: string): Promise<boolean>;
  rewind(promptId: string, dryRun?: boolean): Promise<{ canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number; note?: string }>;
  // Copies the session up to and with a reply, or all of it when reply is null, into a new session; returns its id.
  forkAt(sessionId: string, reply: { id: string; text: string } | null, title?: string): Promise<string>;
  stopTask(toolUseId: string): Promise<boolean>;
  mcpStatus(): Promise<McpServer[] | null>;
  refreshUsage?(): Promise<void>;
  loadContextUsage?(): Promise<void>;
  // Background tasks (workflow runs, background agents and shell commands) that die with the CLI process.
  runningTasks?(): RunningTask[];
  reconnectMcp(name: string): Promise<void>;
  // Reconnects claude.ai connectors logged in since the chat started; true when one was.
  pickUpConnectors?(): Promise<boolean>;
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
  // Opens a new chat in cwd and starts a /build line there, linked under the calling chat's session from; returns the chat id.
  startBuild?: (cwd: string, line: string, from?: string | null) => Promise<string>;
  // Sets an alarm on the phone and returns what the tool tells Claude.
  phoneAlarm(a: { time: string; day?: string; label?: string }): Promise<string>;
  setSession(patch: Partial<SessionInfo>): void;
  noteFile(rel: string, source: 'tool' | 'watcher'): void;
  captureEdit(file: string): void;
  canUseTool(toolName: string, input: Record<string, unknown>, opts: AskOptions): Promise<Decision>;
  ask(toolName: string, input: Record<string, unknown>, opts: AskOptions): Promise<Decision>;
  turnStarted(why?: string): void;
  turnEnded(): void;
  turnResult(r: TurnResult): void;
  // The agent took a message sent with 'next' into the running turn; it no longer shows as waiting.
  taken(id: string): void;
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

// What a chat feature asks a provider for; registry.ts holds one per provider.
export type MessageHit = { sessionId: string; role: 'user' | 'assistant'; text: string; at: string };

// The chats a provider has saved, read without starting the agent.
export type Transcripts = {
  // The file that holds a chat's transcript, or null when this provider has no such chat.
  path(id: string): string | null;
  list(): Promise<SavedSession[]>;
  // A saved chat's events; null when the provider cannot read it.
  read(id: string): Promise<ChatEvent[] | null>;
  // The end of a chat's transcript as raw text, empty when there is none.
  tail(id: string): Promise<string>;
  // Prompts and replies that hold every word, newest first.
  search(words: string[], max: number): Promise<MessageHit[]>;
  firstCommit(id: string): Promise<{ hash: string; subject: string } | null>;
};

// The provider's connectors (claude.ai connectors, ChatGPT apps), grouped by account.
export type Connectors = {
  list(refresh: boolean): Promise<ConnectorGroup[]>;
  // False when the provider cannot switch the connector from here.
  toggle(id: string, on: boolean): Promise<boolean>;
  // The page that signs the connector in, or null when there is none.
  signIn(id: string): Promise<string | null>;
};

export type ProviderStrategy = {
  // A picked account is pinned: the chat stays on it at its usage limit.
  driver(cwd: string, resume?: string, fork?: boolean, unattended?: boolean, account?: Account): DriverFactory;
  // Clears a limit mark the provider no longer deserves, so a chat does not start on a wrong one.
  verifyLimits(): Promise<unknown>;
  transcripts: Transcripts;
  connectors: Connectors | null;
  // The instruction files the Memory list shows for a folder.
  memory(cwd: string): Promise<MemoryFile[]>;
  // The folders the provider writes memory files in for a folder, where a removed one may be restored.
  memoryDirs(cwd: string): string[];
  // The shell line that continues a chat in the provider's own CLI, or null when it has none.
  resume(cwd: string, sessionId: string, account: Account): string | null;
  // The MCP servers the provider's own config defines for a folder, probed, and the plain definitions of those it would start.
  mcpProbe(cwd: string, refresh: boolean): Promise<McpServer[]>;
  servers(cwd: string): Promise<Record<string, McpServerDef>>;
  // Where those servers are configured, as the pages name it.
  serversFile: string;
  // Providers with the same model ids share one set, so a client keeps one model list and last model per set.
  modelSet: string;
  // The driver options that hold a scheduled chat to its worktree and the settings' extra folders and domains.
  unattended: { limits(worktree: string, settings: UnattendedLimits): Record<string, unknown> };
};
