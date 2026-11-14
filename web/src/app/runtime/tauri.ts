// The desktop app's Tauri bridge, kept apart so the shell does not load the Codex sync engine for it.
export type Invoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke?: Invoke } };
    __TAURI_INTERNALS__?: { invoke?: Invoke };
    AgentViewShell?: { unlock(): void };
  }
  interface WindowEventMap {
    'assistant-key': CustomEvent<{ key?: string; error?: string } | null>;
  }
}

export const tauriInvoke = () => window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
