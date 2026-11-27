import type { BackgroundShell } from './protocol';

// The composer's background list: running shells first, then the finished ones with a muted duration and their command and last output.
// Android: chat/BackgroundShellsLogic.kt.
export type ShellRow = { toolUseId: string; label: string; time: string; failed: boolean; detail: string };

export function shellDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

export function shellRows(shells: BackgroundShell[], now: number) {
  const row = (t: BackgroundShell): ShellRow => ({
    toolUseId: t.toolUseId,
    label: t.label || t.command || 'Shell command',
    time: shellDuration((t.endedAt ?? now) - t.startedAt),
    failed: Boolean(t.failed),
    detail: [t.command && `$ ${t.command}`, t.output || (t.endedAt ? 'No output' : '')].filter(Boolean).join('\n'),
  });
  return { running: shells.filter((t) => !t.endedAt).map(row), finished: shells.filter((t) => t.endedAt).map(row) };
}
