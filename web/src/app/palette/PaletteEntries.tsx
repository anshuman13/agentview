import type { RefObject } from 'react';
import { Icon } from '../../ui/Icon';
import { Row as UiRow } from '../../ui/Row';
import { Hl } from '../../ui/util';
import { itemKey, type Command, type ItemHit, type PaletteItem, type Row } from './paletteLogic';
import { itemMeta } from './paletteActions';

export type Entry = { row: Row } | { item: ItemHit } | { all: number };

const entryGroup = (e: Entry, blank: boolean) => {
  if ('all' in e) return '';
  if ('item' in e) return blank ? 'Recently opened' : 'Items';
  return e.row.cmd.pinned && blank ? 'pinned chats' : e.row.recent ? 'recently used' : 'other commands';
};

type Props = { list: RefObject<HTMLUListElement | null>; entries: Entry[]; idx: number; blank: boolean; q: string; run: (cmd: Command) => void; runItem: (i: PaletteItem) => void; runAll: () => void };

export function PaletteEntries({ list, entries, idx, blank, q, run, runItem, runAll }: Props) {
  return (
    <ul ref={list} role="listbox">
      {entries.map((e, i) => {
        const label = entryGroup(e, blank);
        const group = label !== (entries[i - 1] ? entryGroup(entries[i - 1], blank) : 'other commands') ? label : '';
        const active = { role: 'option', 'aria-selected': i === idx, className: i === idx ? 'active' : '' } as const;
        if ('all' in e) {
          return (
            <li key="see-all" {...active} className={`${active.className} palette-item`} onClick={runAll}>
              <UiRow plain title={`See all ${e.all} results`} meta={`"${q.trim()}"`} trailing={<Icon name="chevron-right" />} />
            </li>
          );
        }
        if ('item' in e) {
          const { item, hits } = e.item;
          return (
            <li key={itemKey(item)} {...active} className={`${active.className} palette-item`} onClick={() => runItem(item)}>
              <UiRow plain title={<Hl text={item.title} hits={hits} />} meta={itemMeta(item)} trailing={group && <span className="palette-group">{group}</span>} />
            </li>
          );
        }
        const r = e.row;
        return (
          <li key={r.cmd.id} {...active} onClick={() => run(r.cmd)}>
            <span className="palette-label"><Hl text={r.cmd.label} hits={r.hits} /></span>
            {r.cmd.key && <span className="palette-key">{r.cmd.key}</span>}
            {group && <span className="palette-group">{group}</span>}
          </li>
        );
      })}
    </ul>
  );
}
