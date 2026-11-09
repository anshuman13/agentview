import { useEffect, useRef, useState } from 'react';
import type { McpServer } from '../../../shared/protocol';
import { getState, send, notice } from '../app/store';
import { post } from './mcpActions';
import { fetchMcpConnectors, fetchMcpGroups, fetchMcpProbe } from './opsApi';
import type { Group } from './mcpHelpers';
import type { AccountConnectors } from './mcpRows';

// The probed server list and the connector lists per account; load reconnects connectors that were logged in meanwhile.
export function useMcpProbe(account: string, id: string) {
  const [probed, setProbed] = useState<McpServer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(0);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<AccountConnectors>({});
  const seq = useRef(0);
  const load = (refresh = false) => {
    const n = ++seq.current;
    setBusy(true);
    setError('');
    send({ type: 'mcp_status' });
    fetchMcpConnectors(refresh).then((a) => {
      if (n !== seq.current || !a || a.error) return;
      setAccounts(a);
      // A connector logged in on claude.ai after the chat started only shows up once the chat reconnects it.
      const loggedIn = new Set((a[account] ?? []).filter((c: { status: string }) => c.status === 'connected').map((c: { name: string }) => c.name));
      for (const m of getState().session.mcp) if (m.type === 'claudeai' && m.status === 'needs-auth' && loggedIn.has(m.name)) send({ type: 'mcp_reconnect', name: m.name });
    }, () => undefined);
    fetchMcpProbe(refresh)
      .then((p) => {
        if (n !== seq.current) return;
        if (Array.isArray(p)) { setProbed(p); setAt(Date.now()); } else setError(p?.error ?? 'Probe failed');
      }, (e) => n === seq.current && setError(e.message))
      .finally(() => n === seq.current && setBusy(false));
  };
  useEffect(() => load(), [id]);
  return { probed, busy, at, error, accounts, load };
}

export function useMcpGroups() {
  const [groups, setGroups] = useState<Record<string, Group | 'hidden'>>({});
  useEffect(() => {
    fetchMcpGroups().then((g) => g && typeof g === 'object' && setGroups(g), () => undefined);
  }, []);
  const setGroup = (service: string, group: Group | 'hidden' | 'shown') => {
    const before = groups;
    setGroups((g) => { const { [service]: _, ...rest } = g; return group === 'shown' ? rest : { ...rest, [service]: group }; });
    post('/api/mcp/groups', { service, group }).then((g) => { setGroups(g); window.dispatchEvent(new Event('agentview:mcp-groups')); }, (e) => { setGroups(before); notice(`Could not save the group: ${e.message}`); });
  };
  return { groups, setGroup };
}
