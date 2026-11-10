import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getState, useStore } from '../app/store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/Panel';
import { Section } from '../ui/Section';
import { useCan } from '../chat/useCan';
import { ago, useTick } from '../ui/util';
import { accountGroup, groupKey, hideKey, KINDS, mcpCalls, needsYou, rowKey, services, slug, type Group, type Row, type Service } from './mcpHelpers';
import { mcpRows } from './mcpRows';
import { useMcpHealth } from './mcpShown';
import { useMcpGroups, useMcpProbe } from './useMcpPage';
import { Detail } from './McpDetail';
import { ServiceRow } from './McpServiceRow';
import '../styles/features/wiki.css';
import '../styles/features/meetings.css';

type Stats = { probed: boolean; busy: boolean; at: number; ok: number; total: number; attention: number; onCheck: () => void };

function McpStats({ probed, busy, at, ok, total, attention, onCheck }: Stats) {
  return (
    <div className="mcp-stats">
      {probed && <span className={attention ? 'warn' : ''}><b>{ok}</b> connected of {total}</span>}
      {attention > 0 && <span className="bad"><b>{attention}</b> need you</span>}
      <button className={`btn mcp-refresh ${busy ? 'busy' : ''}`} onClick={onCheck} disabled={busy} title="Connect to every server again">
        <Icon name={busy ? 'loading' : 'refresh'} small spin={busy} /> {busy ? 'Checking' : at ? `Checked ${ago(at, ' ago')}` : 'Check'}
      </button>
    </div>
  );
}

const FOLD = 5;
const rowCount = (of: Service[]) => of.reduce((n, s) => n + s.variants.length, 0);

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
  const [expanded, setExpanded] = useState<Group[]>([]);
  const health = useMcpHealth();
  useTick(15000);

  const rows = useMemo(() => mcpRows(probed, mcp, account, accounts, connectors), [probed, mcp, account, accounts, connectors]);
  const list = useMemo(() => services(rows).sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)), [rows]);
  const usage = useMemo(() => mcpCalls(getState().events), [toolKey]);
  const usageOf = (r: Row) => usage.get(slug(r.name));
  const current = rows.find((r) => rowKey(r) === sel) ?? null;
  const groupOf = (r: Row): Group => (r.account ? accountGroup(r.account) : groups[groupKey(r)] === 'personal' ? 'personal' : 'work');
  const hidden = (s: Service) => groups[hideKey(s)] === 'hidden';
  const shown = list.filter((s) => !hidden(s));
  const hiddenList = list.filter(hidden);
  const shownRows = shown.flatMap((s) => s.variants.map((v) => v.row));
  const extra = document.getElementById('page-mcp-extra');
  const pick = (name: string) => setSel((s) => (s === name ? null : name));
  const renderRows = (s: Service, g: Group, isHidden: boolean) => s.variants.map(({ row }) => (
    <ServiceRow key={rowKey(row)} row={row} selected={rowKey(row) === sel} usage={usageOf(row)} onPick={() => pick(rowKey(row))} group={g} onGroup={(to) => setGroup(groupKey(s.variants[0].row), to)} onHide={() => setGroup(hideKey(s), isHidden ? 'shown' : 'hidden')} isHidden={isHidden} />
  ));

  return (
    <div className={`mcp-page ${current ? 'with-detail' : ''}`}>
      <div className="mcp-main wk"><div className="wk-scroll"><div className="mt-page">
        {extra && createPortal(<McpStats probed={probed !== null} busy={busy} at={at} ok={health.ok} total={health.total} attention={shownRows.filter(needsYou).length} onCheck={() => load(true)} />, extra)}
        {error && <div className="mcp-error" role="alert"><Icon name="error" small /> {error}</div>}
        {probed === null && !error && (
          <div className="skeleton-list">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton mcp-skeleton" style={{ animationDelay: `${i * 80}ms` }} />)}</div>
        )}
        {probed !== null && rows.length === 0 && (
          <EmptyState size="sm" icon="plug" title="No MCP servers yet" hint={connectors ? <>Add one with <code>claude mcp add</code> or connect one on claude.ai, then check again.</> : <>Add one with <code>codex mcp add</code>, then check again.</>} />
        )}
        {!connectors && <div className="muted">claude.ai connectors load in Claude chats only</div>}
        {(['work', 'personal'] as Group[]).map((g) => {
          const mine = shown.filter((s) => groupOf(s.variants[0].row) === g);
          if (!mine.length) return null;
          const all = mine.flatMap((s) => renderRows(s, g, false));
          const folded = !expanded.includes(g) && all.length > FOLD;
          return (
            <section key={g}>
              <Section label={g === 'work' ? 'Work' : 'Personal'} count={rowCount(mine)} />
              <div className="as-group">{folded ? all.slice(0, FOLD) : all}</div>
              {folded && <Button variant="quiet" size="sm" onClick={() => setExpanded((e) => [...e, g])}>Show all {all.length}</Button>}
            </section>
          );
        })}
        {hiddenList.length > 0 && (
          <section>
            <Section label="Hidden" count={rowCount(hiddenList)} open={showHidden} onToggle={() => setShowHidden((v) => !v)} />
            {showHidden && <div className="as-group">{hiddenList.map((s) => renderRows(s, groupOf(s.variants[0].row), true))}</div>}
          </section>
        )}
      </div></div></div>
      {current && <Detail row={current} usage={usageOf(current)} group={groupOf(current)} onGroup={(to) => setGroup(groupKey(current), to)} onClose={() => { document.querySelector<HTMLElement>(`[data-row="${CSS.escape(rowKey(current))}"]`)?.focus(); setSel(null); }} />}
    </div>
  );
}
