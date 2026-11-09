import { useRef, useState, type MouseEvent } from 'react';
import type { Meeting } from '../data/wiki/wiki';
import { countdown, isSolo, meetingBadge, meetingMeta } from '../data/meetings/meetings';
import { atTime } from '../data/tasks/engine';
import type { ItemRow } from '../data/sync';
import { Badge } from '../../ui/Badge';
import { Button, IconButton } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { haptic } from '../../ui/haptic';
import { safeHref } from '../../ui/util';
import { openMeeting, openMeetingNotes, openTask } from '../view';
import { useActions } from '../useActions';
import { clock } from '../tasks/time';

const stop = (e: MouseEvent) => e.stopPropagation();

// The one thing to do next: the next meeting today with More (Prep, Open calendar, Notes), else the first task due today with Done.
export function UpNext({ meeting, task, now, onPrep }: { meeting?: Meeting; task?: ItemRow; now: number; onPrep: () => void }) {
  const act = useActions();
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const calendar = meeting?.id.startsWith('cal:') ? safeHref(meeting.calendar_url) : undefined;
  const due = task && atTime(task.at);
  return (
    <section>
      <Section label="Up next" />
      <div className="as-group">
        {meeting && (
          <Row plain role="button" tabIndex={0} title={meeting.title} meta={[countdown(meeting, now), meetingMeta(meeting, now)].filter(Boolean).join(' · ')}
            onClick={() => openMeeting(meeting)}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openMeeting(meeting); } }}
            trailing={(
              <span className="ov-actions" onClick={stop}>
                {meetingBadge(meeting, now) && <Badge status="running" label="Live" />}
                <span className="ov-more">
                  <IconButton ref={more} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
                  {menu && (
                    <Menu trigger={more} onClose={() => setMenu(false)}>
                      {!isSolo(meeting) && <MenuItem icon="sparkle" onClick={() => { setMenu(false); onPrep(); }}>Prep</MenuItem>}
                      {calendar && <MenuItem icon="calendar" href={calendar} onClick={() => setMenu(false)}>Open calendar</MenuItem>}
                      <MenuItem icon="edit" onClick={() => { setMenu(false); openMeetingNotes(meeting); }}>Notes</MenuItem>
                    </Menu>
                  )}
                </span>
              </span>
            )} />
        )}
        {task && (
          <Row plain className="ov-task" title={<button type="button" className="ov-hit" onClick={() => openTask(task)}>{task.title}</button>}
            meta={due != null ? clock(due) : undefined}
            trailing={<Button size="sm" variant="tinted" onClick={() => { haptic('success'); act.done(task); }}>Done</Button>} />
        )}
      </div>
    </section>
  );
}
