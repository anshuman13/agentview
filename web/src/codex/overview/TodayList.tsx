import { useRef, useState } from 'react';
import type { Meeting } from '../data/wiki/wiki';
import { joinMinutes, meetingBadge } from '../data/meetings/meetings';
import { atTime } from '../data/tasks/engine';
import type { ItemRow } from '../data/sync';
import { Badge } from '../../ui/Badge';
import { Button, IconButton } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';
import { Row } from '../../ui/Row';
import { Icon } from '../../ui/Icon';
import { Section } from '../../ui/Section';
import { haptic } from '../../ui/haptic';
import { safeHref } from '../../ui/util';
import { openMeeting, openTask } from '../view';
import { useActions } from '../useActions';
import { clock } from '../tasks/time';

const SHOWN = 7;

export const doneCount = (done: number, open: number) => (done > 0 ? `${done} of ${done + open} done` : undefined);

function TaskRow({ r, late, now }: { r: ItemRow; late: boolean; now: number }) {
  const act = useActions();
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const due = atTime(r.at);
  return (
    <Row plain className="ov-task" title={<button type="button" className="ov-hit" onClick={() => openTask(r)}>{r.title}</button>}
      meta={!late && due != null ? clock(due) : undefined}
      onLongPress={() => setMenu(true)}
      leading={<IconButton icon="check" size="sm" label={`Mark ${r.title} done`} onClick={() => { haptic('success'); act.done(r); }} />}
      trailing={(
        <>
          {late && <Badge status="late" reason="Overdue" />}
          <span className="ov-more">
            <IconButton ref={more} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
            {menu && (
              <Menu trigger={more} onClose={() => setMenu(false)}>
                <MenuItem icon="clock" onClick={() => { setMenu(false); haptic('tap'); act.snoozeLater(r, now); }}>Snooze to tomorrow</MenuItem>
                <MenuItem icon="arrow-right" onClick={() => { setMenu(false); openTask(r); }}>Open</MenuItem>
              </Menu>
            )}
          </span>
        </>
      )} />
  );
}

function MeetingRow({ m, now }: { m: Meeting; now: number }) {
  const live = meetingBadge(m, now);
  const link = m.calendar_url ? safeHref(m.calendar_url) : '';
  const soon = link ? joinMinutes(m, now) : null;
  return (
    <Row plain role="button" tabIndex={0} title={m.title} meta={soon ? `Starts in ${soon} min` : clock(m.starts_at!)}
      trailing={live ? <Badge status="running" label="Live" /> : soon ? <a className="btn btn-filled btn-sm" href={link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><Icon name="device-camera-video" small />Join</a> : undefined}
      onClick={() => openMeeting(m)}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openMeeting(m); } }} />
  );
}

// Overdue tasks first, then the rest of today's meetings and tasks in time order; 7 rows, then Show all.
export function TodayList({ meetings, overdue, tasks, now, done, open }: { meetings: Meeting[]; overdue: ItemRow[]; tasks: ItemRow[]; now: number; done: number; open: number }) {
  const [all, setAll] = useState(false);
  const rows = [
    ...overdue.map((r) => ({ key: r.profile + r.id, at: atTime(r.at) ?? 0, late: true, r })),
    ...[
      ...meetings.map((m) => ({ key: `${m.profile}:${m.id}`, at: m.starts_at!, m })),
      ...tasks.map((r) => ({ key: r.profile + r.id, at: atTime(r.at) ?? 0, r })),
    ].sort((a, b) => a.at - b.at),
  ];
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);
  const doneText = doneCount(done, open);
  return (
    <section className="ov-today">
      <Section label="Today" action={doneText && <span className="badge quiet">{doneText}</span>} />
      <div className="as-group">
        {shown.map((x) => ('m' in x ? <MeetingRow key={x.key} m={x.m} now={now} /> : <TaskRow key={x.key} r={x.r} late={'late' in x} now={now} />))}
      </div>
      {rows.length > shown.length && <Button variant="quiet" size="sm" className="ov-more" onClick={() => setAll(true)}>Show all {rows.length}</Button>}
    </section>
  );
}
