import type { ChatEvent } from '../../../shared/protocol.js';

export const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/;

export const createsPr = (e: ChatEvent) => e.kind === 'tool_use' && e.name === 'Bash' && /\bgh pr create\b/.test(String(e.input.command ?? ''));

// The number of the last pull request a `gh pr create` in this chat printed.
export function prFrom(events: ChatEvent[]): number | null {
  const creates = new Set<string>();
  let pr: number | null = null;
  for (const e of events) {
    if (createsPr(e)) creates.add(e.id);
    else if (e.kind === 'tool_result' && creates.has(e.toolUseId)) pr = Number(PR_URL.exec(e.text)?.[1]) || pr;
  }
  return pr;
}
