import { useMemo } from 'react';
import { useAssistantData, useCodex } from '../data';
import { briefFor, openQuestions, priorWith, questionKey, type Meeting } from '../data/wiki';
import { resolvedQuestions } from './OpenQuestions';

// What to know before a meeting: earlier meetings with their decisions and open actions, open questions from them,
// open tasks about its people and related claims. Renders nothing without history.
export function Prep({ m, section }: { m: Meeting; section?: boolean }) {
  const snap = useAssistantData();
  const { meetings } = useCodex();
  const prior = useMemo(() => priorWith(m, meetings, snap.items), [m, meetings, snap.items]);
  const brief = useMemo(() => briefFor(m, snap.items, snap.facts), [m, snap.items, snap.facts]);
  const questions = useMemo(
    () => openQuestions(meetings).filter((q) => !resolvedQuestions().includes(questionKey(q)) && prior.some((p) => p.meeting.id === q.meeting.id && p.meeting.profile === q.profile)).slice(0, 3),
    [meetings, prior],
  );
  if (!prior.length && !questions.length && !brief.tasks.length && !brief.claims.length) return null;
  const body = (
    <>
      {prior.length > 0 && (
        <div className="as-ctx-list">
          <div className="muted small">Last time</div>
          {prior.map(({ meeting, decisions, open: openActions }) => (
            <div key={meeting.profile + meeting.id} className="as-ctx">
              <span>{meeting.title}</span>
              <span>{new Date(meeting.starts_at!).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
              {decisions[0] && <span className="as-quote">{decisions[0].split('\n')[0]}</span>}
              {openActions.length > 0 && <span className="as-due late">{openActions.length} open</span>}
            </div>
          ))}
        </div>
      )}
      {questions.length > 0 && (
        <div className="as-ctx-list">
          <div className="muted small">Open questions</div>
          {questions.map((q) => <div key={q.profile + q.text} className="as-ctx"><span className="as-quote">{q.text}</span></div>)}
        </div>
      )}
      {(brief.tasks.length > 0 || brief.claims.length > 0) && (
        <div className="as-ctx-list">
          {brief.tasks.map(({ person, items }) => (
            <div key={person} className="as-ctx">
              <span>{person}</span>
              <span className="as-due late">{items.length} open</span>
              <span className="as-quote">{items[0].title}</span>
            </div>
          ))}
          {brief.claims.map((f) => <div key={f.profile + f.id} className="as-ctx"><span className="as-quote">{f.text}</span></div>)}
        </div>
      )}
    </>
  );
  return section ? <section className="mt-sec"><h2>Prep</h2>{body}</section> : body;
}
