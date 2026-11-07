import { useMemo, useState, type ReactNode } from 'react';
import { useAssistantTable } from '../data';
import { Icon } from '../../ui/Icon';
import { EmptyState } from '../../ui/Panel';
import { Row } from '../../ui/Row';
import { Section as Head } from '../../ui/Section';
import { dayLabel } from '../data/dates';
import { hoursText, weekReview } from '../data/load';
import { unanswered, waitingByPerson } from '../data/review';
import type { Fact, Meeting } from '../data/wiki';
import { when } from '../time';
import { copyText, openMeeting, setView, useView } from '../view';
import { plural } from '../../ui/util';
import { Review } from './Review';
import { WeekGoals } from '../Goals';

const MAX = 8;
const text = (t: string | null) => t?.trim() || 'Untitled';

function Section({ title, rows }: { title: string; rows: ReactNode[] }) {
  if (!rows.length) return null;
  return (
    <section className="mt-wk-sec">
      <Head label={title} count={rows.length} />
      <div className="as-group">{rows.slice(0, MAX)}</div>
      {rows.length > MAX && <div className="mt-load-share">+{rows.length - MAX} more</div>}
    </section>
  );
}

export function Week({ meetings, facts, now }: { meetings: Meeting[]; facts: Fact[]; now: number }) {
  const all = useAssistantTable('items');
  const briefs = useAssistantTable('briefs');
  const { filter } = useView();
  const items = useMemo(() => (filter === 'all' ? all : all.filter((i) => i.profile === filter)), [all, filter]);
  const r = useMemo(() => weekReview({ meetings, facts, items }, now), [meetings, facts, items, now]);
  const byKey = useMemo(() => new Map(meetings.map((m) => [`${m.profile}:${m.id}`, m])), [meetings]);
  const markdown = () => {
    const waiting = waitingByPerson(items, now, unanswered(briefs.filter((b) => filter === 'all' || b.profile === filter)));
    const list = (title: string, rows: string[]) => (rows.length ? [`## ${title} (${rows.length})`, ...rows.map((x) => `- ${x}`), ''] : []);
    return [
      `# Week of ${dayLabel(r.start)}`,
      '',
      `${plural(r.meetings, 'meeting')}, ${hoursText(r.hours)} in meetings`,
      '',
      ...list('Decisions', r.decisions.map((d) => `${d.text} (${d.meeting.title || 'Meeting'})`)),
      ...list('New claims', r.claims.map((f) => text(f.text))),
      ...list('Tasks done', r.done.map((i) => text(i.title))),
      ...list('Open meeting actions', r.open.map((i) => text(i.title))),
      ...list('Waiting on', waiting.flatMap((g) => g.rows.map((x) => `${g.name}: ${x.title} (${plural(x.days, 'day')})`))),
    ].join('\n').trim();
  };
  const [review, setReview] = useState(false);
  const copy = () => copyText(markdown());
  const empty = !r.decisions.length && !r.claims.length && !r.done.length && !r.open.length;
  return (
    <div className="mt-load">
      <div className="mt-log-bar">
        <span className="mt-load-share">Since {dayLabel(r.start)}: {plural(r.meetings, 'meeting')}, {hoursText(r.hours)}</span>
        <span className="spacer" />
        <button className="btn" title="Done, slipped, stuck and waiting tasks" onClick={() => setReview(!review)}><Icon name="checklist" small /> <span>{review ? 'Summary' : 'Review'}</span></button>
        <button className="btn" title="Copy the week as Markdown" onClick={copy}><Icon name="copy" small /> <span>Copy</span></button>
      </div>
      {review ? <Review now={now} /> : <>
      <WeekGoals now={now} />
      <Section title="Decisions" rows={r.decisions.map((d, i) => (
        <Row key={i} lines={2} title={d.text} meta={`${d.meeting.title || 'Meeting'} · ${when(d.at)}`} onClick={() => openMeeting(d.meeting)} />
      ))} />
      <Section title="New claims" rows={r.claims.map((f) => (
        <Row key={f.profile + f.id} lines={2} title={text(f.text)} onClick={() => setView({ list: 'wiki', open: f.page_id ?? null, anchor: null })} />
      ))} />
      <Section title="Tasks done" rows={r.done.map((i) => <Row key={i.profile + i.id} plain title={text(i.title)} />)} />
      <Section title="Open meeting actions" rows={r.open.map((i) => {
        const m = byKey.get(`${i.profile}:${i.meeting_id}`);
        return <Row key={i.profile + i.id} title={text(i.title)} meta={m && (m.title || 'Meeting')} onClick={() => m && openMeeting(m)} />;
      })} />
      {empty && <EmptyState size="sm" icon="calendar" title="Nothing this week yet." />}
      </>}
    </div>
  );
}
