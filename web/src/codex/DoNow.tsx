import { useState } from 'react';
import { useAssistantTable } from './data';
import { SNOOZES, atTime } from './data/engine';
import type { ItemRow } from './data/sync';
import type { Meeting } from './data/wiki';
import { estimateMin, minutesText } from './data/plan';
import { peopleOf } from './data/meetings';
import { channelOf } from './taskSource';
import { useActions } from './useActions';
import type { useNeedsYou } from './NeedsYou';
import { Icon } from '../ui/Icon';
import { haptic } from '../ui/haptic';
import { openMeeting, openTask, openWeekGoals } from './view';
import { clock } from './time';
import { Flag } from './AddSheet';
import { Swipe } from './Swipe';
import { CardRow } from './overview/CardRow';
import { goalsMeta, useGoalsCount } from './Goals';
import { Button } from '../ui/Button';
import { MenuItem, MenuSeparator } from '../ui/Menu';
import { Row } from '../ui/Row';
import { safeHref } from '../ui/util';
import { FOCUS_MINUTES, isFocused, startFocus, stopFocus, useFocus } from './focus';

type Item = { key: string; title: string; why: string; priority?: number | null; open: () => void; button: { label: string; run: () => void }; row?: ItemRow; calendar?: string };

const TOP = 3;
const SHOWN = 5;

// Higher first: a priority flag lifts a task above Slack, an untouched day of lateness adds a little.
const rankTask = (r: ItemRow, now: number) => (r.priority ?? 0) * 10 + Math.min(5, Math.max(0, Math.floor((now - (atTime(r.at) ?? now)) / 86400_000)));

