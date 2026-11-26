import { useRef, useState } from 'react';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Menu, MenuItem } from '../ui/Menu';
import { rowKey, shortName, sourceOf, stateOf, statusGroup, tagOf, typeOf, usageText, type Group, type Row, type Usage } from './mcpHelpers';

// The Status cell: a check when connected, a spinner while connecting, else the reason in its tone.
export function StatusCell({ row }: { row: Row }) {
  const [status, reason] = stateOf(row);
  if (row.status === 'pending' || row.status === 'probing') return <span className="mcp-st-ico" title={reason}><Icon name="loading" small spin /><span className="sr-only">{reason}</span></span>;
  if (status === 'done') return <span className="mcp-st-ico" title="Connected"><Icon name="check" small /><span className="sr-only">Connected</span></span>;
  return <span className={status === 'failed' ? 'bad' : status === 'waiting' ? 'warn' : 'muted'} title={row.status === 'failed' ? row.error : undefined}>{reason}</span>;
}

export const ServerIcon = ({ row }: { row: Row }) => <span className="mcp-ico" aria-hidden><Icon name={typeOf(row) === 'Web' ? 'globe' : 'terminal'} small /></span>;

// One table row like Claude's Connectors page: icon and name, Type with a tag, Source, Status, and a menu.
export function ServiceRow({ row, usage, onPick, group, onGroup, onHide, isHidden }: { row: Row; usage?: Usage; onPick: () => void; group: Group; onGroup: (g: Group) => void; onHide: () => void; isHidden?: boolean }) {
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const other: Group = group === 'work' ? 'personal' : 'work';
  const tag = tagOf(row);
  const off = statusGroup(row) === 'Off';
  return (
    <div className={`mcp-tr ${off ? 'mcp-off' : ''}`} role="row">
      <span role="cell" className="c-name">
        <ServerIcon row={row} />
        <span className="nm">
          <button type="button" className="mcp-hit" data-row={rowKey(row)} onClick={onPick} title={usage ? usageText(usage) : undefined}>{shortName(row.name)}</button>
          <span className="sub">{typeOf(row)} · {sourceOf(row)}</span>
        </span>
      </span>
      <span role="cell" className="c-type"><span className="t">{typeOf(row)}</span>{tag && <span className="mcp-tag">{tag}</span>}</span>
      <span role="cell" className="c-src"><span className="t">{sourceOf(row)}</span>{!row.account && group === 'personal' && <span className="mcp-tag">Personal</span>}</span>
      <span role="cell" className="c-st"><StatusCell row={row} /></span>
      <span role="cell" className="c-more">
        <IconButton ref={more} icon="ellipsis" label="More" size="sm" small onClick={() => setOpen((v) => !v)} />
        {open && (
          <Menu trigger={more} onClose={() => setOpen(false)}>
            <MenuItem icon={isHidden ? 'eye' : 'eye-closed'} onClick={() => { setOpen(false); onHide(); }}>{isHidden ? 'Show' : 'Hide'}</MenuItem>
            {!row.account && <MenuItem icon="arrow-swap" onClick={() => { setOpen(false); onGroup(other); }}>Move to {other === 'work' ? 'Work' : 'Personal'}</MenuItem>}
          </Menu>
        )}
      </span>
    </div>
  );
}
