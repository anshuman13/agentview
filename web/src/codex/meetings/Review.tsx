import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAssistantTable, useAssistantStore } from '../data';
import { EmptyState } from '../../ui/Panel';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { nextMonday, nudgeText, unanswered, waitingByPerson, weeklyReview } from '../data/review';
import type { ItemRow } from '../data/sync';
import type { Patch } from '../data/store';
import { PickTime, when } from '../time';
import { copyText, showSnack, useView } from '../view';
import { safeHref } from '../../ui/util';

function More({ children }: { children: (close: () => void) => ReactNode }) {
  const [menu, setMenu] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <span className="as-wrap-more">
      <IconButton ref={btn} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
      {menu && <Menu trigger={btn} onClose={() => setMenu(false)}>{children(() => setMenu(false))}</Menu>}
    </span>
  );
}

function Group({ title, rows, children }: { title: string; rows: ItemRow[]; children: (r: ItemRow) => ReactNode }) {
  if (!rows.length) return null;
  return (
    <section className="mt-wk-sec">
      <Section label={title} count={rows.length} />
      <div className="as-group">
        {rows.map((r) => <Fragment key={r.profile + r.id}>{children(r)}</Fragment>)}
      </div>
    </section>
  );
}

export function Review({ now }: { now: number }) {
  const store = useAssistantStore();
  const all = useAssistantTable('items');
  const briefs = useAssistantTable('briefs');
  const { filter } = useView();
  const items = useMemo(() => (filter === 'all' ? all : all.filter((i) => i.profile === filter)), [all, filter]);
  const r = useMemo(() => weeklyReview(items, now), [items, now]);
  const mail = useMemo(() => unanswered(briefs.filter((b) => filter === 'all' || b.profile === filter)), [briefs, filter]);
  const waiting = useMemo(() => waitingByPerson(items, now, mail), [items, now, mail]);
  const change = (row: ItemRow, patch: Patch, text: string) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, row[k as keyof ItemRow]])) as Patch;
    void store.update(row, patch);
    showSnack(text, () => void store.update(row, before));
  };
  const reschedule = (row: ItemRow, t: number) => change(row, { at: t, rolls: null, rolled_from: null }, `Due ${when(t)}`);
  const actions = (row: ItemRow) => (
    <Row
      plain
      title={row.title}
      meta={(row.rolls ?? 0) > 0 ? `Moved ${row.rolls}x` : undefined}
      trailing={<>
        <PickTime className="btn btn-gray btn-sm" title="Reschedule" label="Reschedule" onPick={(t) => reschedule(row, t)} />
        <More>{(close) => <>
          <MenuItem title="Next Monday 09:00" onClick={() => { close(); reschedule(row, nextMonday(now)); }}>Next Monday</MenuItem>
          <MenuItem danger onClick={() => { close(); change(row, { deleted: 1 }, 'Dropped'); }}>Drop</MenuItem>
        </>}</More>
      </>}
    />
  );
  const empty = !r.done.length && !r.slipped.length && !r.stuck.length && !waiting.length;
  return (
    <>
      <div className="mt-log-bar"><span className="mt-load-share">Weekly review: {r.done.length} done, {r.slipped.length} slipped, {r.stuck.length} stuck</span></div>
      <Group title="Done this week" rows={r.done}>{(row) => <Row plain title={row.title} />}</Group>
      <Group title="Slipped" rows={r.slipped}>{actions}</Group>
      <Group title="Stuck" rows={r.stuck}>{actions}</Group>
      {waiting.length > 0 && (
        <section className="mt-wk-sec">
          <Section label="Waiting on" count={waiting.length} />
          <div className="as-group">
            {waiting.map((g) => {
              const links = g.rows.filter((x) => x.url);
              return (
                <Row
                  key={g.name}
                  lines={2}
                  title={g.name}
                  meta={g.rows.map((x) => `${x.title} (${x.days}d)`).join(', ')}
                  onClick={() => copyText(nudgeText(g), 'Nudge copied')}
                  action={links.length > 0 ? <More>{(close) => links.map((x) => <MenuItem key={x.key} href={safeHref(x.url!)} onClick={close}>Open {x.title}</MenuItem>)}</More> : undefined}
                />
              );
            })}
          </div>
        </section>
      )}
      {empty && <EmptyState size="sm" icon="calendar" title="Nothing to review" />}
    </>
  );
}
