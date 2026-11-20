import { useMemo, useState } from 'react';
import { useCodex } from '../data';
import { openQuestions, questionKey, type Question } from '../data/meetings/meetings';
import { when } from '../tasks/time';
import { Button } from '../../ui/Button';
import { save, stored } from '../../ui/util';
import { Section, sectionCount } from '../../ui/Section';
import { openMeeting } from '../view';

const RESOLVED = 'agentview.questionsResolved';
export const resolvedQuestions = () => stored<string[]>(RESOLVED, []);

// Questions the meetings left open; Resolve hides one for good and forgets keys whose question is gone.
export function OpenQuestions({ questions }: { questions: Question[] }) {
  const { meetings } = useCodex();
  const [resolved, setResolved] = useState(resolvedQuestions);
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
      <Section label="Open questions" count={sectionCount(rows.length)} />
      <ul className="wk-claims">
        {rows.map((q) => (
          <li key={questionKey(q)} className="wk-claim">
            <span className="wk-claim-text">{q.text}</span>
            <span className="wk-claim-foot">
              <button className="mt-person" onClick={() => openMeeting(q.meeting)}>{q.meeting.title} · {when(q.at)}</button>
              <Button size="sm" aria-label={`Resolve ${q.text}`} onClick={() => resolve(q)}>Resolve</Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
