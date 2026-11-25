import { ACCOUNT_LABEL, type Account } from '../../../shared/protocol';
import { MenuItem } from '../ui/Menu';
import { Row as ListRow } from '../ui/Row';
import { dotTone, rowNote, plural, rowKey, shortName, statusGroup, usageText, type Group, type Row, type Usage } from './mcpHelpers';

export function ServiceRow({ row, selected, usage, onPick, group, onGroup, onHide, isHidden }: { row: Row; selected: boolean; usage?: Usage; onPick: () => void; group: Group; onGroup: (g: Group) => void; onHide: () => void; isHidden?: boolean }) {
  const other: Group = group === 'work' ? 'personal' : 'work';
  const meta = [
    rowNote(row),
    row.account ? ACCOUNT_LABEL[row.account as Account] ?? row.account : group === 'personal' && 'Personal',
    row.ms != null && `${row.ms} ms`,
    usage && usageText(usage),
  ].filter(Boolean).join(' · ');
  const off = statusGroup(row) === 'Off';
  return (
    <ListRow
      plain
      lines={1}
      className={off ? 'mcp-off' : undefined}
      aria-current={selected || undefined}
      leading={<span className={`dot ${dotTone(row)}`} aria-hidden />}
      title={<button type="button" className="mcp-hit" data-row={rowKey(row)} aria-pressed={selected} onClick={onPick}>{shortName(row.name)}</button>}
      meta={meta || undefined}
      trailing={row.tools && <span className="chip pill sm mcp-count">{row.tools.length ? plural(row.tools.length, 'tool') : 'No tools'}</span>}
      menu={(
        <>
          <MenuItem onClick={onHide}>{isHidden ? 'Show' : 'Hide'}</MenuItem>
          {!row.account && <MenuItem onClick={() => onGroup(other)}>Move to {other === 'work' ? 'Work' : 'Personal'}</MenuItem>}
        </>
      )}
    />
  );
}
