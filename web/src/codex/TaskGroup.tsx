import { Fragment } from 'react';
import type { ItemRow } from './data/sync';
import type { Drag } from './drag';
import { Section, sectionCount } from '../ui/Section';
import { TaskRow } from './Task';

export type Day = { key: string; label: string; day: number | null; rows: ItemRow[] };

type ListProps = {
  rows: ItemRow[];
  sectionKey?: string;
  droppable?: boolean;
  inDay?: boolean;
  drag: Drag<ItemRow> | null;
  picked: Set<string> | null;
  onOpen: (r: ItemRow) => void;
  start: (item: ItemRow, key: string, title: string) => (e: React.PointerEvent) => void;
};

export function TaskList({ rows, sectionKey, droppable = true, inDay = false, drag, picked, onOpen, start }: ListProps) {
  const over = sectionKey && droppable && drag?.over?.section === sectionKey ? drag.over.index : -1;
  const shown = rows.filter((r) => r.profile + r.id !== drag?.key);
  return (
    <div className="ui-group" data-drop={droppable ? sectionKey : undefined}>
      {rows.map((r) => {
        const k = r.profile + r.id;
        const line = over >= 0 && shown[over] && shown[over].profile + shown[over].id === k;
        return (
          <Fragment key={k}>
            {line && <div className="as-drop-line" />}
            <TaskRow row={r} inDay={inDay} picking={!!picked} selected={picked?.has(k)} onOpen={() => onOpen(r)} onGrab={sectionKey ? start(r, k, r.title ?? '') : undefined} lifted={drag?.key === k} />
          </Fragment>
        );
      })}
      {over >= 0 && over >= shown.length && <div className="as-drop-line" />}
      {droppable && drag && !rows.length && <div className="as-drop-empty">Drop here</div>}
    </div>
  );
}

export function DayGroup({ d, ...list }: Omit<ListProps, 'rows' | 'sectionKey' | 'droppable' | 'inDay'> & { d: Day }) {
  if (!d.rows.length && !list.drag) return null;
  return (
    <section data-day={d.key} className={list.drag?.over?.section === d.key && d.day != null ? 'as-target' : undefined}>
      <Section label={d.label} count={sectionCount(d.rows.length)} />
      <TaskList {...list} rows={d.rows} sectionKey={d.key} droppable={d.day != null} inDay={d.day != null} />
    </section>
  );
}
