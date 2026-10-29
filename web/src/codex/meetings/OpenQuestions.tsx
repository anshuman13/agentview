import { useMemo, useState } from 'react';
import { useCodex } from '../data';
import { openQuestions, questionKey, type Question } from '../data/wiki';
import { when } from '../time';
import { save, stored } from '../../ui/util';
import { setView } from '../view';
import { meetingKey } from './MeetingList';

const RESOLVED = 'agentview.questionsResolved';

// Questions the meetings left open; Resolve hides one for good and forgets keys whose question is gone.
export function OpenQuestions({ questions }: { questions: Question[] }) {
  const { meetings } = useCodex();
  const [resolved, setResolved] = useState(() => stored<string[]>(RESOLVED, []));
  const rows = useMemo(() => questions.filter((q) => !resolved.includes(questionKey(q))), [questions, resolved]);
  if (!rows.length) return null;
  const resolve = (q: Question) => {
    const live = new Set(openQuestions(meetings).map(questionKey));
    const next = [...new Set([...resolved, questionKey(q)])].filter((k) => live.has(k));
    setResolved(next);
    save(RESOLVED, next);
  };
  return (
    <section className="mt-sec">
      <h2>Open questions<span className="mt-of">{rows.length}</span></h2>
      <ul className="wk-claims">
        {rows.map((q) => (
          <li key={questionKey(q)} className="wk-claim">
            <span className="wk-claim-text">{q.text}</span>
            <span className="wk-claim-foot">
              <button className="mt-person" onClick={() => setView({ list: 'meetings', open: meetingKey(q.meeting), person: null })}>{q.meeting.title} · {when(q.at)}</button>
              <button className="btn sm" aria-label={`Resolve ${q.text}`} onClick={() => resolve(q)}>Resolve</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