// One list of what to do next, in order: the meeting about to start, flagged tasks, then today's tasks, as rows in one group. The top three are numbered; five show, then Show all.
export function DoNow({ needs, today, nextUp, meeting, now, onPrep }: {
  needs: ReturnType<typeof useNeedsYou>;
  today: ItemRow[];
  nextUp: Ahead | null;
  meeting: Meeting | null;
  now: number;
  onPrep: () => void;
}) {
  const act = useActions();
  const [all, setAll] = useState(false);
  const timer = useFocus();
  const goals = useGoalsCount(now);
  const done = (r: ItemRow) => () => { haptic('success'); act.done(r); };
  const task = (r: ItemRow, why: string): Item => ({
    key: `t:${r.profile}:${r.id}`, title: r.title ?? '(Untitled)', why, priority: r.priority, row: r,
    open: () => openTask(r), button: { label: 'Done', run: done(r) },
  });
  const timeOf = (r: ItemRow) => { const t = atTime(r.at); return t != null && new Date(t).getHours() + new Date(t).getMinutes() > 0 && t > now ? `at ${clock(t)}` : ''; };
  const prio = (r: ItemRow) => (['', 'Low priority', 'Medium priority', 'High priority'][r.priority ?? 0] ?? '');

  const seen = new Set(needs.rows.flatMap((x) => x.keys).filter((k) => k.startsWith('task:')).map((k) => k.slice(5)));
  const todays = [...today].filter((r) => !seen.has(`${r.profile}:${r.id}`)).sort((a, b) => rankTask(b, now) - rankTask(a, now) || (atTime(a.at) ?? 0) - (atTime(b.at) ?? 0))
    .map((r) => task(r, [timeOf(r) || 'Today', prio(r), r.people].filter(Boolean).join(' · ')));
  const flagged = todays.filter((i) => (i.priority ?? 0) >= 2);
  const meetingItem: Item[] = meeting ? [{
    key: `m:${meeting.profile}:${meeting.id}`, title: meeting.title ?? 'Meeting',
    why: [meeting.starts_at! <= now ? 'Now' : `In ${Math.max(1, Math.round((meeting.starts_at! - now) / 60000))} min`, peopleOf(meeting).slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    open: () => openMeeting(meeting), button: { label: 'Prep', run: onPrep }, calendar: meeting.id.startsWith('cal:') ? safeHref(meeting.calendar_url) : undefined,
  }] : [];
  const items = [...meetingItem, ...flagged, ...todays.filter((i) => !flagged.includes(i))];
  const ahead = nextUp && !todays.length && !meeting ? <Ahead next={nextUp} now={now} /> : null;
  if (!items.length) return ahead;
  const weekend = [0, 6].includes(new Date(now).getDay());
  const menu = (i: Item) => {
    const r = i.row;
    if (!r) return i.calendar ? (choose: (fn: () => void) => () => void) => <MenuItem icon="calendar" href={i.calendar} onClick={choose(() => {})}>Open calendar</MenuItem> : undefined;
    return (choose: (fn: () => void) => () => void) => (
      <>
        {isFocused(timer, r)
          ? <MenuItem icon="debug-stop" onClick={choose(stopFocus)}>Stop focus</MenuItem>
          : <MenuItem icon="play" onClick={choose(() => startFocus(r, FOCUS_MINUTES))}>Focus</MenuItem>}
        <MenuItem icon="arrow-right" onClick={choose(() => act.snoozeLater(r, now))}>Tomorrow</MenuItem>
        <MenuSeparator />
        {SNOOZES.filter((o) => o.label !== 'Tomorrow').map((o) => <MenuItem key={o.label} icon="clock" onClick={choose(() => act.snooze(r, o.at(new Date(now), r.profile)))}>Snooze {o.label.toLowerCase()}</MenuItem>)}
      </>
    );
  };
  const rowOf = (i: Item, n: number) => {
    const el = <CardRow key={i.key} title={i.title} meta={<>{i.priority ? <Flag priority={i.priority} /> : null}{i.why}</>} leading={n < TOP ? n + 1 : undefined} onOpen={i.open} button={i.button} menu={menu(i)} />;
    return i.row ? <Swipe key={i.key} onRight={done(i.row)} onLeft={() => act.snoozeLater(i.row!, now)}>{el}</Swipe> : el;
  };
  return (
    <>
    {weekend && ahead}
    <div className="as-group ov-today">
      {(all ? items : items.slice(0, SHOWN)).map(rowOf)}
      {!all && items.length > SHOWN && <div className="ov-ask"><div className="ov-ask-line"><Button variant="quiet" size="sm" onClick={() => setAll(true)}>Show all {items.length}</Button></div></div>}
      {goals.count > 0 && <Row title="Goals" meta={goalsMeta(goals.count, goals.risk)} trailing={<Icon name="chevron-right" small />} onClick={openWeekGoals} />}
    </div>
    {!weekend && ahead}
    </>
  );
}

type Ahead = { label: string; tomorrow: boolean; tasks: ItemRow[]; meetings: Meeting[] };

// Nothing to do today: the next day at a glance, with the hub's written summary, its counts and the task to start with.
function Ahead({ next, now }: { next: Ahead; now: number }) {
  const ts = [...next.tasks].sort((a, b) => rankTask(b, now) - rankTask(a, now) || (atTime(a.at) ?? 0) - (atTime(b.at) ?? 0));
  const est = ts.map((r) => estimateMin(r.title)).filter((m): m is number => m != null).reduce((a, b) => a + b, 0);
  const ms = [...next.meetings].sort((a, b) => a.starts_at! - b.starts_at!);
  const meetMin = Math.round(ms.reduce((n, m) => n + Math.max(0, ((m.ends_at ?? m.starts_at!) - m.starts_at!) / 60000), 0));
  const flagged = ts.filter((r) => (r.priority ?? 0) >= 2).length;
  const start = new Date(atTime(ts[0].at)!).setHours(0, 0, 0, 0);
  const brief = useAssistantTable('briefs').find((b) => !b.deleted && b.kind === 'ahead' && b.from_at === start && b.text);
  const stats: [string | number, string][] = [
    [ts.length, `${ts.length === 1 ? 'task' : 'tasks'}${est ? `, ${minutesText(est)}` : ''}`],
    [ms.length, `${ms.length === 1 ? 'meeting' : 'meetings'}${meetMin ? `, ${minutesText(meetMin)}` : ''}`],
    ...(ms.length ? [[clock(ms[0].starts_at!), 'first meeting'] as [string, string]] : flagged ? [[flagged, 'flagged'] as [number, string]] : []),
  ];
  return (
    <section className="fc">
      <div className="as-section">{next.label}</div>
      <div className="fc-ahead">
        {brief && <p className="fc-summary">{brief.text}</p>}
        <div className="fc-stats">{stats.map(([n, l]) => <div key={l}><b>{n}</b><span>{l}</span></div>)}</div>
        <button className="fc-first" onClick={() => openTask(ts[0])}>
          <span><span className="muted small">Start with</span>{ts[0].title ?? '(Untitled)'}</span>
          <Icon name="chevron-right" small />
        </button>
      </div>
    </section>
  );
}
