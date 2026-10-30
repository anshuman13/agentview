import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { McpServer } from '../../../shared/protocol';
import { getState, send, notice, api, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { ago, save, stored, useTick } from '../ui/util';
import { post } from './mcpActions';
import { accountGroup, groupKey, hideKey, KINDS, mcpCalls, merge, needsYou, rowKey, services, slug, type Group, type Row, type Service } from './mcpHelpers';
import { Detail } from './McpDetail';
import { ServiceRow } from './McpServiceRow';

const CONNECTORS = 'agentview.mcp.connectors';

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

export function McpPage() {
  const mcp = useStore((s) => s.session.mcp);
  const account = useStore((s) => s.session.account);
  const id = useStore((s) => s.session.id);
  const toolKey = useStore((s) => `${s.events[0]?.id}:${s.events.reduce((n, e) => n + (e.kind === 'tool_use' || e.kind === 'tool_result' ? 1 : 0), 0)}`);
  const [probed, setProbed] = useState<McpServer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(0);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [groups, setGroups] = useState<Record<string, Group | 'hidden'>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [accounts, setAccounts] = useState<Record<string, { name: string; status: string }[]>>({});

  const seq = useRef(0);
  const load = (refresh = false) => {
    const n = ++seq.current;
    setBusy(true);
    setError('');
    send({ type: 'mcp_status' });
    fetch(api(`/api/mcp/connectors${refresh ? '?refresh=1' : ''}`)).then((r) => r.json()).then((a) => {
      if (n !== seq.current || !a || a.error) return;
      setAccounts(a);
      // A connector logged in on claude.ai after the chat started only shows up once the chat reconnects it.
      const loggedIn = new Set((a[account] ?? []).filter((c: { status: string }) => c.status === 'connected').map((c: { name: string }) => c.name));
      for (const m of getState().session.mcp) if (m.type === 'claudeai' && m.status === 'needs-auth' && loggedIn.has(m.name)) send({ type: 'mcp_reconnect', name: m.name });
    }, () => undefined);
    fetch(api(`/api/mcp/probe${refresh ? '?refresh=1' : ''}`))
      .then((r) => r.json())
      .then((p) => {
        if (n !== seq.current) return;
        if (Array.isArray(p)) { setProbed(p); setAt(Date.now()); } else setError(p?.error ?? 'Probe failed');
      }, (e) => n === seq.current && setError(e.message))
      .finally(() => n === seq.current && setBusy(false));
  };
  useEffect(() => load(), [id]);
  useEffect(() => {
    fetch(api('/api/mcp/groups')).then((r) => r.json()).then((g) => g && typeof g === 'object' && setGroups(g), () => undefined);
  }, []);
  useTick(15000);

  const setGroup = (service: string, group: Group | 'hidden' | 'shown') => {
    const before = groups;
    setGroups((g) => { const { [service]: _, ...rest } = g; return group === 'shown' ? rest : { ...rest, [service]: group }; });
    post('/api/mcp/groups', { service, group }).then((g) => { setGroups(g); window.dispatchEvent(new Event('agentview:mcp-groups')); }, (e) => { setGroups(before); notice(`Could not save the group: ${e.message}`); });
  };

  const rows = useMemo(() => {
    const merged: Row[] = merge(probed ?? [], mcp).map((r) => (r.type === 'claudeai' ? { ...r, account } : r));
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
  }, [probed, mcp, account, accounts]);
  const list = useMemo(() => services(rows), [rows]);
  const usage = useMemo(() => mcpCalls(getState().events), [toolKey]);
  const usageOf = (r: Row) => usage.get(slug(r.name));
  const current = rows.find((r) => rowKey(r) === sel) ?? null;
  const groupOf = (r: Row): Group => (r.account ? accountGroup(r.account) : groups[groupKey(r)] === 'personal' ? 'personal' : 'work');
  const hidden = (s: Service) => groups[hideKey(s)] === 'hidden';
  const shown = list.filter((s) => !hidden(s));
  const hiddenList = list.filter(hidden);
  const shownRows = shown.flatMap((s) => s.variants.map((v) => v.row));
  const ok = shownRows.filter((r) => r.status === 'connected').length;
  const attention = shownRows.filter(needsYou).length;
  const extra = document.getElementById('page-mcp-extra');
  const pick = (name: string) => setSel((s) => (s === name ? null : name));

  return (
    <div className={`mcp-page ${current ? 'with-detail' : ''}`}>
      <div className="mcp-main">
        {extra && createPortal(
          <div className="mcp-stats">
            {probed !== null && <span className={attention ? 'warn' : ''}><b>{ok}</b> connected of {shownRows.length}</span>}
            {attention > 0 && <span className="bad"><b>{attention}</b> need you</span>}
            <button className={`btn mcp-refresh ${busy ? 'busy' : ''}`} onClick={() => load(true)} disabled={busy} title="Connect to every server again">
              <Icon name={busy ? 'loading' : 'refresh'} small spin={busy} /> {busy ? 'Checking' : at ? `Checked ${ago(at, ' ago')}` : 'Check'}
            </button>
          </div>,
          extra,
        )}
        {error && <div className="mcp-error" role="alert"><Icon name="error" small /> {error}</div>}
        {probed === null && !error && (
          <div className="mcp-list">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="mcp-row skeleton" style={{ animationDelay: `${i * 80}ms` }} />)}</div>
        )}
        {probed !== null && rows.length === 0 && (
          <div className="mcp-empty">
            <Icon name="plug" />
            <div className="empty-title">No MCP servers yet</div>
            <div className="muted">Add one with <code>claude mcp add</code> or connect one on claude.ai, then check again.</div>
          </div>
        )}
        {(['work', 'personal'] as Group[]).map((g) => {
          const mine = shown.filter((s) => groupOf(s.variants[0].row) === g);
          if (!mine.length) return null;
          return (
            <section key={g} className="mcp-section">
              <div className="mcp-group-head">{g === 'work' ? 'Work' : 'Personal'}<span className="muted count">{mine.length}</span></div>
              {KINDS.map((k) => {
                const of = mine.filter((s) => s.kind === k);
                if (!of.length) return null;
                return (
                  <div key={k} className="mcp-kind">
                    <div className="mcp-section-head"><span>{k}</span></div>
                    <div className="mcp-list">
                      {of.map((s) => <ServiceRow key={rowKey(s.variants[0].row)} service={s} sel={sel} usageOf={usageOf} onPick={pick} group={g} onGroup={(to) => setGroup(groupKey(s.variants[0].row), to)} onHide={() => setGroup(hideKey(s), 'hidden')} />)}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
        {hiddenList.length > 0 && (
          <section className="mcp-section">
            <button className="mcp-group-head mcp-hidden-head" onClick={() => setShowHidden((v) => !v)}>
              <Icon name={showHidden ? 'chevron-down' : 'chevron-right'} small />Hidden<span className="muted count">{hiddenList.length}</span>
            </button>
            {showHidden && (
              <div className="mcp-list">
                {hiddenList.map((s) => <ServiceRow key={rowKey(s.variants[0].row)} service={s} sel={sel} usageOf={usageOf} onPick={pick} group={groupOf(s.variants[0].row)} onGroup={(to) => setGroup(groupKey(s.variants[0].row), to)} onHide={() => setGroup(hideKey(s), 'shown')} isHidden />)}
              </div>
            )}
          </section>
        )}
      </div>
      {current && <Detail row={current} usage={usageOf(current)} group={groupOf(current)} onGroup={(to) => setGroup(groupKey(current), to)} onClose={() => { document.querySelector<HTMLElement>(`[data-row="${CSS.escape(rowKey(current))}"]`)?.focus(); setSel(null); }} />}
    </div>
  );
}
