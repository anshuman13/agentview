import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { api, useStore } from '../app/store';
import { apiBase, useApiBase } from '../app/api';
import { MCP_BAD } from '../../../shared/protocol';

const service = (name: string) => (name.search(/[_-]/) > 0 ? name.slice(0, name.search(/[_-]/)) : name);

let groups: Record<string, string> = {};
let loadedFor: string | null = null;
const subs = new Set<() => void>();
const subscribe = (l: () => void) => (subs.add(l), () => void subs.delete(l));

function load(force = false) {
  const base = apiBase();
  if (!force && loadedFor === base) return;
  loadedFor = base;
  fetch(api('/api/mcp/groups')).then((r) => r.json()).then((g) => {
    if (base !== apiBase() || !g || typeof g !== 'object') return;
    groups = g;
    subs.forEach((l) => l());
  }, () => void (loadedFor === base && (loadedFor = null)));
}

if (typeof window !== 'undefined') window.addEventListener('agentview:mcp-groups', () => load(true));

// The chat's MCP servers minus the ones hidden on the MCP page.
export function useShownMcp() {
  const mcp = useStore((s) => s.session.mcp);
  const base = useApiBase();
  const shown = useSyncExternalStore(subscribe, () => groups);
  useEffect(() => load(), [base]);
  return useMemo(() => mcp.filter((m) => shown[`hide:${service(m.name)}`] !== 'hidden'), [mcp, shown]);
}

export function useMcpHealth() {
  const mcp = useShownMcp();
  const ok = mcp.filter((m) => m.status === 'connected').length;
  const dot = mcp.some((m) => MCP_BAD.includes(m.status)) ? 'bad' : ok ? 'ok' : 'off';
  return { total: mcp.length, ok, dot };
}
