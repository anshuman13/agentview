import { useMemo, type ReactNode } from 'react';
import { useAssistantData } from '../data';
import { Icon } from '../../ui/Icon';
import { weekReview } from '../data/load';
import type { Fact, Meeting } from '../data/wiki';
import { when } from '../time';
import { setView, showSnack, useView } from '../view';
import { plural } from '../../ui/util';

const MAX = 8;
const hoursText = (h: number) => `${h.toFixed(1)} h`;
const text = (t: string | null) => t?.trim() || 'Untitled';
const openMeeting = (m: Meeting) => setView({ list: 'meetings', open: `${m.profile}:${m.id}`, person: null });
const dayText = (t: number) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });

function Section({ title, rows }: { title: string; rows: ReactNode[] }) {
  if (!rows.length) return null;
  return (
    <section className="mt-wk-sec">
      <div className="mt-load-head">{title} ({rows.length})</div>
      {rows.slice(0, MAX)}
      {rows.length > MAX && <div className="mt-load-share">+{rows.length - MAX} more</div>}
    </section>
  );
}

export function Week({ meetings, facts, now }: { meetings: Meeting[]; facts: Fact[]; now: number }) {
  const { items: all } = useAssistantData();
  const { filter } = useView();
  const items = useMemo(() => (filter === 'all' ? all : all.filter((i) => i.profile === filter)), [all, filter]);
  const r = useMemo(() => weekReview({ meetings, facts, items }, now), [meetings, facts, items, now]);
  const byKey = useMemo(() => new Map(meetings.map((m) => [`${m.profile}:${m.id}`, m])), [meetings]);
  const markdown = () => {
    const list = (title: string, rows: string[]) => (rows.length ? [`## ${title} (${rows.length})`, ...rows.map((x) => `- ${x}`), ''] : []);
    return [
      `# Week of ${dayText(r.start)}`,
      '',
      `${plural(r.meetings, 'meeting')}, ${hoursText(r.hours)} in meetings`,
      '',
      ...list('Decisions', r.decisions.map((d) => `${d.text} (${d.meeting.title || 'Meeting'})`)),
      ...list('New claims', r.claims.map((f) => text(f.text))),
      ...list('Tasks done', r.done.map((i) => text(i.title))),
      ...list('Open meeting actions', r.open.map((i) => text(i.title))),
    ].join('\n').trim();
  };
  const copy = () => void navigator.clipboard.writeText(markdown()).then(() => showSnack('Copied'), () => showSnack('Copy failed'));
  const empty = !r.decisions.length && !r.claims.length && !r.done.length && !r.open.length;
  return (
    <div className="mt-load">
      <div className="mt-log-bar">
        <span className="mt-load-share">Since {dayText(r.start)}: {r.meetings} meeting{r.meetings === 1 ? '' : 's'}, {hoursText(r.hours)}</span>
        <span className="spacer" />
        <button className="btn" title="Copy the week as Markdown" onClick={copy}><Icon name="copy" small /> <span>Copy</span></button>
      </div>
      <Section title="Decisions" rows={r.decisions.map((d, i) => (
        <button key={i} className="mt-log-item" onClick={() => openMeeting(d.meeting)}>
          <span className="mt-log-text">{d.text}</span>
          <span className="mt-log-from">{d.meeting.title || 'Meeting'} · {when(d.at)}</span>
        </button>
      ))} />
      <Section title="New claims" rows={r.claims.map((f) => (
        <button key={f.profile + f.id} className="mt-log-item" onClick={() => setView({ list: 'wiki', open: f.page_id ?? null, anchor: null })}>
          <span className="mt-log-text">{text(f.text)}</span>
        </button>
      ))} />
      <Section title="Tasks done" rows={r.done.map((i) => <div key={i.profile + i.id} className="mt-log-item"><span className="mt-log-text">{text(i.title)}</span></div>)} />
      <Section title="Open meeting actions" rows={r.open.map((i) => {
        const m = byKey.get(`${i.profile}:${i.meeting_id}`);
        return (
          <button key={i.profile + i.id} className="mt-log-item" onClick={() => m && openMeeting(m)}>
            <span className="mt-log-text">{text(i.title)}</span>
            {m && <span className="mt-log-from">{m.title || 'Meeting'}</span>}
          </button>
        );
      })} />
      {empty && <div className="as-empty"><Icon name="calendar" /><div>Nothing this week yet.</div></div>}
    </div>
  );
}
