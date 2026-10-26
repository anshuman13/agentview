import { useEffect, useMemo, useState } from 'react';
import { api, useStore } from '../app/store';

const service = (name: string) => (name.search(/[_-]/) > 0 ? name.slice(0, name.search(/[_-]/)) : name);

// The chat's MCP servers minus the ones hidden on the MCP page.
export function useShownMcp() {
  const mcp = useStore((s) => s.session.mcp);
  const [groups, setGroups] = useState<Record<string, string>>({});
  useEffect(() => {
    const load = () => fetch(api('/api/mcp/groups')).then((r) => r.json()).then((g) => g && typeof g === 'object' && setGroups(g), () => undefined);
    load();
    window.addEventListener('agentview:mcp-groups', load);
    return () => window.removeEventListener('agentview:mcp-groups', load);
  }, []);
  return useMemo(() => mcp.filter((m) => groups[`hide:${service(m.name)}`] !== 'hidden'), [mcp, groups]);
}
