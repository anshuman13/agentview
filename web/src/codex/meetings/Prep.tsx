import { useMemo } from 'react';
import { useAssistantData, useCodex } from '../data';
import { dayLabel } from '../data/dates';
import { agendaMarkdown } from '../data/meetings/meetingMarkdown';
import { pointsFor, theirActions } from '../data/meetings/points';
import { type Meeting } from '../data/wiki/wiki';
import { briefFor, openQuestions, priorWith, questionKey } from '../data/meetings/meetings';
import { IconButton } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { GroupList } from '../overview/DigestCard';
import type { DigestGroup } from '../overview/digest';
import { copyText, openMeeting, openTask } from '../view';
import { resolvedQuestions } from './OpenQuestions';
import { PointList, useMarkRaised } from './Raise';

// What to know before a meeting: open actions, decisions and open questions of earlier meetings with its people, open
// tasks about them, points to raise, what the attendees took on and related claims. Renders nothing without any of these.
type Line = { title: string; meta?: string; open?: () => void };

const PLAIN = ['theirs', 'claims'];

const count = (n: number, one: string) => (n ? [`${n} ${one}${n === 1 ? '' : 's'}`] : []);

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
      return openQuestions(meetings).filter((q) => !resolved.has(questionKey(q)) && prior.some((p) => p.meeting.id === q.meeting.id && p.meeting.profile === q.profile));
    },
    [meetings, prior],
  );
  if (!points.length && !prior.length && !questions.length && !brief.tasks.length && !brief.claims.length) return null;
  const meta = (meeting: Meeting) => `${meeting.title} · ${dayLabel(meeting.starts_at!)}`;
  const actions: Line[] = prior.flatMap(({ meeting, open }) => open.map((r) => ({ title: r.title ?? '', meta: meta(meeting), open: () => openMeeting(meeting) })));
  const decisions: Line[] = prior.flatMap(({ meeting, decisions: ds }) => ds.map((d, i) => ({ title: d.split('\n')[0], meta: meta(meeting), open: () => openMeeting(meeting) })));
  const asked: Line[] = questions.map((q) => ({ title: q.text, meta: meta(q.meeting), open: () => openMeeting(q.meeting) }));
  const tasks: Line[] = brief.tasks.flatMap(({ person, items }) => items.map((r) => ({ title: r.title ?? '', meta: person, open: () => openTask(r) })));
  const groups: DigestGroup<Line>[] = [
    { outcome: 'actions', label: 'Open actions', open: true, rows: actions },
    { outcome: 'decisions', label: 'Decisions', open: false, rows: decisions },
    { outcome: 'questions', label: 'Open questions', open: true, rows: asked },
    { outcome: 'tasks', label: 'Tasks', open: true, rows: tasks },
    { outcome: 'theirs', label: 'They took on', open: true, rows: theirs.map((t) => ({ title: t })) },
    { outcome: 'claims', label: 'Related claims', open: true, rows: brief.claims.map((f) => ({ title: f.text ?? '' })) },
  ].filter((g) => g.rows.length);
  const copy = () => {
    const mine = [...prior.flatMap((p) => p.open), ...brief.tasks.flatMap((t) => t.items)].map((r) => r.title ?? '');
    copyText(agendaMarkdown(m, { points, actions: [...new Set([...theirs, ...mine])], questions: questions.map((q) => q.text) }));
  };
  const badges = [
    ...(actions.length ? [`${actions.length} open`] : []),
    ...count(decisions.length, 'decision'),
    ...count(asked.length, 'question'),
    ...count(tasks.length, 'task'),
  ];
  return (
    <div className={section ? 'mt-sec' : undefined} onClick={(e) => e.stopPropagation()}>
      <Section label="Prep" action={(
        <>
          {badges.map((b) => <span key={b} className="muted">{b}</span>)}
          <IconButton icon="copy" label="Copy agenda" size="sm" onClick={copy} />
        </>
      )} />
      <div className="ov-group">
        {groups.map((g) => (
          <GroupList key={g.outcome} foldKey={`codex.prepFold.${m.profile}:${m.id}:${g.outcome}`} capOpen group={g} render={(r) => PLAIN.includes(g.outcome) ? <Row plain lines={2} title={r.title} /> : <Row title={r.title} meta={r.meta} onClick={r.open} />} />
        ))}
      </div>
      {points.length > 0 && (
        <>
          <Section label="To raise" count={points.length} />
          <PointList points={points} meeting={false} />
        </>
      )}
    </div>
  );
}
