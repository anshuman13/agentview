import { useEffect, useMemo } from 'react';
import { useStore } from '../app/store';
import { fetchMcpGroups } from './opsApi';
import { apiBase, useApiBase } from '../app/api';
import { MCP_BAD } from '../../../shared/protocol';
import { createStore } from '../ui/createStore';

const service = (name: string) => (name.search(/[_-]/) > 0 ? name.slice(0, name.search(/[_-]/)) : name);

const groups = createStore<Record<string, string>>({});
let loadedFor: string | null = null;

function load(force = false) {
  const base = apiBase();
  if (!force && loadedFor === base) return;
  loadedFor = base;
  fetchMcpGroups().then((g) => {
    if (base !== apiBase() || !g || typeof g !== 'object') return;
    groups.set(g);
  }, () => void (loadedFor === base && (loadedFor = null)));
}

if (typeof window !== 'undefined') window.addEventListener('agentview:mcp-groups', () => load(true));

// The chat's MCP servers minus the ones hidden on the MCP page.
function useShownMcp() {
  const mcp = useStore((s) => s.session.mcp);
  const base = useApiBase();
  const shown = groups.use();
  useEffect(() => load(), [base]);
  return useMemo(() => mcp.filter((m) => shown[`hide:${service(m.name)}`] !== 'hidden'), [mcp, shown]);
}

export function useMcpHealth() {
  const mcp = useShownMcp();
  const ok = mcp.filter((m) => m.status === 'connected').length;
  const dot = mcp.some((m) => MCP_BAD.includes(m.status)) ? 'bad' : ok ? 'ok' : 'off';
  return { total: mcp.length, ok, dot, servers: mcp };
}
