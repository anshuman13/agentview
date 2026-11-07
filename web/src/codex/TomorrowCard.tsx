import { useState } from 'react';
import { blockId, isBlock } from '../../../shared/util';
import { rowKey, type ItemRow } from './data/sync';
import { atTime } from './data/engine';
import { estimateMin, freeMinutes, minutesText, timedMeetings, workGaps, type Span } from './data/plan';
import { clock } from './time';
import { openTask } from './view';
import { Capped } from './Fold';
import { MeetingRow } from './meetings/MeetingList';
import { PlanPreview, usePlanFlow } from './PlanPreview';
import { packUnblocked, unblocked } from './planFlow';
import type { useSplit } from './split';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Button, IconButton } from '../ui/Button';
import { plural, save, stored } from '../ui/util';

const DISMISSED = 'codex.tomorrowDismissed';
const SHOW_FROM = 17;
const dayKey = (now: number) => { const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

// From 17:00 the card shows when tomorrow has meetings, blocks or tasks, until it is closed for the day.
export function useTomorrowCard(s: ReturnType<typeof useSplit>, tasks: ItemRow[], now: number) {
  const day = dayKey(now);
  const [closed, setClosed] = useState(() => stored<string>(DISMISSED, ''));
  const hide = () => { setClosed(day); save(DISMISSED, day); };
  return { shown: new Date(now).getHours() >= SHOW_FROM && closed !== day && (s.busyTomorrow.length > 0 || tasks.length > 0), hide };
}

// Tomorrow at a glance, with a Plan tomorrow preview that blocks time for the tomorrow tasks without a block.
export function TomorrowCard({ s, tasks, now, hide }: { s: ReturnType<typeof useSplit>; tasks: ItemRow[]; now: number; hide: () => void }) {
  const timed = timedMeetings(s.busyTomorrow);
  const busy = timed.map((m) => [m.starts_at!, m.ends_at!] as Span);
  const blocks = timed.filter((m) => isBlock(m.id));
  const gaps = workGaps(busy, s.endOfDay);
  const pack = (keep?: Set<string>) => packUnblocked(tasks, blocks, gaps, keep);
  const flow = usePlanFlow(pack, unblocked(tasks, blocks), 'tomorrow');
  const timedSet = new Set(timedMeetings(s.meetingsTomorrow));
  const meetings = [...s.meetingsTomorrow].sort((a, b) => Number(!timedSet.has(a)) - Number(!timedSet.has(b)) || a.starts_at! - b.starts_at!);
  const rows = [
    ...meetings.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} />),
    ...tasks.map((r) => {
      const t = atTime(r.at)!;
      const est = estimateMin(r.title);
      const clocked = new Date(t).getHours() + new Date(t).getMinutes() > 0;
      return <Row key={rowKey(r)} title={r.title} meta={clocked ? clock(t) : est ? `~${minutesText(est)}` : undefined} onClick={() => openTask(r)} />;
    }),
  ];
  const weekend = [0, 6].includes(new Date(s.endOfDay).getDay());
  const plannable = !weekend && gaps.length > 0 && tasks.some((r) => !blocks.some((m) => m.profile === r.profile && m.id === blockId(r.id)));
  return (
    <section>
      <Section
        label={<>Tomorrow
          {meetings.length > 0 && <span className="badge quiet">{plural(meetings.length, 'meeting')}</span>}
          {tasks.length > 0 && <span className="badge quiet">{plural(tasks.length, 'task')}</span>}
          <span className="muted small">free {minutesText(freeMinutes(busy, s.endOfDay))}</span></>}
        action={<>
          {plannable && <Button size="sm" onClick={flow.start}>Plan tomorrow</Button>}
          <IconButton icon="close" size="sm" small label="Hide tomorrow until the next day" onClick={hide} />
        </>} />
      <PlanPreview flow={flow} />
      {rows.length > 0 && <div className="mt-rows ov-card"><Capped items={rows} render={(r) => r} /></div>}
    </section>
  );
}
