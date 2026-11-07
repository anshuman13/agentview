import { Fragment, useState, type ReactNode } from 'react';
import { Button } from '../../ui/Button';
import { Section } from '../../ui/Section';
import { save, stored } from '../../ui/util';
import { visibleRows, type DigestGroup } from './digest';

export function GroupList<R>({ foldKey, capOpen, group, render }: { foldKey: string; capOpen?: boolean; group: DigestGroup<R>; render: (row: R) => ReactNode }) {
  const [open, setOpen] = useState(() => stored<boolean>(foldKey, group.open));
  const [all, setAll] = useState(false);
  const toggle = () => { save(foldKey, !open); setOpen(!open); };
  const rows = visibleRows(group, all, capOpen);
  return (
    <>
      <Section label={group.label} count={group.rows.length} open={open} onToggle={toggle} />
      {open && rows.map((r, i) => <Fragment key={i}>{render(r)}</Fragment>)}
      {open && !all && rows.length < group.rows.length && <Button variant="quiet" size="sm" className="ov-more" onClick={() => setAll(true)}>Show all {group.rows.length}</Button>}
    </>
  );
}
