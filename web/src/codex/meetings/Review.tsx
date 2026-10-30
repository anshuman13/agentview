import { useMemo } from 'react';
import { useAssistantData, useAssistantStore } from '../data';
import { Icon } from '../../ui/Icon';
import { nextMonday, nudgeText, ageDays, waitingByPerson, weeklyReview } from '../data/review';
import type { ItemRow } from '../data/sync';
import type { Patch } from '../data/store';
import { PickTime, when } from '../time';
import { copyText, showSnack, useView } from '../view';

function Group({ title, rows, children }: { title: string; rows: ItemRow[]; children: (r: ItemRow) => React.ReactNode }) {
  if (!rows.length) return null;
  return (
    <section className="mt-wk-sec">
      <div className="mt-load-head">{title} ({rows.length})</div>
      {rows.map((r) => <div key={r.profile + r.id} className="mt-log-item">{children(r)}</div>)}
    </section>
  );
}

export function Review({ now }: { now: number }) {
  const store = useAssistantStore();
  const { items: all } = useAssistantData();
  const { filter } = useView();
  const items = useMemo(() => (filter === 'all' ? all : all.filter((i) => i.profile === filter)), [all, filter]);
  const r = useMemo(() => weeklyReview(items, now), [items, now]);
  const waiting = useMemo(() => waitingByPerson(items, now), [items, now]);
  const change = (row: ItemRow, patch: Patch, text: string) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, row[k as keyof ItemRow]])) as Patch;
    void store.update(row, patch);
    showSnack(text, () => void store.update(row, before));
  };
  const actions = (row: ItemRow) => (
    <>
      <span className="mt-log-text">{row.title}{(row.rolls ?? 0) > 0 && <span className="mt-log-from"> · moved {row.rolls}x</span>}</span>
      <PickTime className="btn sm" title="Reschedule" label="Reschedule" onPick={(t) => change(row, { at: t, rolls: null, rolled_from: null }, `Due ${when(t)}`)} />
      <button className="btn sm" title="Next Monday 09:00" onClick={() => { const t = nextMonday(now); change(row, { at: t, rolls: null, rolled_from: null }, `Due ${when(t)}`); }}>Next Monday</button>
      <button className="btn sm" onClick={() => change(row, { deleted: 1 }, 'Dropped')}>Drop</button>
    </>
  );
  const empty = !r.done.length && !r.slipped.length && !r.stuck.length && !waiting.length;
  return (
    <div className="mt-load">
      <div className="mt-log-bar"><span className="mt-load-share">Weekly review: {r.done.length} done, {r.slipped.length} slipped, {r.stuck.length} stuck</span></div>
      <Group title="Done this week" rows={r.done}>{(row) => <span className="mt-log-text">{row.title}</span>}</Group>
      <Group title="Slipped" rows={r.slipped}>{actions}</Group>
      <Group title="Stuck" rows={r.stuck}>{actions}</Group>
      {waiting.length > 0 && (
        <section className="mt-wk-sec">
          <div className="mt-load-head">Waiting on ({waiting.length})</div>
          {waiting.map((g) => (
            <div key={g.name} className="mt-log-item">
              <span className="mt-log-text">{g.name}: {g.rows.map((x) => `${x.row.title} (${ageDays(x.row, now)}d)`).join(', ')}</span>
              <button className="btn sm" title="Copy a reminder message" onClick={() => copyText(nudgeText(g), 'Nudge copied')}><Icon name="copy" small /> Copy nudge</button>
            </div>
          ))}
        </section>
      )}
      {empty && <div className="as-empty"><Icon name="calendar" /><div>Nothing to review.</div></div>}
    </div>
  );
}
