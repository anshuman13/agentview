import { useRef, useState } from 'react';
import { IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { Row as ListRow } from '../ui/Row';
import { plural, rowKey, shortName, stateOf, usageText, type Group, type Row, type Usage } from './mcpHelpers';
import { Badge } from '../ui/Badge';

export function ServiceRow({ row, selected, usage, onPick, group, onGroup, onHide, isHidden }: { row: Row; selected: boolean; usage?: Usage; onPick: () => void; group: Group; onGroup: (g: Group) => void; onHide: () => void; isHidden?: boolean }) {
  const [menu, setMenu] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [status, reason] = stateOf(row);
  const other: Group = group === 'work' ? 'personal' : 'work';
  const meta = [
    row.tools && (row.tools.length ? plural(row.tools.length, 'tool') : 'No tools'),
    row.ms != null && `${row.ms} ms`,
    usage && usageText(usage),
  ].filter(Boolean).join(' · ');
  return (
    <ListRow
      plain
      aria-current={selected || undefined}
      title={<button type="button" className="mcp-hit" data-row={rowKey(row)} aria-pressed={selected} onClick={onPick}>{shortName(row.name)}</button>}
      meta={meta || undefined}
      trailing={
        <>
          <Badge status={status} label={row.status === 'needs-auth' && status === 'waiting' ? 'Needs you' : row.status === 'connected' ? 'Connected' : undefined} reason={reason} />
          <span className="as-wrap-more">
            <IconButton ref={btn} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
            {menu && (
              <Menu trigger={btn} onClose={() => setMenu(false)}>
                <MenuItem onClick={() => { setMenu(false); onHide(); }}>{isHidden ? 'Show' : 'Hide'}</MenuItem>
                {!row.account && <MenuItem onClick={() => { setMenu(false); onGroup(other); }}>Move to {other === 'work' ? 'Work' : 'Personal'}</MenuItem>}
              </Menu>
            )}
          </span>
        </>
      }
    />
  );
}
