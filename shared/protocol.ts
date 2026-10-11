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
  input: Record<string, unknown>;
  canAlwaysAllow: boolean;
};

export type PendingRequest = PendingQuestion | PendingPermission;

export type ChatEvent =
  | { id: string; kind: 'user'; text: string; at: number }
  | { id: string; kind: 'assistant'; text: string; streaming: boolean; at: number }
  | { id: string; kind: 'tool_use'; name: string; input: Record<string, unknown>; summary: string; at: number }
  | { id: string; kind: 'tool_result'; toolUseId: string; text: string; isError: boolean; at: number }
  | { id: string; kind: 'result'; text: string; costUsd: number; isError: boolean; at: number }
  | { id: string; kind: 'system'; text: string; at: number }
  | { id: string; kind: 'status'; text: string; at: number };

export type SessionInfo = {
  id: string;
  sessionId: string | null;
  model: string | null;
  cwd: string;
  running: boolean;
  permissionMode: string | null;
  apiKeySource: string | null;
  models: Array<{ value: string; displayName: string; description?: string }>;
  commands: Array<{ name: string; description: string }>;
  cache: CacheInfo | null;
};

export type CacheInfo = { at: number; ttlMs: number; readTokens: number; writeTokens: number };

export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'dontAsk'] as const;

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
};

export type SavedSession = {
  sessionId: string;
  title: string;
  cwd: string;
  gitBranch: string | null;
  lastModified: number;
};

export const STALE_MS = 12 * 60 * 60 * 1000;

export type Repo = {
  name: string;
  root: string;
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
  | { type: 'steer'; text: string }
  | { type: 'answer'; id: string; answers: Record<string, string> }
  | { type: 'permission'; id: string; allow: boolean; always?: boolean }
  | { type: 'set_model'; model: string }
  | { type: 'set_permission_mode'; mode: string }
  | { type: 'interrupt' }
  | { type: 'view'; id: string }
  | { type: 'open_session'; sessionId: string }
  | { type: 'new_session'; cwd?: string };
