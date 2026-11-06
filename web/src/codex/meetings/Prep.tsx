import { Fragment, useMemo } from 'react';
import { useAssistantData, useCodex } from '../data';
import { dayLabel } from '../data/dates';
import { agendaMarkdown } from '../data/meetingMarkdown';
import { pointsFor, theirActions } from '../data/points';
import { type Meeting } from '../data/wiki';
import { briefFor, capped, openQuestions, priorWith, questionKey } from '../data/meetings';
import { Icon } from '../../ui/Icon';
import { copyText, openMeeting, openTask } from '../view';
import { resolvedQuestions } from './OpenQuestions';
import { PointList, useMarkRaised } from './Raise';

// What to know before a meeting: points to raise with its people, earlier meetings with their decisions and open
// actions, what the attendees took on, open questions, open tasks about its people and related claims. Renders
// nothing without any of these.
const go = (open: () => void) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); open(); };

export function Prep({ m, section }: { m: Meeting; section?: boolean }) {
  const snap = useAssistantData();
  const { meetings } = useCodex();
  useMarkRaised();
  const prior = useMemo(() => priorWith(m, meetings, snap.items), [m, meetings, snap.items]);
  const brief = useMemo(() => briefFor(m, snap.items, snap.facts), [m, snap.items, snap.facts]);
  const points = useMemo(() => pointsFor(m, snap.items, meetings), [m, snap.items, meetings]);
  const theirs = useMemo(() => theirActions(m, prior.map((p) => p.meeting)), [m, prior]);
  const questions = useMemo(
    () => {
      const resolved = new Set(resolvedQuestions());
      return openQuestions(meetings).filter((q) => !resolved.has(questionKey(q)) && prior.some((p) => p.meeting.id === q.meeting.id && p.meeting.profile === q.profile)).slice(0, 3);
    },
    [meetings, prior],
  );
  if (!points.length && !prior.length && !questions.length && !brief.tasks.length && !brief.claims.length) return null;
  const copy = () => {
    const mine = [...prior.flatMap((p) => p.open), ...brief.tasks.flatMap((t) => t.items)].map((r) => r.title ?? '');
    copyText(agendaMarkdown(m, { points, actions: [...new Set([...theirs, ...mine])], questions: questions.map((q) => q.text) }));
  };
  const body = (
    <>
      {points.length > 0 && (
        <div className="as-ctx-list" onClick={(e) => e.stopPropagation()}>
          <div className="muted small">To raise</div>
          <PointList points={points} meeting={false} />
        </div>
      )}
      {prior.length > 0 && (
        <div className="as-ctx-list">
          <div className="muted small">Last time</div>
          {prior.map(({ meeting, decisions, open: openActions }) => {
            const open = go(() => openMeeting(meeting));
            const acts = capped(openActions);
            const decs = capped(decisions);
            const more = acts.more + decs.more;
            return (
              <Fragment key={meeting.profile + meeting.id}>
                <button className="as-ctx as-ctx-btn" onClick={open}>
                  <span>{meeting.title}</span>
                  <span>{dayLabel(meeting.starts_at!)}</span>
                  {openActions.length > 0 && <span className="as-due late">{openActions.length} open</span>}
                </button>
                {acts.shown.map((r) => <button key={r.id} className="as-ctx as-ctx-btn" onClick={open}><span className="as-quote">{r.title}</span></button>)}
                {decs.shown.map((d) => <button key={d} className="as-ctx as-ctx-btn" onClick={open}><span className="as-quote">{d.split('\n')[0]}</span></button>)}
                {more > 0 && <button className="as-ctx as-ctx-btn" onClick={open}><span>+{more} more</span></button>}
              </Fragment>
            );
          })}
        </div>
      )}
      {theirs.length > 0 && (
        <div className="as-ctx-list">
          <div className="muted small">They took on</div>
          {theirs.map((t) => <div key={t} className="as-ctx"><span className="as-quote">{t}</span></div>)}
        </div>
      )}
      {questions.length > 0 && (
        <div className="as-ctx-list">
          <div className="muted small">Open questions</div>
          {questions.map((q) => (
            <button key={q.profile + q.text} className="as-ctx as-ctx-btn" onClick={go(() => openMeeting(q.meeting))}>
              <span className="as-quote">{q.text}</span>
              <span>{dayLabel(q.meeting.starts_at!)}</span>
            </button>
          ))}
        </div>
      )}
      {(brief.tasks.length > 0 || brief.claims.length > 0) && (
        <div className="as-ctx-list">
          {brief.tasks.flatMap(({ person, items }) => capped(items).shown.map((r, i) => (
            <button key={person + r.id} className="as-ctx as-ctx-btn" onClick={go(() => openTask(r))}>
              <span>{person}</span>
              {i === 0 && <span className="as-due late">{items.length} open</span>}
              <span className="as-quote">{r.title}</span>
            </button>
          )))}
          {brief.claims.map((f) => <div key={f.profile + f.id} className="as-ctx"><span className="as-quote">{f.text}</span></div>)}
        </div>
      )}
      <div className="as-ctx-list"><button className="btn sm" onClick={(e) => { e.stopPropagation(); copy(); }}><Icon name="copy" small /> Copy agenda</button></div>
    </>
  );
  return section ? <section className="mt-sec"><h2>Prep</h2>{body}</section> : body;
}
