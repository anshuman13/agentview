import { useMemo } from 'react';
import { appCounts, type CountChat } from '../../../../shared/counts';
import type { LiveChat } from '../../../../shared/protocol';
import { headerState } from '../../sessions/runLogic';
import { useMcpHidden } from '../../ops/mcpShown';
import { chatState as sessionState } from '../../sessions/folders';
import { createStore } from '../../ui/createStore';
import { useStore } from '../store';

// The Codex chunk fills this from its Needs you and Reply queue rows; the counts only add them.
export const rowCounts = createStore({ needsYouRows: 0, replyRows: 0 });

export const countChat = (c: LiveChat, seen: Record<string, number>): CountChat => ({
  id: c.id,
  state: sessionState({ live: c }, seen),
  tone: headerState(c).tone,
  runNeeds: c.run?.needsYou ?? false,
  agents: c.agentList?.length ?? 0,
});

export const mcpDot = ({ needsYou, connected }: { needsYou: number; connected: number }) => (needsYou > 0 ? 'bad' : connected ? 'ok' : 'off');

export function useCounts() {
  const live = useStore((s) => s.live);
  const viewing = useStore((s) => s.session.id);
  const seen = useStore((s) => s.seen);
  const attention = useStore((s) => s.attention.length);
  const mcp = useStore((s) => s.session.mcp);
  const hidden = useMcpHidden();
  const rows = rowCounts.use();
  return useMemo(
    () => appCounts({ chats: live.map((c) => countChat(c, seen)), viewing, attention, mcp, hidden, ...rows }),
    [live, viewing, seen, attention, mcp, hidden, rows],
  );
}

// Only the Needs you count, so a page that shows just that number does not re-render on every live update.
let lastNeeds: { live: LiveChat[]; seen: Record<string, number>; key: string; value: number } | null = null;
export function useNeedsYouCount() {
  const hidden = useMcpHidden();
  const rows = rowCounts.use();
  return useStore((s) => {
    const key = `${s.session.id}|${s.attention.length}|${JSON.stringify(s.session.mcp ?? null)}|${JSON.stringify(hidden)}|${rows.needsYouRows}|${rows.replyRows}`;
    if (lastNeeds && lastNeeds.live === s.live && lastNeeds.seen === s.seen && lastNeeds.key === key) return lastNeeds.value;
    const value = appCounts({ chats: s.live.map((c) => countChat(c, s.seen)), viewing: s.session.id, attention: s.attention.length, mcp: s.session.mcp, hidden, ...rows }).needsYou;
    lastNeeds = { live: s.live, seen: s.seen, key, value };
    return value;
  });
}
