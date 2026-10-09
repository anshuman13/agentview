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
  sessionId: string | null;
  model: string | null;
  cwd: string;
  running: boolean;
  permissionMode: string | null;
  apiKeySource: string | null;
  models: Array<{ value: string; displayName: string; description?: string }>;
  commands: Array<{ name: string; description: string }>;
};

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
  | { type: 'error'; text: string };

export type SavedSession = {
  sessionId: string;
  title: string;
  cwd: string;
  gitBranch: string | null;
  lastModified: number;
};

export type ClientMessage =
  | { type: 'prompt'; text: string }
  | { type: 'answer'; id: string; answers: Record<string, string> }
  | { type: 'permission'; id: string; allow: boolean; always?: boolean }
  | { type: 'set_model'; model: string }
  | { type: 'set_permission_mode'; mode: string }
  | { type: 'interrupt' }
  | { type: 'open_session'; sessionId: string }
  | { type: 'new_session' };
