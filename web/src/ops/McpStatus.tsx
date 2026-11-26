import { useEffect, useMemo, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { getState, useStore } from '../app/store';
import { Button, Chip, IconButton, ShowAll } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { EmptyState, SearchBox } from '../ui/Panel';
import { Section } from '../ui/Section';
import { useCan } from '../chat/useCan';
import { ago, save, stored, useSlot, useTick } from '../ui/util';
import { accountGroup, filterCounts, groupKey, hideKey, mcpCalls, mcpFilter, mcpMatches, rowKey, slug, sourceGroups, statusCounts, validFilter, whereLabel, type Group, type McpFilter, type Row } from './mcpHelpers';
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

const FOLD = 8;
const FILTER = 'agentview.mcp.filter';

function FilterChips({ chips, filter, onChange }: { chips: ReturnType<typeof filterCounts>; filter: McpFilter; onChange: (f: McpFilter) => void }) {
  return (
    <div className="mcp-chips">
      <div role="group" aria-label="Status">
        {chips.status.map(([k, n]) => <Chip key={k} size="sm" on={filter.status === k} aria-pressed={filter.status === k} onClick={() => onChange({ ...filter, status: filter.status === k ? 'all' : k })}>{k === 'all' ? 'All' : k}<span className="n">{n}</span></Chip>)}
      </div>
      {chips.where.length > 2 && (
        <div role="group" aria-label="Source">
          {chips.where.map(([k, n]) => <Chip key={k} size="sm" on={filter.where === k} aria-pressed={filter.where === k} onClick={() => onChange({ ...filter, where: filter.where === k ? 'all' : k })}>{whereLabel(k)}<span className="n">{n}</span></Chip>)}
        </div>
      )}
    </div>
  );
}

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
  const [expanded, setExpanded] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  useTick(15000);

  const rows = useMemo(() => mcpRows(probed, mcp, account, accounts, connectors), [probed, mcp, account, accounts, connectors]);
  const usage = useMemo(() => mcpCalls(getState().events), [toolKey]);
  const usageOf = (r: Row) => usage.get(slug(r.name));
  const current = rows.find((r) => rowKey(r) === sel) ?? null;
  const groupOf = (r: Row): Group => (r.account ? accountGroup(r.account) : groups[groupKey(r)] === 'personal' ? 'personal' : 'work');
  const hidden = (r: Row) => groups[hideKey({ name: groupKey(r) })] === 'hidden';
  const [saved, setSaved] = useState<McpFilter>(() => stored(FILTER, { status: 'all', where: 'all' }));
  const setFilter = (f: McpFilter) => { setSaved(f); save(FILTER, f); };
  const shown = useMemo(() => rows.filter((r) => !hidden(r)), [rows, groups]);
  const shownCounts = useMemo(() => statusCounts(shown), [shown]);
  useEffect(() => { if (probed !== null) mcpPageCounts.set(shownCounts); }, [probed, shownCounts]);
  const searched = useMemo(() => shown.filter((r) => mcpMatches(r, query)), [shown, query]);
  const chips = useMemo(() => filterCounts(searched, saved), [searched, saved]);
  const filter = validFilter(saved, chips);
  const matched = useMemo(() => sourceGroups(mcpFilter(searched, filter), account), [searched, filter.status, filter.where, account]);
  const hiddenMatched = useMemo(() => sourceGroups(mcpFilter(rows.filter((r) => hidden(r) && mcpMatches(r, query)), filter), account).flatMap(([, rs]) => rs), [rows, groups, query, filter.status, filter.where, account]);
  const narrowed = query.trim() !== '' || filter.status !== 'all' || filter.where !== 'all';
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
        {probed !== null && rows.length > 0 && (
          <div className="mcp-filters">
            <SearchBox value={query} onChange={setQuery} label="Filter servers" />
            <FilterChips chips={chips} filter={filter} onChange={setFilter} />
          </div>
        )}
        {narrowed && !matched.length && !hiddenMatched.length && (
          <EmptyState size="sm" icon="search" title="No servers match" action={<Button size="sm" onClick={() => { setQuery(''); setFilter({ status: 'all', where: 'all' }); }}>Clear filters</Button>} />
        )}
        {matched.map(([g, rs]) => {
          const folded = !query.trim() && !expanded.includes(g) && rs.length > FOLD;
          return (
            <section key={g}>
              <Section label={g} count={rs.length} />
              <div className="as-group mcp-group">{(folded ? rs.slice(0, FOLD) : rs).map((r) => renderRow(r, false))}</div>
              {folded && <ShowAll count={rs.length} onClick={() => setExpanded((e) => [...e, g])} />}
            </section>
          );
        })}
        {hiddenMatched.length > 0 && (
          <section>
            <Section label="Hidden" count={hiddenMatched.length} open={showHidden} onToggle={() => setShowHidden((v) => !v)} />
            {showHidden && <div className="as-group mcp-group">{hiddenMatched.map((r) => renderRow(r, true))}</div>}
          </section>
        )}
      </div></div></div>
      {current && <Detail row={current} usage={usageOf(current)} group={groupOf(current)} onGroup={(to) => setGroup(groupKey(current), to)} onClose={() => { const row = document.querySelector<HTMLElement>(`[data-row="${CSS.escape(rowKey(current))}"]`); flushSync(() => setSel(null)); row?.scrollIntoView({ block: 'nearest' }); row?.focus({ preventScroll: true }); }} />}
    </div>
  );
}
