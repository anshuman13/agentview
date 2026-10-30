import { Icon } from '../ui/Icon';
import { plural, rowKey, shortName, stateOf, usageText, type Group, type Row, type Service, type Usage } from './mcpHelpers';

export function ServiceRow({ service, sel, usageOf, onPick, group, onGroup, onHide, isHidden }: { service: Service; sel: string | null; usageOf: (r: Row) => Usage | undefined; onPick: (name: string) => void; group: Group; onGroup: (g: Group) => void; onHide: () => void; isHidden?: boolean }) {
  const calls = service.variants.reduce((n, v) => n + (usageOf(v.row)?.calls.length ?? 0), 0);
  const errors = service.variants.reduce((n, v) => n + (usageOf(v.row)?.errors ?? 0), 0);
  const other: Group = group === 'work' ? 'personal' : 'work';
  return (
    <div className={`mcp-row ${service.variants.some((v) => rowKey(v.row) === sel) ? 'selected' : ''}`}>
      <button className="mcp-row-name" data-row={rowKey(service.variants[0].row)} onClick={() => onPick(rowKey(service.variants[0].row))}>{shortName(service.name)}</button>
      <div className="mcp-chips">
        {service.variants.map(({ variant, row }) => {
          const [tone, label] = stateOf(row);
          const u = usageOf(row);
          const title = `${row.name} · ${label}${row.tools?.length ? ` · ${plural(row.tools.length, 'tool')}` : ''}${u ? ` · ${usageText(u)}` : ''}`;
          return (
            <button key={rowKey(row)} data-row={rowKey(row)} className={`mcp-chip ${tone} ${rowKey(row) === sel ? 'selected' : ''}`} title={title} onClick={() => onPick(rowKey(row))}>
              <span className={`dot ${tone}`} />{variant || label}
            </button>
          );
        })}
      </div>
      {calls > 0 && <span className={`mcp-row-use ${errors ? 'bad' : ''}`}>{plural(calls, 'call')}</span>}
      <button className="icon-btn mcp-row-move" title={isHidden ? 'Show' : 'Hide'} onClick={onHide}><Icon name={isHidden ? 'eye' : 'eye-closed'} small /></button>
      {!service.variants[0].row.account && <button className="icon-btn mcp-row-move" title={`Move to ${other === 'work' ? 'Work' : 'Personal'}`} onClick={() => onGroup(other)}><Icon name={other === 'work' ? 'briefcase' : 'home'} small /></button>}
    </div>
  );
}
