type Invoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface Window {
  __TAURI__?: { core?: { invoke?: Invoke } };
  AgentViewShell?: { unlock(): void };
}

interface WindowEventMap {
  'assistant-key': CustomEvent<{ key?: string; error?: string } | null>;
}
