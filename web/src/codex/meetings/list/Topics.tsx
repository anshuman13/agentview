import { useMemo, useState } from 'react';
import { queryWords, rowMatcher, type Fact, type Meeting } from '../../data/wiki/wiki';
import { openQuestions, topicTimeline, type Question } from '../../data/meetings/meetings';
import { when } from '../../tasks/time';
import { Icon } from '../../../ui/Icon';
import { Row } from '../../../ui/Row';
import { openMeeting, setView } from '../../view';
import { OpenQuestions } from '../OpenQuestions';

export function TopicBar({ topics, active, fresh, onToggle, onAdd, onRemove }: { topics: string[]; active: string[]; fresh: Record<string, number>; onToggle: (t: string) => void; onAdd: (t: string) => void; onRemove: (t: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="mt-topics">
      {topics.map((t) => (
        <span key={t} className="mt-topic">
          <button className={`chip pill${active.includes(t) ? '' : ' outline'}`} aria-pressed={active.includes(t)} title="Show only meetings on this topic" onClick={() => onToggle(t)}>{t}{fresh[t] > 0 && <span className="mt-topic-new" title={`${fresh[t]} new since your last visit`}>{fresh[t]}</span>}</button>
          <button className="icon-btn" title={`Stop tracking ${t}`} aria-label={`Stop tracking ${t}`} onClick={() => onRemove(t)}><Icon name="close" small /></button>
        </span>
      ))}
      <form onSubmit={(e) => { e.preventDefault(); onAdd(text.trim().toLowerCase()); setText(''); }}>
        <input value={text} placeholder="Track a topic" aria-label="Track a topic" onChange={(e) => setText(e.target.value)} />
      </form>
    </div>
  );
}

export function TopicTimeline({ topic, meetings, facts }: { topic: string; meetings: Meeting[]; facts: Fact[] }) {
  const { entries } = useMemo(() => topicTimeline(topic, meetings, facts), [topic, meetings, facts]);
  const questions = useMemo(() => openQuestions(meetings).filter(rowMatcher<Question>(queryWords(topic), 'question', (q) => [q.text, q.meeting.title])), [topic, meetings]);
  if (!entries.length && !questions.length) return null;
  return (
    <>
      <OpenQuestions questions={questions} />
      <section>
        {entries.map((e, i) => (
          <Row
            key={i}
            leading={<Icon name={e.kind === 'claim' ? 'book' : e.kind === 'decision' ? 'check' : 'calendar'} small />}
            title={e.text}
            trailing={when(e.at)}
            onClick={() => (e.meeting ? openMeeting(e.meeting) : setView({ list: 'wiki', open: e.fact?.page_id ?? null, anchor: null }))}
          />
        ))}
      </section>
    </>
  );
}
