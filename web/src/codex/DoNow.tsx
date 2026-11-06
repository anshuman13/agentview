import { Fragment, useState } from 'react';
import { useAssistantTable } from './data';
import { atTime } from './data/engine';
import type { ItemRow } from './data/sync';
import type { Meeting } from './data/wiki';
import { estimateMin, minutesText } from './data/plan';
import { peopleOf } from './data/meetings';
import { channelOf } from './taskSource';
import { useActions } from './useActions';
import type { useNeedsYou } from './NeedsYou';
import { Icon } from '../ui/Icon';
import { haptic } from '../ui/haptic';
import { openMeeting, openTask } from './view';
import { clock } from './time';
import { Flag } from './AddSheet';
import { Swipe } from './Swipe';
import { FOCUS_MINUTES, isFocused, startFocus, stopFocus, useFocus } from './focus';

type Act = { label: string; run?: () => void; href?: string };
type Item = { key: string; swipe?: { done: () => void; later: () => void }; icon: string; title: string; why: string; hot?: boolean; priority?: number | null; open: () => void; act: Act; done?: () => void; doneLabel?: string; focus?: ItemRow };

const TOP = 3;
const MORE = 5;

// Higher first: a priority flag lifts a task above Slack, an untouched day of lateness adds a little.
const rankTask = (r: ItemRow, now: number) => (r.priority ?? 0) * 10 + Math.min(5, Math.max(0, Math.floor((now - (atTime(r.at) ?? now)) / 86400_000)));

// One list of what to do next, in order: the meeting about to start, flagged tasks, then today's tasks. The top three are numbered with one action each; the rest follow in a short list.
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
  const done = (r: ItemRow) => () => { haptic('success'); act.done(r); };
  const snooze = (r: ItemRow) => act.snoozeLater(r, now);
  const task = (r: ItemRow, why: string, hot = false): Item => ({
    key: `t:${r.profile}:${r.id}`, icon: channelOf(r).icon ?? 'circle-large-outline', title: r.title ?? '(Untitled)', why, hot, priority: r.priority, focus: r,
    open: () => openTask(r), act: { label: 'Done', run: done(r) }, done: () => snooze(r), doneLabel: 'Tomorrow', swipe: { done: done(r), later: () => snooze(r) },
  });
  const timeOf = (r: ItemRow) => { const t = atTime(r.at); return t != null && new Date(t).getHours() + new Date(t).getMinutes() > 0 && t > now ? `at ${clock(t)}` : ''; };
  const prio = (r: ItemRow) => (['', 'Low priority', 'Medium priority', 'High priority'][r.priority ?? 0] ?? '');

  const seen = new Set(needs.rows.flatMap((x) => x.keys).filter((k) => k.startsWith('task:')).map((k) => k.slice(5)));
  const todays = [...today].filter((r) => !seen.has(`${r.profile}:${r.id}`)).sort((a, b) => rankTask(b, now) - rankTask(a, now) || (atTime(a.at) ?? 0) - (atTime(b.at) ?? 0))
    .map((r) => task(r, [timeOf(r) || 'Today', prio(r), r.people].filter(Boolean).join(' · ')));
  const flagged = todays.filter((i) => (i.priority ?? 0) >= 2);
  const meetingItem: Item[] = meeting ? [{
    key: `m:${meeting.profile}:${meeting.id}`, icon: 'calendar', title: meeting.title ?? 'Meeting', hot: true,
    why: [meeting.starts_at! <= now ? 'Now' : `In ${Math.max(1, Math.round((meeting.starts_at! - now) / 60000))} min`, peopleOf(meeting).slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    open: () => openMeeting(meeting), act: { label: 'Prep', run: onPrep },
  }] : [];
  const items = [...meetingItem, ...flagged, ...todays.filter((i) => !flagged.includes(i))];
  const ahead = nextUp && !todays.length && !meeting ? <Ahead next={nextUp} now={now} /> : null;
  if (!items.length) return ahead;
  const rest = items.slice(TOP);
  const weekend = [0, 6].includes(new Date(now).getDay());
  const button = (i: Item) => i.act.href
    ? <a className="btn btn-sm btn-tinted" href={i.act.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{i.act.label}</a>
    : <button className="btn btn-sm btn-tinted" onClick={(e) => { e.stopPropagation(); i.act.run?.(); }}>{i.act.label}</button>;
  return (
    <>
    {weekend && ahead}
    <section className="fc">
      <div className="as-section next">{weekend ? 'When you are back' : 'Do now'}</div>
      <ol className="fc-top">
        {items.slice(0, TOP).map((i, n) => (
          <li key={i.key} className={`fc-item${i.hot && !weekend ? ' hot' : ''}`} onClick={i.open}>
            <span className="fc-n">{n + 1}</span>
            <div className="fc-body">
              <div className="fc-title">{i.title}</div>
              <div className="fc-why"><Icon name={i.icon} small />{i.priority ? <Flag priority={i.priority} /> : null}<span>{i.why}</span></div>
              <div className="fc-acts">
                {button(i)}
                {n === 0 && i.focus && (isFocused(timer, i.focus)
                  ? <button className="btn btn-sm btn-plain" onClick={(e) => { e.stopPropagation(); stopFocus(); }}>Stop</button>
                  : <button className="btn btn-sm btn-plain" onClick={(e) => { e.stopPropagation(); startFocus(i.focus!, FOCUS_MINUTES); }}>Focus</button>)}
                {i.done && <button className="btn btn-sm btn-plain" onClick={(e) => { e.stopPropagation(); i.done!(); }}>{i.doneLabel}</button>}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {rest.length > 0 && (
        <>
          <div className="as-section">Then · {rest.length}</div>
          <div className="ov-follow">
            {(all ? rest : rest.slice(0, MORE)).map((i) => {
              const row = (
                <div className="ov-follow-row">
                  <button className="ov-follow-text" onClick={i.open}>
                    <span className="ov-t">{i.title}</span>
                    <span className="muted small">{i.why}</span>
                  </button>
                  {i.priority ? <Flag priority={i.priority} /> : null}
                  {button(i)}
                </div>
              );
              return i.swipe ? <Swipe key={i.key} onRight={i.swipe.done} onLeft={i.swipe.later}>{row}</Swipe> : <Fragment key={i.key}>{row}</Fragment>;
            })}
            {!all && rest.length > MORE && <button className="fc-more" onClick={() => setAll(true)}>Show {rest.length - MORE} more</button>}
          </div>
        </>
      )}
    </section>
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
