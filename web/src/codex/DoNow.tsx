import { useState } from 'react';
import { useAssistantStore } from './data';
import { atTime, nextNine } from './data/engine';
import type { ItemRow } from './data/sync';
import type { Meeting } from './data/wiki';
import { minutesText } from './data/plan';
import { peopleOf } from './meetings/Meetings';
import { channelOf } from './taskSource';
import { UNROLL, unrollFor, useActions } from './useActions';
import type { useNeedsYou } from './NeedsYou';
import { ago, safeHref } from '../ui/util';
import { Icon } from '../ui/Icon';
import { haptic } from '../ui/haptic';
import { openMeeting, openTask, setView, showSnack } from './view';
import { clock, when } from './time';
import { Flag } from './AddSheet';

type Act = { label: string; run?: () => void; href?: string };
type Item = { key: string; icon: string; title: string; why: string; hot?: boolean; priority?: number | null; open: () => void; act: Act; done?: () => void; doneLabel?: string };

const TOP = 3;
const MORE = 5;

// Higher first: a priority flag lifts a task above Slack, an untouched day of lateness adds a little.
const rankTask = (r: ItemRow, now: number) => (r.priority ?? 0) * 10 + Math.min(5, Math.max(0, Math.floor((now - (atTime(r.at) ?? now)) / 86400_000)));

