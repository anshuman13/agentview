import { useMemo } from 'react';
import { questionKey, type Question } from '../data/meetings/meetings';
import { when } from '../tasks/time';
import { Button } from '../../ui/Button';
import { Section, sectionCount } from '../../ui/Section';
import { openMeeting } from '../view';
import { resolveQuestion, useResolvedQuestions } from './resolvedQuestions';

// Questions the meetings left open; Resolve hides one for good on every device.
export function OpenQuestions({ questions }: { questions: Question[] }) {
  const resolved = useResolvedQuestions();
  const rows = useMemo(() => questions.filter((q) => !resolved.includes(questionKey(q))), [questions, resolved]);
  if (!rows.length) return null;
  const resolve = (q: Question) => resolveQuestion(questionKey(q));
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
