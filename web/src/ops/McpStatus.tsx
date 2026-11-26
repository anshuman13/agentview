import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { getState, useStore } from '../app/store';
import { Button, IconButton } from '../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu';
import { Icon } from '../ui/Icon';
import { EmptyState, SearchBox } from '../ui/Panel';
import { useCan } from '../chat/useCan';
import { ago, save, stored, useSlot, useTick } from '../ui/util';
import { accountGroup, filterCounts, groupKey, hideKey, mcpCalls, mcpList, mcpMatches, rowKey, SHOWS, slug, statusCounts, validFilter, whereLabel, type Group, type McpFilter, type Row } from './mcpHelpers';
import { mcpRows } from './mcpRows';
import { mcpPageCounts } from '../app/shell/counts';
import { useMcpGroups, useMcpProbe } from './useMcpPage';
import { Detail } from './McpDetail';
import { SetupButton } from './SetupButton';
import { ServiceRow } from './McpServiceRow';
import '../styles/features/wiki.css';
import '../styles/features/meetings.css';
import '../styles/features/mcp.css';

const FILTER = 'agentview.mcp.filter';
const ALL: McpFilter = { show: 'all', where: 'all' };

// The funnel menu of Claude's Connectors page: what to show, then where it comes from, each with a count and a check on the current one.
function FilterMenu({ counts, filter, onChange }: { counts: ReturnType<typeof filterCounts>; filter: McpFilter; onChange: (f: McpFilter) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const narrowed = filter.show !== 'all' || filter.where !== 'all';
  const item = (on: boolean, label: string, pick: () => void) => (
    <MenuItem key={label} className="mcp-fitem" aria-checked={on} role="menuitemradio" onClick={() => { pick(); setOpen(false); }}>
      <span className="l">{label}</span>{on ? <Icon name="check" small /> : <span className="ck" />}
    </MenuItem>
  );
  return (
    <div className="mcp-filter">
      <IconButton ref={trigger} icon="list-filter" label="Filter" size="sm" on={narrowed} onClick={() => setOpen((v) => !v)} />
      {open && (
        <Menu trigger={trigger} onClose={() => setOpen(false)}>
          <div className="mcp-fhead">Show</div>
          {counts.show.map(([k]) => item(filter.show === k, SHOWS.find(([s]) => s === k)![1], () => onChange({ ...filter, show: k })))}
          {counts.where.length > 2 && <><MenuSeparator /><div className="mcp-fhead">Source</div>
            {counts.where.map(([k]) => item(filter.where === k, whereLabel(k), () => onChange({ ...filter, where: k })))}</>}
        </Menu>
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
  const [query, setQuery] = useState('');
  useTick(15000);

  const rows = useMemo(() => mcpRows(probed, mcp, account, accounts, connectors), [probed, mcp, account, accounts, connectors]);
  const usage = useMemo(() => mcpCalls(getState().events), [toolKey]);
  const usageOf = (r: Row) => usage.get(slug(r.name));
  const current = rows.find((r) => rowKey(r) === sel) ?? null;
  const groupOf = (r: Row): Group => (r.account ? accountGroup(r.account) : groups[groupKey(r)] === 'personal' ? 'personal' : 'work');
  const hidden = (r: Row) => groups[hideKey({ name: groupKey(r) })] === 'hidden';
  const [saved, setSaved] = useState<McpFilter>(() => ({ ...ALL, ...stored<Partial<McpFilter>>(FILTER, {}) }));
  const setFilter = (f: McpFilter) => { setSaved(f); save(FILTER, f); };
  const shownCounts = useMemo(() => statusCounts(rows.filter((r) => !hidden(r))), [rows, groups]);
  useEffect(() => { if (probed !== null) mcpPageCounts.set(shownCounts); }, [probed, shownCounts]);
  const searched = useMemo(() => rows.filter((r) => mcpMatches(r, query)), [rows, query]);
  const counts = useMemo(() => filterCounts(searched, saved, hidden), [searched, saved, groups]);
  const filter = validFilter(saved, counts);
  const list = useMemo(() => mcpList(searched, filter, hidden), [searched, filter.show, filter.where, groups]);
  const narrowed = query.trim() !== '' || filter.show !== 'all' || filter.where !== 'all';
  const action = useSlot('page-mcp-action');
  const close = () => {
    const key = sel;
    flushSync(() => setSel(null));
    const row = key ? document.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"]`) : null;
    row?.scrollIntoView({ block: 'nearest' });
    row?.focus({ preventScroll: true });
  };

  return (
    <div className="mcp-page">
      <div className="mcp-main wk"><div className="wk-scroll"><div className="mt-page">
        {action && createPortal(<IconButton icon="refresh" label="Check" size="sm" spin={busy} disabled={busy} onClick={() => load(true)} />, action)}
        {current ? (
          <Detail row={current} usage={usageOf(current)} group={groupOf(current)} onGroup={(to) => setGroup(groupKey(current), to)} hidden={hidden(current)} onHide={() => setGroup(hideKey({ name: groupKey(current) }), hidden(current) ? 'shown' : 'hidden')} onClose={close} />
        ) : <>
          {error && <div className="mcp-error" role="alert"><Icon name="error" small /> {error}</div>}
          {probed !== null && rows.length === 0 && (
            <EmptyState size="sm" icon="plug" title="No MCP servers yet" hint="Servers you add show here" action={<SetupButton kind="mcp" mcpCommand={connectors ? 'claude mcp add' : 'codex mcp add'} />} />
          )}
          {!connectors && <div className="muted">claude.ai connectors load in Claude chats only</div>}
          {(rows.length > 0 || (probed === null && !error)) && (
            <div className="mcp-bar">
              <h2>MCP servers</h2>
              <SearchBox value={query} onChange={setQuery} label="Search" />
              <FilterMenu counts={counts} filter={filter} onChange={setFilter} />
              <IconButton icon="refresh" label={busy ? 'Checking' : at ? `Check again (checked ${ago(at, ' ago')})` : 'Check'} size="sm" spin={busy} disabled={busy} onClick={() => load(true)} />
              <SetupButton kind="mcp" mcpCommand={connectors ? 'claude mcp add' : 'codex mcp add'} label="Add" />
            </div>
          )}
          {probed === null && !error && !rows.length && (
            <div className="mcp-table" aria-busy="true" aria-label="Loading servers">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="mcp-skel-row"><span className="skeleton mcp-skel-ico" style={{ animationDelay: `${i * 80}ms` }} /><span className="skeleton mcp-skel-bar" style={{ animationDelay: `${i * 80}ms`, width: `${[38, 26, 44, 30, 34, 22][i]}%` }} /></div>)}</div>
          )}
          {narrowed && !list.length && (
            <EmptyState size="sm" icon="search" title="No servers match" action={<Button size="sm" onClick={() => { setQuery(''); setFilter(ALL); }}>Clear filters</Button>} />
          )}
          {list.length > 0 && (
            <div className="mcp-table" role="table" aria-label="MCP servers">
              <div className="mcp-tr mcp-th" role="row"><span role="columnheader">Server</span><span role="columnheader" className="c-type">Type</span><span role="columnheader" className="c-src">Source</span><span role="columnheader" className="c-st">Status</span><span /></div>
              {list.map((r) => (
                <ServiceRow key={rowKey(r)} row={r} usage={usageOf(r)} onPick={() => setSel(rowKey(r))} group={groupOf(r)} onGroup={(to) => setGroup(groupKey(r), to)} onHide={() => setGroup(hideKey({ name: groupKey(r) }), hidden(r) ? 'shown' : 'hidden')} isHidden={hidden(r)} />
              ))}
            </div>
          )}
        </>}
      </div></div></div>
    </div>
  );
}