// One list of what to do next, in order: the meeting about to start, flagged tasks, what needs me on Slack and in tasks,
// then today's tasks. The top three are numbered with one action each; the rest follow in a short list.
export function DoNow({ needs, today, nextUp, meeting, now, onPrep }: {
  needs: ReturnType<typeof useNeedsYou>;
  today: ItemRow[];
  nextUp: { label: string; tasks: ItemRow[] } | null;
  meeting: Meeting | null;
  now: number;
  onPrep: () => void;
}) {
  const store = useAssistantStore();
  const act = useActions();
  const [all, setAll] = useState(false);
  const done = (r: ItemRow) => () => { haptic('success'); act.done(r); };
  const snooze = (r: ItemRow) => {
    const at = nextNine(new Date(Math.max(atTime(r.at) ?? 0, now)), r.profile);
    void store.update(r, { at, ...unrollFor(at) }).then(() => showSnack(`Snoozed to ${when(at)}`));
  };
  const task = (r: ItemRow, why: string, hot = false): Item => ({
    key: `t:${r.profile}:${r.id}`, icon: channelOf(r).icon ?? 'circle-large-outline', title: r.title ?? '(Untitled)', why, hot, priority: r.priority,
    open: () => openTask(r), act: { label: 'Done', run: done(r) }, done: () => snooze(r), doneLabel: 'Tomorrow',
  });
  const timeOf = (r: ItemRow) => { const t = atTime(r.at); return t != null && new Date(t).getHours() + new Date(t).getMinutes() > 0 && t > now ? `at ${clock(t)}` : ''; };
  const prio = (r: ItemRow) => (['', 'Low priority', 'Medium priority', 'High priority'][r.priority ?? 0] ?? '');

  const fromNeeds: Item[] = needs.rows.map((x) => {
    switch (x.kind) {
      case 'overdue': {
        const t = atTime(x.row.at);
        return task(x.row, [t != null ? `Overdue, was due ${when(t, now)}` : 'Overdue', prio(x.row)].filter(Boolean).join(' · '), true);
      }
      case 'overdueAll': return {
        key: 'overdueAll', icon: 'warning', title: `Clear ${x.rows.length} overdue tasks`, why: x.rows.slice(0, 2).map((r) => r.title).join(', '), hot: true,
        open: () => setView({ list: 'tasks', open: null }),
        act: { label: 'Move to today', run: () => { haptic('success'); for (const r of x.rows) void store.update(r, { at: Math.max(now, new Date(now).setHours(new Date(atTime(r.at) ?? now).getHours(), 0, 0, 0)), ...UNROLL }); showSnack('Moved to today'); } },
      };
      case 'risk': return task(x.row, `Due ${when(x.due, now)}, ${minutesText(x.short)} short between meetings`, true);
      case 'ask': return {
        key: `a:${x.row.profile}:${x.row.id}`, icon: channelOf(x.row).icon ?? 'question', title: x.row.title ?? '(Untitled)', why: `Is this yours? · ${x.row.people || channelOf(x.row).label}`,
        open: () => openTask(x.row), act: { label: 'Mine', run: () => { haptic('success'); void store.update(x.row, { status: 'open' }); showSnack('Added to Today'); } },
        done: () => void store.update(x.row, { status: 'dismissed' }), doneLabel: 'Not mine',
      };
      case 'dm': {
        const c = x.chat;
        return {
          key: `d:${c.profile}:${c.id}`, icon: 'comment-discussion', title: `Reply to ${c.name ?? 'a DM'}`, why: [c.last_at && `waiting ${ago(c.last_at)}`, c.summary].filter(Boolean).join(' · '), hot: true,
          open: () => setView({ person: c.name }), act: safeHref(c.url) ? { label: 'Reply', href: safeHref(c.url) } : { label: 'Task', run: () => needs.chatTask(c) },
          done: () => needs.hideChat(c), doneLabel: 'Handled',
        };
      }
      case 'slack': return {
        key: x.keys[0], icon: 'comment', title: x.x.why || x.x.title, why: x.x.why ? `${x.x.title} · Slack` : 'Slack',
        open: () => { if (x.x.url) window.open(x.x.url, '_blank', 'noreferrer'); },
        act: x.x.url ? { label: 'Reply', href: x.x.url } : { label: 'Task', run: () => needs.bulletTask(x.x, x.profile) },
        done: () => needs.hideBullet(x.x), doneLabel: 'Handled',
      };
    }
  });
  const seen = new Set(fromNeeds.map((i) => i.key));
  const todays = [...today].filter((r) => !seen.has(`t:${r.profile}:${r.id}`)).sort((a, b) => rankTask(b, now) - rankTask(a, now) || (atTime(a.at) ?? 0) - (atTime(b.at) ?? 0))
    .map((r) => task(r, [timeOf(r) || 'Today', prio(r), r.people].filter(Boolean).join(' · ')));
  const flagged = todays.filter((i) => (i.priority ?? 0) >= 2);
  const meetingItem: Item[] = meeting ? [{
    key: `m:${meeting.profile}:${meeting.id}`, icon: 'calendar', title: meeting.title ?? 'Meeting', hot: true,
    why: [meeting.starts_at! <= now ? 'Now' : `In ${Math.max(1, Math.round((meeting.starts_at! - now) / 60000))} min`, peopleOf(meeting).slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    open: () => openMeeting(meeting), act: { label: 'Prep', run: onPrep },
  }] : [];
  const later = !todays.length && nextUp ? nextUp.tasks.map((r) => task(r, [nextUp.label, prio(r)].filter(Boolean).join(' · '))) : [];
  const items = [...meetingItem, ...flagged, ...fromNeeds, ...todays.filter((i) => !flagged.includes(i)), ...later];
  if (!items.length) return null;
  const rest = items.slice(TOP);
  const button = (i: Item) => i.act.href
    ? <a className="btn btn-sm btn-tinted" href={i.act.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{i.act.label}</a>
    : <button className="btn btn-sm btn-tinted" onClick={(e) => { e.stopPropagation(); i.act.run?.(); }}>{i.act.label}</button>;
  return (
    <section className="fc">
      <div className="as-section next">Do now</div>
      <ol className="fc-top">
        {items.slice(0, TOP).map((i, n) => (
          <li key={i.key} className={`fc-item${i.hot ? ' hot' : ''}`} onClick={i.open}>
            <span className="fc-n">{n + 1}</span>
            <div className="fc-body">
              <div className="fc-title">{i.title}</div>
              <div className="fc-why"><Icon name={i.icon} small />{i.priority ? <Flag priority={i.priority} /> : null}<span>{i.why}</span></div>
              <div className="fc-acts">
                {button(i)}
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
            {(all ? rest : rest.slice(0, MORE)).map((i) => (
              <div key={i.key} className="ov-follow-row">
                <button className="ov-follow-text" onClick={i.open}>
                  <span className="ov-t">{i.title}</span>
                  <span className="muted small">{i.why}</span>
                </button>
                {i.priority ? <Flag priority={i.priority} /> : null}
                {button(i)}
              </div>
            ))}
            {!all && rest.length > MORE && <button className="fc-more" onClick={() => setAll(true)}>Show {rest.length - MORE} more</button>}
          </div>
        </>
      )}
    </section>
  );
}
