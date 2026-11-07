import { useEffect, useMemo, useRef, useState } from 'react';
import { useSyncGate, useAssistantData } from './data';
import { atTime } from './data/engine';
import type { ItemRow } from './data/sync';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Row } from '../ui/Row';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/Panel';
import { replyQueue } from './overview/ReplyQueue';
import { useNeedsYou } from './NeedsYou';
import { AddSheet } from './AddSheet';
import { useView } from './view';
import { when } from './time';
import type { useSplit } from './split';
import { UpNext } from './overview/UpNext';
import { TodayList, doneCount } from './overview/TodayList';
import { NeedsYouSheet } from './overview/NeedsYouSheet';

export { Review } from './overview/Review';

type Split = ReturnType<typeof useSplit>;

// The day in three blocks: the next meeting or task, what needs me (a row opening a sheet), and what is left today.
export function Overview({ s, dueToday, onPrep }: { s: Split; dueToday: ItemRow[]; onPrep: () => void }) {
  const snap = useAssistantData();
  const { filter } = useView();
  const now = Date.now();
  const needs = useNeedsYou(s, now);
  const queue = useMemo(() => replyQueue(s.review, now), [s.review, now]);
  const count = needs.rows.length + queue.length;
  const [sheet, setSheet] = useState(false);
  const [adding, setAdding] = useState(false);
  const needsRow = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!count) setSheet(false); }, [count]);
  const loading = useSyncGate().loading && !snap.items.length;
  if (loading) return <Skeleton />;
  const closeSheet = () => {
    setSheet(false);
    requestAnimationFrame(() => needsRow.current?.querySelector('button')?.focus({ preventScroll: true }));
  };
  const risky = new Set(needs.rows.flatMap((n) => (n.kind === 'risk' ? [n.row.profile + n.row.id] : [])));
  const openDue = dueToday.filter((r) => r.status === 'open');
  const openLate = s.overdue.filter((r) => r.status === 'open');
  const openCount = new Set([...openDue, ...openLate].map((r) => r.profile + r.id)).size;
  const todo = openDue.filter((r) => !risky.has(r.profile + r.id)).sort((a, b) => (atTime(a.at) ?? 0) - (atTime(b.at) ?? 0));
  const late = openLate.filter((r) => !risky.has(r.profile + r.id));
  const task = s.next ? undefined : todo[0];
  const others = s.meetingsToday.filter((m) => m !== s.next && (m.ends_at ?? m.starts_at!) > now);
  const nextHint = () => {
    const later = s.later.filter((r) => atTime(r.at) != null).sort((a, b) => atTime(a.at)! - atTime(b.at)!)[0];
    const meeting = s.nextLater;
    if (later && (!meeting || atTime(later.at)! < meeting.starts_at!)) return `Next: ${when(atTime(later.at)!)} ${later.title}`;
    return meeting ? `Next: ${when(meeting.starts_at!)} ${meeting.title}` : 'Nothing planned. Add a task to start the day.';
  };
  return (
    <>
      {s.next || task ? (
        <UpNext meeting={s.next} task={task} now={now} onPrep={onPrep} />
      ) : (
        <EmptyState size="md" icon="pass" title="Nothing today" hint={nextHint()} action={<Button variant="primary" size="sm" onClick={() => setAdding(true)}>New task</Button>} />
      )}
      {count > 0 && (
        <div className="as-group" ref={needsRow}>
          <Row title="Needs you" onClick={() => setSheet(true)} trailing={<><span className="badge quiet">{count}</span><Icon name="chevron-right" small /></>} />
        </div>
      )}
      <TodayList meetings={others} overdue={late} tasks={task ? todo.filter((r) => r !== task) : todo} now={now} done={s.doneToday.length} open={openCount} />
      {sheet && <NeedsYouSheet needs={needs} queue={queue} now={now} onClose={closeSheet} />}
      {adding && <AddSheet filter={filter} onClose={() => setAdding(false)} />}
    </>
  );
}
