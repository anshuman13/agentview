import { MenuItem } from '../ui/Menu';
import { Row as ListRow } from '../ui/Row';
import { plural, rowKey, shortName, stateOf, usageText, type Group, type Row, type Usage } from './mcpHelpers';
import { Badge } from '../ui/Badge';

export function ServiceRow({ row, selected, usage, onPick, group, onGroup, onHide, isHidden }: { row: Row; selected: boolean; usage?: Usage; onPick: () => void; group: Group; onGroup: (g: Group) => void; onHide: () => void; isHidden?: boolean }) {
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
      state={<Badge status={status} label={row.status === 'needs-auth' && status === 'waiting' ? 'Needs you' : row.status === 'connected' ? 'Connected' : undefined} reason={reason} />}
      menu={(
        <>
          <MenuItem onClick={onHide}>{isHidden ? 'Show' : 'Hide'}</MenuItem>
          {!row.account && <MenuItem onClick={() => onGroup(other)}>Move to {other === 'work' ? 'Work' : 'Personal'}</MenuItem>}
        </>
      )}
    />
  );
}
