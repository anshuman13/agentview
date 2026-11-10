import { useEffect } from 'react';
import { useStore } from '../app/store';
import { fetchMcpGroups } from './opsApi';
import { apiBase, useApiBase } from '../app/api';
import { shownMcp } from '../../../shared/counts';
import { createStore } from '../ui/createStore';

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

// The services hidden on the MCP page, loaded once per Mac.
export function useMcpHidden() {
  const base = useApiBase();
  const hidden = groups.use();
  useEffect(() => load(), [base]);
  return hidden;
}

// The chat's MCP servers minus the ones hidden on the MCP page.
export const useShownMcp = () => shownMcp(useStore((s) => s.session.mcp), useMcpHidden());
