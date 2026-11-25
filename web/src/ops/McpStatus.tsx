import { useEffect, useMemo, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { getState, useStore } from '../app/store';
import { Button, IconButton, ShowAll } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/Panel';
import { Section } from '../ui/Section';
import { useCan } from '../chat/useCan';
import { ago, useSlot, useTick } from '../ui/util';
import { accountGroup, groupKey, hideKey, mcpCalls, rowKey, slug, statusCounts, statusGroups, type Group, type Row, type StatusGroup } from './mcpHelpers';
import { mcpRows } from './mcpRows';
import { mcpPageCounts } from '../app/shell/counts';
import { useMcpGroups, useMcpProbe } from './useMcpPage';
import { Detail } from './McpDetail';
import { SetupButton } from './SetupButton';
import { ServiceRow } from './McpServiceRow';
import '../styles/features/wiki.css';
import '../styles/features/meetings.css';
import '../styles/features/mcp.css';

type Stats = { probed: boolean; busy: boolean; at: number; ok: number; total: number; attention: number; onCheck: () => void };

function McpStats({ probed, busy, at, ok, total, attention, onCheck }: Stats) {
  return (
    <div className="mcp-stats">
      {probed && <span className={attention ? 'warn' : ''}><b>{ok}</b> connected of {total}</span>}
      {attention > 0 && <span className="bad"><b>{attention}</b> need you</span>}
      <Button size="sm" className="mcp-refresh" onClick={onCheck} disabled={busy} title="Connect to every server again">
        <Icon name={busy ? 'loading' : 'refresh'} small spin={busy} /> {busy ? 'Checking' : at ? `Checked ${ago(at, ' ago')}` : 'Check'}
      </Button>
    </div>
  );
}

const FOLD = 5;

export function McpPage() {
  const mcp = useStore((s) => s.session.mcp);
  const account = useStore((s) => s.session.account);
  const id = useStore((s) => s.session.id);
  const toolKey = useStore((s) => `${s.events[0]?.id}:${s.events.reduce((n, e) => n + (e.kind === 'tool_use' || e.kind === 'tool_result' ? 1 : 0), 0)}`);
  const connectors = useCan('connectors');
  const { probed, busy, at, error, accounts, load } = useMcpProbe(account, id, connectors);
  const { groups, setGroup } = useMcpGroups();
  const [sel, setSel] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [expanded, setExpanded] = useState<StatusGroup[]>([]);
  useTick(15000);

  const rows = useMemo(() => mcpRows(probed, mcp, account, accounts, connectors), [probed, mcp, account, accounts, connectors]);
  const usage = useMemo(() => mcpCalls(getState().events), [toolKey]);
  const usageOf = (r: Row) => usage.get(slug(r.name));
  const current = rows.find((r) => rowKey(r) === sel) ?? null;
  const groupOf = (r: Row): Group => (r.account ? accountGroup(r.account) : groups[groupKey(r)] === 'personal' ? 'personal' : 'work');
  const hidden = (r: Row) => groups[hideKey({ name: groupKey(r) })] === 'hidden';
  const sections = useMemo(() => statusGroups(rows.filter((r) => !hidden(r))), [rows, groups]);
  const shownCounts = useMemo(() => statusCounts(sections), [sections]);
  useEffect(() => { if (probed !== null) mcpPageCounts.set(shownCounts); }, [probed, shownCounts]);
  const hiddenList = useMemo(() => statusGroups(rows.filter(hidden)).flatMap(([, rs]) => rs), [rows, groups]);
  const extra = useSlot('page-mcp-extra');
  const action = useSlot('page-mcp-action');
  const pick = (name: string) => setSel((s) => (s === name ? null : name));
  const renderRow = (row: Row, isHidden: boolean) => (
    <ServiceRow key={rowKey(row)} row={row} selected={rowKey(row) === sel} usage={usageOf(row)} onPick={() => pick(rowKey(row))} group={groupOf(row)} onGroup={(to) => setGroup(groupKey(row), to)} onHide={() => setGroup(hideKey({ name: groupKey(row) }), isHidden ? 'shown' : 'hidden')} isHidden={isHidden} />
  );

  return (
    <div className={`mcp-page ${current ? 'with-detail' : ''}`}>
      <div className="mcp-main wk"><div className="wk-scroll"><div className="mt-page">
        {action && createPortal(<IconButton icon="refresh" label="Check" size="sm" spin={busy} disabled={busy} onClick={() => load(true)} />, action)}
        {extra && createPortal(<McpStats probed={probed !== null} busy={busy} at={at} ok={shownCounts.connected} total={shownCounts.total} attention={shownCounts.needsYou} onCheck={() => load(true)} />, extra)}
        {error && <div className="mcp-error" role="alert"><Icon name="error" small /> {error}</div>}
        {probed === null && !error && (
          <div className="skeleton-list">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton mcp-skeleton" style={{ animationDelay: `${i * 80}ms` }} />)}</div>
        )}
        {probed !== null && rows.length === 0 && (
          <EmptyState size="sm" icon="plug" title="No MCP servers yet" hint="Servers you add show here" action={<SetupButton kind="mcp" mcpCommand={connectors ? 'claude mcp add' : 'codex mcp add'} />} />
        )}
        {!connectors && <div className="muted">claude.ai connectors load in Claude chats only</div>}
        {sections.map(([g, rs]) => {
          const folded = !expanded.includes(g) && rs.length > FOLD;
          return (
            <section key={g}>
              <Section label={g} count={rs.length} />
              <div className="as-group mcp-group">{(folded ? rs.slice(0, FOLD) : rs).map((r) => renderRow(r, false))}</div>
              {folded && <ShowAll count={rs.length} onClick={() => setExpanded((e) => [...e, g])} />}
            </section>
          );
        })}
        {hiddenList.length > 0 && (
          <section>
            <Section label="Hidden" count={hiddenList.length} open={showHidden} onToggle={() => setShowHidden((v) => !v)} />
            {showHidden && <div className="as-group mcp-group">{hiddenList.map((r) => renderRow(r, true))}</div>}
          </section>
        )}
      </div></div></div>
      {current && <Detail row={current} usage={usageOf(current)} group={groupOf(current)} onGroup={(to) => setGroup(groupKey(current), to)} onClose={() => { const row = document.querySelector<HTMLElement>(`[data-row="${CSS.escape(rowKey(current))}"]`); flushSync(() => setSel(null)); row?.scrollIntoView({ block: 'nearest' }); row?.focus({ preventScroll: true }); }} />}
    </div>
  );
}
