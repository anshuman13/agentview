import type { McpServer } from '../../../shared/protocol';
import { save, stored } from '../ui/util';
import { merge, type Row } from './mcpHelpers';

const CONNECTORS = 'agentview.mcp.connectors';

export type AccountConnectors = Record<string, { name: string; status: string }[]>;

// Keeps the last connector list seen per account, so both accounts show whichever one this chat runs on.
function connectorsByAccount(account: string, live: Row[]): Row[] {
  const seen = stored<Record<string, Row[]>>(CONNECTORS, {});
  const mine = live.filter((r) => r.type === 'claudeai');
  if (mine.length) {
    seen[account] = mine.map((r) => ({ name: r.name, type: r.type, status: r.status, scope: r.scope, tools: r.tools?.map((t) => ({ name: t.name })) }) as Row);
    save(CONNECTORS, seen);
  }
  return Object.entries(seen).filter(([a]) => a !== account).flatMap(([a, rows]) => rows.map((r) => ({ ...r, account: a, live: false })));
}

export function mcpRows(probed: McpServer[] | null, mcp: McpServer[], account: string, accounts: AccountConnectors, connectors: boolean): Row[] {
  const merged: Row[] = merge(probed ?? [], mcp).map((r) => (r.type === 'claudeai' ? { ...r, account } : r));
  if (!connectors) return merged;
  const other = connectorsByAccount(account, merged).filter((o) => !merged.some((r) => r.name === o.name && r.account === o.account));
  for (const [a, list] of Object.entries(accounts)) {
    if (a === account) continue;
    for (const c of list) {
      const i = other.findIndex((o) => o.account === a && o.name === c.name);
      if (i >= 0) other[i] = { ...other[i], status: c.status };
      else other.push({ name: c.name, type: 'claudeai', status: c.status, account: a, live: false } as Row);
    }
  }
  return [...merged, ...other];
}
